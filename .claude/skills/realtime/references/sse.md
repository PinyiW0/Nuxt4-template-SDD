# SSE（Server-Sent Events）實作 pattern

EventSource 單向推播的完整實作。萃取自實戰 SSE store，已驗證過重連、補抓、去重、cleanup、首載時序與 token 過期的坑。

## 何時用 SSE

伺服器要主動推、前端不需回傳（通知、進度、即時 feed、儀表板）。SSE 比 WebSocket 簡單：純文字、瀏覽器原生自動重連、走一般 HTTP（無需升級協定）。需要雙向就改用 WebSocket。

## 連線模型（對齊本範例後端慣例；連線 / 訂閱形狀以各自 api-spec 為準）

- **訂閱透過連線 URL 的 query 達成**：`/events?token={jwt}&channels=watch:{id},account:{id}`。無 `connectionId`、無額外 REST 訂閱端點。
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
interface SightingCreatedEventData { sightingId: string, watchId: string }  // 只帶輕量索引，不含完整資料
interface WatchCaptureEventData { watchId: string }

// 真正的 discriminated union：type 綁定對應 data
export type NotificationEvent
  = | (SseBase & { type: 'connected', data: ConnectEventData })
    | (SseBase & { type: 'sightingCreated', data: SightingCreatedEventData })
    | (SseBase & { type: 'watchCaptureStarted', data: WatchCaptureEventData })
    | (SseBase & { type: 'watchCaptureStopped', data: WatchCaptureEventData })
```

> **不要寫成 `data: A | B | C` 鬆散 union**——那樣 `switch (evt.type)` 不會收斂 `evt.data`，`handleEvent` 又得寫 `evt.data as XxxData`，等於沒做到 discriminated union（這是 review 抓到的反例）。
> codegen 的 `SseEventEnvelope` 是鬆散信封（`data: Record<string, never>`、`type` 是 enum union）；上面手寫 union 疊在它之上補語意，對齊寫法（`Omit<SseBase, 'type' | 'data'> & {...}`）見 `openapi-codegen.md` § 8。

## Pinia store：連線集中 + 重連補抓

核心 store（萃取自 `app/stores/notifications.ts` 並回填 2026-08 的三個實戰教訓——見本節末「這份範例修過的三個 bug」）：

> **此範例把「連線層 + 領域層」放同一 store（對齊實戰、求教學完整）。跨專案重用時應拆開**：連線層只管 status / channels / raw event 流；`sightingList`、`fetchWatchSightings` 這類業務概念移到領域 store 消費事件（見 SKILL.md「傳輸層 vs 領域層」註）。

```ts
import { effectScope, type EffectScope } from 'vue'
import { useEventSource } from '@vueuse/core'

type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

