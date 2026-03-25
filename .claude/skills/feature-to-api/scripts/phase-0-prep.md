# Phase 0: 準備工作

## 必讀規範

```
僅需讀取：
- spec/ui-config/ui-config-pm.yaml（PM 設定）
- spec/gherkin-feature/*.feature（所有 feature 檔）

Sync 模式額外讀取：
- spec/report/route-map.yaml（現有路由對照表）
- app/types/api/*.ts（現有型別定義，欄位級比對基準）
```

---

## 模式判斷

Phase 0 開始前，先檢查 `spec/report/route-map.yaml` 是否存在：

| 條件 | 模式 | 行為 |
|------|------|------|
| `route-map.yaml` **不存在** | **全量模式** | 執行下方「全量模式執行步驟」（現有流程不動） |
| `route-map.yaml` **存在** | **Sync 模式** | 執行下方「Sync 模式步驟」（增量偵測 + 變更報告） |

---

## 全量模式執行步驟

1. **讀取 PM 設定**
   - 讀取 `ui-config-pm.yaml`
   - 同步到 `ui-config.yaml`（參考下方同步邏輯）
   - 記錄 `additionalFeatures` 中值為 `true` 的項目（後續步驟 6 寫入 route-map）

2. **掃描所有 .feature 檔**
   - 路徑：`spec/gherkin-feature/*.dsl.feature`
   - ⚠️ **必須讀取全部檔案**

3. **產出功能清單**（見下方格式）

4. **產出路由規劃**（見下方格式）

5. **建立 API 合約型別**（直接寫入 `app/types/api/*.ts`）
   - 根據 feature 分析結果，直接建立 TypeScript 型別定義檔
   - 每個資源一個檔案（如 `teams.ts`、`auth.ts`）
   - 建立 `index.ts` 統一 re-export
   - ⚠️ 欄位命名使用 `snake_case`（與未來後端 API 對齊）
   - ⚠️ 日期欄位使用 `string`（JSON 不支援 `Date`）
   - ⚠️ **必須建在 `app/types/api/`**，Nuxt 4 的 `~` 別名解析到 `app/`
   - 見下方「API 合約型別範例」

6. **產生路由對照表**（`spec/report/route-map.yaml`）
   - 根據步驟 3-5 的分析結果，自動產生路由對照檔
   - 此檔案是後續所有 Phase 及 **update 迭代的唯一參照來源**
   - ⚠️ **`api_contract` 區塊**：包含 `types`（型別欄位快照，作為 Sync diff 基準；程式碼 SSoT 仍是 `app/types/api/*.ts`）和 `endpoints`（端點規格）
   - 見下方「路由對照表格式」

7. **產出前自檢**（寫入檔案前逐項確認）
   - □ `/` 根路由存在（`navigateTo` 到第一個主要頁面）
   - □ 每個 `.dsl.feature` 都有對應的路由
   - □ `app/types/api/*.ts` 涵蓋所有端點的 Request/Response 型別
   - □ `api_contract.types` 的欄位與 `app/types/api/*.ts` 的 export interface 一一對應
   - □ `api_contract.endpoints` 與各路由的 `api_endpoints` 一致
   - □ `enabled_features` 反映 PM yaml 的 `additionalFeatures`（有啟用的功能才寫入）
   - □ 啟用功能的頁面已標註 `features_used`

8. **詢問用戶確認**（含路由對照表內容）

---

## PM 設定同步邏輯

| PM 設定欄位 | ui-config.yaml 欄位 | 轉換規則 |
|------------|---------------------|----------|
| `project.*` | `project.*` | 直接複製 |
| `meta.*` | `meta.*` | 直接複製 |
| `theme.colors.*` | `theme.colors.*` | 非空值覆蓋預設，空值 fallback 到 Tailwind 內建色 |
| `colorMode.*` | `colorMode.*` | 直接複製 |
| `toast.displaySeconds` | `toast.duration` | 秒 → 毫秒 (×1000) |
| `toast.position` | `toast.position` | 中文轉英文（右上角→top-right 等） |
| `table.*` | `table.*` | 直接複製（結構已對齊） |
| `delete.*` | `delete.*` | 直接複製（結構已對齊） |
| `testAccounts` | `testAccounts` | 直接複製 |
| `additionalFeatures.*`（boolean） | `additionalFeatures.*.required` | `true` → `true`，`false` → `false` |

---

## 輸出格式：功能清單

