---
name: streaming
description: 影音播放領域知識（HLS / WebRTC media / 原生 video）——播放器掛載、錯誤自救與看門狗、直播延遲調校、多路 PDT 對齊、teardown 的共通鐵律與傳輸選型。Use when 實作影音播放、HLS/.m3u8 直播、hls.js、video player、即時影像串流、多路影片同步、或提到 串流播放、直播畫面。
metadata:
  domain: media-playback
---

# Streaming 影音播放

影音播放的**領域知識包**。按「問題領域」而非「傳輸技術」組織：播放器掛載、錯誤自救、看門狗、延遲調校、teardown 這些坑在 HLS / WebRTC media 上**幾乎一樣**，共通核心寫一次，各傳輸的細節放 `references/`。

> 範圍：影音**播放**（把媒體餵進 `<video>` 並穩定播放）。即時**連線與訊息**（SSE / WebSocket / datachannel）屬另一領域，見 `realtime` skill。
> WebRTC 橫跨兩域：**datachannel（資料）在 realtime**、**media track（影音）在本 skill**。

## 傳輸選型

先選對傳輸，再看對應 reference。**預設從 HLS 開始**（最通用、可規模化），延遲需求超出才升級。

| 傳輸 | 用在 | 典型延遲 | 不要用在 | 掛載方式 |
|------|------|----------|----------|----------|
| **HLS**（hls.js，Safari 原生） | 直播、長片、自適應碼率、可規模化廣播 | 數秒（LL-HLS 可到 ~2s） | 需 <1s 互動延遲 | 非 Safari 動態載 `hls.js` `attachMedia`；Safari `canPlayType` 直接綁 `src` |
| **WebRTC media** | 超低延遲直播、視訊通話、雲端遊戲 | <500ms | 大規模廣播（每連線成本高）、長片點播 | `RTCPeerConnection` + `ontrack` → `srcObject` |
| **原生 `<video>`**（MP4/WebM） | 點播短片、已完整檔案 | 不適用 | 直播、自適應碼率 | 直接綁 `src`，不引 lib |

判準：**要規模化直播 / 長片 / 自適應 → HLS**（最通用，從這開始）；**要 <1s 互動延遲 → WebRTC media**；**只是放完整短片 → 原生 `<video>`**（別引 lib）。

## 共通核心（傳輸無關，全部都要遵守）

不論 HLS / WebRTC media，這些鐵律一致。各傳輸具體寫法見 reference，但**原則不可違反**：

1. **播放引擎集中在 composable（`useHlsPlayer`），元件只渲染** — 掛載 / 重掛 / 看門狗 / 自救 / teardown 收進 composable，元件不持有播放器實例（對映 realtime「連線集中在 store」）。掛載一律 client-only + 動態載入：進入點 `if (!import.meta.client) return`，並 `await import('hls.js')` 動態載入（避免 SSR、瘦 bundle）；原生可播（Safari `canPlayType('application/vnd.apple.mpegurl')`）跳過 lib 直接綁 `src`。
2. **src 變動 = 重新掛載；await 後須重驗** — `watch` src 重 setup。動態 `import()` 是 await 點，期間 src / 元素可能已變 → await 回來先重驗 `videoRef`/`src` 仍是當初那個，否則別掛（避免掛到舊流）。
3. **錯誤自救分層，別第一錯就放棄** — fatal network → 重新載流（`startLoad`）；fatal media → `recoverMediaError`；其餘 fatal → teardown + 顯示「無法載入」；非 fatal stall → `seek` 回 live edge。
4. **看門狗（stall watchdog）** — fatal error 攔不到「靜默卡死」（loop 死、`currentTime` 不前進、無錯可攔）。定時器每 N 秒比對 `currentTime` 是否前進，卡超過閾值 → `seek` live edge + 重啟拉流。沒這個只能手動重整才恢復。
5. **teardown 要完整** — unmount / src 變動時：`destroy` 播放器實例 + 清看門狗 timer + 移除 listener。少一樣就洩漏記憶體 / timer。
6. **直播延遲 vs 穩定的取捨** — 低延遲模式緊貼 live edge、緩衝極小，網路抖動吃光緩衝即卡死。穩定優先就**關低延遲 + 加 liveSync / backBuffer**，換 1–2s 延遲換不凍結。依場景調，不要照抄預設值。
7. **多路同步用 PDT 軟對齊（控速不 seek）** — 多路直播用各路 PROGRAM-DATE-TIME（wallclock）量時間差，微調 `playbackRate` 放慢超前那路被落後追平；容差內不動（hysteresis）避免抖動；離場還原 rate。點播多路改用 `currentTime` 對齊。**不 seek → 不跳畫面**。
8. **播放狀態對使用者可見** — 無訊號 / 載入失敗 / LIVE 指示用可辨識的文字呈現。這是 **UI / vibe 範疇的體驗建議，不是 flow 凍結的業務不變式**（真實 flow 不凍結影片畫面呈現，要不要顯示 LIVE / 怎麼呈現是 vibe 自由）。串流的合約在 OpenAPI 的播放 URL 端點（如 `/streams` → `hlsUrl`），不在 flow。
9. **直播自動播放須靜音 + playsinline** — 瀏覽器自動播放政策：`autoplay` 必須 `muted`；iOS 要 `playsinline` 否則被劫持成全螢幕。
10. **播放源就緒 ≠ 進頁時機** — 直播常晚於進頁才開推流（URL 尚未產生或端點暫 404）。解析到 `null` 不能就放棄，要**重試**（可由 realtime 事件驅動，如收到新事件才重抓）直到解析出可播 URL。

## References

| 傳輸 | 內容 | 檔案 |
|------|------|------|
| HLS | hls.js 完整 pattern（掛載 / teardown、看門狗、錯誤自救、延遲調校、PDT 多路對齊、點播 `currentTime` 對齊、Safari 原生路徑、型別 / mock、踩坑、checklist） | [references/hls.md](references/hls.md) |
| WebRTC media | （之後加 `references/webrtc-media.md`） | — |

> 擴充新傳輸 = 在本 skill 加一個 reference 檔，**共通核心不重寫**。永遠只有一個 `streaming` skill。

## 被動 / 主動 觸發

- **被動**（本 skill 的 `description`）：寫 `hls.js` / `.m3u8` / `<video>` 播放器 / `RTCPeerConnection` + media track 等程式碼時自動載入。
- **主動**（接進 SDD 流程）：`feature-to-api` Phase 0 與 `feature-to-flow` 掃到串流訊號時，在報告提示「建議套用 streaming skill」並寫入 route-map：
  - HLS（**主訊號** = `.m3u8` 副檔名、`application/vnd.apple.mpegurl` / `application/x-mpegurl` mime——標準常數最可靠）；`hlsUrl` 欄位、`/streams` 端點、描述含「HLS」僅為**常見命名範例**，實際以「回傳 `.m3u8` URL 的欄位 / 端點」為準（可能叫 `playbackUrl`、或內嵌於相機物件…）
  - WebRTC media：`RTCPeerConnection` + `ontrack` / `addTrack` / `addTransceiver`
