import type { AsyncData, UseFetchOptions } from 'nuxt/app'
import type { FetchContext, FetchError, FetchOptions } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { forceLogout } from '~/utils/force-logout'

// path 佔位符（:id 或 {id}）對應的實際值
export type PathParams = Record<string, string | number>

// reactive 讀取（useFetch）選項：baseURL 由 useHttp 統一帶入、method 固定，故移除
export type HttpGetOptions<T> = Omit<UseFetchOptions<T>, 'baseURL' | 'method'> & {
  pathParams?: PathParams
  // 401 是否自動 refresh→retry→（失敗）登出；登入/refresh 等端點設 false
  handleUnauthorized?: boolean
}

// imperative 讀取 / 寫入（$fetch）選項：同上
export type HttpRequestOptions = Omit<FetchOptions, 'baseURL' | 'method'> & {
  pathParams?: PathParams
  handleUnauthorized?: boolean
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
function isJsonResponse(response: { headers?: Headers }): boolean {
  return (response.headers?.get?.('content-type') ?? '').includes('application/json')
}
function isSuccessEnvelope(
  body: unknown,
): body is { success: true, data: unknown, meta?: unknown } {
  if (!body || typeof body !== 'object')
    return false
  const obj = body as Record<string, unknown>
  return obj.success === true && 'data' in obj
}
function isPaginatedData(data: unknown): data is { items: unknown[] } {
  return (
    !!data
    && typeof data === 'object'
    && !Array.isArray(data)
    && Array.isArray((data as Record<string, unknown>).items)
  )
}
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

function isUnauthorized(error: unknown): boolean {
  const e = error as FetchError | undefined
  return e?.response?.status === 401 || e?.statusCode === 401
}

/**
 * 統一 API 入口（auth 版）：共用 apiBase domain + envelope 拆封 + Authorization 注入 + 401→refresh→retry。
 *
 * - get：useFetch（reactive 讀取）；401 由 retry + onResponseError 處理
 * - getOnce / post / put / patch / delete：$fetch（imperative）；401 由 try/catch 處理
 * - options.handleUnauthorized=false：略過 401 攔截（login / refresh / logout / me 用，避免自身迴圈）
 *
 * 401 流程：refresh（single-flight）成功 → 帶新 token 重試一次；失敗 → forceLogout（冪等，並發只導一次）。
 */
export function useHttp() {
  const config = useRuntimeConfig().public
  const baseURL = config.apiBase
  const envelopeEnabled = config.apiEnvelope !== false
  const authStore = useAuthStore()
  // 首次 await 後 SSR context 會遺失，refresh/forceLogout 的 cookie 寫入會靜默失敗 → 先抓 nuxtApp，hook/catch 內還原
  const nuxtApp = useNuxtApp()

  function bearer(): string {
    return authStore.token ? `Bearer ${authStore.token}` : ''
  }

  // 包 onResponse：先跑使用者 hook（仍看得到原始 envelope），再拆 envelope
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

  // reactive 讀取：useFetch + 401 refresh/retry
  function get<T>(url: MaybeRefOrGetter<string>, options?: HttpGetOptions<T>) {
    const { pathParams, onResponse, handleUnauthorized = true, ...rest } = options ?? {}
    return useFetch(() => withPathParams(toValue(url), pathParams), {
      baseURL,
      ...rest,
      retry: handleUnauthorized ? 1 : 0,
      retryStatusCodes: [401],
      // Authorization 放 onRequest，讓重試時讀到 refresh 後的新 token
      onRequest: (ctx: FetchContext) => {
        ctx.options.headers.set('Authorization', bearer())
      },
      onResponse: withUnwrap(onResponse as Parameters<typeof withUnwrap>[0]),
      onResponseError: async (ctx: FetchContext) => {
        if (!handleUnauthorized || ctx.response?.status !== 401)
          return
        // retry 為剩餘重試數：首次=1（先 refresh 讓 ofetch 帶新 token 重試），重試後仍 401=0（refresh 無效 → 登出）
        const remaining = (ctx.options as { retry?: number | false }).retry
        if (remaining)
          await nuxtApp.runWithContext(() => authStore.refresh())
        else
          await forceLogout(nuxtApp)
      },
    } as unknown as UseFetchOptions<unknown>) as AsyncData<T | undefined, FetchError | undefined>
  }

  // imperative：$fetch（getOnce 與寫入共用）+ 401 refresh/retry
  function request<T>(method: ImperativeMethod, url: string, options?: HttpRequestOptions) {
    const { pathParams, onResponse, handleUnauthorized = true, headers, ...rest } = options ?? {}
    const finalUrl = withPathParams(url, pathParams)
    // 每次嘗試即時讀 token（refresh 後換新值），故包成 thunk
    const attempt = () =>
      $fetch<T>(finalUrl, {
        baseURL,
        method,
        ...rest,
        headers: { ...(headers as Record<string, string> | undefined), Authorization: bearer() },
        onResponse: withUnwrap(onResponse as Parameters<typeof withUnwrap>[0]),
      })

    if (!handleUnauthorized)
      return attempt()

    return (async () => {
      try {
        return await attempt()
      }
      catch (error) {
        if (!isUnauthorized(error))
          throw error
        const refreshed = await nuxtApp.runWithContext(() => authStore.refresh())
        if (refreshed) {
          try {
            return await attempt()
          }
          catch (retryError) {
            if (isUnauthorized(retryError))
              await forceLogout(nuxtApp)
            throw retryError
          }
        }
        await forceLogout(nuxtApp)
        throw error
      }
    })()
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