```markdown
## 功能清單

### 認證相關
- [ ] 登入頁面 (01-使用者登入.dsl.feature)
- [ ] 登出功能 (02-使用者登出.dsl.feature)

### 球隊管理
- [ ] 球隊列表 (03-查詢球隊列表.dsl.feature)
- [ ] 建立球隊 (04-建立球隊.dsl.feature)

### 資料模型
| 實體 | 欄位 | 來源 |
|------|------|------|
| User | account, role, status | 01-使用者登入 |
| Team | id, name, playerCount | 03-查詢球隊列表 |

### API 端點規劃
| 端點 | 方法 | 用途 | 來源 |
|------|------|------|------|
| /api/auth/login | POST | 登入 | 01 |
| /api/teams | GET | 球隊列表 | 03 |
```

---

## 輸出格式：路由規劃

```markdown
## 路由規劃

| 路由 | 頁面 | Layout | 功能來源 |
|------|------|--------|----------|
| /login | login.vue | auth | 01-使用者登入 |
| / | index.vue | default | 首頁/Dashboard |
| /teams | teams/index.vue | default | 03-查詢球隊列表 |
```

---

## API 合約型別範例

Phase 0 直接建立 `app/types/api/*.ts`，消除 YAML → TypeScript 翻譯誤差。

### 型別檔案結構

```
app/types/api/
├── index.ts     # 統一 re-export
├── auth.ts      # LoginData
├── teams.ts     # TeamItem, CreateTeamBody
└── players.ts   # PlayerItem, CreatePlayerBody
```

### 型別檔範例

```typescript
// app/types/api/teams.ts
export interface TeamItem {
  id: number
  name: string
  player_count: number
  created_by: string
  created_at: string
}

export interface CreateTeamBody {
  name: string
}
```

```typescript
// app/types/api/index.ts — 統一 re-export
export type { LoginData } from './auth'
export type { CreateTeamBody, TeamItem } from './teams'
```

> ⚠️ **命名慣例**：欄位 `snake_case`、型別 `PascalCase`、日期用 `string`
>
> ⚠️ 此型別是前端自定義的合約，未來後端 API Spec 到位後只需修改 `types/api/` 即可對齊。

---

## 路由對照表格式（route-map.yaml）

用戶確認後，將此對照表寫入 `spec/report/route-map.yaml`。此檔案是後續 Phase 2-5 及 **update 迭代的唯一參照來源**。

```yaml
# spec/report/route-map.yaml
# 由 /feature-to-ui Phase 0 自動產生
# ⚠️ 可手動修改，修改後以此為準

generated_at: "2026-01-20"
version: 1

# PM 啟用的額外功能（來自 ui-config-pm.yaml > additionalFeatures）
# 只列出值為 true 的項目；全部 false 時省略此區塊
# Phase 4 據此建立對應元件，Phase 5 據此在頁面中使用
# 各功能的實作規範 → 見 features.md
enabled_features:
  - charts              # 統計圖表
  - dragAndDrop         # 拖曳排序

# API 合約規格
api_contract:
  # 回傳格式慣例
  response_conventions:
    list: "{ status: 'success', data: T[], meta: { total, page, page_size } }"
    single: "{ status: 'success', data: T }"
    action: "{ status: 'success', message: '...' }"
    error: "throw createError({ statusCode, message })"

  # 型別欄位快照（鏡像 app/types/api/*.ts，作為 Sync diff 基準）
  # 程式碼層面的 SSoT 仍是 app/types/api/*.ts
  # 手動修改只改 *.ts，此區塊由 Phase 0 自動同步覆蓋
  types:
    TeamItem:
      file: teams.ts
      fields:
        id: number
        name: string
        player_count: number
        created_by: string
        created_at: string
    CreateTeamBody:
      file: teams.ts
      fields:
        name: string

  # 端點規格（方法 + 路徑 + Request/Response 型別名引用）
  endpoints:
    - method: POST
      path: /api/auth/login
      request: "{ account: string, password: string }"
      response: LoginData
    - method: GET
      path: /api/teams
      request: "query: { page?, page_size? }"
      response: "TeamItem[]"
    - method: POST
      path: /api/teams
      request: CreateTeamBody
      response: TeamItem

routes:
  - path: "/login"
    page: "app/pages/login.vue"
    layout: "auth"
    features:
      - file: "01-使用者登入.dsl.feature"
        content_hash: "a1b2c3d4"
    api_endpoints:
      - "POST /api/auth/login"
    components: []
    store: "auth"

  - path: "/teams"
    page: "app/pages/teams/index.vue"
    layout: "default"
    features:
      - file: "03-查詢球隊列表.dsl.feature"
        content_hash: "e5f6g7h8"
      - file: "04-建立球隊.dsl.feature"
        content_hash: "i9j0k1l2"
    api_endpoints:
      - "GET /api/teams"
      - "POST /api/teams"
    components:
      - "PageHeader"
      - "ListContainer"
      - "ConfirmModal"
    store: null
    features_used: []           # 此頁面使用的 additionalFeature（空則省略或留空陣列）

  # 範例：使用 additionalFeature 的頁面
  # - path: "/analytics/[id]"
  #   features_used: [charts]   # Phase 5 據此引用圖表元件
```

