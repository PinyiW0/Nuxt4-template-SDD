# SSE（Server-Sent Events）實作 pattern

EventSource 單向推播的完整實作。萃取自實戰 SSE store，已驗證過重連、補抓、去重、cleanup、首載時序與 token 過期的坑。

## 何時用 SSE

伺服器要主動推、前端不需回傳（通知、進度、即時 feed、儀表板）。SSE 比 WebSocket 簡單：純文字、瀏覽器原生自動重連、走一般 HTTP（無需升級協定）。需要雙向就改用 WebSocket。

## 連線模型（對齊本範例後端慣例；連線 / 訂閱形狀以各自 api-spec 為準）

- **訂閱透過連線 URL 的 query 達成**：`/events?token={jwt}&channels=practice:{id},account:{id}`。無 `connectionId`、無額外 REST 訂閱端點。
- **變更訂閱 = 以新 channels 重連**；channels 不變則沿用既有連線（避免無謂斷線）。
- **連線預設必訂自己的 `account:{accountId}`**（個人通知頻道），其餘頻道按需加入。
- **auth 放哪以 api-spec 為準，別寫死**：原生 `EventSource` 無法帶 header → 原生只剩 query token 或 cookie；要用 header 認證得改 `@microsoft/fetch-event-source`（非原生）。選哪個是後端合約（`route-map.realtime.auth`）。本後端 spec 定義 `/events` 為 `?token=` query（`security: []`），故走 query。**query token 僅用短效 token**（會進 access log / 瀏覽器歷史）。
- **連線前置（preflight）三件事**：等頁面 load 完成、驗 token exp（快過期先 refresh）、同 tick 多次開連線合併成一次——見下方 store 範例與踩坑速查。

## 信封型別：鬆散 data 用 discriminated union

SSE 信封固定外層 `{ id, type, channel, timestamp, data }`，`data` 隨 `type` 變形。OpenAPI 對 `data` 多半給鬆散型別（`Record<string, never>`），**前端手寫 discriminated union 補語意**——codegen 補不了（見 `openapi-codegen.md` § 8）。

用 `type` 當 discriminator（每個 `type` 字面量綁對應 `data` 形狀），`switch (evt.type)` 才會自動收斂 `evt.data`、`handleEvent` 免寫 `as`：

```ts
// app/types/api/notifications.ts
interface SseBase { id: string, channel: string, timestamp: string }
interface ConnectEventData { channels?: string[] }                       // connected 歡迎訊息：回報 RBAC 剔除後的實際頻道
interface PitchCreatedEventData { pitchId: string, practiceId: string }  // 只帶輕量索引，不含完整資料
interface PracticeAiEventData { practiceId: string }

// 真正的 discriminated union：type 綁定對應 data
export type NotificationEvent
  = | (SseBase & { type: 'connected', data: ConnectEventData })
    | (SseBase & { type: 'pitchCreated', data: PitchCreatedEventData })
    | (SseBase & { type: 'practiceAiStarted', data: PracticeAiEventData })
    | (SseBase & { type: 'practiceAiStopped', data: PracticeAiEventData })
```

> **不要寫成 `data: A | B | C` 鬆散 union**——那樣 `switch (evt.type)` 不會收斂 `evt.data`，`handleEvent` 又得寫 `evt.data as XxxData`，等於沒做到 discriminated union（這是 review 抓到的反例）。
> codegen 的 `SseEventEnvelope` 是鬆散信封（`data: Record<string, never>`、`type` 是 enum union）；上面手寫 union 疊在它之上補語意，對齊寫法（`Omit<SseBase, 'type' | 'data'> & {...}`）見 `openapi-codegen.md` § 8。

## Pinia store：連線集中 + 重連補抓

核心 store（萃取自 `app/stores/notifications.ts`，保留教學關鍵段）：

> **此範例把「連線層 + 領域層」放同一 store（對齊實戰、求教學完整）。跨專案重用時應拆開**：連線層只管 status / channels / raw event 流；`pitchList`、`fetchPracticePitches` 這類業務概念移到領域 store 消費事件（見 SKILL.md「傳輸層 vs 領域層」註）。

