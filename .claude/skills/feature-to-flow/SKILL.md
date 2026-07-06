---
name: feature-to-flow
description: 從 spec/gherkin-feature/ 下任何 .feature 檔（含 .dsl.feature）產生 .flow.md（business invariant + UX-agnostic E2E 流程，testid 為 fallback）。Use when 需要從業務規格檔建立 E2E 測試流程文件，補上 /feature-to-api 的前置輸入。
argument-hint: "[module]"
context: fork
agent: general-purpose
---

# Feature to Flow 工作流程

從 `spec/gherkin-feature/` 下任何 `.feature` 檔（含 `.dsl.feature` 副檔名變體）產出 `spec/e2e-flows/*.flow.md`，補齊 SDD 流程缺口。

## 定位

`.flow.md` 是 `.feature`（事件源規格，業務語言）與 UI/E2E（使用者操作，介面語言）之間的橋樑：

```
spec/gherkin-feature/*.feature（Given event / When command / Then event）
       ↓  /feature-to-flow（本 skill）
.flow.md（開啟頁面 / 點按鈕 / 填表單 / 驗證 testid）
       ↓
/feature-to-api  →  /test e2e spec  →  /feature-to-ui  →  /test e2e green
```

> 本 skill 將 event-sourcing 語意翻譯為 **business invariants + UX-agnostic 驗證流程**。
> 接受的副檔名：`*.feature`、`*.dsl.feature`（兩者皆視為來源檔，無差別處理）。
>
> ### v2 抽象化原則（必讀）
>
> `.flow.md` 不是 UI 步驟腳本，是 business invariant 的可執行描述：
>
> 1. **Steps 用使用者意圖** — 「觸發匯出此次練習」，不是「點擊 `[data-testid="export-single-practice-button"]`」
> 2. **Verification 用業務可觀察結果** — API spy / role+text / 狀態變化，不是逐欄 testid 斷言
> 3. **每個 Scenario 留「不再凍結」段** — 列出 vibe 可自由迭代的 UX 細節
> 4. **testid 為 fallback** — 僅在 role + accessible name 無法消歧時用
> 5. **View 多欄位**：主要識別欄 + 業務狀態欄必驗，細節 metric 走抽樣 / sub-flow（見 phase-1-write.md Section 4）
>
> 詳細指引見 [references/flow-template.md](references/flow-template.md) 與 [references/testid-conventions.md](references/testid-conventions.md)。

## 使用方式

```bash
/feature-to-flow              # 全量：掃描所有 Feature，依領域分組
/feature-to-flow accounts     # 單 module：只重新產出 {NN}-accounts.flow.md
/feature-to-flow 0            # 只跑 Phase 0（列計畫、不寫檔）
/feature-to-flow 1            # 跳過 Phase 0，直接依現有計畫寫檔
```

無參數時：執行 Phase 0 → 列計畫 → **等使用者確認** → 執行 Phase 1。

### 檔名規則

產出檔名為 `{NN}-{module}.flow.md`（NN 為兩位編號）。編號順序依 SDD 推進邏輯：認證 → 帳號 → 主資料 → 流程 → 周邊。例：

```
00-auth.flow.md        # 認證（登入、修改密碼、登出 …）
01-accounts.flow.md    # 帳號管理（帳號 CRUD、備註）
02-teams.flow.md       # 隊伍（球員的前置）
03-players.flow.md     # 球員
04-practice.flow.md    # 練習主流程
05-cameras.flow.md     # 相機（背景同步）
06-export.flow.md      # 匯出（衍生功能）
```

> **`00-` 編號保留給 auth**（capability layer 首要分組，業界主流，見 [references/phase-0-plan.md](references/phase-0-plan.md) 第 2 段）。
> **條件式**：僅在 feature 含登入需求（登入 / login / 帳號+密碼 / 未登入導向）時才產 `00-auth.flow.md`；
> 純展示 / 無登入專案不產（編號保留即可）。auth 守門細節（白名單、未登入導向、防迴圈）由 feature-to-api 的 [auth-scaffold.md](../feature-to-api/references/auth-scaffold.md) 處理。
>
> 編號必須穩定。Sync 模式（已存在編號）時保留原編號，只在新增模組時往後遞增；不可重排既有編號，否則 `/test e2e` 的 spec 對應會錯位。

> **`_common.flow.md`（共用前置流程，本 skill 產出）**：Phase 1 首次寫檔時先產出／維護 `spec/e2e-flows/_common.flow.md`，再寫各 module flow。內容為跨 module 共用的前置合約：登入步驟與測試帳號引用、確認彈窗、資料重置約定——消費端與欄位合約見 [`/test e2e` setup](../test/e2e/references/setup.md)。已存在時只在共用步驟變更時更新。

