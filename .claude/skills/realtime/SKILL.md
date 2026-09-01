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
3. **client-only，且等首載完成才連** — 連線只在瀏覽器建立。進入點一律 `if (!import.meta.client) return`（SSR 期間沒有連線，避免 hydration 與重複建連）。且 `document.readyState !== 'complete'` 時**延後到 window load 再連**——首載／hydration 期間建立的 EventSource 會被瀏覽器中斷（Firefox「interrupted while the page was loading」，跨來源還會被標成 CORS 失敗的**假錯誤**）；client 端導航時 readyState 已 complete，不受影響。
4. **auth 放哪由後端 api-spec 決定，別寫死** — 瀏覽器硬限制：原生 `EventSource` / `WebSocket` **無法帶自訂 header**，所以原生方案只剩 **query token** 或 **cookie**（EventSource 會自動帶 cookie）；要用 header 認證得改 `@microsoft/fetch-event-source`（非原生 lib）。在這幾個選項裡選哪個是**後端合約**——以 api-spec 的連線端點為準（由 feature-to-api 偵測寫入 `route-map.realtime.auth`），skill 不該假設「一律 query」。用 query token 時注意：會進反向代理 access log / 瀏覽器歷史，**僅用短效 token**。連帶坑：token 變了要重連、token endpoint 本身別觸發 auth 攔截；**連線前先驗 token exp（留 margin），（近）過期先 refresh 再組 URL**——把死 token 塞進 query 會 401，而重試同一組 URL 永遠 401。
5. **關掉內建自動重連，CLOSED 一律手動 backoff 重連** — 內建 `autoReconnect` 只會拿**同一組 URL**重試，token 過期後永遠 401；**曾經 OPEN 過再斷線一樣要重連**，不要只處理「從未 OPEN 就 CLOSED」——那個分流本身是一個踩過的坑（見 `references/sse.md`「這份範例修過的三個 bug」#1）：`autoReconnect: false` 下沒有「下一次」會接手 OPEN 過的斷線，連線一旦斷了就永久死亡、UI 不再更新且沒有任何錯誤訊號。統一做法：關閉 `autoReconnect`，CLOSED 一律走手動 backoff（設上限如 60s）+ 清 URL 重走 preflight（必要時 refresh 出新 token）。**主動關閉不能觸發這個重連**——見第 10 點，不要用旗標區分，要用 scope 銷毀讓監聽器在結構上失效。
6. **事件逐筆讀取，不用「單一 state + watch」** — 瀏覽器把同一個網路封包裡的多筆事件在同一個 task 內連續 dispatch；`useEventSource` 的 `data` 是單一 shallowRef，`watch(data, ...)` 只看得到同批次的最後一筆，其餘遺失。改成連線建立後直接掛 `eventSource.addEventListener('message', ev => handleEvent(ev.data))`。鈴聲型事件（收到後 refetch）有自癒能力看不太出來，**資料型事件（就地改狀態、不重抓）漏了就永久漏**。
7. **重連必補抓（backfill on reconnect）** — 斷線期間漏掉的事件不會自動補。**區分首次連線 vs 重連**：首次由頁面進場 backfill 負責；第二次（含）以後的 `connected` 才主動重抓斷線期間的資料。後端支援 `Last-Event-ID` replay 後才可移除此補抓。
8. **事件只帶輕量索引，資料用 REST 補** — 推播 payload 只帶 id（如 `{ sightingId, watchId }`），前端收到後**再打 REST 取整包**渲染。好處：推播輕量、與進場 backfill 共用同一條去重路徑、後端不必把完整 model 塞進事件。
9. **去重（upsert by id）** — 重連補抓會與即時事件、進場 backfill 重疊。一律 `upsert by id`（找到就更新、沒有才新增），不可盲目 push。
10. **訂閱 = 連線參數；變更訂閱 = 重連；同 tick 開連線要合併** — 訂閱透過連線 URL 的參數（如 `?channels=`）達成，不走額外 REST。**參數不變則不重連**（避免無謂斷線）；參數變了才以新 URL 重連。**同一 tick 內的多次開連線呼叫要合併成一次**（microtask 收斂、用最終 channels）——connect+subscribe、unsubscribe+subscribe 連開多條會把還在 CONNECTING 的前一條 close 掉，跨來源被瀏覽器標成「CORS did not succeed」的假錯誤。
11. **訂閱用引用計數，頁面只退自己那份——絕不在 unmount 呼叫全域 reset** — SPA 導航到另一個也用同一連線的頁面時，框架的路由/Suspense 通常「新頁 setup 先於舊頁 unmount」，新頁面往往已經訂閱好了；若舊頁面 unmount 呼叫全域 `reset()`（連線層常見的舊寫法），會把新頁面剛建立的連線一起關掉，而新頁面的訂閱邏輯（依賴值沒變）不會重新觸發，導致永久收不到推播（見 `references/sse.md` 同一份 bug 記錄 #3）。訂閱集合用**計數 Map**（`channelId → 數量`）而非 Set，`subscribe` 加一、`unsubscribe` 減一減到 0 才真的退掉；頁面 unmount 只呼叫 `unsubscribe(自己訂的)`。全域 `reset()` 只留給「確定沒有任何頁面在用」的場合（如登出），且應由連線層自己觀察 auth 狀態觸發，而不是散落在各頁面呼叫。
12. **開連線入口要有登出／空頻道守衛** — 光在登出時呼叫 `reset()` 不夠：登出的時序通常是「清 token → 導頁 → 舊頁面才 unmount → 執行 unsubscribe」，而 `unsubscribe` 結尾一律會再走一次開連線流程，會在 `reset()` 之後又把連線開回來（用空 token、空 channels）。守衛要放在「開連線」的**唯一入口**：沒有 token，或組出的 channels 是空的，就 `close()` 並直接 return——這樣所有想開連線的路徑（subscribe / unsubscribe / 重連）都會被擋住。
13. **離場完整 cleanup，連線的 watcher 也要回收** — 元件 unmount 只退自己訂閱的那份（見第 11 點）；連線本身的 `close()` / `reset()` 由連線層負責，清資料 + 清訂閱 + 重置狀態旗標（含 `hasConnectedOnce`）。**每條連線的所有 watcher（message / error / status）要綁在同一個 `effectScope` 裡，重連 / 主動關閉時整組 `scope.stop()`**——這不只是回收記憶體，更是讓「主動關閉」在結構上不可能觸發第 5 點的重連（監聽器已經死了，不會誤判成異常斷線引發重連迴圈）。錯誤紀錄陣列（如 `errorList`）也要設上限，長時間離線反覆失敗不無限堆積。
14. **鬆散 envelope 用 discriminated union** — 事件信封常是 `{ id, type, channel, timestamp, data }`，`data` 隨 `type` 變形。型別層用 `type` 當 discriminator 收斂（見 sse.md），`handleEvent` 內 `switch (evt.type)` 分派，default 忽略未知型別（向前相容）。
15. **常駐連線與 `networkidle` 天生互斥，E2E 要分流** — Playwright 等測試工具的 `waitUntil: 'networkidle'` 等網路安靜，常駐連線永遠不安靜，用了必逾時。若專案的 E2E 依賴 networkidle 且不能改，用明確旗標（如「是否設定了真後端位址」）分流：測試環境走輪詢頂替、有真後端才走即時連線；分流後即時連線路徑在自動化測試零覆蓋，**部署前必須手動跑驗收協定**（見 sse.md），不是選配。
16. **部署前跑驗收協定，不是只看畫面正常** — 連線數是比畫面表現更誠實的指標：重連迴圈、SPA 導航斷線、登出殘留連線，畫面通常看起來一切正常，只有數實際發出的連線請求才看得見。至少驗：停留期間無重連迴圈、頁面間導航後連線數不異常增加、登出後連線確實收乾淨。具體腳本見 `references/sse.md` 的「驗收協定」與 `scripts/`。

