---
paths:
  - "app/pages/**/*.vue"
  - "app/components/**/*.vue"
  - "app/layouts/**/*.vue"
---

# UI 實作規範

## 觸發條件

以下情況視為 UI 實作，需遵循本規範：

- 建立新頁面（pages/）
- 建立新元件（components/）
- 修改現有 UI 元件
- 實作表單功能
- 實作列表/表格功能

## 禁止事項

| 禁止行為 | 正確做法 |
|----------|----------|
| 自行定義網站名稱 | 從 `ui-config.yaml > project.name` 讀取 |
| 寫死色彩值（class 任意值色彩由 visual-hierarchy-check 強制擋） | 使用語意化 `color="primary"` 或 `@theme` token |
| 使用非指定 icon 集 | 使用 `ui-config.yaml > icons.collection` |
| 查詢頁面沒有搜尋框 | `query.searchBox.enabled` 為 true 時必須有 |
| 密碼欄位沒有眼睛切換 | 檢查 `form.password.showToggle` |
| 跳過確認步驟直接做多個功能 | 每個功能完成後都要等用戶確認 |
| 不載入 `/nuxt-ui` 就開始寫組件 | 先載入 skill 確認組件 API |
| 定義 local interface | 必須 import `~/types/api/` |
| 自創字級（`text-[13px]` 任意值、未定義具名 token） | 依 `spec/ui-config/visual-hierarchy.md` 字級三層規則 |
| 一頁多個大標題互搶焦點 | 頁面主標一頁一個，層級見 `visual-hierarchy.md` 文字層級表 |
| 按鈕尺寸不依情境 | 依 `visual-hierarchy.md` 按鈕尺寸對照（列內 `xs`、工具列 `sm`、表單 `md`） |

## 設定來源

所有 UI 設定從 `spec/ui-config/ui-config.yaml` 讀取，禁止自行決定。
視覺層級（文字/顏色層級、載體字級、按鈕尺寸）：實作 UI 前先讀 `spec/ui-config/visual-hierarchy.md`。
創意方向（風格 preset、主題 token、公開頁 `(public)` 解禁分界、動效規範、外部資源升級路徑）：使用者要求風格／質感／動畫或實作公開頁時讀 `spec/ui-config/creative-direction.md`。
