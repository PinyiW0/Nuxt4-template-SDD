# HLS 直播播放（hls.js + Safari 原生）

HTTP Live Streaming 的完整實作 pattern。涵蓋掛載 / teardown、錯誤自救、看門狗、延遲調校、多路 PDT 對齊、點播多路同步、播放源解析重試、型別 / mock、踩坑與 checklist。

> 共通鐵律見 `SKILL.md`。本檔是 HLS 的具體寫法，**原則仍以 SKILL.md 為準**。
> 程式碼萃取自實戰專案（hls.js `1.6.16`、後端 MediaMTX Low-Latency HLS）。

---

## 1. 掛載模型：兩條路徑

`.m3u8` 不是所有瀏覽器原生可播：

- **Safari / iOS**：原生支援 HLS。`video.canPlayType('application/vnd.apple.mpegurl')` 為真 → **直接綁 `<video src>`**，不載 lib。
- **其餘瀏覽器**：無原生支援 → **動態 `import('hls.js')`**，`loadSource` + `attachMedia` 掛到 `<video>`（此時 `<video>` 不綁 src）。

> 動態 import 讓 hls.js 不進 SSR、也不拖累首屏 bundle；只有真的要播 HLS 的客戶端才載。

---

## 2. 播放引擎抽成 composable（元件只渲染）

把 HLS 引擎（掛載 / 重掛 / 錯誤自救 / 看門狗 / teardown）收進 `useHlsPlayer` composable，元件只給 `videoRef` + src、負責呈現。**對齊 realtime「連線集中、元件只讀」**——引擎細節不外漏、可在多個元件重用、可單獨測試；元件不持有 hls 實例。

