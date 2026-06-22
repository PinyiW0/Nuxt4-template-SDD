# Auth Scaffold（條件式登入守門）

> **SDD workflow 對 auth 中立**：template 預設不帶 auth。**只有偵測到登入需求時**才套用本 scaffold。
> 無 auth 訊號的專案（純展示 / 落地頁）一個 auth 字都不生，`useHttp` 維持中立 envelope 版。
>
> **本檔是 auth 的 SSOT / 契約**：偵測規則、route-map.auth schema、防迴圈鐵律、檔案落點與範本。
> 範本沿「消費階段」分流：**API 層由 feature-to-api 套用（範本在 §3a）**、**UI 層由 feature-to-ui 套用（範本在它既有的 login / middleware 段，§3b 指路）**。

---

## 1. 偵測（確定性，grep 訊號，非 AI 猜）

Phase 0 判斷是否需要 auth —— 命中任一即視為「需要」：

| 來源 | 訊號 |
|---|---|
| OpenAPI `spec/api/api-spec.yml` | `paths` 同時含 `/auth/login` 與 `/auth/refresh`；或 `components.securitySchemes` 有 `bearer`（`type: http, scheme: bearer`） |
| `.feature` / `.flow.md` | 有登入 scenario（「登入」「login」「帳號 + 密碼」「未登入導向」） |

偵測到 → 寫入 `route-map.yaml > auth`（§2）並套用 §3。**沒偵測到 → 完全略過本檔。**

---

## 2. route-map.yaml 的 `auth` 區塊（持久化事實，跨 phase 對照）

```yaml
auth:
  required: true
  login_path: /login          # 登入頁
  home_path: /                # 登入後首頁（依專案，root redirect 目標）
  public_paths:               # 免驗證白名單（務必含 login_path）
    - /login
  token_endpoints:            # 這些端點 handleUnauthorized:false（避免自身 401 迴圈）
    - POST /auth/login
    - POST /auth/refresh
    - POST /auth/logout
    - GET  /auth/me
```

> `feature-to-ui` Phase 2 讀此區塊：`required: true` 但 `app/middleware/auth.global.ts` 不存在或白名單缺 login → **報錯並補上**，不可默默跳過。

---

## 3. 檔案落點與歸屬

| 檔案 | 範本位置 | 套用者 | 說明 |
|---|---|---|---|
| `app/types/api/auth.ts` | §3a | feature-to-api | TokenPairData / LoginBody / MeResponse… |
| `app/composables/useHttp.ts` | §3a | feature-to-api | **覆蓋**中立版：envelope 超集 + Authorization + 401→refresh→retry + `handleUnauthorized` |
| `app/stores/auth.ts` | §3a | feature-to-api | single-flight refresh、cookie persist、login/logout/clearAuth |
| `app/utils/force-logout.ts` | §3a | feature-to-api | **冪等單飛**登出出口（防並發導頁，§4） |
| `app/api/auth.api.ts` | §3a | feature-to-api | 登入/refresh/logout/me，全 `handleUnauthorized:false` |
| `app/api/index.ts` | §3a | feature-to-api | re-export（已存在則合併） |
| `nuxt.config.ts` 追加 | §3a | feature-to-api | auth 路徑設定（編輯，非新檔） |
| `app/middleware/auth.global.ts` | §3b → feature-to-ui `phase-2-skeleton.md` | feature-to-ui | 全域守門（白名單 + never-nav-current） |
| `app/pages/login.vue` | §3b → feature-to-ui `page-builder.md` | feature-to-ui | 登入頁（**不得發 authed fetch**） |

**端點前綴**：範本用裸 `/auth/*`；若專案前綴為 `/api/v1`，比照 `openapi-conventions.md` §6 調整（或交給 `useHttp` baseURL）。

### 3a. API 層範本（feature-to-api 套用）

```ts
// app/types/api/auth.ts —— 認證型別（envelope 的 data 取具名 schema）
export interface LoginBody {
  account: string
  password: string
}
export interface TokenPairData {
  accessToken: string
  tokenType: string
  expiresAt: string
  accountId: string
  refreshToken: string
  refreshExpiresAt: string
}
export type LoginResponse = TokenPairData
export interface RefreshBody { refreshToken: string }
export type RefreshResponse = TokenPairData
export interface LogoutBody { refreshToken?: string }
export interface MeResponse {
  accountId: string
  account: string
  name: string
  roles: string[]
}
```

