# Phase 5 模組級扇出

> **上位規範**：本檔講「怎麼扇出」，不判斷扇出算不算獨立驗證——那條界線見 [ops/model-dispatch.md](../../../ops/model-dispatch.md) 第 6 節「與並行無關」註記：worktree 扇出買的是 wall-clock，不是驗證意義上的獨立性。停下來問的判準一律回 [decision-tiers.md](decision-tiers.md) 與 [ops/judgment-rubrics.md](../../../ops/judgment-rubrics.md) 第 3 節，本檔不重列。

## 一、規模開關（可判定）

讀 `spec/report/route-map.yaml`，數 `routes[]` 陣列的筆數：

- **≤ 10** → 循序。沿用 Phase 5 既有流程（一次一頁、每頁完成後停下等確認），不套本檔
- **> 10** → 扇出。套用本檔流程

判定時機：Phase 4 完成、Phase 5 開工前判一次即可，不必等做到一半才改路線。

## 二、切面＝模組，不是頁面

扇出的切分單位是**模組**，不是頁面——頁面數再多，同模組的頁面也只派給同一個分身。

模組判定（依 `route-map.yaml` 可執行，不靠語意猜測）：

1. 走訪 `routes[]`，任兩個 route **共用至少一個 `features[].file`** 即視為同模組——只用這一個條件。`store` 欄位相同**不算**：`store: auth` 這類跨切面共用 store 會把全站不相關的頁面連成同一個模組，扇出等於沒扇出
2. 用連通分量（connected components）把整份 `routes[]` 分群，每群即一個模組
3. 模組頁數 = 該群組內 route 數量

**孿生頁規則**：共用同一套領域邏輯的成對頁面（例如同一個實體的兩個操作台頁面），連通分量演算法多半會因為共用 `features[].file` 而自動分進同一群。若分群結果把明顯共用邏輯的孿生頁拆散了（例如兩頁共用同一個 store 但剛好沒有共同的 feature 檔），人工合併成同一模組——演算法是預設判法，不是天條，發現分錯就手動修正，不要硬套。

## 三、隔離：git worktree

**不要**讓兩個分身在同一個目錄跑。原因：

- 本專案的 mock 資料是單一 dev server process 內的記憶體狀態，每個 spec 用 `test.beforeEach` 呼叫 `/api/__test__/reset` 重設（見 [test/e2e/references/setup.md:114](../../test/e2e/references/setup.md) 與 `:175-178`）
- 兩個分身共用同一個 dev server（同目錄、同 port）時，一個分身的 `beforeEach` reset 會把另一個分身跑到一半的測試資料清空，兩邊互打
- `playwright.config.ts:7-17` 的 port 是用 **worktree 根目錄路徑**做 hash 算出來的（3100–3499）——不同 worktree 天生拿到不同 port、跑各自的 dev server，資料互不影響；這正是 [README.md「多 issue 並行開發」](../../../../README.md)既有慣例的機制
- **殘餘風險**：hash 碰撞機率約 1/400（md5 前兩 byte 對映到 400 個 port）。dev server 起不來或 port 被佔用時視為異常——回報主線、換一個 worktree 目錄名重建，不要默默失敗或硬等

**做法**：每個分身用 Agent tool 派工時帶 `isolation: "worktree"`。這個參數會自動建立一份獨立 git worktree 副本給該分身工作，完成後把 worktree 路徑與分支名回傳（沒有改動則自動清掉，不留垃圾 worktree）。不必手動 `git worktree add`——那是 README 給「人開多個 CLI session」用的手動流程，Agent 扇出時用工具原生參數即可達到同樣的隔離效果。

## 四、前提順序

三項全滿足才扇出，缺一項就退回第一節的循序：

1. **Phase 1–4 地基完成**（layout、共用元件、路由骨架皆已就緒——地基是所有頁面的依賴，本質循序，不可扇出）
2. **[pitfalls.md](pitfalls.md) 存在**（`ls .claude/skills/feature-to-ui/references/pitfalls.md`）——由 issue #137 提案 1 產出；不存在時扇出不啟用、回退第一節的循序，否則每個分身各自重踩一次已知坑，扇出省下的時間全部賠回去
3. 上兩項都確認後才進入第五節交辦

## 五、交辦：每個分身一個 Agent 呼叫

