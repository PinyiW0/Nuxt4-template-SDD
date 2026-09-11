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
| 2026-09-11（PR #141 Copilot review 第 1、2、4、6 輪） | ①heredoc 內文固定併給該行最後一段：`patch -p1 <<'EOF' && echo done` 的內文歸到 `echo` 段，`patch` 段拿不到凍結路徑而漏放 ②`<< EOF`（`<<` 後接空白）不被辨識為 heredoc，內文直接被逐行切散 ③`Path(...).open('r+')`：Path.open 只認 `['"][wax]`，`r+`／`rb+` 等可寫模式漏放 ④單一 `&`（背景執行）不切段：`echo hi & tee <凍結檔>` 整條併一段，`tee` 不在指令位置而漏放 | 已修補：heredoc 內文歸「含 `<<` 開啟符的那一段」（`heredocTerminators` 與 `splitSegments` 共用同一套引號感知，`node -e "a << b"` 引號內的 `<<` 不算開啟符）；`HEREDOC_OPEN` 放寬為 `<<-?\s*`（終止符仍限識別字開頭，`1 << 8` 不受影響；另排除 here-string `<<<`）；Path.open 的 mode 改共用 `MODE`（含 `mode='w'` 關鍵字形式）；單一 `&` 也當分隔符，`>&`／`<&`／`&>`／`&>>`（含 `2>&1`）這類 fd 重導向除外。四案由 `it.fails` 轉回正常 `it`，見 `test/unit/frozen-paths-guard.spec.ts` |
| 2026-09-11（PR #141 Copilot review 後續輪） | ①`MODE` 缺 `t`：Python `'wt'`／`'at'` 文字寫入模式漏放 ②`OPEN_ARGS` 上限 120 太小，第一引數稍長的合法運算式讓整個 `open()` 呼叫對 hook 隱形 ③`OPEN_FIRST_ARG` 把數字當識別字，`open(1,'w')` 誤判成動態呼叫，flood 誤擋同指令內單純被提及的凍結路徑 ④`HEREDOC_OPEN` 終止符限定識別字開頭，數字終止符 `<<1` 判不出來 ⑤重導向偵測只認 `>`／`>>`，`>&` 漏放 ⑥⑦`commandVerbs()`／`gitWriteSubcmd()` 都只認 wrapper 後緊接的下一個 token 當子指令：`sudo -u alice rm`、`git --work-tree /tmp checkout` 這類「wrapper 帶了一個吃值的選項」會把動詞／子指令往後推而漏放 | 已修補：`MODE` 的 `t` 只放進兩側可選字元類（`'rt'` 仍不算寫入）；`OPEN_ARGS` 上限放寬到 2000（仍有界，ReDoS 風險不變）；`OPEN_FIRST_ARG` 第二分支改 `[^\d\W]`；`HEREDOC_OPEN` 拆成數字／識別字兩分支（`<< 1` 數字終止符前有空白仍判不出來，見已知極限第 13 條）；重導向 regex 加 `>&`／`&>`／`&>>`；`commandVerbs()`／`gitWriteSubcmd()` 都改成先跳過吃值旗標（`WRAPPER_VALUE_FLAGS`／`GIT_VALUE_FLAGS`）再找子指令位置 |
| 2026-09-11（PR #141 Copilot review round 13） | ①上一輪的數字 heredoc 終止符（`<<1`）誤判 `$((1<<1))` 這種算術展開，把換行後真正的寫入指令吞成「heredoc 內文」而漏放——是上一輪修補的迴歸 ②`WRAPPER_VALUE_FLAGS` 沒收 xargs 的 `-I`，`xargs -I {} rm <凍結檔>` 的 `{}` 被誤判成子指令，`rm` 判不出來 | 已修補：`heredocTerminators()` 加追蹤 `$(( ))`／`(( ))` 括號深度，深度 >0 時的 `<<` 一律不當 heredoc 開啟符；`WRAPPER_VALUE_FLAGS` 補上 `-I`／`--replace` |
| 2026-09-11（PR #141 收尾） | 直譯器偵測誤擋：`hasScriptInterpreter` 對整條指令所有 token 掃，`grep -R "node writeFileSync('<凍結檔>')" .`（唯讀搜尋）與 `cat > /tmp/doc <<'EOF'`（heredoc 內文提到 python3 與 API、實際寫到 /tmp）都被當成真的在跑直譯器而擋下 | 已修補：`hasScriptInterpreter` 改成只認指令位置的 token（與 `commandVerbs` 同一套判準）、只看 heredoc 開啟行不看內文；`npx`／`pnpx`／`bunx` 補進 `COMMAND_PREFIX` 讓 `npx tsx -e` 仍擋。寫入 API 比對維持整條指令掃（跨行 `python3 -c "` 要靠它），因此殘留一種誤擋形狀，見已知極限第 23 條。其餘 review 抓出的 10 個形狀經使用者裁決不修，列為已知極限 14–22 |

### 已知極限（擋不住，只能靠 Bash 權限策略或人審補位）

本 hook 是純文字靜態解析，不是執行期分析。下列手法一律繞得過，別把 hook 當成唯一防線。
編號與 `.claude/hooks/frozen-paths-guard.mjs` 檔頭註解的清單一一對應，方便跨檔對照：