```ts
// app/composables/useHttp.ts —— auth 版，覆蓋中立 envelope 版（envelope 超集 + Authorization + 401→refresh→retry）
import type { AsyncData, UseFetchOptions } from 'nuxt/app'
import type { FetchContext, FetchError, FetchOptions } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { forceLogout } from '~/utils/force-logout'

export type PathParams = Record<string, string | number>

export type HttpGetOptions<T> = Omit<UseFetchOptions<T>, 'baseURL' | 'method'> & {
  pathParams?: PathParams
  handleUnauthorized?: boolean // 401 是否自動 refresh→retry→（失敗）登出；登入/refresh 端點設 false
}
export type HttpRequestOptions = Omit<FetchOptions, 'baseURL' | 'method'> & {
  pathParams?: PathParams
  handleUnauthorized?: boolean
}

type ImperativeMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const colonParam = /:(\w+)/g
const braceParam = /\{(\w+)\}/g

function withPathParams(url: string, params?: PathParams): string {
  if (!params)
    return url
  return url
    .replace(colonParam, (match, key: string) =>
      key in params ? encodeURIComponent(String(params[key])) : match)
    .replace(braceParam, (match, key: string) =>
      key in params ? encodeURIComponent(String(params[key])) : match)
}

// ---- Envelope 拆封（同中立版）----
function isJsonResponse(response: { headers?: Headers }): boolean {
  return (response.headers?.get?.('content-type') ?? '').includes('application/json')
}
function isSuccessEnvelope(body: unknown): body is { success: true, data: unknown, meta?: unknown } {
  if (!body || typeof body !== 'object')
    return false
  const obj = body as Record<string, unknown>
  return obj.success === true && 'data' in obj
}
function isPaginatedData(data: unknown): data is { items: unknown[] } {
  return !!data && typeof data === 'object' && !Array.isArray(data)
    && Array.isArray((data as Record<string, unknown>).items)
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

export function useHttp() {
  const config = useRuntimeConfig().public
  const baseURL = config.apiBase
  const envelopeEnabled = config.apiEnvelope !== false
  const authStore = useAuthStore()
  // 首次 await 後 SSR context 會遺失 → 先抓 nuxtApp，hook/catch 內 runWithContext 還原
  const nuxtApp = useNuxtApp()

  function bearer(): string {
    return authStore.token ? `Bearer ${authStore.token}` : ''
  }
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

  function get<T>(url: MaybeRefOrGetter<string>, options?: HttpGetOptions<T>) {
    const { pathParams, onResponse, handleUnauthorized = true, ...rest } = options ?? {}
    return useFetch(() => withPathParams(toValue(url), pathParams), {
      baseURL,
      ...rest,
      retry: handleUnauthorized ? 1 : 0,
      retryStatusCodes: [401],
      onRequest: (ctx: FetchContext) => {
        ctx.options.headers.set('Authorization', bearer())
      },
      onResponse: withUnwrap(onResponse as Parameters<typeof withUnwrap>[0]),
      onResponseError: async (ctx: FetchContext) => {
        if (!handleUnauthorized || ctx.response?.status !== 401)
          return
        const remaining = (ctx.options as { retry?: number | false }).retry
        if (remaining)
          await nuxtApp.runWithContext(() => authStore.refresh())
        else
          await forceLogout(nuxtApp)
      },
    } as unknown as UseFetchOptions<unknown>) as AsyncData<T | undefined, FetchError | undefined>
  }

  function request<T>(method: ImperativeMethod, url: string, options?: HttpRequestOptions) {
    const { pathParams, onResponse, handleUnauthorized = true, headers, ...rest } = options ?? {}
    const finalUrl = withPathParams(url, pathParams)
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
```

