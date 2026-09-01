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

// 按 SSE **frame** 解析，不是按行：一個事件以空行（\n\n）結束，且同一事件可以有多行
// data:，規格要求用 \n 串接後才是完整 payload。逐行 JSON.parse 會把多行 payload 拆碎、
// 也會讓 event:／id: 與它的 data: 脫節——對一支 ground-truth 腳本來說，把真事件誤報成
// 壞資料比沒有輸出更糟。
function printFrame(frame) {
  const fields = { event: undefined, id: undefined, retry: undefined }
  const dataLines = []
  const comments = []
  for (const line of frame.split(/\r?\n/)) {
    if (!line) continue
    if (line.startsWith(':')) { comments.push(line.slice(1).trim()); continue }  // 註解行（常見的心跳寫法）
    const colon = line.indexOf(':')
    const name = colon === -1 ? line : line.slice(0, colon)
    // 規格：欄位值只去掉冒號後的「一個」空白，不是全部 trim
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (name === 'data') dataLines.push(value)
    else if (name in fields) fields[name] = value
  }
  if (comments.length) { console.log(el(), `: ${comments.join(' ')}`.slice(0, 120)); if (!dataLines.length) return }
  if (!dataLines.length) return
  const raw = dataLines.join('\n')   // 多行 data 依規格以 \n 串接
  const tag = fields.event ? `(event:${fields.event})` : ''
  try {
    const e = JSON.parse(raw)
    console.log(el(), tag, e.type, JSON.stringify(e.data).slice(0, 200))
  }
  catch {
    console.log(el(), tag, '非 JSON payload:', raw.slice(0, 150))  // 具名事件（如 heartbeat）payload 常是純文字
  }
}

const reader = res.body.getReader()
const dec = new TextDecoder()
let buf = ''
// 留住 timer handle：串流提前斷掉時要 clearTimeout，否則 timer 仍掛在 event loop 上，
// 程式不會結束，最後還會印出「連線仍在」——連線早就斷了，對 ground-truth 腳本是誤報。
const watchTimer = setTimeout(() => {
  console.log(el(), `${WATCH_SECONDS}s 觀察結束，連線仍在`)
  process.exit(0)
}, WATCH_SECONDS * 1000)
while (true) {
  const { value, done } = await reader.read()
  if (done) { clearTimeout(watchTimer); console.log(el(), '✗ 串流被關閉'); break }
  buf += dec.decode(value, { stream: true })  // chunk 邊界不保證對齊 frame，需累積後再切分
  const frames = buf.split(/\r?\n\r?\n/)   // 空行分隔 frame；相容 CRLF
  buf = frames.pop() ?? ''                  // 最後一段可能是未收完的 frame，留到下個 chunk 補完
  for (const frame of frames) if (frame.trim()) printFrame(frame)
}