> 第 14 點接續 feature-to-api codegen 的發現：OpenAPI 對 SSE 的 `data` 多半給鬆散 `Record<string, never>`，**前端需手寫 discriminated union** 補語意（codegen 補不了）。詳見 `openapi-codegen.md` § 8 與本 skill `references/sse.md`。
>
> **傳輸層 vs 領域層要分開（第 1 點的延伸）**：連線 store 只負責「連線生命週期 + 狀態 + raw event 流」（領域無關）；業務清單與「收到事件 → REST 重抓 → upsert」的領域邏輯，理想上放**另一個領域 store** 消費事件。別把 `sightingList`、`fetchWatchSightings` 這類業務概念塞進連線 store——那會讓「跨專案可重用的連線層」綁死在單一業務上。`references/sse.md` 的範例為求完整把兩者放同一 store（對齊實戰），跨專案重用時應拆開。

## References

| 傳輸 | 內容 | 檔案 |
|------|------|------|
| SSE | EventSource 完整實作 pattern（store / 信封型別 / 重連補抓 / mock 端點 / E2E 分流 / 驗收協定）、踩坑、checklist | [references/sse.md](references/sse.md) + [scripts/](scripts/)（3 支可執行驗收腳本：連線數量測、401 backoff 節奏、直連後端的 ground-truth 監聽） |

> 擴充新傳輸（WebSocket、WebRTC datachannel…）= 屆時在本 skill 加一個 reference 檔，**共通核心不重寫**。永遠只有一個 `realtime` skill。

## 被動 / 主動 觸發

- **被動**（本 skill 的 `description`）：寫 `EventSource` / `useEventSource` / `WebSocket` / `RTCPeerConnection` 等程式碼時自動載入。
- **主動**（接進 SDD 流程）：`feature-to-api` Phase 0 與 `feature-to-flow` 掃到即時訊號時，在報告提示「建議套用 realtime skill」並寫入 route-map：
  - SSE：OpenAPI 有 `text/event-stream` content type（**主訊號**）；端點名 `/events` 等僅為範例，以實際標 `text/event-stream` 的端點為準（後端可能叫 `/stream`、`/notifications/subscribe`…）；`.feature`/`.flow.md` 有「即時 / 推播 / 通知 / live」scenario
  - WebSocket：`wss://`、`ws://`、WebSocket 端點描述
  - WebRTC：`RTCPeerConnection`、signaling、datachannel
