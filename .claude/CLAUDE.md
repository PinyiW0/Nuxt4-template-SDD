# Nuxt 4 專案模板

> 本檔只當索引：一段一主題、每主題給路由。細節在引用檔，**照載入時機讀，不要全部預讀**。

## 技術棧

Nuxt 4（Vue 3 Composition API）+ NuxtUI + TypeScript strict + Playwright E2E + ESLint/Prettier。
框架 skill 裁決（pinia auto-import、Nuxt 4 vs skill 3.x 落差）→ 修改 .vue／store／composable 時自動載入 `rules/framework-skills.md`。

## SDD 工作流程

Spec-Driven Development：從 Feature 規格驅動開發。

```
.feature（業務規格，外部產出置入 spec/gherkin-feature/，含 .dsl.feature 變體）
       ↓
/feature-to-flow → .flow.md（business invariant + UX-agnostic E2E 流程）
       ↓
/feature-to-api  → types + mock API
       ↓
/test e2e spec   → .spec.ts（測試合約）
       ↓
/feature-to-ui   → UI 畫面（為通過 spec 而建）
       ↓
/test e2e green  → 修 UI 直到 spec 全過
```

- **spec 變更迭代流**（後端更新 api-spec 時）：新 `api-spec` 置入 → `/feature-to-api`（Sync）→ `/test e2e spec` → `/feature-to-ui`（Sync）→ `/test e2e green` → Gate 回歸。詳見 `.claude/skills/feature-to-api/references/openapi-codegen.md`
- **條件式跨切面關注點**（auth / realtime / streaming / rbac，偵測到才生）：由 `/feature-to-api` Phase 0 偵測寫入 `route-map.yaml`。rbac 合約見 `.claude/skills/feature-to-api/references/rbac-scaffold.md`；角色名一律從 spec 萃取、不寫死
- **多 session 並行**：一個 issue 一個 git worktree，E2E port 自動推導不互撞。詳見 README「多 issue 並行開發」

## 紅線（一律生效）

- `test/e2e/specs/`、`spec/gherkin-feature/`、`spec/e2e-flows/` 凍結——修改這些路徑時 `rules/frozen-paths.md` 會載入，照它處理（唯讀不受限）
- 修改 UI 檔案時遵守 `rules/vibe-ui.md`（Business Invariants 不可破壞）
- 完成程式碼修改後必跑 `npm run eslint` + `npm run typelint`；vibe 完 commit 前必跑 gate config

## 可用指令

| 指令 | 用途 | 前置條件 |
|------|------|----------|
| `/new-issue` | 建 issue + 綁定 linked 分支 | gh 已認證 |
| `/feature-to-flow` | Feature → `.flow.md` | `.feature` 已放入 `spec/gherkin-feature/` |
| `/feature-to-api` | Feature → 型別 + Mock API | `.flow.md` 已放入 `spec/e2e-flows/` |
| `/feature-to-ui` | Feature → 完整 UI 畫面 | `/feature-to-api` 已完成 |
| `/test e2e` | E2E 測試開發流程 | `.flow.md` 已放入 `spec/e2e-flows/` |
| `/vibe-check` | Gate 守門（主 spec + vibe spec） | vibe 完 UI 後、commit 前 |
| `/vibe-setup` | vibe diff 分層標記測試 pattern | `/vibe-check` 綠燈 |
| `/vibe-e2e` | 生成 `test/e2e/vibe/*.spec.ts` 並跑 | `/vibe-check` 綠燈 |
| `/nuxt-ui` | 載入 NuxtUI 官方文檔 | 無 |
| `/sdd-review` | 審查 diff 的框架語意與邏輯安全 | 有 .vue/store/server 改動 |
| `/commit` | 依 SDD 階段分群產生 commit | 有改動 |
| `/pr` | push → PR 草案 → 建 PR | 已 commit、不在 main |

## AI 作業制度（.claude/ops/）

核心三原則：**指揮官不下場**（粗活派便宜 subagent）、**驗證不自驗**（fresh-context 審查）、**隨做隨存**（檔案是唯一真理）。

| 檔案 | 內容 | 載入時機 |
|------|------|----------|
| [ops/model-dispatch.md](ops/model-dispatch.md) | 模型調度：交辦三要素、model/effort 指定、升降級、回報合約 | 要派 subagent 或多步驟任務開工前 |
| [ops/judgment-rubrics.md](ops/judgment-rubrics.md) | 判斷 rubric：何時升級／算完成／停下來問／換路／驗品質 | 拿不定主意時 |
| [ops/delegation-templates.md](ops/delegation-templates.md) | 交辦 prompt 範本（搜尋/實作/重構/研究/審查） | 撰寫 subagent prompt 時 |
| [ops/maintenance.md](ops/maintenance.md) | 維護協議：哪些檔可自改、教訓寫回哪、精簡時機 | 要改 .claude/ 下任何檔前 |
| [ops/diagnosis.md](ops/diagnosis.md) | 本 harness 三大漏洞與修法 | 想知道制度為什麼這樣設計時 |
| [ops/letter-to-future.md](ops/letter-to-future.md) | 給未來 session 的交接信 | 新 session 接手大任務前 |

## 規範索引

| 規範 | 檔案 | 載入時機 |
|------|------|----------|
| 程式碼品質驗證 | [rules/code-quality.md](rules/code-quality.md) | 修改 app/、server/ 程式碼時（自動） |
| UI 實作規範 | [rules/ui-conventions.md](rules/ui-conventions.md) | 修改 pages/、components/、layouts/ 時（自動） |
| Vibe UI 守則 | [rules/vibe-ui.md](rules/vibe-ui.md) | 同上（paths 觸發，未實測） |
| 主 spec 凍結 | [rules/frozen-paths.md](rules/frozen-paths.md) | 修改凍結區時（paths 觸發，未實測） |
| 框架 skill 裁決 | [rules/framework-skills.md](rules/framework-skills.md) | 修改 .vue／store／composable 時（paths 觸發，未實測） |
| UI 設定 | `spec/ui-config/ui-config.yaml` | UI 實作時讀取 |
| Business Invariants | `spec/e2e-flows/*.flow.md` 開頭段 | Vibe UI 前必讀 |

## 專案結構

```
app/
├── components|layouts|pages/   # UI（vibe 守則管轄）
├── stores/                     # Pinia stores
└── types/api/                  # API 合約型別（/feature-to-api 產出）
server/
├── api/                        # API 端點
└── mock/                       # Mock 資料
spec/
├── gherkin-feature/            # .feature（凍結）
├── e2e-flows/                  # .flow.md（凍結）
├── ui-config/                  # UI 設定
└── report/                     # route-map.yaml 等
test/e2e/specs/                 # 主 spec（凍結）
.claude/
├── ops/                        # AI 作業制度
├── rules/                      # 路徑觸發規範
└── skills/                     # 指令與框架知識
```
