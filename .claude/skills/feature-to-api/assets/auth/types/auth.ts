// 認證相關型別（對齊 OpenAPI /auth/*；envelope 的 data 取具名 schema）

export interface LoginBody {
  account: string
  password: string
}

// login / refresh 共用的雙 token 回應主體（對齊 spec TokenPairData）
// accessToken：短效 JWT；refreshToken：長效 opaque 字串（非 JWT），僅放 request body
export interface TokenPairData {
  accessToken: string
  tokenType: string
  expiresAt: string
  accountId: string
  refreshToken: string
  refreshExpiresAt: string
}

// 登入回應（data = TokenPairData）；使用者姓名/角色改由 GET /auth/me 取得
export type LoginResponse = TokenPairData

// 換發 token
export interface RefreshBody {
  refreshToken: string
}
export type RefreshResponse = TokenPairData

// 登出：帶 refreshToken 時撤銷整個 token family；不帶仍成功
export interface LogoutBody {
  refreshToken?: string
}

// 目前登入者資訊（data = AccountResponse 的子集）
export interface MeResponse {
  accountId: string
  account: string
  name: string
  roles: string[]
}
