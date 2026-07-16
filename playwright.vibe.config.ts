import { defineConfig } from '@playwright/test'

import baseConfig from './playwright.config'

// Vibe spec 專用設定：繼承主 config，只切換 testDir 到 test/e2e/vibe
// 主 config 一律不動（凍結合約），vibe 流程獨立跑於此 config
//
// testMatch 由主 config 繼承（'**/*.spec.ts'），三份 config 收檔規則一致。
// **刻意不設 testIgnore**：`unstable/` 在此照跑——時序敏感 spec 不進守門，但手動跑
// /vibe-e2e 或本 config 時要跑得到（見 vibe-e2e/SKILL.md:14、:104-106）。排除 unstable/
// 是 gate config 的職責，不是這裡的；為了「三份一致」在此補 testIgnore 會讓全量 vibe 驗證漏掉它。
export default defineConfig({
  ...baseConfig,
  testDir: './test/e2e/vibe',
  outputDir: 'test/e2e/test-results-vibe',
  // HTML 報告與主 config 分目錄，連續跑不互蓋
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-vibe' }],
  ],
})
