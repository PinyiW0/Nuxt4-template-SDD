import type {
  LoginBody,
  LoginResponse,
  MeResponse,
  RefreshBody,
  RefreshResponse,
} from '~/types/api/auth'
import { useHttp } from '~/composables/useHttp'

// 登入：handleUnauthorized:false，避免 401 觸發 forceLogout 副作用（在 /login 自身造成迴圈）
export function loginUser(body: LoginBody) {
  return useHttp().post<LoginResponse>('/auth/login', {
    body,
    handleUnauthorized: false,
  })
}

// 換發 token：handleUnauthorized:false，避免 refresh 自身 401 又觸發 refresh 造成無限迴圈
export function refreshAuthToken(body: RefreshBody) {
  return useHttp().post<RefreshResponse>('/auth/refresh', {
    body,
    handleUnauthorized: false,
  })
}

// 登出：帶 refreshToken 讓後端撤銷整個 token family（rotation 鏈）；不帶仍回成功
export function logoutUser(refreshToken?: string) {
  return useHttp().post<null>('/auth/logout', {
    body: { refreshToken },
    handleUnauthorized: false,
  })
}

// 取得目前登入者資訊（登入回應不含 name/roles，登入後補抓）
export function fetchMe() {
  return useHttp().getOnce<MeResponse>('/auth/me', { handleUnauthorized: false })
}
