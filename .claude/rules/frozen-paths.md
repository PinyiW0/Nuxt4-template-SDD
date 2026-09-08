---
paths:
  - "test/e2e/specs/**"
  - "spec/gherkin-feature/**"
  - "spec/e2e-flows/**"
---

# 主 spec 凍結（SSOT 政策）

**你正在修改的路徑屬於凍結區。停下來。**（唯讀讀取不受限，本規則管的是修改與刪除）

> 技術強制：`.claude/hooks/frozen-paths-guard.mjs`（PreToolUse hook）會擋下凍結區**既有檔**的 Edit/Write/NotebookEdit 與 Bash 寫入（`sed -i`、`tee`、`cp`、`mv`、重導向等，含 subagent 內；大小寫變體與 symlink 繞道一併攔截）；**新增全新檔**放行（授權產出流程不受影響）。本規則的 paths 觸發僅在主對話生效、subagent 內不注入（2026-07-06 實測），hook 才是實際防線。
>
> **一次性授權通道**：正規產出流程（`/feature-to-flow` 的 flow 覆寫、`/test e2e spec` 的 spec 全量重生）經使用者確認後，寫檔前先建 `.claude/tmp/frozen-allow.json`（格式 `{ "reason": "<為何覆寫>", "files": ["<repo 相對路徑>", ...] }`），hook 對清單內目標放行**一次**並自動從清單移除（清空即刪檔）。此通道僅限上述流程在使用者確認後使用，不得為繞過凍結而自行寫 sentinel。
>
> **凍結路徑清單以 hook 內的 `FROZEN` 陣列為準**——新增／移除凍結區時，hook、本檔 frontmatter paths 與下表三處必須同步改。

| 凍結路徑 | 內容 | 誰能改 |
|----------|------|--------|
| `test/e2e/specs/` | 主 spec（測試合約，UI 的唯一真理） | 只有 `/test e2e spec` 流程在使用者確認下產出；vibe / UI 修改絕不可動 |
| `spec/gherkin-feature/` | `.feature` 業務規格（外部產出，含 `.dsl.feature` 變體與上游 codegen 匯出） | 外部置入（使用者手動或上游腳本產出），AI 不改 |
| `spec/e2e-flows/` | `.flow.md`（business invariant + E2E 流程） | 只有 `/feature-to-flow` 流程產出，下游不回頭改 |

如果任務看起來「不改凍結檔就做不到」：

1. 不要改。先停。
2. 把衝突具體說明給使用者：哪條 invariant／哪個 spec 擋住了什麼目標。
3. 列出選項讓使用者決定（例如：調整目標、走正規 spec 變更迭代流、或由使用者自行修改規格）。

> 唯一例外：使用者明確指示走「spec 變更迭代流」（見 `.claude/CLAUDE.md` SDD 段），此時由對應 skill 依流程更新，仍需使用者逐步確認。

## 已知繞道與修補紀錄

guard 覆蓋面的回歸清單，發現新繞道就補一列，修補後保留紀錄不刪。

