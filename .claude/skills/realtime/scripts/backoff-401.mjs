// 401 重連節奏量測：把 /events 攔成固定 401，記錄前端每次重試的相對時刻。
// 驗證：backoff 指數遞增至上限、無失控轟炸。預期輸出類似：
//   #1 +0.0s  #2 +0.5s  #3 +1.5s  #4 +3.6s  #5 +7.6s  #6 +15.6s  #7 +31.6s  #8 +63.6s
// 用法：在專案根目錄放置後 `node backoff-401.mjs`
import { chromium } from '@playwright/test'

const APP = 'http://localhost:3000'
const SSE_URL_MATCH = '**/api/v1/events*'
const PAGE = '/<有訂閱的頁面>'
const T = { user: 'account-username-input', pass: 'account-password-input', submit: 'account-login-submit-button' }
const LOGIN = { user: '<帳號>', pass: '<密碼>' }
const WATCH_SECONDS = 180

const browser = await chromium.launch()
const page = await browser.newPage()

let t0 = null
let n = 0
await page.route(SSE_URL_MATCH, async (route) => {  // 登入前就攔，避免登入後首個 /events 漏網、量測失準
  t0 ??= Date.now()
  console.log(`  [attempt #${++n} @ +${((Date.now() - t0) / 1000).toFixed(1)}s] -> 401`)
  // 必須 await：不等 fulfill 完成就結束 handler，攔截會偶發失效、量到的節奏不可信
  await route.fulfill({ status: 401, contentType: 'application/json', body: '{"success":false,"code":"UNAUTHORIZED"}' })
})

await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' })  // 登入頁若有常駐連線，networkidle 會卡住；locator 會自動等欄位可互動
await page.getByTestId(T.user).fill(LOGIN.user)
await page.getByTestId(T.pass).fill(LOGIN.pass)
await page.getByTestId(T.submit).click()
await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 })
await page.goto(`${APP}${PAGE}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(WATCH_SECONDS * 1000)
console.log(`\n${WATCH_SECONDS}s 內共 ${n} 次重試。檢查：間隔是否指數遞增至上限、次數是否合理。`)
await browser.close()
