# Claude 專案指令

## Event Storming 自動化流程 v6.0

本流程引導非技術使用者完成 Event Storming，產出 **DSL-Level Gherkin** 規格檔案。

> **Prompt 來源**：所有 Event Storming prompts 位於 `.ai-prompts/event-storming/`
>
> 詳細文檔：[.ai-prompts/event-storming/README.md](.ai-prompts/event-storming/README.md)

### 翻譯鏈定位

```
Event Storming → DSL-Level Gherkin → ISA-Level Gherkin → Test Code → Code
                 ^^^^^^^^^^^^^^^^
                 本流程產出層級
```

| 層級 | 職責 | 受眾 |
|------|------|------|
| **DSL-Level**（本流程） | 業務可讀的可執行規格 | 業務、QA、開發 |
| ISA-Level（後續轉換） | 技術可翻譯的精準規格 | 開發、AI |

---

## 觸發方式

### 標準語法（推薦，與 Copilot 相容）

```
do: docs/user-stories/user-v1.md
for: event storming
```

```
do: docs/user-stories/user-v1.md
for: event storming
epic: B
```

```
do: docs/user-stories/user-v1.md
for: event storming
mode: update
```

### Slash Command

```bash
/event-storming docs/user-stories/user-v1.md
/event-storming docs/user-stories/user-v1.md --epic B
```

### 自然語言

```
執行 Event Storming 流程，PRD 檔案：docs/user-stories/user-v1.md
```

---

## 執行流程

```
Stage 0: PRD 解析
    ↓
Stage 1: 詞彙表建立 (Glossary)
    ↓
Stage 2: Epic 分析
    ↓
[Per Epic Loop]
    Stage 3: Domain Events
    Stage 4: Commands
    Stage 5: Policies
    +------------------+
    | 邊界問題確認      |  <-- 強制步驟
    +------------------+
    Stage 6: Gherkin (DSL)
    ↓
Stage 7: PlantUML 視覺化（可選）
```

---

## Stage 參考

執行每個 Stage 時，請先讀取對應的 prompt 檔案：

| Stage | 角色 | Prompt 檔案 |
|-------|------|-------------|
| 協調者 | Facilitator | `.ai-prompts/event-storming/facilitator.md` |
| 0 | PRD Analyst | `.ai-prompts/event-storming/stages/stage0-prd-analyst.md` |
| 1 | Glossary Manager | `.ai-prompts/event-storming/stages/stage1-glossary-manager.md` |
| 2 | Epic Analyst | `.ai-prompts/event-storming/stages/stage2-epic-analyst.md` |
| 3 | Event Expert | `.ai-prompts/event-storming/stages/stage3-event-expert.md` |
| 4 | Command Expert | `.ai-prompts/event-storming/stages/stage4-command-expert.md` |
| 5 | Policy Expert | `.ai-prompts/event-storming/stages/stage5-policy-expert.md` |
| 6 | BDD Expert | `.ai-prompts/event-storming/stages/stage6-bdd-expert.md` |
| 7 | Visualizer | `.ai-prompts/event-storming/stages/stage7-visualizer.md` |

---

## Claude 使用指引

### 上下文管理

1. **讀取 Prompt**：執行每個 Stage 前，先讀取對應的 prompt 檔案
2. **維持狀態**：在整個流程中維持 Glossary 和已處理的 Epic 狀態
3. **互動確認**：遇到邊界問題時，與使用者互動確認

### 執行步驟

```
1. 讀取 PRD 檔案
2. 讀取 .ai-prompts/event-storming/facilitator.md
3. 依序執行 Stage 0-2
4. 對每個 Epic 執行 Stage 3-6
5. 詢問是否執行 Stage 7
```

### 輸出檔案

將中間產物輸出到 `docs/gherkin-spec/_meta/`：

```
docs/gherkin-spec/
├── _meta/
│   ├── prd-structure.json
│   ├── glossary.json
│   ├── epic-dependencies.json
│   ├── boundary-decisions.json
│   ├── events/{epic-id}-events.json
│   ├── commands/{epic-id}-commands.json
│   └── policies/{epic-id}-policies.json
├── epic-{x}/
│   └── us-{id}-{name}.feature
└── _diagrams/
```

---

## DSL Gherkin 快速參考

詳細語法：[.ai-prompts/event-storming/dsl-format.md](.ai-prompts/event-storming/dsl-format.md)

### Given（前置條件）

```gherkin
Given 系統中存在球隊 "閃電隊"
Given 球隊 "閃電隊" 有球員 "王小明"，背號 1
Given 系統中沒有任何球隊
```

### When（執行動作）

```gherkin
When 教練 建立球隊 "閃電隊"
When 教練 查詢球隊列表
When 教練 刪除球隊 "閃電隊"
```

### Then（驗證結果）

```gherkin
Then 球隊 "閃電隊" 應該存在
Then 應回傳 2 筆球隊
Then 應回傳錯誤 "球隊名稱已被使用"
```

### DSL vs ISA 對照