```ts
// app/composables/useHlsPlayer.ts
import type { Ref } from 'vue'

interface UseHlsPlayer {
  canNativeHls: Ref<boolean> // true → 元件直接綁 <video src>（Safari 原生）
  hlsError: Ref<boolean> // 致命無解 → 顯示「無法載入直播」
  getPlayingDate: () => Date | null // 供多路 PDT 對齊讀「當前畫面的真實時刻」（見 §6）
  setSyncRate: (rate: number) => void // PDT 對齊控速；playbackRate 的唯一 owner（見 §6）
}

// videoRef：元件的 <video>；getSrc：.m3u8 URL（null = 無訊號）；
// getEnabled：是否走 HLS（非 HLS 影片可不用此 composable，直接綁 <video src>）
export function useHlsPlayer(
  videoRef: Ref<HTMLVideoElement | null>,
  getSrc: () => string | null,
  getEnabled: () => boolean = () => true,
): UseHlsPlayer {
  const canNativeHls = ref(false)
  const hlsError = ref(false)

  // 只取用到的 hls.js 成員（playingDate 供 PDT 對齊）
  let hlsInstance: { destroy: () => void, startLoad: () => void, readonly playingDate: Date | null } | null = null
  let stallTimer: ReturnType<typeof setInterval> | null = null

  function stopStallWatchdog() {
    if (stallTimer) {
      clearInterval(stallTimer)
      stallTimer = null
    }
  }

  // 看門狗：偵測「該播卻卡住沒前進」（loop 靜默死掉、無 fatal error 可攔），
  // 卡超過 6 秒就跳回 live edge 並重啟拉流，避免只能手動重整才恢復。
  function startStallWatchdog(instance: { startLoad: () => void }) {
    stopStallWatchdog()
    let lastTime = videoRef.value?.currentTime ?? 0
    let lastProgressAt = Date.now()
    stallTimer = setInterval(() => {
      const v = videoRef.value
      if (!v || v.paused || v.ended)
        return
      if (v.currentTime > lastTime + 0.1) {
        lastTime = v.currentTime
        lastProgressAt = Date.now()
        return
      }
      if (Date.now() - lastProgressAt > 6000) {
        const end = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : null
        if (end != null && end - v.currentTime > 1)
          v.currentTime = end // 跳回 live edge
        instance.startLoad() // 重啟拉流
        lastProgressAt = Date.now() // 給恢復時間，避免每 2 秒狂觸發
      }
    }, 2000)
  }

  function teardownHls() {
    stopStallWatchdog()
    hlsInstance?.destroy()
    hlsInstance = null
  }

  async function setupHls() {
    teardownHls() // 重掛前先清乾淨（含 src 變動重來）
    hlsError.value = false
    canNativeHls.value = false
    const video = videoRef.value
    if (!getEnabled() || !getSrc() || !video)
      return
    // Safari / iOS：原生支援 → 交給 template 綁 src
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      canNativeHls.value = true
      return
    }
    const { default: Hls } = await import('hls.js')
    const src = getSrc()
    // await 期間 src / 元素可能已變動 → 以最新值為準，避免掛到舊流
    if (!getEnabled() || !src || videoRef.value !== video)
      return
    if (!Hls.isSupported()) {
      hlsError.value = true
      return
    }
    const instance = new Hls({
      // 後端為 MediaMTX Low-Latency HLS（EXT-X-PART）。預設低延遲模式緊貼 live edge、
      // 緩衝極小，LAN 抖動即吃光緩衝→卡死難恢復。關閉低延遲改正常緩衝：
      // 代價延遲多約 1–2 秒，換取穩定不凍結。依你的場景調整這三個值（見 §5）。
      lowLatencyMode: false,
      liveSyncDurationCount: 4, // 播放點落在 live edge 後約 4 段（~8s），留足緩衝吸收抖動
      backBufferLength: 30, // 限制回放緩衝記憶體
      // 不開 maxLiveSyncPlaybackRate（讓 hls.js 自己追 live edge）：playbackRate 留給
      // useLivePdtSync 統一控（見 §6），避免兩套機制互搶 playbackRate 震盪。
    })
    // 錯誤自救：直播抖動 / segment 載入失敗時分層處理（見 §3）。
    // 節流：避免反覆致命錯誤造成 loop loading（官方建議）。
    let lastRecoverAt = 0
    instance.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        const tooSoon = Date.now() - lastRecoverAt < 3000
        lastRecoverAt = Date.now()
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (tooSoon) { teardownHls(); hlsError.value = true } // 短時間反覆網路致命 → 放棄，不 loop load
          else instance.startLoad() // 網路致命 → 重新載流
        }
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (tooSoon) instance.swapAudioCodec() // 短時間內又掛 → 先換音訊解碼器（官方升級做法）
          instance.recoverMediaError() // 解碼致命 → 恢復媒體
        }
        else { teardownHls(); hlsError.value = true } // 其餘無法恢復 → 顯示錯誤
      }
      else if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
        // 緩衝卡住（非致命）：跳回可播放範圍末端貼齊 live edge
        const v = videoRef.value
        const end = v?.seekable.length ? v.seekable.end(v.seekable.length - 1) : null
        if (v && end != null && end - v.currentTime > 1)
          v.currentTime = end
      }
    })
    instance.loadSource(src)
    instance.attachMedia(video)
    hlsInstance = instance
    startStallWatchdog(instance)
  }

  // 讀「當前畫面對應的真實時刻」：hls.js 用 playingDate；
  // Safari 原生無 hls 實例 → getStartDate()（WebKit）+ currentTime 推算
  function getPlayingDate(): Date | null {
    const v = videoRef.value
    if (canNativeHls.value && v) {
      const getStartDate = (v as HTMLVideoElement & { getStartDate?: () => Date }).getStartDate
      const start = getStartDate?.call(v)
      return start && !Number.isNaN(start.getTime())
        ? new Date(start.getTime() + v.currentTime * 1000)
        : null
    }
    return hlsInstance?.playingDate ?? null
  }

  // playbackRate 的唯一 owner（PDT 對齊用，見 §6）
  function setSyncRate(rate: number) {
    if (videoRef.value)
      videoRef.value.playbackRate = rate
  }

  // src / 開關變動 → 重新掛載（client only）
  watch([getSrc, getEnabled], () => {
    if (import.meta.client)
      void setupHls()
  })
  onMounted(() => {
    void setupHls()
  })
  // 元件卸載 / 作用域結束 → 完整 teardown（destroy 實例 + 清看門狗 timer）
  onScopeDispose(teardownHls)

  return { canNativeHls, hlsError, getPlayingDate, setSyncRate }
}
```

元件因此只剩呈現與接線（省略全螢幕 / 16:9 量測等與 HLS 無關的部分）：

