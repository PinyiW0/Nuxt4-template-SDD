---
paths:
  - "app/pages/**/*.vue"
  - "app/components/**/*.vue"
  - "app/layouts/**/*.vue"
---

# Vibe UI 守則（v2）

**主 spec 真理是 `test/e2e/specs/*.spec.ts`**——跑 `npx playwright test` 就知道有沒踩線。業務合約定義於對應的 `spec/e2e-flows/*.flow.md` 的 **Business Invariants** 段。

修改 `app/pages/`、`app/components/`、`app/layouts/` 時，必須遵守：

- **不得破壞 Business Invariants**：實體必須可被使用者識別（用業務語意如 username、playerName、deviceId）、業務狀態文字必須保留語意（「連線中」「已斷線」「進行中」「已結束」「建立成功」「已刪除」等）、業務操作必須可被觸發（不一定要按鈕，但要有可達路徑）
- **不得修改** `test/e2e/specs/`（主 spec 凍結，SSOT 政策）
- **不得修改** `spec/gherkin-feature/`、`spec/e2e-flows/`（主 spec 來源凍結）
- **vibe 完 commit 前必跑** `npx playwright test --config playwright.gate.config.ts`（綠燈 = vibe 安全；pre-push 跑同一份 config，但在 Docker production build 內執行，Docker 不可用時 fallback 本機同款）
- vibe spec（`test/e2e/vibe/`）不凍結，但刪改去留是使用者的決定——紅燈時列選項詢問，不可擅自刪改

可以自由改：顏色、間距、字體、icon、layout、按鈕位置與形式（toolbar / icon-only / menu）、modal vs inline form、列表呈現（table / card / list）、折疊、動畫、新增 testid（建議 `vibe-*` 前綴）、新增頁面與互動。字體與按鈕尺寸的預設值見 `spec/ui-config/visual-hierarchy.md`——使用者未明確指示改動時維持預設。

如果你發現非破壞合約無法達成 vibe 目標，**停下來問使用者**，不要擅自改主 spec。
