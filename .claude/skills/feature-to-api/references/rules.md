# 共用規則（API 合約層）

> `/feature-to-api` 的 Phase 0-1 共用規則。

---

## Server API 類型規範 `[P1]`

```typescript
// event 必須標 H3Event
import type { H3Event } from 'h3'
export default defineEventHandler(async (event: H3Event) => { ... })

// noUncheckedIndexedAccess：陣列用 ! 斷言
const item = items[index]!
item.name = 'new'
```

### Mock API 回傳慣例 `[P1]`（穩定迭代核心規則）

> ⚠️ 此規則確保 `types/api/` ↔ `mock data` ↔ `API 回傳` ↔ `頁面消費` 四層永遠對齊。
> 不管全量模式或 sync 模式，都必須遵循。

**API 端點直接回傳 mock data，禁止手動 `.map()` 挑選欄位：**

```typescript
// [O] 直接回傳（型別自動對齊 types/api/）
const paged = items.slice(start, start + pageSize)
return { status: 'success' as const, data: paged, meta: { total, page, page_size } }

// [X] 禁止手動 map（容易和型別定義不一致，導致 TypeScript 報錯）
return { status: 'success' as const, data: paged.map(m => ({ id: m.id, ... })) }
```

**對齊鏈路：**
1. `types/api/*.ts` 定義型別（single source of truth）
2. `server/mock/data/*.ts` 的 mock 資料結構必須與型別一致
3. `server/api/**/*.ts` 直接回傳 mock data，不做欄位轉換
4. `app/pages/*.vue` import 型別後直接使用，無需 workaround