```vue
<script setup lang="ts">
const props = defineProps<{
  src: string | null // .m3u8 直播 URL；null = 無訊號
  hls: boolean // true 才走 hls.js / 原生 HLS 掛載
}>()

const videoRef = ref<HTMLVideoElement | null>(null)
const { canNativeHls, hlsError, getPlayingDate, setSyncRate } = useHlsPlayer(
  videoRef,
  () => props.src,
  () => props.hls,
)
// 多路 PDT 對齊：父層透過此 expose 協調（見 §6）
defineExpose({ videoRef, getPlayingDate, setSyncRate })
</script>

<template>
  <video
    v-if="props.src"
    ref="videoRef"
    :src="props.hls && !canNativeHls ? undefined : props.src"
    muted
    playsinline
    :autoplay="props.hls"
    :preload="props.hls ? 'auto' : 'metadata'"
  />
  <!-- 無訊號 / 載入失敗的提示（呈現屬 UI/vibe，文字語意保留）-->
  <div v-if="props.hls && (!props.src || hlsError)">
    {{ hlsError ? '無法載入直播' : '無直播訊號' }}
  </div>
</template>
```

要點：

- **引擎在 composable、元件只渲染**：掛載 / 重掛 / 看門狗 / 自救 / teardown 全在 `useHlsPlayer`，元件不持有 hls 實例（對齊 realtime「連線集中、元件只讀」）。
- `:src` 在「hls.js 路徑」設 `undefined`（由 `attachMedia` 掛流），原生 / 點播路徑才綁 `src`。
- `autoplay` 配 `muted` 才符合瀏覽器自動播放政策；`playsinline` 防 iOS 劫持全螢幕。
- teardown 用 `onScopeDispose`：src 變動重掛、與離場 teardown 共用同一條清理路徑（`setupHls` 開頭也先 `teardownHls()`）。

---

## 3. 錯誤自救的分層（為何不是「一錯就顯示失敗」）

直播串流長時間運行，瞬斷 / segment 失敗 / 解碼抖動是常態。hls.js 的錯誤分兩類：

| 類別 | 範例 | 處置 |
|------|------|------|
| fatal NETWORK | manifest / segment 載入致命失敗 | `startLoad()` 重新載流；**3 秒內反覆發生就放棄**（避免 loop loading） |
| fatal MEDIA | 解碼器掛掉 | `recoverMediaError()`；**短時間內又掛 → 先 `swapAudioCodec()` 再 recover**（官方升級做法） |
| fatal 其他 | MUX 等無法恢復 | `teardown` + 顯示「無法載入直播」 |
| 非 fatal `BUFFER_STALLED_ERROR` | 緩衝吃光卡住 | `seek` 回 `seekable` 末端貼 live edge |

> 順序：**先試自救（reload / recover / seek），真的無解才放棄**。第一個錯就 teardown 會讓使用者頻繁看到假性「載入失敗」。
> **但 reload / recover 一定要節流**（如 3 秒）：官方明言反覆 `startLoad` 會 loop loading 把問題放大（見 §2 的 `lastRecoverAt`）。

---

## 4. 看門狗：攔住「靜默卡死」

> **先用 hls.js 內建的 stall 自救，手刻看門狗是最後手段。** hls.js 已內建 `highBufferWatchdogPeriod` / `nudgeOffset` / `maxBufferHole` / `detectStallWithCurrentTimeMs`——它會自己 nudge 播放頭、跳 buffer 洞。**先調這些參數**；只有在「直播 live edge 失效、內建救不回」（hls.js issue #813 / #3905 證實會發生）時，才加下面的手刻看門狗。

最難纏的是**沒有任何 error、`currentTime` 卻不再前進**（loop 靜默死掉）——內建有時也救不回 live 直播。手刻定時器主動偵測：

- 每 2 秒檢查 `currentTime` 是否比上次前進（>0.1s）。
- 有前進 → 更新基準時間。
- 連續卡超過 6 秒 → `seek` 回 live edge + `startLoad()` 重啟，並把 `lastProgressAt` 往後推（給恢復時間，避免每輪狂觸發）。

這是「不必手動重整就能自己活過來」的**最後**防線。閾值（2s / 6s）依串流特性調。

> 注意：`setInterval` 全程跑，多路相機牆（如 16 路）= 16 個常駐 timer，可在 `document.hidden` 時暫停省資源。看門狗與 §3 的 `BUFFER_STALLED_ERROR` 都會 seek live edge（兩條自救路徑重疊，通常無害，但別再疊第三條）。

---

## 5. 延遲調校：低延遲 vs 穩定

MediaMTX 等 Low-Latency HLS（EXT-X-PART）預設緊貼 live edge、緩衝極小。在 LAN 抖動下緩衝瞬間吃光 → 卡死難恢復。三個關鍵旋鈕：

| 選項 | 作用 | 取捨 |
|------|------|------|
| `lowLatencyMode: false` | 關掉 LL-HLS 緊貼 live edge | 延遲多 1–2s，換緩衝穩定 |
| `liveSyncDurationCount: 4` | 播放點落在 live edge 後約 4 段 | 數字越大越穩、延遲越高 |
| `backBufferLength: 30` | 限制回放緩衝記憶體 | 防長時間直播記憶體膨脹 |

