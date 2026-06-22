# Auth Scaffold（條件式登入守門）

> **SDD workflow 對 auth 中立**：template 預設不帶 auth。**只有偵測到登入需求時**才套用本 scaffold。
> 無 auth 訊號的專案（純展示 / 落地頁）一個 auth 字都不生，`useHttp` 維持中立 envelope 版。

驗證過的範本檔在 **`assets/auth/`**（已通過 `nuxi typecheck`）；偵測到 auth 時複製到對應 `app/` 路徑。

---

## 1. 偵測（確定性，grep 訊號，非 AI 猜）

Phase 0 判斷是否需要 auth —— 命中任一即視為「需要」：

| 來源 | 訊號 |
|---|---|
| OpenAPI `spec/api/api-spec.yml` | `paths` 同時含 `/auth/login` 與 `/auth/refresh`；或 `components.securitySchemes` 有 `bearer`（`type: http, scheme: bearer`） |
| `.feature` / `.flow.md` | 有登入 scenario（「登入」「login」「帳號 + 密碼」「未登入導向」） |

偵測到 → 寫入 `route-map.yaml` 的 `auth` 區塊（見 §2）並套用 §3 檔案。**沒偵測到 → 完全略過本檔。**

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

## 3. 檔案落點（從 `assets/auth/` 複製到 `app/`）

| asset | 複製到 | 說明 |
|---|---|---|
| `types/auth.ts` | `app/types/api/auth.ts` | TokenPairData / LoginBody / MeResponse… |
| `composables/useHttp.ts` | `app/composables/useHttp.ts` | **覆蓋**中立版：envelope 超集 + Authorization + 401→refresh→retry + `handleUnauthorized` 選項 |
| `stores/auth.ts` | `app/stores/auth.ts` | single-flight refresh、cookie persist、login/logout/clearAuth |
| `utils/force-logout.ts` | `app/utils/force-logout.ts` | **冪等單飛**登出出口（防並發導頁，見 §4） |
| `api/auth.api.ts` | `app/api/auth.api.ts` | 登入/refresh/logout/me，全 `handleUnauthorized:false` |
| `api/index.ts` | `app/api/index.ts` | re-export（已存在則合併） |
| `middleware/auth.global.ts` | `app/middleware/auth.global.ts` | 全域守門（白名單 + never-nav-current） |
| `pages/login.vue` | `app/pages/login.vue` | 登入頁（**不得發 authed fetch**） |

**端點前綴**：assets 用裸 `/auth/*`；若專案前綴為 `/api/v1`，比照 `openapi-conventions.md` §6 調整（或交給 `useHttp` baseURL）。

**`nuxt.config.ts` 追加**（config 用編輯、非複製；`apiEnvelope` 已由 envelope 功能提供）：

```ts
runtimeConfig: {
  public: {
    apiBase: '/api',
    apiEnvelope: true,
    // ↓ auth scaffold 追加（值依 route-map.auth）
    authLoginPath: '/login',
    authHomePath: '/',
    authPublicPaths: ['/login'] as string[],
  },
},
// 若 home_path 不是 '/'，加 root redirect（注意：勿 redirect 到自己造成 loop）
// routeRules: { '/': { redirect: '/dashboard' } },
```

---

## 4. 防「導向迴圈」硬性要求（jsjh-2026-frontend 實戰：此 bug 一直復發）

**根因**：middleware 信任 `refreshAlive` 放行但自己不 refresh → 進受保護頁 → 該頁並發多個 API 帶過期 token →
**同時噴多個 401** → 每個各自 `forceLogout` → **各自 `navigateTo('/login')`** → Vue Router「redundant / duplicated navigation」錯。
參照專案只修了 SSR cookie 時序，**沒修並發導頁**，故一直復發。

scaffold 已內建的六道防線（改動範本時不可拿掉）：

1. **`forceLogout` 單飛冪等**（`utils/force-logout.ts` 的 `loggingOut` flag）→ 並發 401 只導一次。**根治此錯的關鍵。**
2. **顯式公開白名單**（`authPublicPaths`，務必含 login）→ middleware 只在非白名單時導。
3. **never navigate to current**（middleware 與 forceLogout 都檢查 `to.path === loginPath` / 已在 login）。
4. **login 頁與其 layout 禁發 authed fetch**；`auth.api.ts` 端點全 `handleUnauthorized:false`。
5. **clearAuth cookie 確實落地**（`stores/auth.ts` server 端 `deleteCookie(event)`，趕在 redirect 前）。
6. **home/login 路徑用 config**（不寫死），可攜。

---

## 5. 收尾 checklist（`feature-to-ui` 末 / vibe-check 提示；僅 auth 專案跳）

- [ ] `app/middleware/auth.global.ts` 存在，`authPublicPaths` 含 `login_path`
- [ ] 未登入訪問受保護頁 → **只導向 `/login` 一次、無 console navigation error**
- [ ] 登入成功後不被彈回 login（已登入訪 login 會導去 home）
- [ ] login 頁與 layout 沒有 authed fetch
- [ ] （e2e）建議在 `test/e2e/` 加：未登入訪受保護路由 → 斷言落在 `/login` 且無重複導向錯誤

---

## 6. Sync 模式

- spec 後來才加 `/auth/*` → Phase 0 偵測到、補寫 route-map.auth + 套用 scaffold，並在 sync-report 標「新增 auth 守門」。
- spec 移除 auth → 不自動刪（避免誤刪自訂），在 sync-report 標為待人工確認的 auth 孤兒。
