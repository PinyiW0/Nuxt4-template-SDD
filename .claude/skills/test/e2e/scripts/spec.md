# E2E Spec 生成（Phase: e2e spec）

## 目標

將 `.flow.md` 操作流程轉換為 Playwright `.spec.ts` 測試檔案，實現**業務需求 100% 覆蓋**。

> **TDD 定位**：spec 在 UI 之前生成，是測試合約。UI 為通過 spec 而建，spec 不因 UI 而改。

---

## 輸入 / 輸出

### 輸入

```
必讀（結構來源）：
1. spec/e2e-flows/{NN}-{name}.flow.md  — 操作流程文件（測試結構）
2. spec/e2e-flows/_common.flow.md      — 共用步驟
3. test/e2e/helpers/actions.ts       — 共用操作（login 等）
4. test/e2e/helpers/fixtures.ts       — 測試資料

必讀（資料來源）：
5. spec/gherkin-feature/{NN}-{name}.dsl.feature — 原始 Feature Background（該 feature 的初始狀態定義）
6. server/mock/data/*.ts             — 實際 mock 資料（實體名稱、日期、數值等）
7. server/api/{相關 API}.ts           — API 過濾邏輯 + 錯誤訊息（createError 的 message）

不讀（TDD 模式下 UI 尚未建立）：
7. app/pages/{相關頁面}.vue           — ❌ spec 在 UI 之前生成，不依賴 Vue 頁面
```

### 輸出

```
1. test/e2e/specs/{NN}-{name}.spec.ts  — Playwright 測試檔案
2. test/e2e/helpers/fixtures.ts        — 更新（如有新路由/帳號）
```

---

## 核心原則

1. **一個 `.flow.md` 對應一個 `.spec.ts`**
2. **不使用 quickpickle / Gherkin**：直接生成 Playwright `test.describe` / `test` 結構
3. **共用操作從 helpers import**：login / selectOption / confirmDelete 不在 spec 內定義
4. **testid 以 `.flow.md` 為準**：flow 定義 testid，Vue 頁面必須實作 flow 定義的 testid（TDD：spec 先於 UI）
5. **每個 spec 獨立可執行**：透過 `test.beforeEach` reset mock data + 清理多餘實體，確保初始狀態符合 Feature Background
6. **⚠️ 初始狀態以 Feature Background 為準**：每個 `.dsl.feature` 的 `Background:` 定義了該 feature 的初始狀態。Mock 全集是所有 feature 的 Background 合併，可能包含不屬於該 feature 的實體。Spec 必須確保測試開始時的狀態與 Feature Background 一致（見 Step 2c-2d）
7. **spec 是生成物，禁止手動編輯**：`.flow.md` 更新時，spec 全量重新生成。green 階段**禁止修改 spec**，只能修改 UI/mock/API。如果 spec 有問題，修 flow 再重新生成

> ⚠️ 若需調整測試的 Given/When/Then 邏輯，應修改 `.flow.md` 後重新執行 `/test e2e spec`，而非直接編輯 `.spec.ts`

---

## 執行步驟

### Step 1：讀取 .flow.md

解析 `.flow.md` 結構：

```
├── 頁面資訊（名稱、路由）
├── 元素定義表
├── 共用前置條件
└── 規則[]
    └── 情境[]
        ├── 跳過？（⏭️ 整個情境跳過）
        ├── 前置條件[]
        ├── 操作步驟[]
        └── 預期結果[]
```

### Step 2：交叉比對實作（⚠️ 關鍵步驟）

在生成 spec 之前，**必須讀取實際實作**來校正 `.flow.md` 中的假設值。

#### 2a. 讀取 Feature Background（⚠️ 初始狀態定義）

讀取 `spec/gherkin-feature/{NN}-{name}.dsl.feature`，解析 `Background:` 區塊中的 `Given` 語句，識別**該 feature 定義的初始狀態**（哪些實體在測試開始時應該存在）。

```
Feature Background 定義：
- 使用者：admin, coach1
- 球隊：藍鷹隊（coach1）
→ 該 feature 的測試假設「只有藍鷹隊存在」
```

> ⚠️ **Feature Background ≠ Mock 全集**。Mock 資料是所有 feature 的 Background 合併而成的超集。
> 例如 feature 03 的 Background 有 4 支球隊，feature 04 的 Background 只有 1 支。
> 每個 feature 的 spec 必須基於**自己的 Background**推算預期結果，而非 mock 全集。

#### 2b. 掃描 mock data + API 過濾邏輯