> 沒有萬用值：互動性優先（如教練即時喊話）就往低延遲調；穩定優先（純觀看）就如上關掉 LL。**不要照抄 hls.js 預設**，那是為一般點播調的。
>
> 另有一組 **stall 自救** 旋鈕（`highBufferWatchdogPeriod` / `nudgeOffset` / `maxBufferHole`）控制 hls.js 內建 nudge 行為，與上面三個延遲旋鈕是不同目的——**卡頓問題先調這組**（見 §4），不是只調延遲。

---

## 6. 多路直播同步：PDT 軟對齊（控速不 seek）

兩路直播（不同角度同場景）各自的 live edge 會漂移，要顯示「同一真實時刻」。用每路的 PROGRAM-DATE-TIME（`playingDate`，即當前畫面對應的 wallclock）量時間差，**微調 `playbackRate`** 把超前那路放慢被落後追平——不 seek 故不跳畫面。

`getPlayingDate` / `setSyncRate` 由 `useHlsPlayer`（§2）提供，元件 `defineExpose` 出去給父層協調即可，不必在元件內重寫。

> **`playbackRate` 只能有一個 owner。** PDT 對齊靠寫 `playbackRate` 達成，所以**同一支 video 不能有第二個東西也在改 `playbackRate`**——這就是 §2 關掉 hls.js `maxLiveSyncPlaybackRate` 的原因（否則 hls.js 自動追 live edge 與 `useLivePdtSync` 互搶，畫面速率震盪）。要重開 LL sync rate 前，先確認 PDT 對齊已停。

對齊 composable：

```ts
// app/composables/useLivePdtSync.ts
// 用兩路 PDT 量時間差，放慢「較超前」那路被「較落後」那路追平，使兩路顯示同一真實時刻。
// 取捨：純控速不 seek（不跳畫面，收斂需數秒）；對齊到較落後那路（無法讓慢的快轉到未發生內容）；
// 容差內不動（hysteresis 防臨界反覆變速）；持續校正（來源偏移會波動）。
export interface SyncablePlayer {
  getPlayingDate: () => Date | null
  setSyncRate: (rate: number) => void
}
type PlayerGetter = () => SyncablePlayer | null | undefined

const TOLERANCE_SEC = 0.3 // 差距在此之內視為對齊，不調速
const PERIOD_MS = 2000 // 校正週期
const MIN_RATE = 0.85 // 放慢下限（再低觀感變差；影片靜音故不影響聲音）
const RATE_GAIN = 0.1 // 每秒差距對應的減速量：drift 1s → rate≈0.9

export function useLivePdtSync(getA: PlayerGetter, getB: PlayerGetter) {
  let timer: ReturnType<typeof setInterval> | null = null

  function tick() {
    const a = getA()
    const b = getB()
    if (!a || !b)
      return
    const da = a.getPlayingDate()
    const db = b.getPlayingDate()
    // 任一路尚無 PDT（剛載入 / 切流 / Safari 未就緒）→ 都恢復正常速，待下次再對
    if (!da || !db) {
      a.setSyncRate(1)
      b.setSyncRate(1)
      return
    }
    const driftSec = (da.getTime() - db.getTime()) / 1000
    if (Math.abs(driftSec) <= TOLERANCE_SEC) {
      a.setSyncRate(1)
      b.setSyncRate(1)
      return
    }
    // 只放慢較超前那路，較落後維持 1x；差距越大放越慢（不低於 MIN_RATE）
    const slowRate = Math.max(MIN_RATE, 1 - Math.abs(driftSec) * RATE_GAIN)
    a.setSyncRate(driftSec > 0 ? slowRate : 1)
    b.setSyncRate(driftSec > 0 ? 1 : slowRate)
  }

  onMounted(() => {
    timer = setInterval(tick, PERIOD_MS)
  })
  onBeforeUnmount(() => {
    if (timer)
      clearInterval(timer)
    timer = null
    getA()?.setSyncRate(1) // 還原兩路速率，避免離場殘留
    getB()?.setSyncRate(1)
  })
}
```

> 為何不用 PDT 而改 seek 對齊？seek 會跳畫面、體感差，且直播 seek 到未來不存在的內容會再卡。控速收斂雖慢數秒，穩態下 drift 小、修正平滑。

---

