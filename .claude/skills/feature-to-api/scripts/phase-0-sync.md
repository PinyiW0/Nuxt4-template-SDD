# Phase 0: Sync 模式步驟

> 僅當 `spec/report/route-map.yaml` 存在時進入此流程。
> 全量模式步驟 → 詳見 [phase-0-prep.md](phase-0-prep.md)

---

### 步驟 1：讀取 PM 設定 + 設定檔變更偵測

同全量模式，讀取 `ui-config-pm.yaml` 並同步到 `ui-config.yaml`。

同步完成後，比對同步前後的 `ui-config.yaml` 差異，記錄變更的設定區塊：

| 變更的設定區塊 | 影響的 Phase |
|--------------|-------------|
| `theme.colors` | Phase 2 |
| `project.*`（name, description, favicon） | Phase 2 |
| `meta.*`（keywords, author, og） | Phase 2 |
| `colorMode.*` | Phase 2 |
| `table.*` | Phase 4 |
| `delete.*` | Phase 4 |
| `toast.*` | Phase 3（UApp toaster 設定） |
| `responsive.sidebar.*` | Phase 3 |

> 此偵測結果會在步驟 8 產出「Phase 執行建議」時使用。

### 步驟 2：讀取現有 route-map.yaml

- 解析所有已登錄的路由、features（含 `content_hash`）
- 記錄當前 `version` 欄位值

### 步驟 3：掃描所有新版 .dsl.feature

- 路徑：`spec/gherkin-feature/*.dsl.feature`
- 計算每個檔案的 `content_hash`

### 步驟 4：讀取現有型別定義

- 讀取 `app/types/api/*.ts` 的所有 export interface / type
- 建立「型別名 → 欄位清單」對照表（作為欄位級比對基準）

### 步驟 5：逐一比對每個 feature

| 情況 | 判定 |
|------|------|
| route-map 中找不到此 feature | 標記「**新增**」 |
| 找到但 `content_hash` 不同 | 進入步驟 6 分析變更程度 |
| 找到且 `content_hash` 相同 | 標記「**無變化**」 |
| route-map 中有但 feature 檔已不存在 | 標記「**刪除**」 |

### 步驟 6：變更程度判斷

> 機械式規則，不是 AI 猜測。**必須按下方 checklist 逐步判定，並在變更報告中附上判定過程**。

#### 判定 Checklist（依序執行，遇到即停止）

```
1. 端點路徑是否有變更（改名/刪除）？
     → 是 → rebuild（停止）
     → 否 → 繼續

2. 是否出現全新的 Command 類型（如：從未有過的 API 操作）？
     → 是 → rebuild（停止）
     → 否 → 繼續

3. 計算欄位增減數量 = |新增欄位數| + |刪除欄位數|
     → > 2 → rebuild（停止）
     → ≤ 2 → 繼續

4. 計算新增 Scenario 數量，並逐一分類：
     a) 「欄位驗證型」：Scenario 名稱或內容可明確對應到新增欄位
        （如：「體重超出範圍」對應新增的 weight 欄位）
     b) 「新功能型」：無法對應到任何新增欄位
        （如：「搜尋球員」「AI 狀態篩選」「分頁」）

     → 存在任何「新功能型」Scenario → rebuild（停止）
     → 全部都是「欄位驗證型」→ patch（停止）

5. 以上皆否（僅措辭/數值微調、Background 資料微調）
     → patch
```

#### 判定結果記錄格式

在變更報告的「Feature 變更總覽」表格中，`說明` 欄須包含判定依據：

```markdown
| 04-建立球隊 | 修改 | patch | /teams | 新增 1 欄位(簡介) + 2 Scenario 皆為該欄位驗證 → checklist #4a → patch |
| 12-查詢訓練列表 | 修改 | rebuild | /trainings | 新增 6 Scenario 含搜尋/篩選/分頁(新功能型) → checklist #4b → rebuild |
```

> **不附判定依據 = 違規**。這是確保判定可追溯、可驗證的關鍵。

### 步驟 7：推導下游影響

根據步驟 5-6 的結果，推導受影響的下游產出：

| 變更 | 影響範圍 |
|------|---------|
| 欄位變更 | → 對應的 `types/api/*.ts` → import 該型別的 API 端點 → 使用該型別的頁面 |
| Scenario 變更 | → 對應頁面的 UI 邏輯 |
| 端點路徑變更 | → `server/api/` 端點 → 呼叫該端點的頁面 |
| 新增 feature | → 可能需要新型別、新端點、新路由、新頁面 |
| 刪除 feature | → 標記待刪除項目（Phase 5 開始時確認後執行） |

### 步驟 7.5：additionalFeatures 變更偵測

- 比對 PM yaml 的 `additionalFeatures` 與現有 `route-map.yaml > enabled_features`
- 新啟用的功能 → 在變更報告中標註，Phase 4 需要建立對應元件
- 關閉的功能 → 在待刪除項目中標記（不自動移除）

### 步驟 8：產出變更報告

將分析結果寫入 **`spec/report/sync-report.md`**。

> 因為 `context: fork`，Phase 間無法共享對話記憶，所以必須持久化為檔案。後續 Phase 讀取此報告決定行為。

#### Phase 執行建議的強制規則

產出「Phase 執行建議」表格時，**必須依序檢查以下規則**：

