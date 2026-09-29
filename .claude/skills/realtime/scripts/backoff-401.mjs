// 401 重連節奏量測：把 /events 攔成固定 401，記錄前端每次重試的相對時刻。
// 驗證：backoff 指數遞增至上限、無失控轟炸。預期輸出類似：
//   #1 +0.0s  #2 +0.5s  #3 +1.5s  #4 +3.6s  #5 +7.6s  #6 +15.6s  #7 +31.6s  #8 +63.6s
// 用法：在專案根目錄放置後 `node backoff-401.mjs`
// 判定：逐個間隔對 min(BASE × 2^i, MAX) 比較（容差見 judgeBackoff）、觀察期內次數不超過理論上限，
//   任一不符結束碼為 1，全過為 0。固定間隔重試（如每 1s 一次）最慢在第 3 個間隔就會被下限抓到（issue #164；
//   舊版只驗「不縮短、不超上限、次數不過多」，固定間隔也會過）。
//   BASE_BACKOFF_MS／MAX_BACKOFF_MS 要改成專案 store 的實際值（sse.md 範例是 500／60_000）
// 判定邏輯抽成純函式 judgeBackoff 並 export，test/unit/backoff-401.spec.ts 餵假間隔驗證；
// 量測流程只在直接執行本檔時跑，被 import 時不開瀏覽器。
import { pathToFileURL } from 'node:url'

const APP = 'http://localhost:3000'
const SSE_URL_MATCH = '**/api/v1/events*'
const PAGE = '/<有訂閱的頁面>'
const T = { user: 'account-username-input', pass: 'account-password-input', submit: 'account-login-submit-button' }
const LOGIN = { user: '<帳號>', pass: '<密碼>' }
const WATCH_SECONDS = 180
const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 60_000

// 容差：下限卡緊、上限放寬。
// - 下限 expected − LOWER_SLACK_MS：瀏覽器計時器不會提早觸發，固定間隔一定在這裡被抓到
// - 上限 expected + max(UPPER_SLACK_MIN_MS, expected × UPPER_SLACK_RATIO)：每次重連前的預檢請求（換 token 等）
//   會加到間隔上，dev 模式可能慢；量到的實際偏差若常態超過 1s，調 UPPER_SLACK_MIN_MS 而不是放寬下限
export const LOWER_SLACK_MS = 100
export const UPPER_SLACK_MIN_MS = 1000
export const UPPER_SLACK_RATIO = 0.25

// 理論次數上限：照 BASE→×2→MAX 的節奏排滿觀察期，再加 1 次容錯
export function maxAttemptsWithin(watchMs, { base, max }) {
  let count = 1
  for (let t = 0, d = base; t + d <= watchMs; t += d, d = Math.min(d * 2, max)) count++
  return count + 1
}

// 純判定：gaps 是相鄰請求的間隔（ms），第 i 個間隔預期 min(base × 2^i, max)。回傳失敗訊息陣列，空陣列＝通過。
export function judgeBackoff(gaps, { base, max }) {
  const failures = []
  if (gaps.length < 2) failures.push(`間隔只有 ${gaps.length} 個，不足 2 個，無法判定節奏`)
  gaps.forEach((g, i) => {
    const expected = Math.min(base * 2 ** i, max)
    const lower = expected - LOWER_SLACK_MS
    const upper = expected + Math.max(UPPER_SLACK_MIN_MS, expected * UPPER_SLACK_RATIO)
    if (g < lower) failures.push(`第 ${i + 1} 個間隔 ${g}ms 短於預期 ${expected}ms（下限 ${lower}ms）：沒有照 BASE→×2 遞增`)
    if (g > upper) failures.push(`第 ${i + 1} 個間隔 ${g}ms 長於預期 ${expected}ms（上限 ${upper}ms）`)
  })
  return failures
}

async function main() {
  const { chromium } = await import('@playwright/test')
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

  const judged = times
  const gaps = judged.slice(1).map((t, i) => t - judged[i])
  const limits = { base: BASE_BACKOFF_MS, max: MAX_BACKOFF_MS }
  const failures = judgeBackoff(gaps, limits)
  const maxAttempts = maxAttemptsWithin(WATCH_SECONDS * 1000, limits)
  if (judged.length > maxAttempts) failures.push(`${WATCH_SECONDS}s 內受測頁 ${judged.length} 次請求，超過理論上限 ${maxAttempts} 次（失控轟炸）`)

  console.log(`\n${WATCH_SECONDS}s 內受測頁共 ${judged.length} 次請求（含登入過程共 ${n} 次），間隔（ms）：${gaps.join(', ') || '無'}`)
  failures.forEach(f => console.log(`❌ ${f}`))
  console.log(failures.length ? `驗收失敗 ${failures.length} 項` : '✅ 間隔照 BASE→×2→MAX 遞增、次數在理論上限內')
  if (failures.length) process.exitCode = 1
}

// 只在 `node backoff-401.mjs` 直接執行時量測；vitest import 本檔取 judgeBackoff 時不開瀏覽器
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