## 7. 點播多路同步：currentTime 對齊（無 PDT）

點播（VOD，兩支等長同場景影片）沒有 wallclock，改用 `currentTime`。前提：兩支長度與 frame rate 一致 → 無需 leader，指令同步下達兩支，只做漂移校正。

```ts
// app/composables/useDualVideoSync.ts（節錄校正核心）
// 一條 bar 同步兩支等長影片：play/pause/seek/rate 同步下達，timeupdate 時校正漂移
const onTime = () => {
  const pair = both() // [aRef.value, bRef.value]，任一為 null 則 return
  if (!pair)
    return
  currentTime.value = pair[0].currentTime
  // 副影片漂移 > 0.15s 才校正，避免每幀抖動
  if (Math.abs(pair[1].currentTime - pair[0].currentTime) > 0.15) {
    if (rafId)
      cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      const p = both()
      if (p)
        p[1].currentTime = p[0].currentTime // 對齊到主影片
    })
  }
}
// 事件用 @vueuse/core useEventListener 綁，watch([aRef, bRef]) 在 remount 時重掛
// onScopeDispose 取消 rafId
```

> 直播用 PDT（§6）、點播用 currentTime（§7）：差別在直播沒有共同時間軸、只有各自 live edge 的真實時刻；點播兩支共用 0~duration 時間軸。

---

## 8. 播放源就緒 ≠ 進頁時機（事件驅動重試）

直播 URL 常**晚於進頁**才產生（第一個事件才開始推流），或 stream 端點暫時 404。若解析到 `null` 就放棄，使用者只能手動重整。正解：解析失敗不放棄，**由 realtime 事件驅動重試**直到拿到可播 URL。

```ts
// streamId → GET /streams/{streamId} 取 hlsUrl（hlsUrl 單一真相來源在 streams 端點）
async function resolveHls(streamId: string | undefined): Promise<string | null> {
  if (!streamId)
    return null
  try {
    return (await getStream(streamId)).hlsUrl
  }
  catch {
    return null // 端點暫 404 / 尚未推流 → 待重試
  }
}

// 事件驅動重試：每收到新事件（如 SSE pitchCreated）且直播源尚未全部接上時，
// 重抓來源直到解析出 hlsUrl。重試中再收到事件 → 記 pending，本輪結束後補跑，
// 避免事件被丟棄後再無人重試。
let hlsRetrying = false
let hlsRetryPending = false

watch(() => notifications.pitchList.length, async (len, prevLen) => {
  if (!import.meta.client || len <= (prevLen ?? 0))
    return
  if (hlsRetrying) {
    hlsRetryPending = true
    return
  }
  if (hlsAllResolved())
    return
  hlsRetrying = true
  try {
    do {
      hlsRetryPending = false
      await refreshSources() // 重抓相機清單 + 重解析 hlsUrl
    } while (hlsRetryPending && !hlsAllResolved())
  }
  finally {
    hlsRetrying = false
  }
})
```

> 這是 streaming 版的「重連補抓」（對映 `realtime` skill 共通核心第 6 點），只是補的是「播放源 URL」而非「漏掉的事件」，且由 realtime 事件當觸發器——兩個 skill 在此交會。
>
> **這是權宜，不是理想解**：拿「球變多」當「直播源可能好了」的 proxy 是 leaky abstraction（耦合到特定領域事件）。理想做法是後端給一個明確的 **stream-ready 訊號**（如 SSE `streamActive` 事件，或 stream 端點回 `status: active`）當觸發器，而非借用業務事件。沒有時才退回此法。

---

## 9. 型別來源（OpenAPI codegen）

HLS URL 多半由獨立端點提供（單一真相來源），型別走 codegen alias（見 `feature-to-api/references/openapi-codegen.md`）。實戰 spec 範例：

```yaml
# api-spec.yml（節錄）
StreamResponse:
  type: object
  required: [streamId, name, status, hlsUrl, createdAt]
  properties:
    streamId: { type: string, format: uuid }
    status: { type: string, enum: [active, inactive, error] }
    hlsUrl: { type: string, format: uri } # 例：https://.../live/cam1/index.m3u8
```

```ts
// app/types/api/streams.ts —— 從 codegen schema 取 alias，不手抄
import type { components } from './_schema'

export type StreamResponse = components['schemas']['StreamResponse']
```

> 相機 recorder 帶 `streamId` 參照 → 前端以 `GET /streams/{streamId}` 取 `hlsUrl`（hlsUrl 單一真相來源在 streams 端點，相機端點不重複給）。