1. 讀取 `server/mock/data/*.ts`，取得原始資料全集
2. 讀取 `server/api/{對應路徑}.ts`，理解 API 的過濾邏輯（日期過濾、狀態過濾、角色過濾、搜尋篩選等）
3. **以每個測試情境的角色/參數，模擬 API 過濾**，推算該情境下 API 實際會回傳哪些資料
4. 用推算結果寫斷言值，而非 raw data 的值

> ⚠️ raw data ≠ API 回傳。例如 `mockTrainings` 有 16 筆，但經過 `status === 'active'`、`date >= today`、角色過濾後，coach1 呼叫 API 可能只拿到 3~4 筆。斷言必須基於過濾後的結果。

#### 2c. 比對 Feature Background vs Mock 全集（⚠️ 背景差異偵測）

將 Step 2a 的 Feature Background 與 Step 2b 的 mock 全集比對：

```
Feature Background 定義的實體 vs mock 全集
├─ 完全一致 → 無需額外處理，直接用 reset
└─ 有差異 → 需要在 beforeEach 中建立乾淨背景
    ├─ mock 多餘實體（不在 Background 中）→ 需刪除
    └─ mock 缺少實體（在 Background 中但 mock 沒有）→ 需建立

例：
  Feature 04 Background: 藍鷹隊
  Mock 全集: 藍鷹隊, 紅龍隊, 白虎隊, 黑豹隊(deleted)
  差異: 紅龍隊、白虎隊、黑豹隊為多餘 → 需刪除
```

#### 2d. 生成乾淨背景 setup（有差異時）

**原則：每個 spec 的初始狀態必須精確對應 Feature Background，不多不少。**

在 `test.beforeEach` 中，先 reset 到全集，再透過 API 呼叫調整到 Feature Background：

```typescript
test.beforeEach(async ({ request }) => {
  // Step 1: 重置 mock 資料到全集
  await request.post('/api/__test__/reset')

  // Step 2: 調整到 Feature 04 的 Background（只有藍鷹隊）
  // 刪除不屬於此 feature Background 的實體
  await request.delete('/api/teams/2') // 紅龍隊
  await request.delete('/api/teams/3') // 白虎隊
})
```

> ⚠️ **解耦原則**：每個 spec 必須從自己 Feature Background 定義的乾淨狀態開始。
> mock 全集只是一個「素材池」，reset 後再透過 API 裁剪到正確的初始狀態。
> 這確保了：
> - 建立操作不會因為多餘實體的唯一性約束而失敗
> - 列表查詢的筆數與 Feature Background 一致
> - 各 spec 之間完全解耦，不互相影響

#### 2e. 掃描 API 錯誤訊息（僅涉及錯誤場景時）

讀取相關 API handler，提取 `createError` 的 message：

```bash
grep "createError" server/api/{相關路徑}/*.ts
```

#### 2f. 產出校正表

對比 `.flow.md` 與 mock data / API / Feature Background，列出資料差異：

```
⚠️ 校正表：
- flow 實體名稱 "{flow值}" → 實際 mock: "{mock值}"
- flow 錯誤訊息 "{flow訊息}" → 實際 API: "{api訊息}"
- testid: 直接使用 flow 定義（flow 是 testid 權威來源）
- toast 文字: 直接使用 flow 定義（UI 必須實作此文字）
- ⚠️ Background 衝突: mock 多餘實體 "{name}" 與建立操作衝突 → 需清理
```

### Step 3：更新 fixtures.ts

若 `.flow.md` 涉及新的路由或測試帳號，更新 `fixtures.ts`。

### Step 4：生成 .spec.ts（使用校正後的值）

---

## .spec.ts 結構

```typescript
import { expect, test } from '@playwright/test'
import { confirmDelete, login, selectOption } from '../helpers'

// Mock data reset + 背景調整：確保初始狀態精確對應 Feature Background
test.beforeEach(async ({ request }) => {
  await request.post('/api/__test__/reset')
  // 若 Feature Background ≠ mock 全集，在此刪除/建立實體使其一致
  // await request.delete('/api/teams/2') // 範例：刪除不在 Background 的球隊
})

test.describe('規則：{Rule 名稱}', () => {
  test('{Example 名稱}', async ({ page }) => {
    // Given：{前置條件原文}
    await login(page, 'coach1', 'pass123')
    await page.goto('/items', { waitUntil: 'networkidle' })

    // When：{操作步驟原文}
    // ...

    // Then：{預期結果原文}
    // ...
  })

  test.skip('{跳過的 Example 名稱}', async () => {
    // 跳過：{原因}
  })
})
```

---

## Playwright 必遵守規則