| 特性 | DSL-Level（本流程） | ISA-Level |
|------|---------------------|-----------|
| **Key 識別** | `"閃電隊"` | `$Team.id` |
| **變數語法** | 無 | `>`, `<`, `$` |
| **技術參數** | 隱藏 | `(UID="$User.id")`, `call table:` |
| **DataTable 欄位** | 中文 | camelCase |
| **目的** | 業務驗收 | 技術翻譯 |

---

## 邊界問題互動

當遇到需要確認的問題時，使用以下格式：

```markdown
---
### 需要確認

**關於 [問題主題]**

**Q[編號]: [問題描述]**
- [ ] **A)** [最可能的選項] (推薦)
- [ ] **B)** [次可能的選項]
- [ ] **C)** 其他：_______________

請選擇：
---
```

---

## UI 實作指令

### 完整工作流程（推薦）

當需要根據 .feature 檔產生完整的 UI 畫面時，使用以下指令：

```bash
/feature-to-ui
```

或自然語言：
```
請根據 .feature 檔搭配 NuxtUI 去產生對應畫面
```

此工作流程會依序執行：

| Phase | 說明 | 完成後動作 |
|-------|------|-----------|
| Phase 0 | 載入 `/nuxt-ui`、分析所有 .feature 檔、產出功能清單 | 詢問確認 |
| Phase 1 | 建立 Mock API（假資料端點） | 詢問確認 |
| Phase 2 | 基礎架構設定（色彩、Layout、共用組件、明暗模式） | 詢問確認 |
| Phase 3 | 逐一實作功能畫面 | **每個功能完成後都詢問確認** |

> **重要**：每個 Phase 和每個功能完成後都會詢問用戶確認，確認後才會繼續。

詳細流程請參考：`.claude/skills/feature-to-ui/SKILL.md`

---

### 單一功能實作

如果只需要實作單一功能（非完整流程），必須先讀取以下文件：

1. **UI 設定檔**：`.ai-prompts/ui/ui-config.yaml`
   - 專案名稱（禁止自行定義）
   - 色彩主題配置
   - Toast、表格、表單等元件行為設定
   - Icon 對照表

2. **UI 建構指南**：`.ai-prompts/ui/nuxt-ui-page-builder.md`
   - DSL Feature 到 UI 的轉換規則
   - 元件規範和範本
   - 表單驗證規則
   - 錯誤處理方式

3. **NuxtUI 文檔**：載入 `/nuxt-ui` skill
   - 組件 API 和使用方式

4. **DSL Feature 規格**：`docs/gherkin-spec/features/*.feature`
   - 從 DSL 提取表單欄位
   - 從 Rule 提取驗證規則
   - 從 Then 提取錯誤訊息

### 執行流程

```
1. 載入 /nuxt-ui skill
2. 讀取 ui-config.yaml 取得設定
3. 讀取相關的 DSL Feature 檔案
4. 依照 nuxt-ui-page-builder.md 的規範產生 UI
5. 確保 app.config.ts 與 ui-config.yaml 同步
```

### 禁止事項

| 禁止行為 | 正確做法 |
|----------|----------|
| 自行定義網站名稱 | 從 `project.name` 讀取 |
| 寫死色彩值 | 使用語意化 `color="primary"` |
| 使用非指定 icon 集 | 使用 `ui-config.yaml > icons.collection` |
| 查詢頁面沒有搜尋框 | `query.searchBox.enabled` 為 true 時必須有 |
| 密碼欄位沒有眼睛切換 | 檢查 `form.password.showToggle` |
| 跳過確認步驟直接做多個功能 | 每個功能完成後都要等用戶確認 |
| 不載入 /nuxt-ui 就開始寫組件 | 先載入 skill 確認組件 API |

### 觸發條件

以下情況視為 UI 實作，需遵循上述流程：
- 建立新頁面（pages/）
- 建立新元件（components/）
- 修改現有 UI 元件
- 實作表單功能
- 實作列表/表格功能

---

## 程式碼品質驗證（強制）

**每次完成程式碼修改後（包括新增、編輯、刪除檔案），必須執行以下驗證：**

```bash
npx eslint . --fix && npm run typecheck
```

### 執行時機

- 完成一個功能或修改後（不是每改一個檔案就跑一次）
- 在回報「完成」之前
- 在準備 commit 之前

### 處理流程

1. 先執行 `npx eslint . --fix` 自動修正可修正的問題
2. 如果有 ESLint 錯誤無法自動修正，手動修正後重新執行
3. 執行 `npm run typecheck` 檢查型別
4. 如果有型別錯誤，修正後重新執行直到通過
5. **兩者都通過後才算完成**

### 常見問題

| 問題 | 原因 | 解法 |
|------|------|------|
| re-export 找不到型別 | 新增了 API 但沒定義對應型別 | 在 `app/types/api/` 下新增型別定義 |
| import 排序錯誤 | perfectionist 規則 | `eslint --fix` 自動修正 |
| `noUncheckedIndexedAccess` | tsconfig strict 模式 | 使用 `!` 斷言或加 null check |

---

## 其他專案指令

（其他 Claude 指令可以在這裡添加）
