import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// === 測試環境隔離：per-worktree 確定性 port ===
// 以本 config 檔所在目錄（= worktree 根目錄）hash 出 port：
// - 同一 worktree 每次算出同一個 port → reuseExistingServer 可安全重用（green loop 快）
// - 不同 worktree（git worktree add 的平行目錄）→ 不同 port → 多 session 並行不互撞
// 純函式推導、無副作用，gate / vibe config 重複 import 本檔也冪等
const worktreeRoot = path.dirname(fileURLToPath(import.meta.url))
const portHash = createHash('md5').update(worktreeRoot).digest().readUInt16BE(0)
const devPort = 3100 + (portHash % 400) // 3100–3499，避開 dev 慣用的 3000

// E2E_BASE_URL 存在（Docker gate / 外部 server 模式）→ 直接打該 URL，不啟本機 dev server
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${devPort}`

export default defineConfig({
  testDir: './test/e2e/specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'zh-TW',
    viewport: { width: 1280, height: 720 },
  },
  outputDir: 'test/e2e/test-results',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Docker gate 模式（E2E_BASE_URL）不掛 webServer，由外部 container 提供受測 server
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: `npx nuxt dev --port ${devPort}`,
          url: baseURL,
          // 同 worktree 永遠同 port，重用既有 dev server 是安全的（不會連到別的 worktree）
          reuseExistingServer: !process.env.CI,
          timeout: 120000,
          // 測試時強制 API 走同源相對路徑：.env 若設了絕對 URL（固定 port）會讓瀏覽器打錯 server
          // （Playwright 將此 env 疊在 process.env 之上，Nuxt dotenv 不覆蓋既有環境變數 → 必定生效）
          env: { NUXT_PUBLIC_API_BASE: '/api' },
        },
      }),
})