> ⚠️ 違反任一條都會產生有問題的 spec。此段落為 Playwright 規則的**唯一權威來源**，其他檔案（red.md、green.md）不再重複列出。

### 語法規則

| 規則 | 正確 | 禁止 |
|------|------|------|
| `page.goto()` | 加 `{ waitUntil: 'networkidle' }` | 不帶 waitUntil |
| Toast 斷言 | `{ exact: true }` | regex（如 `/成功/`） |
| `test.skip` callback | `async () =>` | `async ({ page }) =>` |
| `test.beforeEach` | reset + 調整到 Feature Background 狀態 | 省略 reset 或忽略 Background 差異 |
| 確認彈窗 | `confirmDelete(page)` | `getByText('確定要刪除')` + `getByRole('button')` |
| 列表行定位 | `locator('tbody tr', { hasText })` | 直接 `getByText`（會匹配 header） |
| `toHaveURL` | 用 `waitForURL('**/path')` 代替 | `toHaveURL` 不支援 glob |
| helpers | 從 `../helpers` import | 在 spec 內重複定義 login / selectOption / confirmDelete |

### 交叉比對規則（TDD 模式）

| 資料類型 | 來源 | 說明 |
|---------|------|------|
| 實體名稱、日期、數值 | `server/mock/data/*.ts` | 必須使用 mock 實際值 |
| testid | `.flow.md`（權威來源） | 直接使用，UI 必須實作此 testid |
| toast 文字 | `.flow.md`（權威來源） | 直接使用，UI 必須顯示此文字 |
| API 錯誤訊息 | `server/api/` 的 `createError({ message })` | 優先用 API 實際值 |
| select option label | `.flow.md` | 直接使用，UI 必須實作此格式 |
| 統計數值 | 從 mock data 手動計算 | 不可省略，必須計算 |

> **TDD 原則**：spec 在 UI 之前生成。testid、toast、操作流程全部使用 flow 定義的值。UI 實作時必須符合這些值。

### Strict Mode Violation 防範

`getByText` 只能匹配一個元素。對每個 `getByText` 斷言思考：**這段文字是否可能在頁面上出現多次？**

```typescript
// ❌ toast 文字與 Badge 重複 → strict mode violation
await expect(page.getByText('狀態文字', { exact: true })).toBeVisible()

// ✅ 限定在 toast 區域
await expect(page.getByRole('alert').getByText('狀態文字')).toBeVisible()

// ❌ 數值出現在多處
await expect(page.getByText('128.5')).toBeVisible()

// ✅ 限定在特定 testid
await expect(page.getByTestId('{value-label}')).toContainText('128.5')
```

---

## Flow → Playwright 轉換規則

### 操作動詞轉換

| Flow 動詞 | Playwright 程式碼 |
|-----------|------------------|
| `前往{頁面} → /path` | `await page.goto('/path', { waitUntil: 'networkidle' })` |
| `點擊「{元素}」→ #id` | `await page.getByTestId('id').click()` |
| `輸入 {value} → #id` | `await page.getByTestId('id').fill('value')` |
| `清空並輸入 {value} → #id` | `await page.getByTestId('id').clear()` + `.fill('value')` |
| `勾選「{描述}」→ #id` | 見「批次勾選」 |
| `取消勾選「{描述}」→ #id` | 見「批次勾選」 |
| `等待{描述}出現 → #id` | `await expect(page.getByTestId('id')).toBeVisible()` |
| `等待跳轉到{頁面} → /path` | `await page.waitForURL('**/path')` |

### 驗證詞轉換

| Flow 驗證詞 | Playwright 程式碼 |
|------------|------------------|
| `→ 顯示成功提示「{text}」` | `await expect(page.getByText('text', { exact: true })).toBeVisible()` |
| `→ 顯示成功提示` | 從 Vue 頁面的 `toast.add` 取得實際文字（找不到時套用 fallback） |
| `→ 顯示錯誤提示「{text}」` | `await expect(page.getByText('text', { exact: true })).toBeVisible()` |
| `→ 顯示錯誤提示` | 從 API 的 `createError` 取得實際文字（找不到時套用 fallback） |
| `→ 文字「{text}」可見` | `await expect(page.getByText('text')).toBeVisible()` |
| `→ 文字「{text}」不可見` | `await expect(page.getByText('text')).not.toBeVisible()` |
| `→ #{id} 包含「{text}」` | `await expect(page.getByTestId('id')).toContainText('text')` |
| `→ #{id} 不包含「{text}」` | `await expect(page.getByTestId('id')).not.toContainText('text')` |
| `→ #{id} 中「{rowText}」那列包含「{text}」` | 見下方「行內驗證」 |
| `→ 跳轉到 {path}` | `await page.waitForURL('**/path')`。⚠️ **Redirect 路由解析**：生成前必須查 `route-map.yaml`，若 `{path}` 的 `note` 含 `redirect` 字樣，必須解析出最終目標路由並使用目標路由的 path。`waitForURL` 不能用 redirect 來源路由，因為瀏覽器會瞬間跳走，Playwright 抓不到 |
| `→ 前往 {path}，#{id} 不包含「{text}」` | 見下方「跨頁驗證」 |
| `→ 前往 {path}，#{id} 包含「{text}」` | 見下方「跨頁驗證」 |
| `→ 前往 {path}，文字「{text}」可見` | 見下方「跨頁驗證」 |
| `→ ⏭️ 跳過（{reason}）` | `// 跳過：{reason}` |