| 日期 | 繞道方式 | 現況 |
|------|----------|------|
| 2026-08-24 | `perl -pi`／`ruby -i` 等就地改檔工具未在 `bashFrozenWrites()` 的寫入判斷內（原判斷寫死 `sed`），可繞過 guard 改到凍結區既有檔 | 已修補：`INPLACE_TOOLS`／`INPLACE_FLAG` 通用判斷涵蓋 sed／perl／ruby／gsed（issue #129） |
| 2026-09-08 | `python3 - <<'PY' … write_text(…) … PY` 等直譯器 heredoc：逐段判斷以 `\n` 切段，直譯器詞在首行、寫入 API 在後續行，兩段各自看都不像寫入，可繞過 guard 改到凍結區既有檔；且漏放不經過 `tryConsumeSentinel`，sentinel 不會被消耗 | 已修補：新增 `SCRIPT_INTERPRETERS`／`SCRIPT_WRITE_API`，對整條指令（不切段）判斷，涵蓋 `SCRIPT_INTERPRETERS` 全部（python/node/ruby/perl/php/deno/bun/tsx/ts-node/vite-node）（issue #137） |
| 2026-09-08（同日對抗審查） | 上一版「命中即整條指令 flood」誤攔過廣：凍結區檔案只是被 `git diff`／`open()` 唯讀讀取、寫入目標其實在別處時，也會被當成寫入擋下（SDD 管線常見寫法：讀 flow/feature 產出 route-map／型別） | 已修補：`SCRIPT_WRITE_API` 每項拆成 `{ detect, capture }`，capture 抓到字面值路徑時只擋該路徑；抓不到（引數是變數／`os.path.join(...)` 等運算式）才回退整條指令 flood（issue #137） |
| 2026-09-08（同日第二輪對抗審查） | ①切段不認引號：`sed -i '' 's/a/b/;s/c/d/' <凍結檔>` 被 `;` 切散，動詞與目標分屬兩段而漏放 ②`1 << 8` 位元左移被當 heredoc，把後續指令整包吞掉 ③`open()` 的 mode 引數後還有 `encoding=` 等引數時判不出寫入 ④`renameSync`／`rmdirSync`／`fs.truncate`／`os.symlink` 等 API 漏列 ⑤rename／move 的來源是凍結檔（搬走＝刪除）沒擋 ⑥mode 字元類用無界量詞，長輸入回溯爆炸（ReDoS） | 已修補：切段改逐字元掃描、引號內分隔符不算；heredoc 終止符必須緊接 `<<`；mode 後允許 `[,)]`；補齊 API 清單；rename／move 兩個引數都當目標（copy 只算目的地）；mode 字元類改有界量詞（80KB 惡意輸入實測 80–120ms）。回歸測試見 `test/unit/frozen-paths-guard.spec.ts` |
| 2026-09-08（同日第三輪對抗審查） | ①`p='<凍結檔>'; python3 -c "open('$p','w')"`：`'$p'` 被 capture 當成字面值路徑抓走，比不中凍結區而漏放 ②反向誤攔：API 名只是被「提及」（grep 樣式 `"createWriteStream("` 引號未閉合、commit 訊息裡的 `writeFileSync(...)`）時 capture 抓不到，被誤判成動態呼叫而整條 flood | 已修補：含 `$` 的引號字串不算字面值（退回 flood）；detect 命中後加驗第一引數形狀（`CALL_ARG`）——閉合的引號字串或識別字／`$` 變數／運算式開頭才算呼叫，`.`／`)`／閉不起來的引號一律算提及 |

### 已知極限（擋不住，只能靠 Bash 權限策略或人審補位）

本 hook 是純文字靜態解析，不是執行期分析。下列手法一律繞得過，別把 hook 當成唯一防線：

1. 先把腳本寫到 `/tmp` 等非凍結路徑，再另開一條指令執行該腳本檔；或腳本帶 shebang 直接 `./script.py` 執行（指令原文看不到直譯器詞）
2. 指令或腳本內容先 base64／其他編碼再解碼執行；動態組出函式名（`getattr(p, 'write' + '_text')`）
3. 路徑由運算式組出——f-string、`Path(dir) / name`、字串拼接、shell 變數拆兩段（`T=test/e2e; python3 -c "open('$T/specs/x','w')"`）。capture 抓不到字面值時雖會退回 flood，但路徑沒有以字面值出現在指令原文時，flood 也無從比中
4. 引號內含 shell 分隔符只認成對的單／雙引號（涵蓋常見 sed／perl 形式）；跳脫引號（`\'`）、`$'...'`、巢狀引號仍可能被誤切段
5. `vim -es`／`emacs --batch`／`awk -i inplace` 這類編輯器不在寫入動詞清單內
6. flood 命中時擋出來的是「指令原文裡比中凍結路徑的 token」，可能是目錄或 glob 字串而非檔案——要走 sentinel 授權時，`files` 要照 hook 訊息列出的字串填
7. `tool_input.command` 不是字串（缺欄位或型別不對）時直接放行
8. fail-open 設計：hook 內部 throw 時 node 以 exit 1 結束，Claude Code 視同非阻斷（寧可放行，不讓鎖壞掉癱瘓所有編輯）
9. 含 `$` 的引號字串只在 `open()` 系列的 capture 被排除；`renameSync`／`writeFileSync`／`shutil.*` 等其他 API 的 capture 仍把 `'$p'` 當字面值路徑，`p=<凍結檔>; node -e "require('fs').renameSync('$p',…)"` 這種形狀會漏放（2026-09-08 回歸實測）