```ts
import { useEventSource } from '@vueuse/core'

type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

// 不驗簽，只解 JWT payload 判斷 exp 是否（快）到期——連線前決定要不要先 refresh。
// 預留 15s margin，避免「組完 URL → 後端驗證」之間剛好跨過 exp。
function isAccessTokenAlive(token: string): boolean {
  try {
    const json = atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = (JSON.parse(json) as { exp?: number }).exp
    return typeof exp !== 'number' || exp * 1000 > Date.now() + 15_000
  }
  catch { return true } // 解不開就當有效，交給後端判
}

export const useNotificationsStore = defineStore('notifications', () => {
  const status = ref<ConnectionStatus>('idle')
  const pitchList = ref<PitchListItem[]>([])
  const activePracticeIds = reactive<Set<string>>(new Set())  // 想保持訂閱的 id；連線依此組 channels

  let closeFn: (() => void) | null = null
  let connScope: ReturnType<typeof effectScope> | null = null  // 包住本條連線的 watcher，重連/離場一次回收
  let currentUrl: string | null = null      // channels 不變則不重連
  let hasConnectedOnce = false               // 區分首次連線 vs 重連 → 決定要不要補抓
  let openScheduled = false                  // 合併同一 tick 內多次開連線呼叫
  let currentReachedOpen = false             // 本條連線是否曾進入 OPEN（判斷「從未 OPEN 就 CLOSED」）
  let reopenTimer: ReturnType<typeof setTimeout> | null = null  // 從未 OPEN 的手動重連 timer
  let reopenBackoffMs = 500                  // 手動重連 backoff；連上後 reset

  // --- 去重：upsert by id（補抓會與即時事件、進場 backfill 重疊）---
  function upsertPitch(pitch: PitchListItem) {
    const idx = pitchList.value.findIndex(p => p.pitchId === pitch.pitchId)
    if (idx >= 0) pitchList.value[idx] = pitch
    else pitchList.value.push(pitch)
  }
  function backfill(pitches: PitchListItem[]) { for (const p of pitches) upsertPitch(p) }

  // --- 重連補抓：對所有訂閱中的資源重抓，補齊斷線期間漏掉的 ---
  async function refetchPractice(practiceId: string) {
    try { backfill(await fetchPracticePitches(practiceId)) }
    catch { /* 補抓失敗忽略，不影響後續即時事件 */ }
  }
  async function refetchActive() {
    // 並行重抓（訂閱多時，序列 await 會疊加延遲）
    await Promise.all([...activePracticeIds].map(id => refetchPractice(id)))
  }

  // --- 事件分派：switch by type，default 忽略未知型別（向前相容）---
  function handleEvent(raw: string) {
    let evt: NotificationEvent
    try { evt = JSON.parse(raw) as NotificationEvent } catch { return }  // 壞 JSON 忽略

    if (evt.type === 'connected') {
      // 第二次（含）以後的 connected = 重連 → 補抓斷線期間漏掉的
      if (hasConnectedOnce) void refetchActive()
      hasConnectedOnce = true
    }
    else if (evt.type === 'pitchCreated') {
      // evt.data 已被 union 收斂成 PitchCreatedEventData（免 as）。
      // 粒度注意：優先抓「單顆球」（GET /pitches/{id}）再 upsert；這裡退回重抓整場，
      // 是因為本後端只有 practice-pitches 端點——有單筆端點時別重抓整場（連投時 O(n²)）。
      void refetchPractice(evt.data.practiceId)
    }
    // ...其餘 type
  }

  function buildChannels(): string[] {
    const { accountId } = storeToRefs(useAuthStore())
    const channels: string[] = []
    if (accountId.value) channels.push(`account:${accountId.value}`)  // 必訂個人頻道
    for (const id of activePracticeIds) channels.push(`practice:${id}`)
    return channels
  }

  // 關連線 + 停該連線的所有 watcher（effectScope）+ 清手動重連 timer → 重連/離場共用
  function teardownConnection() {
    closeFn?.(); closeFn = null
    connScope?.stop(); connScope = null
    if (reopenTimer) { clearTimeout(reopenTimer); reopenTimer = null }
  }

  // --- 對外開連線入口：同一 tick 的多次呼叫合併成一次 ---
  // connect()+subscribe()、unsubscribe(prev)+subscribe(next) 都會在同一 tick 連叫兩次；
  // 不合併會連開多條、把還在 CONNECTING 的前一條 close 掉——跨來源連線建立較慢，
  // 中途被關會被瀏覽器標成「CORS request did not succeed」的假錯誤（其實不是 CORS 問題）。
  // 合併到 microtask 後，用「最終 channels」只實際開一次。
  function openConnection() {
    if (!import.meta.client) return  // SSR 無連線
    if (openScheduled) return
    openScheduled = true
    queueMicrotask(async () => {
      try { await doOpenConnection() }
      finally { openScheduled = false }
    })
  }

  // --- 建立 / 重建連線（channels 不變則不重連）---
  async function doOpenConnection() {
    // ① 首載期不連：頁面 load 中建立的 EventSource 會被中斷
    //（Firefox「interrupted while the page was loading」，跨來源被標成假 CORS 失敗）
    // → 等 window load 完成再連；client 端導航時 readyState 已 complete，不受影響
    if (document.readyState !== 'complete') {
      window.addEventListener('load', () => openConnection(), { once: true })
      return
    }

    // ② token preflight：（近）過期先 refresh 再組 URL。把死 token 塞進 ?token= 會 401，
    // 而重試同一組舊 URL 永遠 401 → 必須換新 token、組新 URL
    const auth = useAuthStore()
    if (auth.token && !isAccessTokenAlive(auth.token)) {
      if (!await auth.refresh()) return
      // refresh 的 XHR 也算頁面 network 活動，緊挨著建 EventSource 仍可能被中斷 → 隔一個 rAF
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }

    const { token } = storeToRefs(auth)
    const channels = buildChannels()
    // auth 放哪以 api-spec 為準（route-map.realtime.auth）；本後端是 ?token= query
    const url = `${resolveApiBaseUrl()}/api/v1/events?token=${token.value ?? ''}&channels=${encodeURIComponent(channels.join(','))}`

    if (url === currentUrl && (status.value === 'connecting' || status.value === 'open'))
      return  // 連線目標未變且仍在線 → 不重連

    teardownConnection()        // 關舊連線 + 停舊 watcher，以新 channels 重連
    currentUrl = url
    currentReachedOpen = false
    status.value = 'connecting'

    // 每條連線的 watcher 綁進 effectScope → 重連/離場 scope.stop() 一次回收，避免洩漏
    connScope = effectScope()
    connScope.run(() => {
      const { data, error, status: esStatus, close } = useEventSource(url, [], {
        // autoReconnect 只會拿「同一組 URL」重試：對「從未 OPEN 就 CLOSED」的失敗
        //（stale token 401、首載期被中斷、後端拒絕）永遠救不回 → 關掉，
        // 由 esStatus watch 分流：從未 OPEN → backoff 重走 preflight（可能換新 token / URL）
        autoReconnect: false,
      })
      closeFn = close

      watch(data, (value) => { if (value) handleEvent(value) })
      watch(error, (err) => { if (err) status.value = 'error' })
      watch(esStatus, (s) => {
        if (s === 'OPEN') {
          status.value = 'open'
          currentReachedOpen = true
          reopenBackoffMs = 500 // 連上了 → 重置退避
        }
        else if (s === 'CLOSED') {
          status.value = 'closed'
          // 從未 OPEN 就 CLOSED（首載中斷 / 401 / 後端拒絕）→ 手動 backoff 重連；
          // OPEN 過才斷屬正常斷線，由下一次 openConnection()（事件 / 訂閱變更）接手
          if (!currentReachedOpen) scheduleReopen()
        }
      })
    })
  }

  // 「從未 OPEN」失敗的手動重連：backoff 上限 15s（長時間離線不打爆後端）；
  // 清 currentUrl 讓 doOpenConnection 重走完整 preflight，不拿同 URL 踩同一個錯
  function scheduleReopen() {
    if (reopenTimer) return
    const delay = Math.min(reopenBackoffMs, 15_000)
    reopenBackoffMs = Math.min(reopenBackoffMs * 2, 15_000)
    reopenTimer = setTimeout(() => {
      reopenTimer = null
      currentUrl = null
      openConnection()
    }, delay)
  }

  function subscribe(practiceId: string) { activePracticeIds.add(practiceId); openConnection() }
  function unsubscribe(practiceId: string) { activePracticeIds.delete(practiceId); openConnection() }

  function close() {
    teardownConnection(); currentUrl = null
    reopenBackoffMs = 500; currentReachedOpen = false
    if (status.value !== 'error') status.value = 'closed'
  }

  // --- 離場完整重置：關連線 + 清資料 + 清訂閱 + 重置旗標 ---
  function reset() {
    close()
    pitchList.value = []
    activePracticeIds.clear()
    hasConnectedOnce = false
    status.value = 'idle'
  }

  return { status, pitchList, backfill, upsertPitch, handleEvent, subscribe, unsubscribe, close, reset }
})
```

