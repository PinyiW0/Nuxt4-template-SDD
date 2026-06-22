import { useAuthStore } from '~/stores/auth'

const base64UrlDash = /-/g
const base64UrlUnderscore = /_/g

// 解析 JWT payload 的 exp 判斷是否仍在效期（不驗簽，僅作 UX gate；真正驗證在後端）。
// 解析失敗 → 視為可用，交給後端 401 判定（mock token 非標準 JWT 時亦走此分支）。
function isJwtAlive(token: string): boolean {
  try {
    const payload = token.split('.')[1]
    if (!payload)
      return true
    const json = atob(payload.replace(base64UrlDash, '+').replace(base64UrlUnderscore, '/'))
    const exp = (JSON.parse(json) as { exp?: number }).exp
    return typeof exp !== 'number' || exp * 1000 > Date.now()
  }
  catch {
    return true
  }
}

// 全域認證 gate。防迴圈設計：
// - 顯式公開白名單（authPublicPaths，務必含 login）：白名單內一律放行
// - never navigate to current：to 已是目標時不再導
// - 不只看 token 存在，而看「session 可用」（access 未過期，或 refresh 未過期可 rotation）——
//   過期 token 進頁 → 401 → forceLogout 導回，比在此硬擋更穩；refresh 可用則放行讓 http 層換發。
export default defineNuxtRouteMiddleware((to) => {
  const authStore = useAuthStore()
  const { public: config } = useRuntimeConfig()
  const loginPath = config.authLoginPath || '/login'
  const homePath = config.authHomePath || '/'
  const publicPaths: string[] = config.authPublicPaths?.length ? config.authPublicPaths : [loginPath]

  const isPublic = publicPaths.some(p => to.path === p || to.path.startsWith(`${p}/`))

  const accessAlive = !!authStore.token && !!authStore.accountId && isJwtAlive(authStore.token)
  const refreshAlive
    = !!authStore.refreshToken
      && !!authStore.refreshExpiresAt
      && new Date(authStore.refreshExpiresAt).getTime() > Date.now()
  const sessionUsable = accessAlive || refreshAlive

  // 未登入 + 非公開頁 → 導 login（公開頁含 login，故不會 /login → /login 自彈）
  if (!sessionUsable && !isPublic)
    return navigateTo(loginPath)
  // 已登入卻在 login 頁 → 導回 home（never-nav-to-current 保護）
  if (sessionUsable && to.path === loginPath && to.path !== homePath)
    return navigateTo(homePath)
})