const MAX_BACKOFF_MS = 60_000   // 重連間隔上限。SPA 常駐一整天不設放棄上限，靠拉長間隔壓請求量
const ERROR_LIST_LIMIT = 20     // 錯誤紀錄設上限，長時間離線不無限堆積

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
  const sightingList = ref<SightingListItem[]>([])
  const errorList = ref<Event[]>([])

  // 想保持訂閱的 channel id → 訂閱者數量。**不是 Set**：SPA 導航時新舊頁面並存
  // （框架的 Suspense/路由通常是「新頁 setup 先於舊頁 unmount」），同一頻道被兩個
  // 頁面同時訂閱是常態；先離開的頁面只能退掉自己那一份，不能把還在用的頻道退掉。
  const activeWatchIds = reactive(new Map<string, number>())

  // 一條連線 = 一個可整組銷毀的 scope。EventSource 與它所有的監聽器都收在這裡，
  // 關閉／重連時整組 stop()，舊監聽器就在結構上不可能再被呼叫——不用 `manuallyClosed`
  // 這類旗標去區分「主動關閉」與「異常斷線」：旗標要在對的時機設定與復原，時序一亂
  // 就出錯（重連迴圈）；scope 銷毀沒有這個問題。
  let connectionScope: EffectScope | null = null
  let currentUrl: string | null = null      // channels 不變則不重連
  let hasConnectedOnce = false               // 區分首次連線 vs 重連 → 決定要不要補抓
  let openScheduled = false                  // 合併同一 tick 內多次開連線呼叫
  let reopenTimer: ReturnType<typeof setTimeout> | null = null
  let backoffMs = 500                        // 重連 backoff；連上後 reset

  // --- 去重：upsert by id（補抓會與即時事件、進場 backfill 重疊）---
  function upsertSighting(sighting: SightingListItem) {
    const idx = sightingList.value.findIndex(p => p.sightingId === sighting.sightingId)
    if (idx >= 0) sightingList.value[idx] = sighting
    else sightingList.value.push(sighting)
  }
  function backfill(sightings: SightingListItem[]) { for (const p of sightings) upsertSighting(p) }

  // --- 重連補抓：對所有訂閱中的資源重抓，補齊斷線期間漏掉的 ---
  async function refetchWatch(watchId: string) {
    try { backfill(await fetchWatchSightings(watchId)) }
    catch { /* 補抓失敗忽略，不影響後續即時事件 */ }
  }
  async function refetchActive() {
    // 並行重抓（訂閱多時，序列 await 會疊加延遲）
    await Promise.all([...activeWatchIds.keys()].map(id => refetchWatch(id)))
  }

  // --- 事件分派：switch by type，default 忽略未知型別（向前相容）---
  function handleEvent(raw: string) {
    let evt: NotificationEvent
    try { evt = JSON.parse(raw) as NotificationEvent } catch { return }  // 壞 JSON / 心跳等非事件訊息忽略

    if (evt.type === 'connected') {
      // 第二次（含）以後的 connected = 重連 → 補抓斷線期間漏掉的
      if (hasConnectedOnce) void refetchActive()
      hasConnectedOnce = true
    }
    else if (evt.type === 'sightingCreated') {
      // evt.data 已被 union 收斂成 SightingCreatedEventData（免 as）。
      // 粒度注意：優先抓「單筆事件」（GET /sightings/{id}）再 upsert；這裡退回重抓整場，
      // 是因為本後端只有 watch-sightings 端點——有單筆端點時別重抓整場（密集出現時 O(n²)）。
      void refetchWatch(evt.data.watchId)
    }
    // ...其餘 type
  }

  function buildChannels(): string[] {
    const { accountId } = storeToRefs(useAuthStore())
    const channels: string[] = []
    if (accountId.value) channels.push(`account:${accountId.value}`)  // 必訂個人頻道
    for (const id of activeWatchIds.keys()) channels.push(`watch:${id}`)
    return channels
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

    const auth = useAuthStore()

    // ② 【bug#3 修法】沒登入就不該有連線，順手關掉舊的。
    // 這道守衛必須放在「開連線」的唯一入口，因為登出的時序是：
    // 清 token → 導向登入頁 → 舊頁面才 unmount → 走 unsubscribe() → unsubscribe
    // 結尾一律又會呼叫 openConnection()。只在 watch(accountId) 那層 reset()（見下）
    // 是不夠的：那次 reset 之後，unsubscribe 還會把一條空 token、空 channels 的
    // 連線重新開回來——真後端下每次都 401，配合下方的重連機制會變成每 60s 打一次
    // 打到分頁關閉為止。
    if (!auth.token) { close(); return }

    // ③ token preflight：（近）過期先 refresh 再組 URL。把死 token 塞進 ?token= 會 401，
    // 而 EventSource 的內建自動重連只會拿同一組舊 URL 重試，永遠 401 → 必須換新 token
    if (!isAccessTokenAlive(auth.token)) {
      if (!await auth.refresh()) return
      // refresh 的 XHR 也算頁面 network 活動，緊挨著建 EventSource 仍可能被中斷 → 隔一個 rAF
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }

    const { token } = storeToRefs(auth)
    const channels = buildChannels()

    // ④ 沒有任何頻道可訂 → 連了也收不到東西，不連
    if (channels.length === 0) { close(); return }

    // auth 放哪以 api-spec 為準（route-map.realtime.auth）；本後端是 ?token= query
    const url = `${resolveApiBaseUrl()}/api/v1/events?token=${encodeURIComponent(token.value ?? '')}&channels=${encodeURIComponent(channels.join(','))}`

    if (url === currentUrl && (status.value === 'connecting' || status.value === 'open'))
      return  // 連線目標未變且仍在線 → 不重連

    // 先整組銷毀舊連線（含監聽器），再建新的——見上方 connectionScope 的說明
    connectionScope?.stop()
    if (reopenTimer) { clearTimeout(reopenTimer); reopenTimer = null }
    currentUrl = url
    status.value = 'connecting'

    connectionScope = effectScope(true)
    connectionScope.run(() => {
      const { eventSource, error, status: esStatus } = useEventSource(url, [], {
        autoReconnect: false, // 自動重連只會拿同一組 URL 重試，過期 token 永遠救不回，關掉自己管
      })

      // 【bug#2 修法】直接掛 message listener，不看 vueuse 的 data ref：
      // 瀏覽器把同一個網路封包裡的多筆事件在同一個 task 內連續 dispatch 時，
      // 「單一 state + watch」的寫法後一筆會蓋掉前一筆，watch（pre-flush 批次）
      // 只看得到最後那筆。鈴聲型事件（sightingCreated）有 refetch 自癒看不出來，
      // 但資料型事件（就地改狀態、不重抓的那種）漏掉會永遠停在舊狀態。
      watch(eventSource, (es, _prev, onCleanup) => {
        if (!es) return
        const onMessage = (ev: MessageEvent<string>) => handleEvent(ev.data)
        es.addEventListener('message', onMessage)
        onCleanup(() => es.removeEventListener('message', onMessage))  // es 換掉或 scope 停時解掛，避免重複掛
      }, { immediate: true })

      watch(error, (err) => {
        if (err) {
          errorList.value = [...errorList.value, err].slice(-ERROR_LIST_LIMIT)
          status.value = 'error'
        }
      })

      watch(esStatus, (s) => {
        if (s === 'OPEN') {
          status.value = 'open'
          backoffMs = 500 // 連上了 → 重置退避
        }
        else if (s === 'CLOSED') {
          // 【bug#1 修法】走到這裡「一定是」非預期斷線——主動關閉（換 channels、
          // close()）會先 stop 掉本 scope，這個 watcher 就不會再被呼叫。舊寫法只在
          // 「從未 OPEN 過」時重連，理由是「OPEN 過才斷交給下一次 openConnection
          // 接手」——但 autoReconnect: false 時沒有「下一次」，訂閱不變的話永遠
          // 不會有人再呼叫 openConnection，連線就從此死亡、UI 不再更新且沒有任何
          // 錯誤訊號。CLOSED 一律排重連，不分「有沒有 OPEN 過」。
          status.value = 'closed'
          scheduleReopen()
        }
      })
    })
  }

  // 有 backoff 的手動重連：清 currentUrl 讓 doOpenConnection 重新做完整 preflight
  // （含換新 token）。不設放棄上限——SPA 常駐整天，網路斷了要能自己接上；改以拉長
  // 間隔上限（60s）壓住「重試也不會好」的情況（後端掛掉、token 被撤銷、頻道無權限）
  // 的請求量。
  function scheduleReopen() {
    if (reopenTimer) return
    const delay = Math.min(backoffMs, MAX_BACKOFF_MS)
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
    reopenTimer = setTimeout(() => {
      reopenTimer = null
      currentUrl = null
      openConnection()
    }, delay)
  }

  // 訂閱：加計數。同一個 channel 被訂第二次只加數字，channels 沒變 doOpenConnection
  // 比對 URL 後不會重連。
  function subscribe(watchId: string) {
    activeWatchIds.set(watchId, (activeWatchIds.get(watchId) ?? 0) + 1)
    openConnection()
  }
  // 退訂：計數歸零才真的移除頻道並重連（仍有 account 頻道則維持連線）
  function unsubscribe(watchId: string) {
    const rest = (activeWatchIds.get(watchId) ?? 0) - 1
    if (rest > 0) activeWatchIds.set(watchId, rest)
    else activeWatchIds.delete(watchId)
    openConnection()
  }

  function close() {
    connectionScope?.stop(); connectionScope = null
    currentUrl = null
    if (reopenTimer) { clearTimeout(reopenTimer); reopenTimer = null }
    backoffMs = 500
    if (status.value !== 'error') status.value = 'closed'
  }

  // 完整重置：關連線 + 清所有資料殘留。只給「確定沒有任何頁面在用」的場合（登出）。
  // 【bug#3 修法】頁面 unmount 絕不呼叫這個——見下方「元件接法」。
  function reset() {
    close()
    sightingList.value = []
    errorList.value = []
    activeWatchIds.clear()
    hasConnectedOnce = false
    status.value = 'idle'
  }

  // 登出（含 refresh 失敗轉登出）→ 收掉資料殘留。由本 store 觀察 auth 狀態，
  // 不讓 authStore 反過來呼叫本 store——本 store 已經依賴 authStore，反向依賴
  // 會形成循環 import。這層只負責清「資料殘留」（跨帳號污染，如已翻亮清單、
  // 錯誤紀錄）；「連線本身」由上面 doOpenConnection 的 ② 守衛負責——兩層缺一不可，
  // 光有這層不夠（見 ② 的說明），光有 ② 不夠（不會清資料殘留）。
  if (import.meta.client) {
    const { accountId } = storeToRefs(useAuthStore())
    watch(accountId, (id, prev) => {
      if (prev !== id) reset()  // 涵蓋登出（id 變空）與換帳號（id 變成另一個值），不然舊帳號資料會沿用到新帳號
    })
  }

  return { status, sightingList, errorList, backfill, upsertSighting, handleEvent, subscribe, unsubscribe, close, reset }
})
```

### 這份範例修過的三個 bug

實戰中這三個 pattern 曾經是本範例（更早版本）教的寫法，上線後才在真實環境炸出來，記錄下來避免重蹈：

| # | 舊寫法 | 症狀 | 教訓 |
|---|--------|------|------|
| 1 | CLOSED 只在「從未 OPEN 過」時重連（`currentReachedOpen` 旗標分流） | 連線曾經正常，某次斷線後畫面永遠不再更新，沒有任何錯誤訊號 | `autoReconnect: false` 沒有「下一次」可以接手；CLOSED 必須一律排重連 |
| 2 | `watch(data, ...)` 讀事件 | 一批事件同時到達時，只有最後一筆生效，其餘永久遺失 | 同封包多筆事件在同一 task 內 dispatch，watch 只看得到最後寫入值；改用 `addEventListener` 逐筆讀 |
| 3 | 元件 `onBeforeUnmount(() => store.reset())` | SPA 導航到另一個也用 SSE 的頁面時，新頁面收不到任何推播；登出後仍有連線每 60s 打一次必定失敗的請求 | SPA 導航「新頁 setup 先於舊頁 unmount」，全域 reset 會關掉新頁剛建立的連線；訂閱要用引用計數、頁面只退自己那份 |

## 元件接法

```ts
// pages 進場：訂閱 → 進場 backfill；離場只退自己訂的那份
const store = useNotificationsStore()
onMounted(async () => {
  store.subscribe(watchId)              // 加 channel 並（重）連
  store.backfill(await fetchWatchSightings(watchId))  // 首次進場打底（重連補抓由 store 自理）
})
// 【bug#3】不要呼叫 store.reset()——導航到另一個也用這個 store 的頁面時，
// 新頁面的 setup 通常先於本頁的 unmount 執行，它可能已經訂閱好了；reset() 是
// 全域重置，會把新頁面剛建立的連線一起關掉，而新頁面的訂閱邏輯（依賴值沒變）
// 不會重新觸發，於是永久收不到推播，要重整頁面才會恢復。
onBeforeUnmount(() => store.unsubscribe(watchId))   // 只退自己這份；store 的引用計數決定要不要真的斷線
```

若一個頁面動態訂閱多個 id（如「本練習 + 當日其他練習」），記錄自己實際送出的訂閱集合，unmount 時逐一退訂：

```ts
let subscribed = new Set<string>()
function syncSubscriptions(next: Set<string>) {
  for (const id of subscribed) if (!next.has(id)) store.unsubscribe(id)
  for (const id of next) if (!subscribed.has(id)) store.subscribe(id)
  subscribed = new Set(next)
}
onBeforeUnmount(() => { for (const id of subscribed) store.unsubscribe(id) })
```

元件**只**呼叫 store 方法、讀 `store.status` / `store.sightingList`，不自己碰 EventSource；`store.reset()` 只給「確定沒有任何頁面在用」的場合呼叫（本 store 已經在登出時自己呼叫，見上方 store 範例末段，元件不需要也不應該再呼叫）。

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

## E2E 與 networkidle：常駐連線天生互斥

Playwright 的 `waitUntil: 'networkidle'` 等「網路安靜 500ms」，而 SSE 是**常駐連線**，永遠不安靜——用了 networkidle 的 `page.goto` 必逾時。用「延後 N 秒再連線」賭載入速度是不穩定的，遲早紅。

若專案的 E2E 依賴 networkidle 且無法改（凍結的 spec），採**環境分流**：

```ts
// mock 模式（E2E 跑的環境）走輪詢，設定了真後端位址才走 SSE
const useSse = !!useRuntimeConfig().public.baseApiUrl

