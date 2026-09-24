// SSE 連線數驗收：攔截前端所有 /events 請求，驗三件事——
//   (1) 停留期間無重連迴圈  (2) 頁面導航後恰好一條活連線  (3) 登出後零新連線、既有已關
// 用途：連線數是比畫面表現更誠實的指標；迴圈與殘留連線只有數請求才看得見。
// 用法：在專案根目錄放置後 `node connection-count.mjs`（需要專案的 @playwright/test）
// 判定：三段全跑完才結束，任一段不過結束碼為 1，全過為 0——呼叫端（CI、AI）看結束碼，不必讀 log
import { chromium } from '@playwright/test'

const APP = 'http://localhost:3000'
const SSE_URL_MATCH = '/api/v1/events'
const LOGIN = { user: '<帳號>', pass: '<密碼>' }
const T = {  // 專案的 testid
  user: 'account-username-input', pass: 'account-password-input',
  submit: 'account-login-submit-button', logout: 'sidebar-logout',
}
const PAGE_A = '/<有訂閱的頁面A>'
const PAGE_B = '/<有訂閱的頁面B>'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const sse = []
page.on('request', r => { if (r.url().includes(SSE_URL_MATCH)) sse.push({ ch: new URL(r.url()).searchParams.get('channels'), done: false, req: r }) })
page.on('requestfinished', r => { const x = sse.find(s => s.req === r); if (x) x.done = true })
page.on('requestfailed', r => { const x = sse.find(s => s.req === r); if (x) x.done = true })
const report = (tag) => {
  const alive = sse.filter(s => !s.done)
  console.log(`\n=== ${tag}：總 ${sse.length} 條，活著 ${alive.length} ===`)
  sse.forEach((s, i) => console.log(`  #${i + 1} channels=${(s.ch ?? '').slice(0, 120)}  ${s.done ? '已關閉' : '★連線中'}`))
  return alive.length
}
const failures = []
const verdict = (ok, pass, fail) => {
  console.log(ok ? `✅ ${pass}` : `❌ ${fail}`)
  if (!ok) failures.push(fail)
}

await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' })  // 登入頁若有常駐連線，networkidle 會卡住；locator 會自動等欄位可互動
await page.getByTestId(T.user).fill(LOGIN.user)
await page.getByTestId(T.pass).fill(LOGIN.pass)
await page.getByTestId(T.submit).click()
await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 })

// (1) 停留 20s：連線數應穩定（初連 + 頻道擴充各一條算正常；同 channels 重複開 = 迴圈）
const beforeStay = sse.length
await page.goto(`${APP}${PAGE_A}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(20000)
report('頁 A 停留 20s')
const stayCounts = {}
sse.slice(beforeStay).forEach(s => { stayCounts[s.ch ?? ''] = (stayCounts[s.ch ?? ''] ?? 0) + 1 })
const repeated = Object.entries(stayCounts).filter(([, n]) => n > 1)
verdict(repeated.length === 0, '停留期間無同 channels 重複連線',
  `停留期間同 channels 重複連線（重連迴圈）：${repeated.map(([ch, n]) => `${ch.slice(0, 60)} ×${n}`).join('、')}`)

// (2) 導航：恰好一條活連線
const beforeNav = sse.length
await page.goto(`${APP}${PAGE_B}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)
const aliveAfterNav = report('導航到頁 B 後')
console.log(`  導航期間新增 ${sse.length - beforeNav} 條 SSE 請求`)
verdict(aliveAfterNav === 1, '導航後恰好一條活連線', `導航後活連線 ${aliveAfterNav} 條（應為 1）`)

// (3) 登出：零新連線、既有已關（觀察 15s 涵蓋一輪 backoff）
const beforeLogout = sse.length
await page.getByTestId(T.logout).first().click()
await page.waitForTimeout(15000)
const aliveAfterLogout = report('登出後 15s')
const newAfterLogout = sse.length - beforeLogout
verdict(newAfterLogout === 0 && aliveAfterLogout === 0, '登出後零新連線、既有連線已收掉',
  `登出後新開 ${newAfterLogout} 條 / 活著 ${aliveAfterLogout} 條（應皆為 0）`)
await browser.close()
console.log(failures.length ? `\n驗收失敗 ${failures.length} 段` : '\n三段全部通過')
if (failures.length) process.exitCode = 1
