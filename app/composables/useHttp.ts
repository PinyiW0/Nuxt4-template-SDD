import type { AsyncData, UseFetchOptions } from 'nuxt/app'
import type { FetchContext, FetchError, FetchOptions } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'

// path 佔位符（:id 或 {id}）對應的實際值
export type PathParams = Record<string, string | number>

// reactive 讀取（useFetch）選項：baseURL 由 useHttp 統一帶入、method 固定，故移除
export type HttpGetOptions<T> = Omit<UseFetchOptions<T>, 'baseURL' | 'method'> & {
  pathParams?: PathParams
}

// imperative 讀取 / 寫入（$fetch）選項：同上
export type HttpRequestOptions = Omit<FetchOptions, 'baseURL' | 'method'> & {
  pathParams?: PathParams
}

type ImperativeMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const colonParam = /:(\w+)/g
const braceParam = /\{(\w+)\}/g

// 將 /users/:id、/users/{id} 內的佔位符換成實際值；未提供的佔位符原樣保留（方便發現漏帶參數）
function withPathParams(url: string, params?: PathParams): string {
  if (!params)
    return url
  return url
    .replace(colonParam, (match, key: string) =>
      key in params ? encodeURIComponent(String(params[key])) : match)
    .replace(braceParam, (match, key: string) =>
      key in params ? encodeURIComponent(String(params[key])) : match)
}

// ---- Envelope 拆封（對齊後端 { success, data, message, meta } 包裝）----
// 由 runtimeConfig.public.apiEnvelope 控制（預設 on）；裸 schema 後端關掉即直通。
// 拆封容忍非 envelope 回應（過渡期 / mock 回裸物件皆直通），故開著也不會弄壞裸回應。

function isJsonResponse(response: { headers?: Headers }): boolean {
  return (response.headers?.get?.('content-type') ?? '').includes('application/json')
}

// SuccessEnvelope：物件、success===true、有 data 欄位
function isSuccessEnvelope(
  body: unknown,
): body is { success: true, data: unknown, meta?: unknown } {
  if (!body || typeof body !== 'object')
    return false
  const obj = body as Record<string, unknown>
  return obj.success === true && 'data' in obj
}

// 分頁 data：非陣列物件且含 items 陣列（對齊 PaginatedSuccessEnvelope 的 data: { items: [...] }）
function isPaginatedData(data: unknown): data is { items: unknown[] } {
  return (
    !!data
    && typeof data === 'object'
    && !Array.isArray(data)
    && Array.isArray((data as Record<string, unknown>).items)
  )
}

// 成功 envelope → 取 data（分頁攤平為 items，分頁資訊存 response._meta 供分頁 UI 取用）；
// 非 JSON（Blob/CSV 匯出）、非 envelope 一律直通。
function unwrapEnvelope(response: { _data?: unknown, headers?: Headers }): void {
  if (!isJsonResponse(response))
    return
  const body = response._data
  if (!isSuccessEnvelope(body))
    return
  response._data = isPaginatedData(body.data) ? body.data.items : body.data
  if ('meta' in body) {
    ;(response as { _meta?: unknown })._meta = body.meta
  }
}

/**
 * 統一 API 入口：所有呼叫共用 runtimeConfig.public.apiBase 這個 domain。
 *
 * - get：走 useFetch，回 AsyncData（reactive 讀取，需在 setup 內呼叫；url 可傳 getter，ref 變動自動重抓）
 * - getOnce：走 $fetch，回 Promise（imperative 讀取，如 Blob 下載、event handler 內抓一次）
 * - post/put/patch/delete：走 $fetch，回 Promise（寫入）
 *
 * Envelope：`apiEnvelope`（預設 on）時自動拆掉後端 `{ success, data }` 外層，回傳裸 data；
 * 裸 schema 後端設 `NUXT_PUBLIC_API_ENVELOPE=false` 即可關閉。錯誤端用 `~/utils/api-error` 的
 * `readApiError` / `getErrorCode` / `getFieldErrors` 讀 ErrorEnvelope。
 *
 * 注意：本層不含 Authorization / 401→refresh 攔截——auth 屬條件式能力，由 auth scaffold（偵測到登入需求時）
 * 注入，無登入的專案維持此乾淨樣貌。
 *
 * @example
 * const http = useHttp()
 * const { data } = http.get<User[]>('/users', { query: { page: 1 } })
 * const { data: user } = http.get<User>(() => `/users/${id.value}`)
 * const blob = await http.getOnce<Blob>('/reports/{id}/export', { pathParams: { id }, responseType: 'blob' })
 * await http.post<User>('/users', { body: { name } })
 * await http.delete('/users/:id', { pathParams: { id } })
 */
export function useHttp() {
  const config = useRuntimeConfig().public
  const baseURL = config.apiBase
  // 預設開啟 envelope 拆封；僅在明確設為 false 時關閉（裸 schema 後端）
  const envelopeEnabled = config.apiEnvelope !== false

  // 包一層 onResponse：先跑使用者 hook（仍看得到原始 envelope），再拆 envelope
  function withUnwrap(
    userHook: ((ctx: FetchContext) => unknown) | ((ctx: FetchContext) => unknown)[] | undefined,
  ) {
    return async (ctx: FetchContext) => {
      if (Array.isArray(userHook)) {
        for (const hook of userHook) await hook(ctx)
      }
      else if (typeof userHook === 'function') {
        await userHook(ctx)
      }
      if (envelopeEnabled && ctx.response)
        unwrapEnvelope(ctx.response)
    }
  }

  // reactive 讀取：useFetch；url 傳 getter 時 ref 變動會自動重抓
  function get<T>(url: MaybeRefOrGetter<string>, options?: HttpGetOptions<T>) {
    const { pathParams, onResponse, ...rest } = options ?? {}
    // useFetch 泛型包裝的已知型別限制：不帶 <T>、改以斷言收斂 options 與回傳（沿用參考專案做法）
    return useFetch(() => withPathParams(toValue(url), pathParams), {
      baseURL,
      ...rest,
      onResponse: withUnwrap(onResponse as Parameters<typeof withUnwrap>[0]),
    } as unknown as UseFetchOptions<unknown>) as AsyncData<T | undefined, FetchError | undefined>
  }

  // imperative：$fetch（getOnce 與寫入共用）
  function request<T>(method: ImperativeMethod, url: string, options?: HttpRequestOptions) {
    const { pathParams, onResponse, ...rest } = options ?? {}
    return $fetch<T>(withPathParams(url, pathParams), {
      baseURL,
      method,
      ...rest,
      onResponse: withUnwrap(onResponse as Parameters<typeof withUnwrap>[0]),
    })
  }

  return {
    get,
    getOnce: <T>(url: string, options?: HttpRequestOptions) => request<T>('GET', url, options),
    post: <T>(url: string, options?: HttpRequestOptions) => request<T>('POST', url, options),
    put: <T>(url: string, options?: HttpRequestOptions) => request<T>('PUT', url, options),
    patch: <T>(url: string, options?: HttpRequestOptions) => request<T>('PATCH', url, options),
    delete: <T>(url: string, options?: HttpRequestOptions) => request<T>('DELETE', url, options),
  }
}
