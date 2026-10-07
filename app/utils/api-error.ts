// 後端 ErrorEnvelope：{ success:false, code, message, errors? }
// 欄位層級驗證錯誤
export interface ErrorEnvelopeFieldError {
  field: string
  message: string
}
export interface ErrorEnvelope {
  success: false
  code: string
  message: string
  errors?: ErrorEnvelopeFieldError[]
}

// 錯誤種類：只分「畫面上有不同處理」的種類；409／422／429 等歸 client，由呼叫端用 getErrorCode／getFieldErrors 分支
export type ApiErrorKind
  = | 'network' // 沒收到回應：斷網、逾時、CORS
    | 'unavailable' // 502／503／504：後端整台無法服務
    | 'server' // 500 與其他 5xx
    | 'unauthorized' // 401（refresh 流程由 useHttp 負責）
    | 'forbidden' // 403
    | 'notFound' // 404
    | 'client' // 其他 4xx
    | 'unknown' // 不是 HTTP 錯誤（例如程式本身拋錯）

// 各種類的預設使用者文案；衍生專案直接改這裡即全站生效
export const ERROR_COPY: Record<ApiErrorKind, string> = {
  network: '網路連線中斷，請確認網路後再試一次',
  unavailable: '伺服器暫時無法服務，請稍後再試',
  server: '系統發生錯誤，請稍後再試',
  unauthorized: '登入已過期，請重新登入',
  forbidden: '你沒有權限執行這個操作',
  notFound: '找不到這筆資料，可能已被刪除',
  client: '請求無法完成，請確認後再試',
  unknown: '發生未預期的錯誤，請稍後再試',
}

// 各種類的短標題（給 UEmpty 的 title）；整句文案放 description。衍生專案改這裡即全站生效
export const ERROR_TITLE: Record<ApiErrorKind, string> = {
  network: '連線中斷',
  unavailable: '服務暫停',
  server: '系統發生錯誤',
  unauthorized: '登入已過期',
  forbidden: '沒有權限',
  notFound: '找不到資料',
  client: '無法完成請求',
  unknown: '發生錯誤',
}

// 這些種類的後端文字沒有價值（Bad Gateway、ofetch 組的 <no response>、Nitro 填的 Server Error／Cannot find any path…），一律用固定文案
// 401 刻意不列入：登入頁的「帳號或密碼錯誤」必須能從呼叫端 fallback 或後端 envelope 透出來
const FIXED_COPY_KINDS = new Set<ApiErrorKind>(['network', 'unavailable', 'server', 'forbidden', 'notFound'])

// 「稍後再試可能就好」的種類才給重試；403／404 重試結果不會變，所以與 FIXED_COPY_KINDS 是兩個不同集合，須同處維護
const RETRYABLE_KINDS = new Set<ApiErrorKind>(['network', 'unavailable', 'server'])

export function isRetryableKind(kind: ApiErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind)
}

interface EnvelopeLike {
  code?: string
  message?: string
  errors?: ErrorEnvelopeFieldError[]
}

interface ErrorLike {
  name?: string
  statusCode?: number
  status?: number
  response?: { status?: number }
  // 真實後端裸回 envelope 是淺層；mock 層 createError({ data: envelope }) 會多包一層 data.data
  data?: EnvelopeLike & { data?: EnvelopeLike }
}

function asErrorLike(err: unknown): ErrorLike | null {
  return err && typeof err === 'object' ? err as ErrorLike : null
}

// 只有「拿不到 response 也拿不到狀態碼」才判沒收到回應（$fetch 拋的 FetchError）。
// 刻意接受的取捨：
// - 寫入（$fetch）斷網 → 準確判 network
// - 讀取（useFetch）斷網 → 狀態碼被 Nuxt 補成 500，判 server
// - 讀取時 transform／handler 內程式 bug → 同樣判 server
// 後兩者形狀相同、無法區分；「系統發生錯誤，請稍後再試」兩種情形都成立。
// 若改看 cause 判斷，會把程式 bug 說成「網路連線中斷」並給一個永遠無效的重試按鈕。
function isNoResponse(e: ErrorLike): boolean {
  return e.name === 'FetchError' && !e.response && e.statusCode == null
}