## 元件接法

```ts
// pages 進場：seed → 訂閱 → 進場 backfill；離場 reset
const store = useNotificationsStore()
onMounted(async () => {
  store.subscribe(practiceId)              // 加 channel 並（重）連
  store.backfill(await fetchPracticePitches(practiceId))  // 首次進場打底（重連補抓由 store 自理）
})
onBeforeUnmount(() => store.reset())       // 離場關連線、清乾淨
```

元件**只**呼叫 store 方法、讀 `store.status` / `store.pitchList`，不自己碰 EventSource。

## Mock SSE 端點（給本地開發 / E2E）

正式後端 SSE 上線前，用 Nitro 的 `createEventStream` 做 in-memory mock。後端真上線後連端點帶 mock hub 一起移除即可。

```ts
// server/api/v1/events.get.ts
export default defineEventHandler((event) => {
  const channels = String(getQuery(event).channels ?? '').split(',').map(c => c.trim()).filter(Boolean)
  const stream = createEventStream(event)
  const connectionId = nextConnectionId()
  registerConnection(connectionId, stream, channels)

  // 握手：connected 歡迎訊息（信封對齊 SseEventEnvelope）
  void stream.push(JSON.stringify({
    id: `evt-${connectionId}`, type: 'connected', channel: 'system',
    timestamp: new Date().toISOString(), data: { channels },
  }))

  // 30s 心跳維持連線
  const heartbeat = setInterval(() => {
    void stream.push({ event: 'heartbeat', data: new Date().toISOString() })
  }, 30000)

  stream.onClosed(async () => { clearInterval(heartbeat); removeConnection(connectionId); await stream.close() })
  return stream.send()
})
```

