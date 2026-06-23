# SSE（Server-Sent Events）實作 pattern

EventSource 單向推播的完整實作。萃取自實戰 SSE store，已驗證過重連、補抓、去重、cleanup 的坑。

## 何時用 SSE

伺服器要主動推、前端不需回傳（通知、進度、即時 feed、儀表板）。SSE 比 WebSocket 簡單：純文字、瀏覽器原生自動重連、走一般 HTTP（無需升級協定）。需要雙向就改用 WebSocket。

## 連線模型（對齊正式後端慣例）

- **訂閱透過連線 URL 的 query 達成**：`/events?token={jwt}&channels=practice:{id},account:{id}`。無 `connectionId`、無額外 REST 訂閱端點。
- **變更訂閱 = 以新 channels 重連**；channels 不變則沿用既有連線（避免無謂斷線）。
- **連線預設必訂自己的 `account:{accountId}`**（個人通知頻道），其餘頻道按需加入。
- **auth token 走 query**：原生 `EventSource` 無法帶 header，token 只能放 URL。

## 信封型別：鬆散 data 用 discriminated union

SSE 信封固定外層 `{ id, type, channel, timestamp, data }`，`data` 隨 `type` 變形。OpenAPI 對 `data` 多半給鬆散型別（`Record<string, never>`），**前端手寫 discriminated union 補語意**——codegen 補不了（見 `openapi-codegen.md` § 8）。

```ts
// app/types/api/notifications.ts
export interface ConnectEventData { channels?: string[] }           // connected 歡迎訊息：回報 RBAC 剔除後的實際頻道
export interface PitchCreatedEventData { pitchId: string, practiceId: string }  // 只帶輕量索引，不含完整資料
export interface PracticeAiEventData { practiceId: string }

export type NotificationEventType
  = 'connected' | 'pitchCreated' | 'practiceAiStarted' | 'practiceAiStopped'

// 信封對齊 api_spec.yml SseEventEnvelope
export interface NotificationEvent {
  id: string
  type: NotificationEventType
  channel: string
  timestamp: string
  data: ConnectEventData | PitchCreatedEventData | PracticeAiEventData
}
```

> 進階：可改寫成真正的 discriminated union（每個 `type` 綁定對應 `data`），讓 `switch (evt.type)` 自動收斂 `evt.data` 型別，免去 `evt.data as XxxData` 斷言。上例為對齊後端鬆散信封而保留 union data；型別嚴格度依專案取捨。

## Pinia store：連線集中 + 重連補抓

核心 store（萃取自 `app/stores/notifications.ts`，保留教學關鍵段）：

```ts
import { useEventSource } from '@vueuse/core'

type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export const useNotificationsStore = defineStore('notifications', () => {
  const status = ref<ConnectionStatus>('idle')
  const pitchList = ref<PitchListItem[]>([])
  const activePracticeIds = reactive<Set<string>>(new Set())  // 想保持訂閱的 id；連線依此組 channels

  let closeFn: (() => void) | null = null
  let currentUrl: string | null = null      // channels 不變則不重連
  let hasConnectedOnce = false               // 區分首次連線 vs 重連 → 決定要不要補抓

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
    for (const id of activePracticeIds) await refetchPractice(id)
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
      // 事件只帶索引 → 重抓該資源取整包（upsert 去重）
      void refetchPractice((evt.data as PitchCreatedEventData).practiceId)
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

  // --- 建立 / 重建連線（僅 client；channels 不變則不重連）---
  function openConnection() {
    if (!import.meta.client) return  // SSR 無連線

    const { token } = storeToRefs(useAuthStore())
    const channels = buildChannels()
    const url = `${resolveApiBaseUrl()}/api/v1/events?token=${token.value ?? ''}&channels=${encodeURIComponent(channels.join(','))}`

    if (url === currentUrl && (status.value === 'connecting' || status.value === 'open'))
      return  // 連線目標未變且仍在線 → 不重連

    closeFn?.()                 // 關舊連線，以新 channels 重連
    currentUrl = url
    status.value = 'connecting'

    const { data, error, status: esStatus, close } = useEventSource(url, [], { autoReconnect: true })
    closeFn = close

    watch(data, value => { if (value) handleEvent(value) })
    watch(error, err => { if (err) status.value = 'error' })
    watch(esStatus, s => {
      if (s === 'OPEN') status.value = 'open'
      else if (s === 'CLOSED') status.value = 'closed'
    })
  }

  function subscribe(practiceId: string) { activePracticeIds.add(practiceId); openConnection() }
  function unsubscribe(practiceId: string) { activePracticeIds.delete(practiceId); openConnection() }

  function close() {
    closeFn?.(); closeFn = null; currentUrl = null
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
| token 放 header | EventSource 建構式無法帶 header，連線無授權 | token 走 **query param** |
| 心跳用 SSE 註解行 `: heartbeat` | h3 `EventStream` 無法輸出純註解行 | 改送具名 `heartbeat` 事件，前端忽略（不觸發 message 解析） |
| 重連不補抓 | 斷線期間的事件永久遺失 | `hasConnectedOnce` 區分重連 → `refetchActive()` |
| 推播塞完整 model | payload 肥、與 backfill 兩套渲染路徑 | 事件只帶 id → REST 補整包 → upsert 去重 |
| 盲目 push | 補抓與即時事件重複 → 畫面重複項 | 一律 `upsert by id` |
| 每次訂閱都重連 | channels 沒變也斷線重連，畫面閃動 | `url === currentUrl && 在線` 則略過 |
| 離場沒 cleanup | 連線洩漏、`hasConnectedOnce` 殘留汙染下次 | `reset()`：close + 清資料 + 清訂閱 + 重置旗標 |
| SSR 建連 | hydration 錯誤、重複連線 | `if (!import.meta.client) return` |

## Checklist

- [ ] 連線集中在 Pinia store，元件只讀狀態 / 呼叫方法
- [ ] 狀態機 `idle/connecting/open/closed/error` 對映可讀 UI 文字
- [ ] `if (!import.meta.client) return` 守住 SSR
- [ ] auth token 走 query param
- [ ] `useEventSource(url, [], { autoReconnect: true })`
- [ ] `hasConnectedOnce` 區分首次 vs 重連；重連 `refetchActive()` 補抓
- [ ] 事件只帶索引 → REST 補整包 → `upsert by id` 去重
- [ ] channels 不變不重連；變更訂閱以新 URL 重連
- [ ] 信封 `data` 用 discriminated union（`switch (evt.type)`，default 忽略未知）
- [ ] 離場 `reset()`：close + 清資料 + 清訂閱 + 重置旗標
- [ ] 壞 JSON / 補抓失敗都靜默忽略，不中斷後續事件
