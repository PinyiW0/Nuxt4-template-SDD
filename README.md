# **（專案名稱）**

<!-- 📝 本檔是衍生專案的 README 模板，段落分三類：
- 含「📝」HTML 註解 ＝ 填空段：照指引填寫，填完刪除該註解
- 標「（可選）」 ＝ 條件段：用不到就整段刪除
- 其餘 ＝ 固定段：模板能力照用；內容與現況不符時回模板 repo 開 issue，不要只改自己這份
全部填完後刪除本註解。 -->

<!-- 📝 一句話定位：這是什麼系統、給誰用、核心場景講完；有前版專案就附連結。
範例：「jsjh-2025-frontend 的第二版，為棒球投球訓練數據的管理後台前端。教練端開啟練習、即時觀看雙鏡頭直播、逐球檢視投球軌跡與數據，並管理球隊／球員與歷史數據匯出。」
填完刪除本註解。 -->

（一句話講清楚：這是什麼系統、給誰用、解決什麼問題）

## 關於專案

### 功能模組

<!-- 📝 一個路由模組一列，職責一句話講完；開發中新增模組時同步補列。填完刪除本註解。 -->

| 模組 | 路由 | 職責 |
|------|------|------|
| （認證） | （`/login`） | （登入、權限守門） |
| （…） | （…） | （…） |

### 技術重點

<!-- 📝 每個模組挑「接手的人不先知道會踩雷」的實作決策寫一行——寫決策與取捨，不寫功能清單。
範例：「**練習**：SSE 事件驅動更新逐球清單；雙鏡頭 HLS 直播（無低延遲需求，採輕量穩定做法）」。
填完刪除本註解。 -->

- **（模組）**：（關鍵實作決策）

### 架構概覽

