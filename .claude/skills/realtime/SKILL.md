---
name: realtime
description: 即時連線領域知識（SSE / WebSocket / WebRTC datachannel）——連線生命週期、重連補抓、auth token、store 集中、cleanup 的共通鐵律與傳輸選型。Use when 實作即時推播、伺服器推送、EventSource/SSE、WebSocket、即時通知/feed、雙向連線、或提到 realtime、即時連線、斷線重連。
metadata:
  domain: realtime-connection
---

# Realtime 即時連線

即時連線的**領域知識包**。按「問題領域」而非「傳輸技術」組織：連線生命週期、重連、auth、cleanup 這些坑在 SSE / WebSocket / WebRTC 上**幾乎一樣**，共通核心寫一次，各傳輸的細節放 `references/`。

> 範圍：即時**連線與訊息**（伺服器推、雙向訊息、P2P data）。影音**播放**（HLS/WebRTC media）屬另一領域，見 `streaming` skill。JWT / 登入守門屬 auth 領域，見 feature-to-api 的 `auth-scaffold.md`。

## 傳輸選型

先選對傳輸，再看對應 reference。**預設從最簡單的 SSE 開始**，需求超出才升級。

| 傳輸 | 方向 | 用在 | 不要用在 | auth 傳遞 |
|------|------|------|----------|-----------|
| **SSE**（EventSource） | 伺服器→前端 單向 | 通知、進度、即時 feed、儀表板推送（後端推、前端不回） | 需雙向互動、傳二進位 | token 走 **query param**（原生 EventSource 無法帶 header） |
| **WebSocket** | 雙向 | 聊天、協作編輯、雙向低延遲指令 | 純單向推播（殺雞用牛刀，SSE 更省） | token 走 query param，或連線後第一則訊息帶 |
| **WebRTC datachannel** | 點對點 雙向 | P2P 低延遲、繞伺服器直連、即時遊戲/白板 | 需伺服器權威狀態、需稽核訊息 | 透過 signaling 通道交換 |

判準：**只有伺服器要推、前端不需回 → SSE**（最省、自動重連、純文字）；**雙向且都經伺服器 → WebSocket**；**要點對點繞過伺服器 → WebRTC datachannel**。

## 共通核心（傳輸無關，全部都要遵守）

不論 SSE / WS / WebRTC，這些鐵律一致。各傳輸的具體寫法見 reference，但**原則不可違反**：

1. **連線集中在 Pinia store** — 單一連線、單一狀態源。元件**只讀** store 狀態與呼叫 `connect/subscribe/close`，**不得**自己持有 socket 或重複建連。
2. **狀態機顯式化** — `idle → connecting → open → closed / error`，用業務可讀文字對映 UI（「連線中」「已連線」「已斷線」）。不要用裸 boolean。
3. **client-only** — 連線只在瀏覽器建立。進入點一律 `if (!import.meta.client) return`（SSR 期間沒有連線，避免 hydration 與重複建連）。
4. **auth token 走 query，不靠 header** — 原生 `EventSource` / `WebSocket` 建構式**無法帶自訂 header**。token 一律放連線 URL 的 query（`?token=...`）。連帶坑：token 變了要重連、token endpoint 本身別觸發 auth 攔截。
5. **自動重連 + backoff** — 用 `@vueuse/core` 的 `useEventSource`/`useWebSocket` 的 `autoReconnect`（內建退避）。不要自己手刻 `setTimeout` 重連迴圈。
6. **重連必補抓（backfill on reconnect）** — 斷線期間漏掉的事件不會自動補。**區分首次連線 vs 重連**：首次由頁面進場 backfill 負責；第二次（含）以後的 `connected` 才主動重抓斷線期間的資料。後端支援 `Last-Event-ID` replay 後才可移除此補抓。
7. **事件只帶輕量索引，資料用 REST 補** — 推播 payload 只帶 id（如 `{ pitchId, practiceId }`），前端收到後**再打 REST 取整包**渲染。好處：推播輕量、與進場 backfill 共用同一條去重路徑、後端不必把完整 model 塞進事件。
8. **去重（upsert by id）** — 重連補抓會與即時事件、進場 backfill 重疊。一律 `upsert by id`（找到就更新、沒有才新增），不可盲目 push。
9. **訂閱 = 連線參數；變更訂閱 = 重連** — 訂閱透過連線 URL 的參數（如 `?channels=`）達成，不走額外 REST。**參數不變則不重連**（避免無謂斷線）；參數變了才以新 URL 重連。
10. **離場完整 cleanup** — 元件 unmount / 離開頁面時 `close()` 連線 + 清資料 + 清訂閱 + 重置狀態旗標（含 `hasConnectedOnce`）。連線未關 = 記憶體與連線洩漏。
11. **鬆散 envelope 用 discriminated union** — 事件信封常是 `{ id, type, channel, timestamp, data }`，`data` 隨 `type` 變形。型別層用 `type` 當 discriminator 收斂（見 sse.md），`handleEvent` 內 `switch (evt.type)` 分派，default 忽略未知型別（向前相容）。

> 第 11 點接續 feature-to-api codegen 的發現：OpenAPI 對 SSE 的 `data` 多半給鬆散 `Record<string, never>`，**前端需手寫 discriminated union** 補語意（codegen 補不了）。詳見 `openapi-codegen.md` § 8 與本 skill `references/sse.md`。

## References

| 傳輸 | 內容 | 檔案 |
|------|------|------|
| SSE | EventSource 完整實作 pattern（store / 信封型別 / 重連補抓 / mock 端點 / E2E）、踩坑、checklist | [references/sse.md](references/sse.md) |
| WebSocket | （之後加 `references/websocket.md`） | — |
| WebRTC datachannel | （之後加 `references/webrtc-data.md`） | — |

> 擴充新傳輸 = 在本 skill 加一個 reference 檔，**共通核心不重寫**。永遠只有一個 `realtime` skill。

## 被動 / 主動 觸發

- **被動**（本 skill 的 `description`）：寫 `EventSource` / `useEventSource` / `WebSocket` / `RTCPeerConnection` 等程式碼時自動載入。
- **主動**（接進 SDD 流程）：`feature-to-api` Phase 0 與 `feature-to-flow` 掃到即時訊號時，在報告提示「建議套用 realtime skill」並寫入 route-map：
  - SSE：OpenAPI 有 `text/event-stream` content type（**主訊號**）；端點名 `/events` 等僅為範例，以實際標 `text/event-stream` 的端點為準（後端可能叫 `/stream`、`/notifications/subscribe`…）；`.feature`/`.flow.md` 有「即時 / 推播 / 通知 / live」scenario
  - WebSocket：`wss://`、`ws://`、WebSocket 端點描述
  - WebRTC：`RTCPeerConnection`、signaling、datachannel