| Phase | 條件 | 建議 |
|-------|------|------|
| Phase 1 | 型別變更或端點變更表格有任何「新增」或「修改」 | 執行 |
| Phase 2 | 設定檔變更偵測到 `theme.colors`、`project.*`、`meta.*`、`colorMode.*` 有變更 | 執行（否則跳過） |
| Phase 2 | 路由變更表格有任何「新增」 | 執行 |
| **Phase 3** | **路由變更表格有任何「新增」，或設定檔變更偵測到 `toast.*`、`responsive.sidebar.*` 有變更** | **執行** |
| Phase 4 | 新路由使用了尚未建立的共用元件，或設定檔變更偵測到 `table.*`、`delete.*` 有變更 | 執行（否則跳過） |
| Phase 5 | 頁面實作指令有任何 build/patch/rebuild | 執行 |

> **Phase 3 跟 Phase 2 的觸發條件相同**：有新路由 → 兩者都必須執行。Phase 2 建空殼頁面，Phase 3 把新路由加入 sidebar 導航。

格式見下方「變更報告格式」。

### 步驟 9：更新 route-map.yaml

- `version` 遞增（如 1 → 2）
- 新增的 feature → 加入對應路由的 features 陣列（或建立新路由條目）
- hash 變更的 feature → 更新 `content_hash`
- 刪除的 feature → **不自動移除**，僅在報告中標記待刪除
- **同步更新 `api_contract`**：新增/修改的型別 → 更新 `api_contract.types`（鏡像 `app/types/api/*.ts` 的欄位）；新增/修改的端點 → 更新 `api_contract.endpoints`
- **同步更新 `enabled_features`**：反映 PM yaml 最新的 `additionalFeatures`
- 更新 `generated_at` 為今天日期

### 步驟 10：詢問用戶確認

向用戶展示：
1. 變更報告摘要（Feature 變更總覽表格）
2. Phase 執行建議（哪些 Phase 需要跑、哪些可跳過）
3. 待刪除項目（提醒用戶手動處理）
4. 更新後的 route-map.yaml 變更

確認後才寫入檔案。

---

## 變更報告格式（spec/report/sync-report.md）

```markdown
# Sync 變更報告

generated_at: YYYY-MM-DD
base_version: 1
sync_version: 2

## 設定檔變更

| 設定區塊 | 變更內容 | 影響 Phase |
|---------|---------|-----------|
| （若無變更則顯示「設定檔無變更」） | | |

## Feature 變更總覽

| Feature 檔 | 狀態 | 模式 | 影響頁面 | 說明 |
|------------|------|------|---------|------|
| 03-查詢球隊列表.dsl.feature | 無變化 | skip | — | hash 相同 |
| 04-建立球隊.dsl.feature | 修改 | patch | /teams | 新增 1 個欄位 |
| 12-新增教練.dsl.feature | 新增 | build | /coaches | 全新功能 |
| 05-刪除球隊.dsl.feature | 刪除 | — | /teams | feature 檔已不存在 |

## 型別變更

| 檔案 | 動作 | 詳細變更 |
|------|------|---------|
| app/types/api/teams.ts | 修改 | CreateTeamBody 新增 `description` 欄位 |
| app/types/api/coaches.ts | 新增 | CoachItem, CreateCoachBody |

## 端點變更

| 端點 | 動作 | 影響型別 | 影響頁面 |
|------|------|---------|---------|
| POST /api/teams | 修改 | CreateTeamBody | /teams |
| GET /api/coaches | 新增 | CoachItem[] | /coaches |
| POST /api/coaches | 新增 | CreateCoachBody | /coaches |

## 路由變更

| 路由 | 動作 | 頁面 | Features |
|------|------|------|---------|
| /coaches | 新增 | app/pages/coaches/index.vue | 12-新增教練 |

## 頁面實作指令

| 頁面 | 模式 | 變更的 Features | 說明 |
|------|------|----------------|------|
| /teams | patch | 04-建立球隊 | 新增欄位，Edit 受影響區塊 |
| /coaches | build | 12-新增教練 | 全新頁面 |
| /login | skip | — | 無變化 |

## Phase 執行建議

| Phase | 建議 | 原因 |
|-------|------|------|
| Phase 0 | 已完成 | 本次執行 |
| Phase 1 | 執行 | 有型別/端點新增或修改 |
| Phase 2 | 跳過 | 設定檔無變更（theme/project/meta/colorMode） |
| Phase 2 | 執行 | 有新增路由 |
| Phase 3 | 執行 | 有新增路由（需加入 sidebar 導航） |
| Phase 4 | 跳過 | 共用元件無變更 |
| Phase 5 | 執行 | 有 build/patch 頁面 |

## 待刪除項目（Phase 5 開始時確認後執行）

> Phase 5 增量模式會在最開始讀取此區塊，向用戶確認後再執行刪除。

| 類型 | 路徑 | 原因 |
|------|------|------|
| feature 參照 | route-map.yaml > /teams > 05-刪除球隊 | feature 檔已不存在 |
| 型別（待確認） | app/types/api/teams.ts > DeleteTeamBody | 若 05 是唯一使用者 |
| 端點（待確認） | DELETE /api/teams/[id] | 若 05 是唯一使用者 |
```

### 邊界情況處理

| 情況 | 處理方式 |
|------|---------|
| Scenario 邏輯變動但端點/欄位沒變 | content_hash 偵測到 feature 有改，標記為「修改」，Phase 5 patch |
| 多 feature 對應同一頁面，只有部分改 | patch 只改受影響的區塊，「頁面實作指令」列出變更的 Features |
| feature 改名（舊刪新增） | 報告同時列出刪除+新增，使用者確認時自行判斷 |
| route-map 手動加的路由（無 feature） | sync 不動此路由，不標記刪除 |
| Phase 1 改型別影響未標記的端點 | 修改型別後掃描所有 import 該型別的端點，補入報告 |
| 讀到舊格式 route-map（features 為字串陣列） | 視為無 hash，全部 feature 進入完整比對 |