> **即時連線（條件式）**：flow 含即時需求（即時 / 推播 / 通知 / live / 斷線重連）時，Business Invariants 段須捕捉「連線狀態對使用者可見」（連線中 / 已連線 / 已斷線）與「斷線重連後資料不遺漏」這兩條業務不變式（UX-agnostic：不指定用什麼元件呈現）。實作知識（傳輸選型、重連補抓、cleanup）由 `realtime` skill 提供，連線端點與信封型別由 feature-to-api Phase 0「Realtime 偵測」寫入 route-map。

> **影音串流（條件式，與即時連線不同）**：與「連線狀態」不同，**影音播放的畫面呈現屬 UI / vibe 範疇，flow 不凍結它**——真實 flow 通常只以路由暗示直播頁（如 `/practice/live` 的「live」字），不寫「直播狀態可見」這類不變式（影片要不要顯示 LIVE / 無訊號 / 載入失敗，是 vibe 可自由迭代的呈現）。串流的合約在 OpenAPI 的播放 URL 端點（`/streams` → `hlsUrl`），由 feature-to-api Phase 0「Streaming 偵測」寫入 route-map；實作知識（播放器掛載、看門狗、延遲調校、多路對齊、teardown）由 `streaming` skill 提供。**flow 層不需為串流新增業務不變式**（對比：相機「連線中 / 已斷線」屬即時連線領域，那才是 flow 該捕捉的；見上一條 realtime note）。

> **角色分層 / 授權（條件式）**：feature 含**不同角色看到 / 能做的事不一樣**（「以管理員登入」vs「以教練登入」清單或可操作不同、「僅…可」「無權限」語意）時，Business Invariants 須捕捉兩條 **UX-agnostic** 不變式：① 「{操作 / 資源} 僅 {role} 可達」；② 「無權角色被擋——看不到入口、或被導離、或操作被拒（任一語意反饋皆可）」。**不指定守門形式**（403 頁 / 導回首頁 / 入口隱藏由 vibe 決定）。角色名用 feature 實際出現的詞、不寫死。授權的合約（端點存取 / 列表 ACL / 單筆 object 歸屬（BOLA）/ 受保護路由）由 feature-to-api Phase 0「授權（RBAC）偵測」萃取進 `route-map.rbac`，實作範本見 [rbac-scaffold.md](../feature-to-api/references/rbac-scaffold.md)；flow 只負責把「角色可見性」立成業務不變式（含「只能操作自己的」這類單筆歸屬語意），讓 spec 有依據產拒絕場景。

---

## 現有檔案

!`find spec/gherkin-feature -maxdepth 1 -type f -name '*.feature' 2>/dev/null | sort -u || echo "(無)"`

!`echo "--- 現有 flow ---"; find spec/e2e-flows -maxdepth 1 -type f -name '*.flow.md' 2>/dev/null | sort -u || echo "(無)"`

---

## Phase 概覽

| Phase | 名稱 | 輸出 | 必讀規範 |
|-------|------|------|----------|
| 0 | 計畫 | module 分組表、Feature → flow 對照表 | [phase-0-plan.md](references/phase-0-plan.md) |
| 1 | 寫檔 | `spec/e2e-flows/_common.flow.md`（首次）+ `{module}.flow.md` | [phase-1-write.md](references/phase-1-write.md) + [flow-template.md](references/flow-template.md) + [testid-conventions.md](references/testid-conventions.md) |

---

## 必讀文件

- **[references/phase-0-plan.md](references/phase-0-plan.md)** — 解析 Feature、推導 module 分組、列計畫
- **[references/phase-1-write.md](references/phase-1-write.md)** — 依計畫產出 .flow.md
- **[references/flow-template.md](references/flow-template.md)** — `.flow.md` 結構範本
- **[references/testid-conventions.md](references/testid-conventions.md)** — `data-testid` 命名規則

---

## 自動執行規則

- 執行 `/feature-to-flow`（無參數）時，**直接開始 Phase 0**，掃描 `spec/gherkin-feature/` 內所有 `*.feature` 檔（含 `*.dsl.feature`）
- 帶 module 參數時（如 `accounts`），只處理該 module 對應的 Feature 區塊
- **Phase 0 結束時必須停下來等使用者確認**：列出建議的 module 分組與 Feature → flow 對應，使用者回覆 `OK` / 調整建議後才進入 Phase 1
- 若 `spec/e2e-flows/{module}.flow.md` 已存在，Phase 1 寫入前要在計畫中標示「覆寫」並等確認
- 不主動詢問其他細節（命名、testid 規則皆已內建於 references）

---

## 注意事項

- 每個 Phase 完成後，告知使用者下一步指令
- **Phase 0 完成後提示**：「請確認分組計畫，回覆 OK 後執行 `/feature-to-flow 1` 寫檔」
- **Phase 1 完成後提示**：「下一步：`/feature-to-api` 產出 API 合約」
- `.flow.md` 必須涵蓋 `.feature` 內所有 `Scenario`（含 happy-path 與例外路徑），不可只挑 happy-path
- testid 命名一律遵守 [testid-conventions.md](references/testid-conventions.md)，禁止臨時發明格式