mock hub（`server/mock/sse-hub.ts`）維護 `Map<connectionId, { stream, channels }>`，`broadcast(channel, payload)` 對訂閱該 channel 的連線推送。另曝 `subscribedChannels()` 供 E2E 確認訂閱已建立。

## 踩坑速查

| 坑 | 症狀 | 解 |
|----|------|----|
| 把「token 走 query」當通則寫死 | 換到 cookie / header 認證的後端就錯 | auth 放哪以 **api-spec** 為準（`route-map.realtime.auth`）；原生只能 query / cookie，要 header 用 `fetch-event-source` |
| 心跳用 SSE 註解行 `: heartbeat` | h3 `EventStream` 無法輸出純註解行 | 改送具名 `heartbeat` 事件，前端忽略（不觸發 message 解析） |
| 首載期就建 EventSource | Firefox「interrupted while the page was loading」；跨來源被標成假 CORS 錯誤 | `readyState !== 'complete'` → 等 window load 再連 |
| stale token 塞進 `?token=` | 401，且重試同一組 URL 永遠 401 | 連線前驗 exp（留 margin），快過期先 `refresh()` 再組 URL；refresh 後隔一個 rAF 再連 |
| 同 tick 連呼叫 connect/subscribe | 連開多條、CONNECTING 中被 close → 假 CORS 錯誤 | 開連線入口 microtask 合併，用最終 channels 只開一次 |
| 指望 autoReconnect 救「從未 OPEN」的失敗 | 只會拿同 URL 重試，永遠救不回 | 分流：從未 OPEN 的 CLOSED → 手動 backoff + 清 URL 重走 preflight |
| 重連不補抓 | 斷線期間的事件永久遺失 | `hasConnectedOnce` 區分重連 → `refetchActive()` |
| 重連不停舊 watcher | 每次重連洩漏一批 `watch`（store action 內無 active scope） | 連線 watcher 綁 `effectScope`，重連 / 離場 `scope.stop()` |
| 信封用 `data: A \| B \| C` 鬆散 union | `switch` 不收斂，又得寫 `as` | 真正的 discriminated union（`type` 綁對應 `data`） |
| 連線 store 混進業務清單 | 連線層綁死單一業務、難跨專案 | 連線層只管連線；領域清單放領域 store |
| 單顆事件重抓整個集合 | 連投時 O(n²) 流量 | 優先抓單一實體；無單筆端點才退回抓集合 |
| `autoReconnect: true` 無上限 | server 真掛時固定間隔狂敲（非指數退避） | 設 `retries` 上限或 `onFailed` 退避；手動 backoff 設上限（如 15s） |
| 推播塞完整 model | payload 肥、與 backfill 兩套渲染路徑 | 事件只帶 id → REST 補整包 → upsert 去重 |
| 盲目 push | 補抓與即時事件重複 → 畫面重複項 | 一律 `upsert by id` |
| 每次訂閱都重連 | channels 沒變也斷線重連，畫面閃動 | `url === currentUrl && 在線` 則略過 |
| 離場沒 cleanup | 連線洩漏、`hasConnectedOnce` 殘留汙染下次 | `reset()`：close + 停 scope + 清資料 + 清訂閱 + 重置旗標 |
| SSR 建連 | hydration 錯誤、重複連線 | `if (!import.meta.client) return` |

