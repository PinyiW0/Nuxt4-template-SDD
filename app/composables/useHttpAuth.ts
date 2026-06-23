// useHttp 的 auth 注入點（中立版）。
//
// 無登入需求的專案：本檔回 null → useHttp 不帶 Authorization、不攔 401，維持乾淨樣貌。
// 偵測到登入需求時，auth scaffold 會以「從 stores/auth + utils/force-logout 組出 handler」的版本
// 覆蓋本檔（見 feature-to-api references/auth-scaffold.md §3a），即啟用 401→refresh→retry。
//
// useHttp 不需修改——它只依賴此 handler 介面。

export interface HttpAuthHandler {
  // 目前 access token（無則回 null）→ useHttp 用來帶 Authorization header
  getToken: () => string | null
  // 401 時嘗試換發 token，回傳是否成功（成功則 retry 原請求）
  refresh: () => Promise<boolean>
  // refresh 失敗 / retry 仍 401 → 冪等的登出出口（收斂並發 401，只導一次 login）
  forceLogout: () => Promise<void>
}

export function useHttpAuth(): HttpAuthHandler | null {
  return null
}
