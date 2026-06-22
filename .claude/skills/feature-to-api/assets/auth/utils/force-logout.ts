import type { NuxtApp } from 'nuxt/app'
import { useAuthStore } from '~/stores/auth'

// 並發 401 收斂旗標：同一時間多個請求 401 時，只允許一次「登出 + 導頁」，
// 其餘直接略過 → 根治 Vue Router「redundant / duplicated navigation」錯誤（並發導頁競態）。
let loggingOut = false

// 唯一合法的「登出 + 導回登入頁」出口。任何「認證失效 → 導頁」需求一律呼叫此函式，
// 不要自行組合 clearAuth + navigateTo（否則並發 401 會各自導頁、又會踩 SSR cookie 時序）。
//
// 防迴圈三道：
// 1. 單飛冪等（loggingOut）：並發 401 只導一次
// 2. 已在 login 頁 → 只清除、不再導（never navigate to current）
// 3. clearAuth 內含 server 端 deleteCookie，讓清除在 redirect 前生效（useCookie 寫入延遲到 app:rendered）
//
// 必須包在 runWithContext 內：401 處理常發生在 await 之後 / fetch hook 內，SSR context 已遺失，
// 直接 navigateTo / cookie 操作會靜默失敗。nuxtApp 由呼叫端在 setup 階段（await 之前）先抓好傳入。
export function forceLogout(nuxtApp: NuxtApp): Promise<void> {
  return nuxtApp.runWithContext(async () => {
    const loginPath = useRuntimeConfig().public.authLoginPath || '/login'
    if (loggingOut)
      return
    // 已在 login 頁：清除壞 token 即可，不再導頁（避免 /login → /login 自彈）
    if (useRoute().path === loginPath) {
      useAuthStore().clearAuth()
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