---

## 10. Mock 端點

mock 直接回 `StreamResponse`（裸物件 / 或 envelope，依專案 `apiEnvelope` 開關），`hlsUrl` 給一個真實可播或固定的 `.m3u8`：

```ts
// server/mock/data/streams.ts
export const streams = [
  { streamId: 'cam1', name: '一壘側相機直播', status: 'active', hlsUrl: 'https://stream.example.edu/live/cam1/index.m3u8', createdAt: '2026-01-01T00:00:00Z' },
]
```

```ts
// server/api/v1/streams/[streamId].get.ts
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'streamId')
  const stream = streams.find(s => s.streamId === id)
  if (!stream)
    throw createError({ statusCode: 404, statusMessage: 'Stream not found' })
  return stream
})
```

> E2E 測試不必真的播 HLS（Playwright 環境無解碼）：mock 回固定 `hlsUrl`，斷言**業務可觀察狀態**（LIVE 標籤可見 / 無訊號文字 / `<video>` 的 `src` 或載入狀態），不斷言實際畫面像素。

---

## 11. 踩坑表

| 坑 | 後果 | 解法 |
|----|------|------|
| 直接 `<video :src="m3u8">` 在 Chrome | 播不出（無原生 HLS） | 非 Safari 動態載 hls.js `attachMedia`；Safari 才綁 src |
| hls.js 進 SSR / 首屏 bundle | hydration 噴錯 / bundle 肥大 | `if (import.meta.client)` + 動態 `import('hls.js')` |
| `await import()` 後 src 已變 | 掛到舊流 / 競態 | await 回來重驗 `videoRef`/`src` 仍是當初那個 |
| 只攔 fatal error | 靜默卡死（無 error）救不回 | 加 stall 看門狗主動偵測 `currentTime` 不前進 |
| 一遇 error 就 teardown | 頻繁假性「載入失敗」 | 分層自救：network reload / media recover / stall seek，無解才放棄 |
| 照抄 LL-HLS 預設 | LAN 抖動吃光緩衝卡死 | `lowLatencyMode:false` + 調 `liveSyncDurationCount`/`backBufferLength` |
| 多路用 seek 對齊 | 跳畫面 / seek 到未來再卡 | PDT 控速軟對齊（`playbackRate`），容差內不動 |
| `autoplay` 沒配 `muted` | 瀏覽器擋自動播放 | 直播一律 `muted` + `playsinline` |
| 解析 hlsUrl 失敗就放棄 | 串流晚於進頁就永遠黑屏 | 事件驅動重試直到解析出（§8） |
| 引擎全塞元件（god-component） | 難重用 / 難測 / 與 realtime 哲學矛盾 | 抽 `useHlsPlayer` composable，元件只渲染（§2） |
| unmount 沒 `destroy` + 清 timer | 記憶體 / 看門狗 timer 洩漏 | composable 用 `onScopeDispose(teardownHls)`：`destroy` + `clearInterval` |
| 離場沒還原 `playbackRate` | 跨頁殘留變速 | PDT sync 的 `onBeforeUnmount` 還原 rate=1 |

---

## 12. Checklist

- [ ] 引擎在 `useHlsPlayer` composable、元件只渲染（不持有 hls 實例）
- [ ] 掛載走 client-only + 動態 `import('hls.js')`；Safari `canPlayType` 走原生綁 src
- [ ] `await import()` 後重驗 `videoRef`/`src` 仍當初那個
- [ ] 錯誤分層自救：fatal network→`startLoad`、fatal media→`recoverMediaError`、stall→`seek` live edge、無解→teardown+顯示失敗
- [ ] stall 看門狗：定時偵測 `currentTime` 不前進 → seek live edge + 重啟拉流
- [ ] 延遲調校依場景設 `lowLatencyMode`/`liveSyncDurationCount`/`backBufferLength`，未照抄預設
- [ ] 多路直播用 PDT 軟對齊（控速不 seek）；點播用 `currentTime` 對齊
- [ ] 直播 `<video>` 帶 `muted` + `playsinline` + `autoplay`
- [ ] 無訊號 / 載入失敗 / LIVE 有業務語意可見文字
- [ ] 播放源解析失敗會重試（可由 realtime 事件驅動）直到拿到可播 URL
- [ ] teardown 用 `onScopeDispose(teardownHls)`：`destroy` 實例 + 清看門狗 timer；PDT sync 離場還原 rate
- [ ] 型別走 codegen alias（`StreamResponse`）；mock 回固定 `hlsUrl`
