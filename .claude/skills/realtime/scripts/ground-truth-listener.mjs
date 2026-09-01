// SSE ground-truth 監聽器：直連後端、逐筆印出原始事件與相對時間。
// 用途：前端沒反應時，先分清「後端沒推」還是「前端沒收」；驗 connected 的 data.channels。
// 用法：改下方常數後 `node ground-truth-listener.mjs`（需 Node 18+，用到內建 fetch 與串流讀取）
const API = 'http://<後端host>:<port>'
const LOGIN_PATH = '/api/v1/auth/login'
const LOGIN_BODY = { account: '<帳號>', password: '<密碼>' }
const TOKEN_PATH = ['data', 'accessToken']          // 登入回應中 token 的路徑
const EVENTS_PATH = '/api/v1/events'
const CHANNELS = ['<channel:id1>', '<channel:id2>'] // 要訂的頻道
const WATCH_SECONDS = 600

// 登入回應先驗 status 再 parse：後端回 4xx/5xx 或非 JSON 時，直接 .json() 只會噴難讀的
// SyntaxError 堆疊，看不出是帳密錯、路徑錯還是後端掛了——這支是除錯腳本，錯誤訊息要能定位。
const loginRes = await fetch(`${API}${LOGIN_PATH}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(LOGIN_BODY),
})
const loginText = await loginRes.text()
if (!loginRes.ok) { console.error(`登入失敗 HTTP ${loginRes.status}`, loginText.slice(0, 300)); process.exit(1) }
let login
try { login = JSON.parse(loginText) }
catch { console.error(`登入回應不是 JSON（HTTP ${loginRes.status}）`, loginText.slice(0, 300)); process.exit(1) }
const token = TOKEN_PATH.reduce((o, k) => o?.[k], login)
if (!token) { console.error(`登入回應找不到 token（路徑 ${TOKEN_PATH.join('.')}）`, loginText.slice(0, 300)); process.exit(1) }

const url = `${API}${EVENTS_PATH}?token=${encodeURIComponent(token)}&channels=${encodeURIComponent(CHANNELS.join(','))}`
const t0 = Date.now()
const el = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`
const res = await fetch(url, { headers: { Accept: 'text/event-stream' } })
console.log(`HTTP ${res.status}  content-type=${res.headers.get('content-type')}  x-accel-buffering=${res.headers.get('x-accel-buffering')}`)
if (!res.ok || !res.body) { console.error('連線失敗：非 2xx 或無回應內容'); process.exit(1) }

const reader = res.body.getReader()
const dec = new TextDecoder()
let buf = ''
setTimeout(() => { console.log(el(), `${WATCH_SECONDS}s 觀察結束，連線仍在`); process.exit(0) }, WATCH_SECONDS * 1000)
while (true) {
  const { value, done } = await reader.read()
  if (done) { console.log(el(), '✗ 串流被關閉'); break }
  buf += dec.decode(value, { stream: true })  // chunk 邊界不保證對齊換行，需累積後再切分
  const lines = buf.split(/\r?\n/)  // 相容 CRLF，避免行尾殘留 \r 讓 JSON.parse 誤判
  buf = lines.pop() ?? ''  // 最後一段可能是不完整的行，留到下個 chunk 補完
  for (const line of lines) {
    if (!line.trim()) continue
    if (line.startsWith('data:')) {
      try { const e = JSON.parse(line.slice(5).trimStart()); console.log(el(), e.type, JSON.stringify(e.data).slice(0, 200)) }
      catch { console.log(el(), line.slice(0, 150)) }
    }
    else console.log(el(), line.slice(0, 100))   // 心跳註解等
  }
}
