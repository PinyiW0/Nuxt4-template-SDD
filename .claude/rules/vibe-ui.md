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
- **不得修改凍結區**（主 spec 與其來源）——路徑清單與處理方式見 `rules/frozen-paths.md`（hook 強制擋，此處不重列）
- **vibe 完 commit 前必跑 gate**：走 `/vibe-check`（綠燈 = vibe 安全；pre-push 跑同一份 config，執行環境差異見 /vibe-check「目的」段）。裸指令 `npx playwright test --config playwright.gate.config.ts` 等價**但少了前置檢查**——gate 範圍尚無測試檔時它回 exit 1（`No tests found`），`/vibe-check` 與 pre-push 則會判定「無 spec 可守」放行
- vibe spec（`test/e2e/vibe/`）不凍結，但刪改去留是使用者的決定——紅燈時列選項詢問，不可擅自刪改

可以自由改：顏色、間距、字體、icon、layout、按鈕位置與形式（toolbar / icon-only / menu）、modal vs inline form、列表呈現（table / card / list）、折疊、動畫、新增頁面與互動。新增元素優先給**語意 anchor**（role、accessible name、可見文字），不要自創 testid——合約外 testid 會被 `/vibe-e2e` 判為孤兒；需要新合約定位點時走 flow.md → spec 重生流程。字體與按鈕尺寸的預設值見 `spec/ui-config/visual-hierarchy.md`——使用者未明確指示改動時維持預設。使用者要求「好看一點」「有質感」「換風格」時，先讀 `spec/ui-config/creative-direction.md` 確認風格方向再動手；加動畫時遵守其 §4 動效規範。

如果你發現非破壞合約無法達成 vibe 目標，**停下來問使用者**，不要擅自改主 spec。