```ts
// app/stores/auth.ts —— single-flight refresh、cookie persist、clearAuth 含 server deleteCookie
import type { LoginBody } from '~/types/api/auth'
import { deleteCookie } from 'h3'
import { fetchMe, loginUser, logoutUser, refreshAuthToken } from '~/api/auth.api'

export const useAuthStore = defineStore(
  'auth',
  () => {
    const accountId = ref<string | null>(null)
    const token = ref<string | null>(null)
    const refreshToken = ref<string | null>(null)
    const refreshExpiresAt = ref<string | null>(null)
    const account = ref<string | null>(null)
    const name = ref<string | null>(null)
    const roles = ref<string[]>([])

    const isAuthenticated = computed(() => !!token.value && !!accountId.value)

    async function fetchProfile(): Promise<void> {
      const me = await fetchMe()
      accountId.value = me.accountId
      account.value = me.account
      name.value = me.name
      roles.value = me.roles
    }

    async function login(body: LoginBody): Promise<void> {
      const data = await loginUser(body)
      token.value = data.accessToken
      refreshToken.value = data.refreshToken
      refreshExpiresAt.value = data.refreshExpiresAt
      accountId.value = data.accountId
      await fetchProfile()
    }

    // single-flight：同時多個 401 共用同一次換發，避免互相作廢新 token 或誤觸後端 reuse detection
    let refreshing: Promise<boolean> | null = null
    function refresh(): Promise<boolean> {
      if (refreshing)
        return refreshing
      refreshing = (async (): Promise<boolean> => {
        if (!refreshToken.value)
          return false
        try {
          const data = await refreshAuthToken({ refreshToken: refreshToken.value })
          token.value = data.accessToken
          refreshToken.value = data.refreshToken
          refreshExpiresAt.value = data.refreshExpiresAt
          accountId.value = data.accountId
          return true
        }
        catch {
          clearAuth()
          return false
        }
        finally {
          refreshing = null
        }
      })()
      return refreshing
    }

    function clearAuth(): void {
      accountId.value = null
      token.value = null
      refreshToken.value = null
      refreshExpiresAt.value = null
      account.value = null
      name.value = null
      roles.value = []
      // SSR：Set-Cookie 延遲到 app:rendered；登出後立刻 navigateTo 會讓清除送不出去 → 壞 token 殘留造成迴圈。
      // 故在 server 直接對 H3 event 寫刪除 header（cookie 名 = store id 'auth'）。
      if (import.meta.server) {
        const event = useRequestEvent()
        if (event)
          deleteCookie(event, 'auth', { path: '/' })
      }
    }

    async function logout(): Promise<void> {
      try {
        await logoutUser(refreshToken.value ?? undefined)
      }
      finally {
        clearAuth()
      }
    }

    return {
      accountId,
      token,
      refreshToken,
      refreshExpiresAt,
      account,
      name,
      roles,
      isAuthenticated,
      login,
      fetchProfile,
      refresh,
      logout,
      clearAuth,
    }
  },
  {
    persist: {
      // cookie 而非 localStorage：SSR 讀得到 token，避免 hydration 不一致
      storage: piniaPluginPersistedstate.cookies({ sameSite: 'lax' }),
      pick: ['accountId', 'token', 'refreshToken', 'refreshExpiresAt', 'account', 'name', 'roles'],
    },
  },
)
```

```ts
// app/utils/force-logout.ts —— 冪等單飛登出出口（防並發導頁，§4 第 1 道）
import type { NuxtApp } from 'nuxt/app'
import { useAuthStore } from '~/stores/auth'

// 並發 401 收斂旗標：同時多個 401 只允許一次「登出 + 導頁」→ 根治 Vue Router 重複導向錯誤
let loggingOut = false

// 唯一合法的「登出 + 導回登入頁」出口。必須包在 runWithContext（401 常在 await 後 / hook 內，SSR context 已失）。
export function forceLogout(nuxtApp: NuxtApp): Promise<void> {
  return nuxtApp.runWithContext(async () => {
    const loginPath = useRuntimeConfig().public.authLoginPath || '/login'
    if (loggingOut)
      return
    if (useRoute().path === loginPath) {
      useAuthStore().clearAuth() // 已在 login：清壞 token 即可，不再導
      return
    }
    loggingOut = true
    try {
      useAuthStore().clearAuth()
      await navigateTo(loginPath)
    }
    finally {
      loggingOut = false
    }
  })
}
```