**確認點的仲裁**：Phase 5 原規則「一次只做一個頁面，完成後停下等使用者確認」（見 [phase-5-pages.md](phase-5-pages.md)）在扇出模式下失效——分身沒有管道向使用者提問，逐頁停下會卡死整個模組。扇出模式下：**分身不逐頁停下等確認**，改成「該模組全部頁面的 spec 皆綠 ＋ 模組級回報（含每頁的一句對照表：頁面、spec 結果、關鍵取捨）」，等所有分身回報後，由主線在第六節「匯流」的第一步一次向使用者確認。確認點從「頁」升到「模組」，不是取消確認。

- **model**：`sonnet`（依 [ops/model-dispatch.md](../../../ops/model-dispatch.md) 第 3 節，實作類任務 sonnet 足夠）
- **isolation**：`"worktree"`（見第三節）
- **prompt**：依 [ops/delegation-templates.md](../../../ops/delegation-templates.md) 範本 2（實作），在驗收條件額外加一條：**「每頁做完立刻跑該頁對應的 spec 到綠，才算完成該頁，才可以動下一頁」**——這一條是 Phase 5 扇出版的核心規則，紅燈成因還在分身的短期記憶裡，當場修比事後靠別人考古便宜

範本套用範例（模組名、頁面清單、spec 路徑依實際 route-map.yaml 填入）：

```
第一步：worktree 建立後先跑 `npm install`（node_modules 與 .nuxt 不進 git，每個 worktree 要各自安裝），裝完才開始下面的任務。

任務：在 <模組內的 pages 清單> 實作 Phase 5 功能。
動機：Phase 5 模組級扇出，本模組與其他模組互不依賴，平行做以縮短 wall-clock；不平行的部分（Phase 1-4 地基）已完成。
規格：<模組內每個頁面對應的 test/e2e/specs/{NN}-{name}.spec.ts>，依 phase-5-pages.md 的必讀規範清單逐頁實作。
遵循：decision-tiers.md 三級表；ops/judgment-rubrics.md 第 3 節；rules.md [P5] 段；frontend-security.md；page-builder.md；spec/report/contract-facts.md（Step 0 合約事實：envelope 形狀、ID pattern、登入方式、種子總表、testid 慣例來源，直接引用不重查）。
禁止：修改凍結區；新增跨模組共用檔（見 decision-tiers.md 第三級，命中就停下來問）；假設其他模組已完成；逐頁停下等確認（見上方「確認點的仲裁」，改成模組級回報）。
驗收條件：每頁做完立刻跑該頁對應 spec 到綠才算完成該頁，完成後不停下、直接做下一頁；模組內所有頁面做完後，跑一次涵蓋本模組全部 spec 的指令（npx playwright test <本模組 spec 清單>）全綠才回報。
回報格式：改了哪些檔（檔案:行號）、每頁的 spec 執行結果對照表、worktree 路徑與分支名（供匯流步驟使用）。
```

（共通回報尾段見 [ops/delegation-templates.md](../../../ops/delegation-templates.md) 開頭「共通尾段」，逐字貼進每個分身的 prompt。）

## 六、匯流

1. 收集每個分身回報的 worktree 路徑與分支名
2. 主線（commander 所在分支）**逐一**處理每個分身的分支，一次一個，在**主線 worktree**執行。先移除該分身的 worktree——分支還被那邊 checkout 著時，主線 `git checkout` 會被拒（branch already used by worktree）：
   ```bash
   git worktree remove <分身 worktree 路徑>   # 分身有改動未 commit 會被拒，先確認它已 commit
   git checkout <分身分支>
   git rebase <主線分支>
   git checkout <主線分支>
   git merge --ff-only <分身分支>
   ```
   rebase 有衝突就停下回報，不自動解；確認這個分身乾淨合併後才處理下一個分身的分支——不要一次把所有分身的分支都合完再排錯，衝突會疊加，分不清是哪個分身造成的
3. 全部合併完，跑一次全量（`npm run test:e2e`，見 README.md 指令表），確認跨模組沒有互相影響
4. `spec/report/route-map.yaml` 理論上 Phase 5 不會被任何分身改動（它是 Phase 0 的產出，Phase 5 只讀不寫）。若合併時真的在這份檔案上出現衝突，視為異常訊號，停下來問，不要猜著解
