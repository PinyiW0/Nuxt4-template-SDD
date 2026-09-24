// 401 重連節奏量測：把 /events 攔成固定 401，記錄前端每次重試的相對時刻。
// 驗證：backoff 指數遞增至上限、無失控轟炸。預期輸出類似：
//   #1 +0.0s  #2 +0.5s  #3 +1.5s  #4 +3.6s  #5 +7.6s  #6 +15.6s  #7 +31.6s  #8 +63.6s
// 用法：在專案根目錄放置後 `node backoff-401.mjs`
// 判定：相鄰間隔不縮短、間隔不超過上限、觀察期內次數不超過理論上限，任一不符結束碼為 1，全過為 0。
//   BASE_BACKOFF_MS／MAX_BACKOFF_MS 要改成專案 store 的實際值（sse.md 範例是 500／60_000）
import { chromium } from '@playwright/test'

const APP = 'http://localhost:3000'
const SSE_URL_MATCH = '**/api/v1/events*'
const PAGE = '/<有訂閱的頁面>'
const T = { user: 'account-username-input', pass: 'account-password-input', submit: 'account-login-submit-button' }
const LOGIN = { user: '<帳號>', pass: '<密碼>' }
const WATCH_SECONDS = 180
const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 60_000
const TOLERANCE_MS = 300  // 量測誤差：瀏覽器排程與 route 攔截的延遲

const browser = await chromium.launch()
const page = await browser.newPage()

let t0 = null
let n = 0
const times = []  // 只收受測頁發出的請求：登入後落地頁也可能打 /events，算進來會吃掉次數上限的容錯
await page.route(SSE_URL_MATCH, async (route) => {  // 登入前就攔，避免登入後首個 /events 漏網、量測失準
  t0 ??= Date.now()
  if (new URL(route.request().frame().url()).pathname === PAGE) times.push(Date.now())
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
await browser.close()

// 理論次數上限：照 BASE→×2→MAX 的節奏排滿觀察期，再加 1 次容錯
let maxAttempts = 1
for (let t = 0, d = BASE_BACKOFF_MS; t + d <= WATCH_SECONDS * 1000; t += d, d = Math.min(d * 2, MAX_BACKOFF_MS)) maxAttempts++
maxAttempts += 1

const judged = times
const gaps = judged.slice(1).map((t, i) => t - judged[i])
const failures = []
if (gaps.length < 2) failures.push(`受測頁只量到 ${judged.length} 次請求，間隔不足 2 個，無法判定節奏`)
gaps.forEach((g, i) => {
  if (i > 0 && g + TOLERANCE_MS < gaps[i - 1]) failures.push(`第 ${i + 2} 個間隔 ${g}ms 比前一個 ${gaps[i - 1]}ms 短（未遞增）`)
  if (g > MAX_BACKOFF_MS + TOLERANCE_MS) failures.push(`第 ${i + 1} 個間隔 ${g}ms 超過上限 ${MAX_BACKOFF_MS}ms`)
})
if (judged.length > maxAttempts) failures.push(`${WATCH_SECONDS}s 內受測頁 ${judged.length} 次請求，超過理論上限 ${maxAttempts} 次（失控轟炸）`)

console.log(`\n${WATCH_SECONDS}s 內受測頁共 ${judged.length} 次請求（含登入過程共 ${n} 次），間隔（ms）：${gaps.join(', ') || '無'}`)
failures.forEach(f => console.log(`❌ ${f}`))
console.log(failures.length ? `驗收失敗 ${failures.length} 項` : '✅ 間隔不縮短、未超過上限、次數在理論上限內')
if (failures.length) process.exitCode = 1