- **前端**：Nuxt 4（SSR）（管理後台／官網／…），以（REST／SSE／WebSocket）串接（後端框架）後端
- **資料來源**：單一環境變數 `NUXT_PUBLIC_API_BASE` 切換內建 mock／真後端（詳見[部署](#部署)）
- **開發法**：測試合約先行的 SDD（詳見 [SDD 開發流程](#sdd-開發流程)）

## 技術選型

> 清單之外更重要的是**理由**——接手時請先理解取捨，再動架構。

模板內建（衍生專案共通）：

- **Nuxt 4**（SSR + Composition API）— 內建 Nitro server 讓 `server/api/` 直接當 mock 後端，是「mock／真後端單變數切換」的地基
- **Nuxt UI**（含 Tailwind v4）— 官方深整合組件庫，配 `@theme` 對接設計稿變數，省去自建設計系統
- **Pinia + persistedstate** — 集中管理跨頁狀態（auth 等），token 跨重整存活（搭配 SSR cookie 策略）
- **zod** — 在 API 邊界做 runtime 驗證，守住 mock／真後端兩來源的型別契約
- **openapi-typescript** — `spec/api/api-spec.yml` 存在時跑 `npm run gen:api` 直接產型別，OpenAPI 為最高真相
- **Playwright** — E2E 為本模板 SSOT，需真實瀏覽器跑業務流程合約
- **Vitest** — composables／utils 層的單元測試

<!-- 📝 專案新增的依賴補在下方，一行一個「套件 — 為什麼選它」；理由寫給接手的人看。
範例：「**hls.js** — 解雙影片 HLS 直播串流（瀏覽器原生不支援時）」。沒有新增就刪除整個「專案新增」小段。 -->

專案新增：

- （套件 — 選用理由）

### 規範工具

- [@antfu/eslint-config](https://github.com/antfu/eslint-config)（主 ESLint 規則集）
- [@nuxt/eslint](https://eslint.nuxt.com/)（Nuxt 整合，含 Vue / TS 規則）
- [Prettier](https://prettier.io/)（含 prettier-plugin-tailwindcss class 排序）
- [commitlint](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional) + husky（commit-msg / pre-push 守門）

### 關鍵慣例（最常踩雷，務必遵守）

- 一律 `<script setup lang="ts">`，禁止 Options API
- Props / Emits 用 type-based 宣告，禁止 runtime 宣告
- Pinia store 採框架預設 auto-import（`@pinia/nuxt`），不強制手動 import
- 讀取用 `useFetch`、寫入用 `$fetch`，禁止混用；禁止 `globalThis.$fetch` 繞過型別檢查
- E2E 測試 step 用中文描述
- 完成程式碼修改後必跑 `npm run eslint` + `npm run typelint`，修完才算完成

## 專案結構

> 部分目錄由 SDD 指令產出後才出現（見各行註解）；模板初始狀態沒有它們是正常的。

```
app/
├── api/                        # 前端 client 包裝層（*.api.ts；/feature-to-api 產出）
├── components|layouts|pages/   # UI（vibe 守則管轄；/feature-to-ui 產出）
├── composables|utils/          # 共用邏輯（useHttp 等）
├── stores/                     # Pinia stores（/feature-to-ui 產出）
├── types/api/                  # API 合約型別（/feature-to-api 產出）
└── assets/                     # 樣式與靜態資源
server/
├── api/                        # 內建 mock 後端（/feature-to-api 產出；NUXT_PUBLIC_API_BASE 同源時命中）
└── mock/                       # Mock 資料（/feature-to-api 產出）
spec/                           # SDD 規格來源
├── gherkin-feature/            # .feature 業務規格（外部產出置入，凍結）
├── api/                        # OpenAPI spec（存在時為最高真相）
├── e2e-flows/                  # .flow.md 流程＋Business Invariants（/feature-to-flow 產出，凍結）
├── ui-config/                  # UI 設定與設計參考
└── report/                     # route-map.yaml 等產出報告
test/
├── e2e/specs/                  # 主 E2E 測試合約（SSOT，凍結，勿改）
├── e2e/vibe/                   # vibe 微調驗證（不凍結，去留由人決定）
└── unit/                       # Vitest 單元測試
.claude/                        # AI 協作制度（skills／rules／ops）
```

## SDD 開發流程

本模板不是「先寫 UI 再補測試」，而是**測試合約先於 UI**。AI 協作指令總表見 [`.claude/CLAUDE.md`](.claude/CLAUDE.md)，隨時可跑 `/sdd-status` 盤點進度。

```
spec/gherkin-feature/*.feature   ← 業務規格（外部產出，手動放入）
spec/api/api-spec.yml            ← OpenAPI（若有則為最高真相）
        │ /feature-to-flow
        ▼
spec/e2e-flows/{NN}-{module}.flow.md   ← Business Invariants + UX-agnostic 流程
        │ /feature-to-api
        ▼
app/types/api · server/mock|api · app/api/*.api.ts · route-map.yaml
        │ /test e2e spec
        ▼
test/e2e/specs/*.spec.ts          ← 測試合約（SSOT，凍結）
        │ /feature-to-ui
        ▼
app/pages · components · layouts · stores   ← 為通過合約而生
        │ /test e2e green
        ▼
全綠（npm run test:e2e）→ 部署
```

### Vibe UI 守則（改 UI 必讀）

UI 可以自由微調（顏色、間距、layout、按鈕形式、table/card 呈現…），但**不得破壞 Business Invariants**：

- **不得修改** `test/e2e/specs/`、`spec/gherkin-feature/`、`spec/e2e-flows/`（主 spec 凍結，SSOT 政策）
- 業務實體要可被使用者識別（用業務語意欄位）、業務狀態文字要保留語意、業務操作要有可達路徑
- **vibe 完、commit 前必跑** `npm run test:gate`（綠燈＝安全，pre-push 跑同一份）
- 若非破壞合約無法達成目標——**停下來問人**，不要擅自改主 spec

三份 Playwright config：`playwright.config.ts`（主 spec）、`playwright.gate.config.ts`（守門＝主 spec＋vibe spec）、`playwright.vibe.config.ts`（只跑 vibe）。

## 專案資訊

### 資源

<!-- 📝 沒有的項目標 _（此專案無提供）_，不要留空——留空看起來像忘了填。填完刪除本註解。 -->

- 流程圖： （流程圖連結）
- 設計稿： （設計稿連結）
- 後端文件： （後端文件連結）
- Slack： （Slack 連結）
- Asana： （Asana 連結）

### 環境

- node 版本 : `>=22.12.0`（見 package.json `engines`）
- 編輯器 : `VSCode`

### VSCode 套件

- [VS Code](https://code.visualstudio.com/)
- [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)
- [Vue 3 Snippets](https://marketplace.visualstudio.com/items?itemName=hollowtree.vue-snippets)
- [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Goto definition alias](https://marketplace.visualstudio.com/items?itemName=antfu.goto-alias)

### 啟動指令

```
npm install            // 安裝套件
npm run dev            // 啟動 dev（預設 mock，http://localhost:3000）
npm run build          // SSR 打包
npm run generate       // SSG 打包
npm run preview        // 啟動打包後專案
npm run eslint         // ESLint 檢查
npm run typelint       // 型別檢查（nuxi typecheck）
npm run gen:api        // OpenAPI → API 型別（讀 spec/api/api-spec.yml）
npm run test:unit      // Vitest 單元測試
npm run test:e2e       // Playwright 主 E2E 合約（--headed／--ui 變體見 package.json）
npm run test:gate      // 守門（主 spec＋vibe spec，pre-push 跑同一份）
npm run test:vibe      // 只跑 vibe spec
```

## 多 issue 並行開發（git worktree）

一個 issue 一個 worktree，多個 CLI session 才不會在同一目錄互踩（source、`.nuxt`、git 分支天然隔離）：

```bash
git worktree add ../nuxt4-template-issue-40 'feature/#40-xxx'
cd ../nuxt4-template-issue-40 && npm install
```

- `.env` 是 git tracked，worktree checkout 自帶，無需手動複製
- E2E dev server port 由 worktree 路徑自動推導（3100–3499，gate/vibe config 繼承同一 base 推導，不各自重算）：各 worktree 不互撞，同 worktree 重跑重用同一 server（快）；萬一兩個 worktree 撞到同一個 port（機率 1/400），換個 worktree 目錄名即換 port
- port 隔離只管 E2E 起的 server；**手動 `npm run dev` 固定跑 3000**，多個 worktree 同時手動 dev 要自帶 port 錯開：`npm run dev -- --port 3001`
- pre-push gate 走 Docker（`scripts/docker-gate.sh`，production build 隔離 + ephemeral port），多 session 同時 push 也不互撞；Docker 沒開時自動 fallback 本機模式並警告
- 兩條線都動了 API 層時，`spec/report/route-map.yaml`（機器產的單檔 SoT）merge 必衝突：**不手動解衝突**——晚合併的分支先 rebase main，再重跑 `/feature-to-api` 重新產出 route-map
- 收工清理：`git worktree remove ../nuxt4-template-issue-40`

## 專案建立步驟

### GitHub 設定

- General
  - Pull Requests
    - Allow squash merging : `Default to pull request title and commit details`

### 開發步驟

- 建立 `feature/#1-basic` 分支
  - 手動執行專案初始化設定
    - package.json
      - name : `${GitHub 專案名稱}`
    - README.md
      - 照本檔各 📝 註解填寫專案名稱與專案資訊，填完刪除註解
    - Slack 綁定
      - 在 `#team-front-end-develop` 群組中輸入 `/github subscribe ${owner}/${repo}` 即可將進行綁定，未來群組成員可以收到 `issues`, `pulls`, `commits`, `releases`, `deployments` 相關的訊息。
      - 若專案結束，輸入 `/github unsubscribe ${owner}/${repo}` 即可解除綁定。
      - 若要綁定其他 Slack 群組，需要在該群組選項 `Integrations/Apps` 中新增 `Github`，並重複以上操作即可。
  - 部署設定詳見[部署](#部署)段；SSG 靜態站需求見其中「Azure Blob Website 自動部署」

> 技術選型、專案結構與開發慣例見開頭各段；`.feature` 規格置入 `spec/gherkin-feature/` 後從 `/feature-to-flow` 開始開發（見 [SDD 開發流程](#sdd-開發流程)）。

## 部署

用**一個變數** `NUXT_PUBLIC_API_BASE` 切換資料來源，不靠 `NODE_ENV`、不靠多份 config：

- **同源 `/api`（預設）** → 請求打回 Nuxt 自己 → 命中內建 mock（`server/api/`）
- **絕對 URL** → 請求打到真後端 → 接真實 DB

**fail-safe：mock 是預設**，要碰真資料一定得刻意改設定。

```bash
# 本機 dev（mock，零設定）
npm install
npm run dev                                            # http://localhost:3000

# 本機 dev 接真後端（比對真資料／debug 線上）
NUXT_PUBLIC_API_BASE=https://<真後端位址>/api npm run dev

# Docker（讀 .env 的 PROJECT_NAME／IMAGE_TAG／HOST_PORT）
docker compose build
docker compose up -d                                   # http://localhost:${HOST_PORT}（預設 3000）
```

<!-- 📝 專案定案的部署形態寫在這：自訂的具名指令（如 jsjh 的 dev:prod-api／docker:prod，模板未內建）、
正式機部署步驟、交付方式（雲端／地端離線）、遠端開發機（tmux）等，寫到「照抄指令就能部完」的程度。
可參考 jsjh-2026-frontend README 的部署段寫法。填完刪除本註解。 -->

### 設定檔職責

| 檔案 | 進版控 | 內容 |
|------|--------|------|
| `.env` | ✅ | `PROJECT_NAME` / `IMAGE_TAG` / `HOST_PORT`；`NUXT_PUBLIC_API_BASE` 預設 `/api`＝mock |
| `docker-compose.yml` | ✅ | 唯一服務定義；名稱與 tag 由 `.env` 控制，換專案只改 `.env` 不動此檔 |
| `nuxt.config.ts` | ✅ | `runtimeConfig` 預設值（`apiBase`、`apiEnvelope`），正式由 env 覆蓋 |

> **鐵則**：committed 的 `.env` **零機敏**。機敏值只走 runtime 注入，絕不進版控；`.env` 不進 image（已被 `.dockerignore` 排除），只在 host 端被 docker-compose 讀取。
> `.env` 是刻意加入 git 追蹤的（`.gitignore` 的忽略不影響已追蹤檔），勿 `git rm --cached` 移出——worktree「checkout 自帶 `.env`」靠的就是它。
> 後端回 envelope（`{ success, data, message, meta }`）維持預設即可；裸 schema 後端設 `NUXT_PUBLIC_API_ENVELOPE=false`（`useHttp` 依此決定拆不拆外層）。

### 機敏值注入（可選）

`docker-compose.yml` 已示範對 `NUXT_PRIVATE_GOOGLE_SHEET_KEY` 做同名 passthrough——部署機 export 後再起服務，不進版控也不進 image：

```bash
export NUXT_PRIVATE_GOOGLE_SHEET_KEY='真正的 key'
docker compose up -d
```

要啟用時需在 `nuxt.config.ts` 的 `runtimeConfig` 補上對應 server-side key（模板僅留 passthrough 示範，未定義該 key）；其他機敏值照此模式增加。

### 版本號／回滾

image 以 `.env` 的 `IMAGE_TAG` 標記（`${PROJECT_NAME}-frontend:${IMAGE_TAG}`），與 git 版本綁定即可回滾：

```bash
IMAGE_TAG=$(git describe --tags --always) docker compose build   # build 時綁 git 版本
IMAGE_TAG=<舊版 tag 或 sha> docker compose up -d                 # image 還在時直接回滾，不必重 build
```

### Azure Blob Website 自動部署（可選）

> SSG 靜態站（`npm run generate`）走 CI 部署到 Azure Blob 時才留本段；用 Docker SSR 部署就刪除。

- Azure Storage Account 設定
  - 請先自行在指定 resource group 底下開設 storage account，並且設置 static website active
  - 確認 resource group 位置後，需要向 resource group 權限管理者去索取一個 JSON 檔來進行 RBAC
  ([reference](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-static-site-github-actions?tabs=userlevel#generate-deployment-credentials))
- GitHub Repo 設定
  - 移動至 `Settings > Security > Secrets and variables > Actions > Repository secrets` 將上述 JSON 檔貼上，並取變數名為 `AZURE_CREDENTIALS` (Beta 為 `AZURE_CREDENTIALS_BETA`)
  - 移動至 `Settings > Security > Secrets and variables > Actions > Repository variables` 將 Azure storage account name 貼上，並取變數名為 `ACCOUNT_NAME`（Beta 為 `ACCOUNT_NAME_BETA`）

### 測試帳號

<!-- 📝 至該專案的共用雲端表（Google Sheets）登記測試帳號，再把連結貼進下行；無就標 _（此專案無提供）_。填完刪除本註解。 -->

請至[雲端連結](（該專案測試帳號表連結）)查詢

## GitHub 流程

> Issue／Commit／PR 三站已封裝成 AI 指令：`/new-issue`（建 issue＋綁 linked 分支）、`/commit`（SDD 階段分群＋訊息草案）、`/pr`（push＋PR 草案＋自動 `Closes #N`）。skill 內建下列慣例且一律先出草案待確認——日常直接用指令，以下規範供手動操作與 review 時對照。

### 流程

- 預設使用 `GitHub Flow` 流程
- main：主要分支（開發環境）
- tag：部署版本（正式環境）
- 多環境情境
  - 建立其他分支代表特定環境（ex. 建立 produciton 分支代表正式環境）
  - 若需進行更新
    - 使用 `git merge main --no-ff` 的方式合併 main 分支改動
- 多版本維護情境
  - 建立 `release/${主版號}.${次版號}` 分支維護單一版本
  - 若需進行更新（適用所有版本）
    - 建立分支並合併至 main
    - 使用 `git cherry-pick` 的方式從 main 分支更新改動
  - 若需進行更新（僅適用此版本）
    - 建立分支並合併至 release

### Issues

- 建議用 `/new-issue` 一鍵完成本節（issue＋linked 分支，含重複 issue 檢查與驗收標準代擬）
- 填寫標題、說明和標籤類型
- 指派至少一名負責人
- 建立分支
  - 右下角點擊 `Create a branch`
  - Main 分支改動 : `feature/#${issue_number}-${description}`
  - 特定 Release 分支改動 : `feature/${主版號}.${次版號}-#${issue_number}-${description}`
  - GitHub 原生 `${issue_number}-${description}` 格式（Create a branch 預設名）`/pr` 也能解析，但慣例以上列格式為準

### Commits

- 建議用 `/commit` 產生符合慣例的 commit（依 SDD 階段分群、Conventional Commits 訊息，草案確認後才提交）
- 只開發對應 Issue 的內容，不相關的內容請另開 Issue
- 複雜邏輯應適當註解
- 定期同步主分支
  - Main 分支為主分支 : `git merge main --no-ff`
  - 特定 Release 分支為主分支 : `git merge release/${主版號}.${次版號} --no-ff`
- 通過 `commitlint` 檢查

### Pull Requests

- Author
  - 建議用 `/pr` 完成發 PR（push＋繁中草案＋`Closes #N`＋assignee 預設自己）
  - reviewer 至少掛 **Copilot＋一名協作者**——`/pr` 已內建：草案階段列協作者候選（含 Copilot）請你挑，明說不掛才略過；也可直接在指令指明（例：`/pr 找 alice review，加 copilot`）
  - 標題、功能說明和標籤類型填寫正確且清楚
  - 通過 CI 檢查
  - 填寫測試清單
  - 指派至少一名 Code Review 負責人
- Reviewer
  - 確認標題、功能說明和標籤類型填寫符合對應 Issue
  - 確認目標合併分支正確
  - 進行 Code Review 確認是否符合開發規範
  - 確認通過測試清單
  - 使用 `Squash and Merge` 模式合併
  - 確認通過 CI/CD 且成功合併及部署

### Releases

- Choose a tag
  - 版本號 : `v${主版號}.${次版號}.${修訂號}-${測試環境}.${測試版號}`
    - 主版號 : 不可相容的功能新增或修改
    - 次版號 : 可相容的功能新增或修改
    - 修訂號 : 可相容的功能問題修復
    - 測試環境（選填）: alpha (內部)、beta (外部)
    - 測試版號（選填）: 內部或外部測版號
- Target
  - 選擇 `main` 或 `release`
- 填寫標題及改動說明
  - 可點擊 `Generate release notes` 自動產生