---

## 特殊操作轉換

### 列表中定位特定行

```typescript
const row = page.getByTestId('{entity}-list').locator('tbody tr', { hasText: '{item-name}' })
await row.getByTestId('{entity}-edit').click()
```

### 行內驗證

```typescript
const row = page.getByTestId('{entity}-list').locator('tbody tr', { hasText: '{item-name}' })
await expect(row).toContainText('{expected-text}')
```

### 批次勾選

```typescript
await page.getByTestId('{entity}-row').filter({ hasText: '{item-id}' }).locator('input[type="checkbox"]').check()
```

### 確認彈窗

```typescript
await confirmDelete(page)
```

### 跨頁驗證

```typescript
await page.goto('/items', { waitUntil: 'networkidle' })
await expect(page.getByTestId('{entity}-list')).not.toContainText('{deleted-name}')
```

### USelect 下拉選單

```typescript
await selectOption(page, '{field-id}', '{option-label}')
```

> **注意**：option label 可能經過格式化（如 `"1 - 項目名稱"` 而非 `"項目名稱"`），必須檢查 Vue 頁面確認實際格式。

---

## Skip 規則

### 允許 skip 的情況（僅限以下）

- API 層已過濾，UI 根本無法觸發的場景（如「使用者編輯他人的資源」）
- 需要外部系統配合且無法 mock（如 SSE 即時推送）
- 需要控制時間的場景（如帳號鎖定過期）

### 禁止 skip 的情況

**「UI 尚未實作」不是 skip 的理由。** 寫完整步驟，讓 Playwright 自然因找不到元素而失敗。E2E 測試報告就是功能完成度清單。

```typescript
// ❌ 禁止
test.skip('成功調整排序', async () => {
  // 跳過：UI 尚未實作
})

// ✅ 寫完整步驟
test('成功調整排序', async ({ page }) => {
  await login(page, 'coach1', 'pass123')
  await page.goto('/items/1/list', { waitUntil: 'networkidle' })
  await page.getByTestId('sort-handle').first()
    .dragTo(page.getByTestId('sort-handle').nth(2))
})
```

### test.skip 語法

```typescript
test.skip('帳號鎖定後重新登入', async () => {
  // 跳過：需要控制時間（鎖定過期）
})
```

> callback 必須是 `async () =>`，**不帶** `{ page }` 參數。

---

## ESLint / Lint Gate

```typescript
// ✅ import 排序：import type 在前、外部套件按字母、相對路徑按字母、named imports 按字母
import { expect, test } from '@playwright/test'
import { confirmDelete, login } from '../helpers'
```

生成後**必須執行**：

```bash
npm run lint --fix
npm run lint    # 確認 0 errors
```

常見問題：
- `test.skip` 導致 `expect` / `login` 未使用 → 移除未使用的 import
- 未使用參數 → 加 `_` 前綴

---

## 檢查清單

- [ ] fixtures.ts 已包含所需的路由和測試帳號
- [ ] import 排序符合 ESLint perfectionist 規則
- [ ] 共用操作從 `../helpers` import，spec 內無本地定義
- [ ] `test.beforeEach` 呼叫 reset + 背景調整（Feature Background vs mock 全集已比對）
- [ ] 每個 test 有 Given/When/Then 註解
- [ ] 所有語法規則已遵守（見「Playwright 必遵守規則 > 語法規則」表）
- [ ] 所有交叉比對已完成（見「Playwright 必遵守規則 > 交叉比對規則」表）
- [ ] getByText 斷言已檢查 strict mode violation 風險
- [ ] 未驗證的值已標註 `// ⚠️ 未驗證` 註解
- [ ] `npm run lint` 零錯誤