## Checklist

- [ ] 連線集中在 Pinia store，元件只讀狀態 / 呼叫方法
- [ ] （跨專案）連線層與領域層分開：連線 store 不放業務清單 / refetch
- [ ] 狀態機 `idle/connecting/open/closed/error` 對映可讀 UI 文字
- [ ] `if (!import.meta.client) return` 守住 SSR；首載未完成（`readyState !== 'complete'`）等 window load 再連
- [ ] auth 放哪以 api-spec 為準（`route-map.realtime.auth`）；query token 僅用短效，別寫死成通則
- [ ] 連線前驗 token exp（留 margin），快過期先 refresh 再組 URL
- [ ] 開連線入口同 tick 合併（microtask、最終 channels 只開一次）
- [ ] 連線 watcher 綁 `effectScope`，重連 / 離場 `scope.stop()`
- [ ] 重連分流：「從未 OPEN 就 CLOSED」→ 手動 backoff（設上限）+ 清 URL 重走 preflight；用內建 `autoReconnect` 時設 `retries` 上限
- [ ] `hasConnectedOnce` 區分首次 vs 重連；重連 `refetchActive()` 補抓（並行）
- [ ] 事件只帶索引 → REST 補整包 → `upsert by id` 去重；優先抓單一實體，無單筆端點才抓集合
- [ ] channels 不變不重連；變更訂閱以新 URL 重連
- [ ] 信封用**真** discriminated union（`type` 綁 `data`，`switch` 自動收斂、免 `as`，default 忽略未知）
- [ ] 離場 `reset()`：close + 停 scope + 清資料 + 清訂閱 + 重置旗標
- [ ] 壞 JSON / 補抓失敗都靜默忽略，不中斷後續事件
