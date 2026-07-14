import { defineConfig } from '@playwright/test'

import baseConfig from './playwright.config'

// 守門 config：主 spec + vibe spec 一次跑完（共用同一個 webServer，避免冷啟動兩次）
// 三個守門入口（/vibe-check、pre-push、未來 CI）都跑這份，確保合約一致
// vibe/unstable/ 為時序敏感 spec 隔離區，不進守門（手動 /vibe-e2e 時照跑）
export default defineConfig({
  ...baseConfig,
  testDir: './test/e2e',
  testMatch: ['specs/**/*.spec.ts', 'vibe/**/*.spec.ts'],
  testIgnore: ['vibe/unstable/**'],
  // 結果目錄與主 config 分開：/sdd-status 以主 config 的 .last-run.json 判「主 spec green」，
  // gate 跑（含 vibe spec）寫同一份會污染該訊號
  outputDir: 'test/e2e/test-results-gate',
  // HTML 報告與主 config 分目錄，連續跑不互蓋
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-gate' }],
  ],
})