1. 先把腳本寫到 `/tmp` 等非凍結路徑，再另開一條指令執行該腳本檔
2. 腳本檔案本身帶 shebang、直接以 `./script.py` 執行（指令原文看不到直譯器詞）
3. 指令或腳本內容先 base64／其他編碼再解碼執行
4. 動態組出函式名（如 `getattr(p, 'write' + '_text')`）
5. 路徑拆成兩段、用 shell 變數組回（如 `T=test/e2e; python3 -c "open('$T/specs/x','w')"`）
6. 路徑或 API 名由運算式組出（f-string、`Path(dir) / name`、字串拼接）——capture 抓不到字面值時雖會退回 flood，但路徑本身沒有以字面值出現在指令原文時，flood 也無從比中
7. 引號內含 shell 分隔符時只認成對的單／雙引號（涵蓋常見 sed／perl 形式）；跳脫引號（`\'`）、`$'...'`、巢狀引號等變體仍可能被誤切段
8. `vim -es`／`emacs --batch`／`awk -i inplace` 這類編輯器不在寫入動詞清單內
9. flood 命中時擋出來的是「指令原文裡比中凍結路徑的 token」，可能是目錄或 glob 字串而非檔案——要走 sentinel 授權時，`files` 要照 hook 訊息列出的字串填
10. `tool_input.command` 不是字串（缺欄位或型別不對）時直接放行
11. fail-open 設計：hook 內部 throw 時 node 以 exit 1 結束，Claude Code 視同非阻斷（寧可放行，不讓鎖壞掉癱瘓所有編輯）
12. 含 `$` 的引號字串只在 `open()` 系列的 capture 被排除；`renameSync`／`writeFileSync`／`shutil.*` 等其他 API 的 capture 仍把 `'$p'` 當字面值路徑，`p=<凍結檔>; node -e "require('fs').renameSync('$p',…)"` 這種形狀會漏放（2026-09-08 回歸實測）
13. heredoc 數字終止符（`<<1`）只在緊接 `<<`（無空白）時才被認出；`<< 1`（`<<` 與數字終止符間有空白）目前仍判不出來，是刻意窄化——放寬空白會讓 `1 << 8` 這種位元左移誤判成 heredoc

以下 14–23 是 PR #141 Copilot review 抓出、經使用者裁決「不修、列為已知極限」的形狀（2026-09-11）。理由：本 hook 防的對象是 Claude 自己（主對話或 subagent 沒讀到規則、順手改了凍結檔），不是刻意繞道的攻擊者。Claude 想改檔用的是 Edit 工具、`sed -i`、`tee`、`cat >`、`patch`、`open(…,'w')`、`writeFileSync`，這些全都擋住了；下列形狀是「知道有 guard、故意要繞」才會寫的，而第 1–3 條早已說明刻意繞道三秒就能做到，再堵這些也不會讓 hook 變成防線。

14. `SCRIPT_INTERPRETERS` 認得 php／deno／bun，但 `SCRIPT_WRITE_API` 沒有這三種語言的寫入 API（`file_put_contents`／`Deno.writeTextFile`／`Bun.write`），等於這三種語言完全不設防
15. `os.open(path, os.O_WRONLY | os.O_TRUNC)` 用數字旗標而非 mode 字串，MODE 系列 regex 比不中
16. `Path(<凍結檔>).replace(dest)` 完全沒有對應規則（只有 `os.replace(`）；`Path(...).rename(dest)` 的接收端來源路徑也沒被 capture，但 detect 命中＋capture 少一個會退回 flood，端到端仍擋得住
17. optional chaining：`writeFileSync?.(…)` 這類 `?.(` 呼叫，所有 detect 都要求 API 名緊接 `(`
18. `open(path, mode)` 的 mode 是變數而非字面字串時，detect 整段比不中，連 flood 都不會觸發（要堵得把「mode 是識別字」也算呼叫，代價是唯讀的 `mode='r'` 也會被 flood 誤擋）
19. `Path(os.path.join(…)).open('w')`：Path.open 的 detect 用 `[^)]*`，建構子引數含巢狀括號就提前收尾
20. `if rm <凍結檔>; then …`、`while`／`for`／`{ …; }` 等 shell 控制結構：關鍵字不在 `COMMAND_PREFIX`，其後的動詞不算指令位置
21. heredoc 內文餵給 pipeline 下游寫入指令：`cat <<'EOF' | patch -p1`，內文歸給 `cat` 段、寫入的 `patch` 段拿不到路徑（直譯器路線不受影響：`cat <<'PY' | python3` 仍由整條指令掃 API 擋下）
22. `>|`（noclobber override）：`splitSegments` 先把 `|` 當管線切開，重導向 regex 也沒收 `>|`
23. 直譯器偵測只認指令位置後，仍有一種殘留誤擋：grep 樣式裡放了引號閉合的完整寫檔呼叫（`grep -rn "writeFileSync('<凍結檔>','x')" . && node -v`），同一行又真的跑直譯器——寫入 API 刻意對整條指令掃（跨行 `python3 -c "` 要靠這個），這種形狀就分不出樣式與呼叫