### 欄位說明

| 欄位 | 說明 |
|------|------|
| `enabled_features` | PM 啟用的額外功能清單（來自 `additionalFeatures`，Phase 4/5 消費，見 `features.md`） |
| `api_contract` | API 合約規格 |
| `api_contract.response_conventions` | 回傳格式慣例 |
| `api_contract.types` | 型別欄位快照（鏡像 `app/types/api/*.ts`，Sync diff 基準；手動修改只改 `*.ts`，此區塊由 Phase 0 自動覆蓋） |
| `api_contract.endpoints` | 端點規格（方法 + 路徑 + Request/Response 型別引用） |
| `path` | 路由路徑 |
| `page` | 頁面檔案路徑（相對於專案根目錄） |
| `layout` | 使用的 Layout 名稱 |
| `features` | 對應的 .feature 檔案（物件陣列，含 `file` 和 `content_hash`） |
| `api_endpoints` | 會呼叫的 API 端點列表（引用 `api_contract.endpoints` 的路徑） |
| `components` | 使用的共用元件 |
| `store` | 使用的 Pinia store（null 表示不使用） |
| `features_used` | 此頁面使用的 `enabled_features` 項目（Phase 5 據此引用對應元件） |

### 推導規則

| Feature 類型 | 路由推導 | 說明 |
|-------------|---------|------|
| （無 feature 對應） | `/` → `index.vue` | **必建**：根路由，Phase 2 放空殼，Phase 5 填入 `navigateTo` |
| `使用者登入` / `使用者登出` | `/login` | 認證類功能合併到登入頁 |
| `查詢 XXX 列表` | `/xxx` (複數) | 列表頁 |
| `建立 XXX` / `編輯 XXX` / `刪除 XXX` | 同列表頁 | CRUD 合併到同一個列表頁 |
| `查看 XXX 詳情` | `/xxx/[id]` | 詳情頁 |
| `XXX 的子功能` | `/xxx/[id]/yyy` | 巢狀路由 |

> ⚠️ **根路由必建**：即使沒有 feature 對應 `/`，route-map.yaml 也必須包含 `/` 路由。Phase 2 建空殼，Phase 5 填入 client-side redirect。**禁止使用 `redirectCode`（HTTP redirect 會被瀏覽器快取，影響同 port 的其他專案）**，改用 `if (import.meta.client) { await navigateTo('/xxx', { replace: true }) }`。

> ⚠️ **一個頁面可對應多個 feature**：例如球隊列表頁同時處理「查詢」「建立」「編輯」「刪除」四個 feature。
>
> ⚠️ **Phase 2 必須讀取此檔案**：建立頁面骨架時，以 route-map.yaml 為準。
>
> ⚠️ **Phase 5 必須讀取此檔案**：實作頁面時，根據 features 欄位確認要實作哪些功能。

### features 格式說明

features 欄位使用物件陣列，每個物件包含 `file`（檔名）和 `content_hash`（內容雜湊）：

```yaml
features:
  - file: "03-查詢球隊列表.dsl.feature"
    content_hash: "a1b2c3d4"
```

- `content_hash` 使用 `shasum -a 256` 計算 feature 檔案內容
- Sync 模式用此 hash 判斷 feature 是否有變更
- **向下相容**：讀到舊格式（字串陣列）→ 視為無 hash，全部標記為需要比對

計算方式（shell，統一使用 `shasum -a 256`，macOS/Linux 皆內建）：
```bash
shasum -a 256 spec/gherkin-feature/03-查詢球隊列表.dsl.feature | awk '{print $1}'
```

---

## Sync 模式步驟

Sync 模式的完整步驟（步驟 1-10）、變更報告格式、邊界情況處理 → 詳見 [phase-0-sync.md](phase-0-sync.md)