onMounted(() => {
  if (useSse) { syncSubscriptions(); return }
  pollTimer = setInterval(pollOnce, 1000)   // mock：輪詢頂替 SSE 的翻亮效果
})
```

**代價要接受並寫清楚**：分流後 SSE 路徑在自動化測試零覆蓋，下方「驗收協定」變成部署前**必跑**而非選配；兩條路徑的行為差異（例如輪詢版只在 `inProgress` 時才打、SSE 版不限）要誠實寫進註解與 PR，不要寫「兩邊做的事一樣」——之後的人會被誤導。

## 驗收協定（部署前必跑，尤其 SSE 路徑無 E2E 覆蓋時）

寫完不算完成。以下每一項都對應過真實發生的 bug，`scripts/` 內附三支可直接改常數執行的腳本。

| # | 驗什麼 | 怎麼驗 | 通過標準 |
|---|--------|--------|----------|
| 0 | 訂閱真的生效 | 看首筆 `connected` 的 `data.channels`（`scripts/ground-truth-listener.mjs` 直連後端） | 清單含所有預期頻道 |
| 1 | 無重連迴圈 | Playwright 攔 `/events` 請求數（`scripts/connection-count.mjs`） | 頁面停留 20s，連線數穩定，無同 channels 重複連線 |
| 2 | 導航不斷線 | 同上腳本：頁 A → 頁 B | 導航後**恰好一條**活連線，頻道正確 |
| 3 | 登出收乾淨 | 同上腳本：登入 → 按登出 → 觀察 15s | 新開連線 **0 條**、既有連線已關閉 |
| 4 | 同批事件不漏 | 同一 tick 併發注入 2 筆事件（測試端點或 mock broadcast） | 兩筆**都**生效，不是只有最後一筆 |
| 5 | 斷線自癒 | 讓後端斷開連線再恢復 | backoff 遞增重連，恢復後收到 connected 並 backfill |
| 6 | 壞 token 不轟炸 | 讓 `/events` 固定回 401，記錄每次重試時刻（`scripts/backoff-401.mjs`） | 間隔指數遞增至上限，errorList 長度 ≤ 上限 |
| 7 | E2E 全綠 | 專案的 gate/測試指令 | 全過，含用 networkidle 的 spec |

驗收心法：**連線數是比畫面表現更誠實的指標**——迴圈與殘留連線只有數請求才看得見，畫面看起來正常不代表沒問題。

## 踩坑速查

| 坑 | 症狀 | 解 |
|----|------|----|
| 把「token 走 query」當通則寫死 | 換到 cookie / header 認證的後端就錯 | auth 放哪以 **api-spec** 為準（`route-map.realtime.auth`）；原生只能 query / cookie，要 header 用 `fetch-event-source` |
| 心跳用 SSE 註解行 `: heartbeat` | h3 `EventStream` 無法輸出純註解行 | 改送具名 `heartbeat` 事件，前端忽略（不觸發 message 解析） |
| 首載期就建 EventSource | Firefox「interrupted while the page was loading」；跨來源被標成假 CORS 錯誤 | `readyState !== 'complete'` → 等 window load 再連 |
| stale token 塞進 `?token=` | 401，且重試同一組 URL 永遠 401 | 連線前驗 exp（留 margin），快過期先 `refresh()` 再組 URL；refresh 後隔一個 rAF 再連 |
| 同 tick 連呼叫 connect/subscribe | 連開多條、CONNECTING 中被 close → 假 CORS 錯誤 | 開連線入口 microtask 合併，用最終 channels 只開一次 |
| 指望內建 `autoReconnect` 能救回斷線 | 只會拿同一組舊 URL 重試，token 過期後永遠 401 | 直接關掉 `autoReconnect`，CLOSED 一律走手動 backoff + 清 URL 重走 preflight（見下一條，不分「有沒有 OPEN 過」）|
| CLOSED 只在「從未 OPEN 過」時重連 | 連線曾經正常，某次斷線後畫面永遠不再更新、無任何錯誤 | `autoReconnect: false` 沒有「下一次」可以接手；CLOSED 一律排 `scheduleReopen()` |
| 用 `watch(data, ...)` 讀 SSE 事件 | 同一批（同封包）事件只有最後一筆生效，其餘遺失 | 改用 `eventSource.addEventListener('message', ...)` 逐筆讀 |
| 元件 `onBeforeUnmount(() => store.reset())` | SPA 導航到另一個用 SSE 的頁面時收不到推播；登出後仍留一條連線每 60s 打 401 | 引用計數：頁面只 `unsubscribe` 自己訂的；`reset()` 只給登出等「確定無人在用」的場合，由 store 自己 watch auth 狀態觸發 |
| 開連線入口沒有登出／空 channels 守衛 | `unsubscribe()` 結尾一律重新開連線，登出後 token 為空仍會開出一條連線 | `doOpenConnection` 開頭：無 token 或無 channels → `close()` 並 return |
| 重連不補抓 | 斷線期間的事件永久遺失 | `hasConnectedOnce` 區分重連 → `refetchActive()` |
| 重連不停舊 watcher | 每次重連洩漏一批 `watch`（store action 內無 active scope） | 連線 watcher 綁 `effectScope`，重連 / 離場 `scope.stop()` |
| 信封用 `data: A \| B \| C` 鬆散 union | `switch` 不收斂，又得寫 `as` | 真正的 discriminated union（`type` 綁對應 `data`） |
| 連線 store 混進業務清單 | 連線層綁死單一業務、難跨專案 | 連線層只管連線；領域清單放領域 store |
| 單顆事件重抓整個集合 | 密集出現時 O(n²) 流量 | 優先抓單一實體；無單筆端點才退回抓集合 |
| `autoReconnect: true` 無上限 | server 真掛時固定間隔狂敲（非指數退避），且 token 過期後仍卡死在同一組舊 URL | 不要用 `retries`/`onFailed` 掩蓋，直接 `autoReconnect: false` 改手動 backoff，設上限（如 60s） |
| 推播塞完整 model | payload 肥、與 backfill 兩套渲染路徑 | 事件只帶 id → REST 補整包 → upsert 去重 |
| 盲目 push | 補抓與即時事件重複 → 畫面重複項 | 一律 `upsert by id` |
| 每次訂閱都重連 | channels 沒變也斷線重連，畫面閃動 | `url === currentUrl && 在線` 則略過 |
| 離場沒 cleanup | 連線洩漏、下個訂閱者收不到已變更的 channels | unmount 對自己訂的每個 id 呼叫 `unsubscribe(watchId)`（單一 id，訂多個就逐一退；引用計數歸零才真正 close + 停 scope）；`reset()` 只留給登出等確定無人使用的時機 |
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
- [ ] `autoReconnect: false`；CLOSED **一律**（不分有沒有 OPEN 過）手動 backoff 重連（上限如 60s）+ 清 URL 重走 preflight
- [ ] 事件用 `addEventListener('message', ...)` 逐筆讀，不經過「單一 state + watch」
- [ ] 訂閱用引用計數（Map），不是 Set；頁面 unmount 只退自己那份，不呼叫全域 `reset()`
- [ ] 開連線入口有守衛：無 token 或無 channels → `close()` 並 return（防登出後殘留連線）
- [ ] errorList 等錯誤紀錄設上限，長時間離線不無限堆積
- [ ] `hasConnectedOnce` 區分首次 vs 重連；重連 `refetchActive()` 補抓（並行）
- [ ] 事件只帶索引 → REST 補整包 → `upsert by id` 去重；優先抓單一實體，無單筆端點才抓集合
- [ ] channels 不變不重連；變更訂閱以新 URL 重連
- [ ] 信封用**真** discriminated union（`type` 綁 `data`，`switch` 自動收斂、免 `as`，default 忽略未知）
- [ ] 壞 JSON / 補抓失敗都靜默忽略，不中斷後續事件
- [ ] 若 E2E 用 `networkidle`：已依 baseApiUrl 等明確旗標分流（mock 輪詢／真後端 SSE），且差異已寫進註解
- [ ] 部署前跑過「驗收協定」（見上）：無重連迴圈、導航後恰好一條連線、登出後零連線、同批事件不漏
