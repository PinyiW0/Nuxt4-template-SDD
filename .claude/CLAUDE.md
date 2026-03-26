# Nuxt 4 專案模板

## 技術棧

- **框架**：Nuxt 4（Vue 3 Composition API）
- **UI 庫**：NuxtUI
- **測試**：Playwright（E2E）
- **型別**：TypeScript strict mode
- **Lint**：ESLint + Prettier

---

## SDD 工作流程

Spec-Driven Development：從 Feature 規格驅動開發。

```
.dsl.feature（業務規格，外部產出，手動放入 spec/gherkin-feature/）
       ↓
.flow.md（外部產出，手動放入 spec/e2e-flows/）
       ↓
/feature-to-api  → types + mock API
       ↓
/test e2e spec   → .spec.ts（測試合約）
       ↓
/feature-to-ui   → UI 畫面（為通過 spec 而建）
       ↓
/test e2e green  → 修 UI 直到 spec 全過
```

---

## 可用指令

| 指令 | 用途 | 前置條件 |
|------|------|----------|
| `/feature-to-api` | Feature → 型別定義 + Mock API | `.flow.md` 已放入 `spec/e2e-flows/` |
| `/feature-to-ui` | Feature → 完整 UI 畫面 | `/feature-to-api` 已完成 |
| `/test e2e` | E2E 測試開發流程 | `.flow.md` 已放入 `spec/e2e-flows/` |
| `/nuxt-ui` | 載入 NuxtUI 官方文檔 | 無 |

---

## 規範索引

| 規範 | 檔案 | 載入時機 |
|------|------|----------|
| 程式碼品質驗證 | [rules/code-quality.md](rules/code-quality.md) | 修改 app/、server/ 程式碼時 |
| UI 實作規範 | [rules/ui-conventions.md](rules/ui-conventions.md) | 修改 pages/、components/、layouts/ 時 |
| UI 設定 | `spec/ui-config/ui-config.yaml` | UI 實作時讀取 |

---

## 專案結構

```
app/
├── components/       # Vue 元件
├── layouts/          # Layout
├── pages/            # 頁面路由
├── stores/           # Pinia stores
└── types/api/        # API 合約型別（由 /feature-to-api 產出）
server/
├── api/              # API 端點
└── mock/             # Mock 資料
spec/
├── gherkin-feature/  # .dsl.feature 規格檔
├── e2e-flows/        # .flow.md 測試流程
├── ui-config/        # UI 設定
└── report/           # route-map.yaml 等報告
test/
└── e2e/specs/        # Playwright 測試
```