function statusOf(e: ErrorLike): number | null {
  return e.response?.status ?? e.statusCode ?? e.status ?? null
}

// 讀 HTTP 狀態碼；沒收到回應或不是 HTTP 錯誤回 null
export function getErrorStatus(err: unknown): number | null {
  const e = asErrorLike(err)
  if (!e || isNoResponse(e))
    return null
  return statusOf(e)
}

export function getErrorKind(err: unknown): ApiErrorKind {
  const e = asErrorLike(err)
  if (!e)
    return 'unknown'
  if (isNoResponse(e))
    return 'network'
  const status = statusOf(e)
  if (status === null)
    return 'unknown'
  if (status === 502 || status === 503 || status === 504)
    return 'unavailable'
  if (status >= 500)
    return 'server'
  if (status === 401)
    return 'unauthorized'
  if (status === 403)
    return 'forbidden'
  if (status === 404)
    return 'notFound'
  return status >= 400 ? 'client' : 'unknown'
}

// 後端文案守衛：擋掉可由來源識別的框架自產物，其餘字串視為後端文案放行。
// 擋三類（比對的是原始碼寫死的字面常數與格式，不是某個狀態碼對應的英文）：
// - 非字串／空白：後端違約或框架砍掉欄位時，不讓 [object Object] 或空字串上畫面
// - 'Server Error'：nitropack 的字面常數（error/prod.mjs:20、:59），4xx 碰到非 H3Error 時會被填進來
// - ofetch 自組訊息：格式為 `[METHOD] "url": status statusText`（無回應時狀態段為 <no response>），含上游主機位址；
//   比完整格式而不只比前綴，避免誤殺 `[INFO] "order" 已成立` 這類後端文案
// 限制：無法識別來源的非文案（例如帶 4xx statusCode 的第三方 Error 原文）仍會透出，dev 尤其明顯；
// production 會被框架遮成 'Server Error' 後由本守衛擋下。
const OFETCH_MESSAGE = /^\[[a-z]+\]\s+"[^"]*":\s+(?:\d{3}\b|<no response>)/i

function backendCopy(value: unknown): string | null {
  if (typeof value !== 'string')
    return null
  const text = value.trim()
  if (!text || text === 'Server Error' || OFETCH_MESSAGE.test(text))
    return null
  return value
}

// 統一從 $fetch / useFetch 拋出的錯誤抽取「使用者可讀訊息」。
// 固定文案種類 → ERROR_COPY；其他 → data.data.message（mock createError 包一層）→ data.message（裸回 envelope）
// → fallback → ERROR_COPY[kind]。
// 刻意不讀 statusMessage（含 data.statusMessage）：它是 HTTP status line 的 reason phrase，不是使用者文案，
// 且值由開發者或執行環境決定（真實 Nitro 可能填 Server Error；vitest registerEndpoint 的 body 甚至沒有 message 欄位），
// 所以整個欄位不讀。上方守衛比對的是 nitropack／ofetch 原始碼寫死的字面常數與格式，與此不衝突。
// 改讀 message：那是 h3 建議、也是後端唯一該放使用者文案的位置；後端沒給時它是空字串，會落到 fallback。
// 頂層 statusMessage／message 同樣不讀：那是 HTTP 原文與 ofetch 自組的字串。
export function readApiError(err: unknown, fallback?: string): string {
  const kind = getErrorKind(err)
  if (FIXED_COPY_KINDS.has(kind))
    return ERROR_COPY[kind]
  const data = asErrorLike(err)?.data
  return backendCopy(data?.data?.message) ?? backendCopy(data?.message) ?? fallback ?? ERROR_COPY[kind]
}

// CONSTANT_CASE 錯誤碼（ErrorEnvelope.code），供 UI 對特定錯誤分支處理
export function getErrorCode(err: unknown): string | null {
  const data = asErrorLike(err)?.data
  return data?.data?.code ?? data?.code ?? null
}

// 欄位層級驗證錯誤（ErrorEnvelope.errors），供表單顯示
export function getFieldErrors(err: unknown): ErrorEnvelopeFieldError[] {
  const data = asErrorLike(err)?.data
  return data?.data?.errors ?? data?.errors ?? []
}