```ts
// app/api/auth.api.ts —— auth 端點全 handleUnauthorized:false（防自身迴圈）
import type {
  LoginBody, LoginResponse, MeResponse, RefreshBody, RefreshResponse,
} from '~/types/api/auth'
import { useHttp } from '~/composables/useHttp'

export function loginUser(body: LoginBody) {
  return useHttp().post<LoginResponse>('/auth/login', { body, handleUnauthorized: false })
}
export function refreshAuthToken(body: RefreshBody) {
  return useHttp().post<RefreshResponse>('/auth/refresh', { body, handleUnauthorized: false })
}
export function logoutUser(refreshToken?: string) {
  return useHttp().post<null>('/auth/logout', { body: { refreshToken }, handleUnauthorized: false })
}
export function fetchMe() {
  return useHttp().getOnce<MeResponse>('/auth/me', { handleUnauthorized: false })
}
```

```ts
// app/api/index.ts（已存在則合併）
export * from './auth.api'
```

```ts
// nuxt.config.ts 追加（apiEnvelope 已由 envelope 功能提供；以下值依 route-map.auth）
runtimeConfig: {
  public: {
    apiBase: '/api',
    apiEnvelope: true,
    authLoginPath: '/login',
    authHomePath: '/',
    authPublicPaths: ['/login'] as string[],
  },
},
// 若 home_path 不是 '/'，加 root redirect（勿 redirect 到自己造成 loop）：
// routeRules: { '/': { redirect: '/dashboard' } },
```

### 3b. UI 層範本（feature-to-ui 套用）

- **`app/middleware/auth.global.ts`** → 範本見 feature-to-ui `references/phase-2-skeleton.md`「Auth gate / middleware 範本」段。
- **`app/pages/login.vue`** → 範本見 feature-to-ui `references/page-builder.md`「登入表單（含 Auth Store）」段（**唯一** login 範本，勿另建）。

---

## 4. 防「導向迴圈」硬性要求（jsjh-2026-frontend 實戰：此 bug 一直復發）

**根因**：middleware 信任 `refreshAlive` 放行但自己不 refresh → 進受保護頁 → 該頁並發多個 API 帶過期 token →
**同時噴多個 401** → 每個各自 `forceLogout` → **各自 `navigateTo('/login')`** → Vue Router「redundant / duplicated navigation」錯。
參照專案只修了 SSR cookie 時序，**沒修並發導頁**，故一直復發。

六道防線（改範本時不可拿掉）：

1. **`forceLogout` 單飛冪等**（`loggingOut` flag）→ 並發 401 只導一次。**根治此錯的關鍵。**
2. **顯式公開白名單**（`authPublicPaths`，務必含 login）→ middleware 只在非白名單時導。
3. **never navigate to current**（middleware 與 forceLogout 都檢查目標 path）。
4. **login 頁與其 layout 禁發 authed fetch**；`auth.api.ts` 端點全 `handleUnauthorized:false`。
5. **clearAuth cookie 確實落地**（store server 端 `deleteCookie`）。
6. **home/login 路徑用 config**（不寫死），可攜。

---

## 5. 收尾 checklist（`feature-to-ui` 末 / vibe-check 提示；僅 auth 專案跳）

- [ ] `app/middleware/auth.global.ts` 存在，`authPublicPaths` 含 `login_path`
- [ ] 未登入訪問受保護頁 → **只導向 `/login` 一次、無 console navigation error**
- [ ] 登入成功後不被彈回 login
- [ ] login 頁與 layout 沒有 authed fetch
- [ ] （e2e）建議在 `test/e2e/` 加：未登入訪受保護路由 → 斷言落在 `/login` 且無重複導向錯誤

---

## 6. Sync 模式

- spec 後來才加 `/auth/*` → Phase 0 偵測到、補寫 route-map.auth + 套用 scaffold，sync-report 標「新增 auth 守門」。
- spec 移除 auth → 不自動刪（避免誤刪自訂），sync-report 標為待人工確認的 auth 孤兒。
