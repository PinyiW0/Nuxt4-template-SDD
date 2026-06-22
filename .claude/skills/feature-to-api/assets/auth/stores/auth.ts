import type { LoginBody } from '~/types/api/auth'
import { deleteCookie } from 'h3'
import { fetchMe, loginUser, logoutUser, refreshAuthToken } from '~/api/auth.api'

// 認證狀態 store。token 以 cookie 持久化（SSR 也讀得到，避免 sidebar/Bearer 的 hydration 不一致）。
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

    // 以 /auth/me 補抓使用者姓名/角色（登入回應不含）
    async function fetchProfile(): Promise<void> {
      const me = await fetchMe()
      accountId.value = me.accountId
      account.value = me.account
      name.value = me.name
      roles.value = me.roles
    }

    async function login(body: LoginBody): Promise<void> {
      const data = await loginUser(body)
      // 先寫 token，後續 /auth/me 才會帶 Bearer
      token.value = data.accessToken
      refreshToken.value = data.refreshToken
      refreshExpiresAt.value = data.refreshExpiresAt
      accountId.value = data.accountId
      await fetchProfile()
    }

    // refresh token rotation；single-flight：同時多個 401 共用同一次換發，
    // 避免互相作廢新 token 或誤觸後端 reuse detection。
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
      // SSR：persistedstate 的 Set-Cookie 延遲到 app:rendered 才寫 header，
      // 登出後若立刻 navigateTo，sendRedirect 會先結束 response，清除送不到瀏覽器 → 壞 token 殘留造成 302 迴圈。
      // 故在 server 直接對 H3 event 立刻寫入刪除 header（cookie 名 = store id 'auth'）。
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
      // cookie 而非 localStorage：SSR 讀得到 token / 使用者資訊，避免 hydration 不一致
      storage: piniaPluginPersistedstate.cookies({ sameSite: 'lax' }),
      pick: ['accountId', 'token', 'refreshToken', 'refreshExpiresAt', 'account', 'name', 'roles'],
    },
  },
)
