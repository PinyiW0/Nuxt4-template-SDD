// 凍結區門鎖（PreToolUse hook）
// 政策：凍結路徑內「修改既有檔」一律擋下（exit 2）；「建立全新檔」放行。
// 涵蓋面：
// - Edit/Write/NotebookEdit：比對 file_path（NotebookEdit 用 notebook_path）
// - Bash：解析 command，段內比中凍結路徑＋寫入類動詞或重導向目標即視為寫入
//   （不細分 source/dest，寧可誤擋不可漏放；唯讀操作不受影響）
// darwin 檔案系統大小寫不敏感 → 比對前兩側 toLowerCase；目標已存在時先
// realpathSync 解 symlink 再比對，繞道 symlink 一樣被擋。
// 授權通道：正規產出流程（flow 覆寫、spec 全量重生）經使用者確認後，先寫
// .claude/tmp/frozen-allow.json（{ reason, files: [<repo 相對路徑>] }），
// hook 比中一次即從清單移除（清空刪檔），其餘情況照擋。
// 為什麼用 hook 不用 rules/frozen-paths.md：paths 觸發規則在 subagent 內不注入
//（2026-07-06 實測），只有 hook 對主對話與所有 subagent 都生效。
//
// 2026-09-08（issue #137）：補直譯器（python/node/ruby/perl/php/deno/bun/tsx/ts-node/vite-node）
// 繞道——上面的逐段判斷以 `\n` 切段，heredoc 把「直譯器在首行、寫入 API 在後續行」拆成
// 兩段各自看都不像寫入，會漏放（且漏放不經過 tryConsumeSentinel，sentinel 不會被消耗）。
// 修法：對「整條指令」（不切段）另外判斷——任一處出現直譯器詞、且該語言的寫入 API
//（SCRIPT_WRITE_API）被實際呼叫時才觸發。此防線與既有逐段防線（sed/tee/cp/mv、redirect、
// git）並存、互不取代。
//
// 對抗審查一輪回饋（同日）：初版「命中即整條指令 flood」誤攔過廣——凍結區檔案只是被
// `git diff`／`cat`／`open()` 唯讀讀取、寫入目標其實在別處時，也會被當成寫入擋下（SDD
// 管線常見寫法：讀 flow/feature 產出 route-map／型別）。修法：SCRIPT_WRITE_API 每一項
// 都拆成 { detect, capture } 一對——capture 在寫入呼叫的目標引數是字面字串時把它擷取出
// 來，只有那些路徑才算寫入目標（rename／move 兩個引數都算，搬走等同刪掉來源）；capture
// 抓不到字面值（引數是變數、`os.path.join(...)` 等運算式）時才對該次呼叫回退成「整條指令
// flood」（把指令中所有比中凍結路徑的 token 都當寫入目標，寧可誤擋）。
//
// 對抗審查二輪回饋（同日）：切段不認引號（`sed -i '' 's/a/b/;s/c/d/' <凍結檔>` 被 `;`
// 切散）、`<<` 位元左移被當 heredoc、heredoc 內文的散字被當寫入動詞、`,'w')` 形狀誤攔。
// 修法：切段時忽略引號內的分隔符；heredoc 終止符必須緊接 `<<`；動詞只認「指令位置」的 token；
// open 類 detect 加上「第一引數是路徑樣或識別字」的語境條件。
//
// 對抗審查三輪回饋（同日）：`open('$p','w')`（shell 變數包在引號內）被當字面值抓走而漏放；
// 反過來，API 名只是被「提及」（grep 樣式 `"createWriteStream("` 未閉合引號、commit 訊息裡的
// `writeFileSync(...)`）時 capture 抓不到，被誤判成動態呼叫而 flood。修法：含 `$` 的引號字串
// 不算字面值（走 flood）；detect 命中後還要過 CALL_ARG——第一引數得是閉合的引號字串或
// 識別字／$變數／運算式開頭，否則只算提及、不算呼叫。
//
// 2026-09-11（PR #141 Copilot review 第 1、2、4、6 輪）：①heredoc 內文固定併給該行最後一段，
// `patch -p1 <<'EOF' && echo done` 的內文歸到 echo 段而漏放 ②`<< EOF`（<< 後接空白）不被認成
// heredoc ③`Path(...).open('r+')` 只認 `['"][wax]` 漏掉 r+ ④單一 `&` 不切段，`echo hi & tee <凍結檔>`
// 的 tee 不在指令位置。修法：內文歸「含 << 開啟符的那一段」（heredocTerminators 與 splitSegments
// 同一套引號感知）；`<<-?\s*` 放寬空白（終止符仍限識別字開頭，`1 << 8` 不受影響）；Path.open 的
// mode 改共用 MODE；單一 `&` 也當分隔符（`>&`／`<&`／`&>`／`&>>` 這類 fd 重導向除外）。
//
// 已知極限（本 hook 是純文字靜態解析，非執行期分析，以下手法擋不住）：
//   1. 先把腳本寫到 /tmp 等非凍結路徑，再另開一條指令執行該腳本檔
//   2. 腳本檔案本身帶 shebang、直接以 `./script.py` 執行（指令原文看不到直譯器詞）
//   3. 指令或腳本內容先 base64／其他編碼再解碼執行
//   4. 動態組出函式名（如 `getattr(p, 'write' + '_text')`）
//   5. 路徑拆成兩段、用 shell 變數組回（如 `T=test/e2e; python3 -c "open('$T/specs/x','w')"`）
//   6. 路徑或 API 名由運算式組出（f-string、`Path(dir) / name`、字串拼接）——capture 抓不到
//      字面值時雖會退回 flood，但路徑本身沒有以字面值出現在指令原文時，flood 也無從比中
//   7. 引號內含 shell 分隔符時只認成對的單／雙引號（涵蓋常見 sed／perl 形式）；跳脫引號
//      （`\'`）、`$'...'`、巢狀引號等變體仍可能被誤切段
//   8. `vim -es`／`emacs --batch`／`awk -i inplace` 這類編輯器不在 WRITE_VERBS／INPLACE_TOOLS 內
//   9. flood 命中時擋出來的是「指令原文裡比中凍結路徑的 token」，可能是目錄而不是檔案；
//      要走 sentinel 授權時，files 要照 hook 訊息列出的字串填（是目錄就填目錄字串）
//  10. `tool_input.command` 不是字串（缺欄位或型別不對）時直接放行
//  11. fail-open 設計：hook 內部 throw 時 node 以 exit 1 結束，Claude Code 視同非阻斷
//  12. 含 `$` 的引號字串只在 open() 系列的 capture 被排除；renameSync／writeFileSync／shutil.* 等
//      其他 API 的 capture 仍把 '$p' 當字面值路徑，`p=<凍結檔>; node -e "…renameSync('$p',…)"` 會漏放
// 這些只能靠 Bash 權限策略或人審補位。
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { normalize, relative, resolve } from 'node:path'

// 凍結清單以本陣列為準（一律小寫）；增刪時須同步 rules/frozen-paths.md（frontmatter paths + 表格）
const FROZEN = ['test/e2e/specs', 'spec/gherkin-feature', 'spec/e2e-flows']

// Bash 寫入類動詞：出現在「指令位置」且與凍結路徑同段即視為寫入
// patch／ed／ex 皆能就地改檔（patch -p1 直接套用；ed／ex 是行編輯器，非互動下用 script 或 stdin 一樣能寫檔）
const WRITE_VERBS = new Set(['tee', 'cp', 'mv', 'rm', 'ln', 'truncate', 'dd', 'patch', 'ed', 'ex'])
// 指令位置：段落第一個 token（段落已在 |、;、&&、|| 處切開）。
// 下列前綴後的第一個 token 一併視為指令位置，免得 `sudo rm <凍結檔>`、
// `find … -exec rm {} \;`、`bash -c "rm <凍結檔>"` 這類寫法因為動詞不在第一位而漏放。
const COMMAND_PREFIX = new Set(['sudo', 'env', 'time', 'command', 'nohup', 'xargs', 'then', 'do', 'else', '-exec', '-execdir', '-c'])
// git 會改寫工作區檔案的子指令（git add/diff/log 等唯讀或只動 index 的不算）
const GIT_WRITE_SUBCMDS = new Set(['checkout', 'restore', 'apply', 'mv', 'rm', 'clean', 'stash'])
// 支援 -i／--in-place 就地改檔的串流編輯器與直譯器：帶 in-place 旗標時視為寫入。
// perl 的 -i 常與其他旗標黏在一起（-pi、-pe -i、-i.bak），ruby 同理；
// 註：2026-08-24 實測 perl -pi 曾繞過本 guard 改到凍結區的 flow/spec 註解，故補上。
const INPLACE_TOOLS = new Set(['sed', 'perl', 'ruby', 'gsed'])
// 不忽略大小寫：就地改檔旗標一律小寫慣例（-i、-pi、-i.bak、--in-place），
// 忽略大小寫會讓 perl -Ilib（include path，純讀取）之類的大寫旗標被誤判成寫入。
const INPLACE_FLAG = /^-(?!-)[a-z]*i|^--in-place/

// 腳本直譯器：比對 token 去路徑前綴後的最後一段（如 /usr/bin/python3.11 → python3.11）。
// 含版本號變體（python3.11）與本 repo node_modules/.bin 常見的 tsx／ts-node／vite-node。
const SCRIPT_INTERPRETERS = /^(?:python\d*(?:\.\d+)?|node|ruby|perl|php|deno|bun|tsx|ts-node|vite-node)$/

// 寫入模式字串（'w'、'a'、'x'、'r+'、'wb'…）。字元類一律用有界量詞：無界的
// [rwaxb+]* 兩側夾一個 [wax+] 會在長字串上回溯爆炸（ReDoS）。
// 不可簡化成 [rwaxb+]+ —— 那會把 'r'／'rb' 這種唯讀模式也當成寫入。
const MODE = `['"][rwaxb+]{0,3}[wax+][rwaxb+]{0,3}['"]`
// open() 第一引數的語境條件：路徑樣字面值（含 / 或 .）、含 shell 變數的字串（'$p'、"${p}"）、
// 或以識別字／下標起頭的運算式（變數、os.path.join(...)）。
// 純短字串（print('x','a')、'foo'.replace('o','bar')）不算，藉此把 `,'w')` 形狀的誤攔降噪。
// 第一段刻意寫成 [^'"/.$]* 起頭（遇 / . $ 或引號就停），避免兩個無界 [^'"]* 造成回溯爆炸。
const OPEN_FIRST_ARG = `(?:['"][^'"/.$]*[./$][^'"]*['"]|[\\w[])`
// 引數區掃描：有界惰性重複，且引號字串整段吃掉；兩個分支在同一位置互斥，不會回溯爆炸
const OPEN_ARGS = `(?:[^;'"]|['"][^'"]*['"]){0,120}?`
const OPEN_WRITE_DETECT = new RegExp(`\\bopen(?:Sync)?\\s*\\(\\s*${OPEN_FIRST_ARG}${OPEN_ARGS},\\s*(?:mode\\s*=\\s*)?${MODE}\\s*[,)]`, 'g')
// capture 的路徑不收含 $ 的字串：`open('$p','w')` 的 $p 要 shell 展開才知道指向哪，
// 抓成字面值會誤判成「非凍結路徑」而放行；排除後它算不出字面值 → 退回 flood。
const OPEN_WRITE_CAPTURE = new RegExp(`\\bopen(?:Sync)?\\s*\\(\\s*['"]([^'"$]+)['"]\\s*,\\s*(?:mode\\s*=\\s*)?${MODE}`, 'g')

// 判斷 detect 命中處是不是「真的呼叫」：括號後第一個引數必須是「閉合的引號字串」
// 或識別字／$變數／運算式開頭（[A-Za-z_$([]）。
// 第一引數是 `.`（如 commit 訊息裡的 `writeFileSync(...)`）、`)`（空引數）、
// 或引號但整條指令內都閉不起來（如 grep 的 `"createWriteStream("`）→ 只是「提及」，不算呼叫。
// 用 sticky（y）旗標從指定位置起比對，不必切字串。
const CALL_ARG = /\s*(?:['"][^'"]*['"]|[A-Za-z_$([])/y

// 各語言常見寫入／刪除 API：對「整條指令原文」做 regex 比對（不切段，heredoc 內容也要吃到）。
// 每項 { detect, capture, argsChecked }：
// - detect：判斷此類呼叫是否存在（不要求引數是字面值，寧可多算）。detect 以 `\(` 收尾者，
//   命中後還要過 CALL_ARG 才算呼叫；detect 本身已把引數形狀寫進去的標 argsChecked: true
// - capture：引數是字面字串時，擷取真正的寫入／刪除目標路徑（所有 capture group 都算目標）
// 呼叫次數 > capture 命中次數 → 代表至少一次呼叫的引數是變數／運算式（如
// os.path.join(...)），該情況才需要對整條指令做 flood（見 bashFrozenWrites）。
// 只挑會落地寫檔／刪檔的 API，純讀取（如 python 的 open(path) 預設 'r'）刻意不比中。
// rename／move 類的 capture 有兩個 group（來源、目的）：來源被搬走等同刪除，一樣要擋；
// copy 類只收目的地 group，來源是凍結檔仍放行（不動原檔）。
const SCRIPT_WRITE_API = [
  // ---- node：write／append／stream ----
  { detect: /\b(?:writeFileSync|writeFile)\s*\(/g, capture: /\b(?:writeFileSync|writeFile)\s*\(\s*['"]([^'"]+)['"]/g },
  { detect: /\b(?:appendFileSync|appendFile)\s*\(/g, capture: /\b(?:appendFileSync|appendFile)\s*\(\s*['"]([^'"]+)['"]/g },
  { detect: /\bcreateWriteStream\s*\(/g, capture: /\bcreateWriteStream\s*\(\s*['"]([^'"]+)['"]/g },
  // rename／renameSync：同時涵蓋 python 的 os.rename 與 ruby 的 File.rename（皆為 `.rename(` 形狀）
  { detect: /\b(?:renameSync|rename)\s*\(/g, capture: /\b(?:renameSync|rename)\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g },
  // copy 類：只有目的地算寫入目標
  { detect: /\b(?:copyFileSync|copyFile|cpSync|cp)\s*\(/g, capture: /\b(?:copyFileSync|copyFile|cpSync|cp)\s*\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]/g },
  // 刪除類（含非同步版與 rmdir）
  { detect: /\b(?:rmSync|unlinkSync|rmdirSync|rm|unlink|rmdir)\s*\(/g, capture: /\b(?:rmSync|unlinkSync|rmdirSync|rm|unlink|rmdir)\s*\(\s*['"]([^'"]+)['"]/g },
  // 截斷類（含非同步版；os.truncate 亦命中）
  { detect: /\b(?:truncateSync|ftruncateSync|truncate|ftruncate)\s*\(/g, capture: /\b(?:truncateSync|ftruncateSync|truncate|ftruncate)\s*\(\s*['"]([^'"]+)['"]/g },
  // symlink／hard link：第二引數是被建立／覆蓋的路徑
  { detect: /(?:\b(?:symlinkSync|linkSync)|os\.(?:symlink|link))\s*\(/g, capture: /(?:\b(?:symlinkSync|linkSync)|os\.(?:symlink|link))\s*\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]/g },

  // ---- python：write_text／write_bytes／Path.open／shutil／os ----
  { detect: /Path\s*\([^)]*\)\s*\.\s*(?:write_text|write_bytes|unlink)\s*\(/g, capture: /Path\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\.\s*(?:write_text|write_bytes|unlink)\s*\(/g },
  // Path(...).open(mode)：mode 與 open() 系列共用 MODE（'w'／'a'／'x'／'r+'／'rb+'…皆算寫入，'r'／'rb' 不算），
  // 同樣接受 mode='w' 關鍵字引數形式；只認 `['"][wax]` 會漏掉 'r+'（PR #141 review）
  { detect: new RegExp(`Path\\s*\\([^)]*\\)\\s*\\.\\s*open\\s*\\(\\s*(?:mode\\s*=\\s*)?${MODE}`, 'g'), capture: new RegExp(`Path\\s*\\(\\s*['"]([^'"]+)['"]\\s*\\)\\s*\\.\\s*open\\s*\\(\\s*(?:mode\\s*=\\s*)?${MODE}`, 'g'), argsChecked: true },
  // open(path, 'w'|'a'|'x'|'r+'…)：同時涵蓋 node 的 fs.open/openSync 與 ruby 的 File.open
  { detect: OPEN_WRITE_DETECT, capture: OPEN_WRITE_CAPTURE, argsChecked: true },
  { detect: /shutil\.copy\w*\s*\(/g, capture: /shutil\.copy\w*\s*\([^,]+,\s*['"]([^'"]+)['"]/g },
  { detect: /shutil\.move\s*\(/g, capture: /shutil\.move\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g },
  { detect: /shutil\.rmtree\s*\(/g, capture: /shutil\.rmtree\s*\(\s*['"]([^'"]+)['"]/g },
  { detect: /os\.replace\s*\(/g, capture: /os\.replace\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g },
  { detect: /os\.(?:remove|unlink|truncate|rmdir)\s*\(/g, capture: /os\.(?:remove|unlink|truncate|rmdir)\s*\(\s*['"]([^'"]+)['"]/g },

  // ---- ruby：File.write／IO.write／File.delete／FileUtils ----
  { detect: /(?:File|IO)\.write\s*\(/g, capture: /(?:File|IO)\.write\s*\(\s*['"]([^'"]+)['"]/g },
  { detect: /File\.delete\s*\(/g, capture: /File\.delete\s*\(\s*['"]([^'"]+)['"]/g },
  { detect: /FileUtils\.(?:rm_rf|rm_r|rm)\s*\(/g, capture: /FileUtils\.(?:rm_rf|rm_r|rm)\s*\(\s*['"]([^'"]+)['"]/g },
  { detect: /FileUtils\.cp\w*\s*\(/g, capture: /FileUtils\.cp\w*\s*\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]/g },
  { detect: /FileUtils\.mv\s*\(/g, capture: /FileUtils\.mv\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g },

  // ---- perl：open(..., '>'...)（追加、覆寫皆以 '>' 開頭；'>>' 也命中）----
  // 3-arg 形式：open($fh, '>', 'file')——mode 自己是一個完整字串，檔名是下一個字串
  { detect: /open\s*\([^,]+,\s*['"]>>?['"]\s*,/g, capture: /open\s*\([^,]+,\s*['"]>>?['"]\s*,\s*['"]([^'"]+)['"]/g, argsChecked: true },
  // 2-arg 形式：open($fh, '>file')——mode 與檔名黏在同一個字串裡
  { detect: /open\s*\([^,]+,\s*['"]>>?[^'"]+['"]/g, capture: /open\s*\([^,]+,\s*['"]>>?([^'"]+)['"]/g, argsChecked: true },
]

function baseName(word) {
  return word.slice(word.lastIndexOf('/') + 1)
}

// 整條指令是否含直譯器詞（去路徑前綴比對，如 /usr/bin/python3）
function hasScriptInterpreter(words) {
  return words.some(w => SCRIPT_INTERPRETERS.test(baseName(w)))
}

// detect 命中處之後接的是不是可解析的引數（見 CALL_ARG）
function isCallArgs(command, index) {
  CALL_ARG.lastIndex = index
  return CALL_ARG.test(command)
}

// 分析整條指令的腳本寫入呼叫：回傳是否有呼叫、是否有呼叫的引數抓不到字面值（需 flood）、
// 以及所有抓得到的字面值寫入／刪除目標路徑
function scriptWriteAnalysis(command) {
  let anyCall = false
  let anyDynamic = false
  const literalPaths = []
  for (const { detect, capture, argsChecked } of SCRIPT_WRITE_API) {
    let callCount = 0
    for (const m of command.matchAll(detect)) {
      if (argsChecked || isCallArgs(command, m.index + m[0].length))
        callCount++
    }
    if (!callCount)
      continue
    anyCall = true
    const captured = [...command.matchAll(capture)]
    for (const m of captured) {
      for (const group of m.slice(1)) {
        if (group)
          literalPaths.push(group)
      }
    }
    if (captured.length < callCount)
      anyDynamic = true
  }
  return { anyCall, anyDynamic, literalPaths }
}

const realpath = realpathSync.native ?? realpathSync
let projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd()
try {
  projectRoot = realpath(projectRoot)
}
catch {}

function matchFrozen(rel) {
  return FROZEN.find(p => rel === p || rel.startsWith(`${p}/`))
}

// 判斷單一 token 是否指向凍結路徑，回傳 repo 相對路徑（小寫），否則 null
function frozenRelOf(word) {
  const expanded = word.replace(/^\$\{?CLAUDE_PROJECT_DIR\}?/, projectRoot)
  // 能落地的路徑：resolve（存在時含 symlink 解析）後對 projectRoot 取相對再比對
  try {
    const abs = resolve(projectRoot, expanded)
    const real = existsSync(abs) ? realpath(abs) : abs
    const rel = relative(projectRoot, real).toLowerCase()
    if (!rel.startsWith('..') && matchFrozen(rel))
      return rel
  }
  catch {}
  // 絕對路徑上面已可精確判定，不再做子字串比對（避免 /tmp/spec/... 誤中）
  if (expanded.startsWith('/'))
    return null
  // 落不了地的 token（帶未知變數前綴、dd 的 of= 等）：子字串比對，寧可誤擋
  const lower = normalize(expanded).toLowerCase()
  for (const p of FROZEN) {
    const idx = lower.indexOf(p)
    if (idx === -1)
      continue
    const before = idx === 0 ? '' : lower[idx - 1]
    const after = lower[idx + p.length]
    if ((!before || before === '/' || before === '=') && (!after || after === '/'))
      return lower.slice(idx)
  }
  return null
}

// 目標是否指向「既有檔」：本 hook 只擋既有檔，新增放行。
// glob 樣式（*、?、[）沒辦法逐一比對，退回檢查最近的非 glob 祖先目錄——
// 目錄在就當作可能命中既有檔（寧可誤擋），例如 `git checkout main -- 'test/e2e/specs/*'`。
function targetExists(rel) {
  if (existsSync(resolve(projectRoot, rel)))
    return true
  const globAt = rel.search(/[*?[]/)
  if (globAt === -1)
    return false
  const prefix = rel.slice(0, globAt).replace(/\/[^/]*$/, '')
  return Boolean(prefix) && existsSync(resolve(projectRoot, prefix))
}

// heredoc（<<EOF、<< EOF、<<'EOF'、<<-EOF）感知切塊：把開啟行與各 heredoc 的內文分開回傳，
// 避免下面逐行切分時把「動詞在首行、目標路徑在 heredoc 內文」拆成兩段各自看都不像寫入
// 而漏放（如 `patch -p1 <<'EOF'` 接 unified diff 內文指向凍結檔；issue #137 對抗審查）。
// `<<` 後允許空白（bash 合法寫法 `<< EOF`），終止符限定識別字開頭（不允許數字），
// 所以 `console.log(1 << 8)` 這種位元左移仍不會被當成 heredoc 把後續指令吞進同一塊；
// 前置 (?<!<) 排除 here-string `<<< "text"`。sticky（y）旗標配合 heredocTerminators 從指定位置比對。
const HEREDOC_OPEN = /(?<!<)<<-?\s*(['"]?)([A-Za-z_]\w*)\1/y

// 引號感知的 heredoc 開啟符掃描：回傳 text 內引號外每個 `<<EOF` 的終止符（依出現順序）。
// 與 splitSegments 用同一套單／雙引號判斷，`node -e "a << b"` 這種引號內的 << 不算開啟符；
// 對整行與對切段後的單一 segment 呼叫都給出一致的計數，bashFrozenWrites 靠這點把內文歸段。
function heredocTerminators(text) {
  const terminators = []
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote)
        quote = ''
      continue
    }
    if (c === '<' && text[i + 1] === '<') {
      HEREDOC_OPEN.lastIndex = i
      const m = HEREDOC_OPEN.exec(text)
      if (m) {
        terminators.push(m[2])
        i += m[0].length - 1 // 整個 <<'EOF' 一起跳過，終止符外的引號不進入引號狀態
        continue
      }
    }
    if (c === '\'' || c === '"')
      quote = c
  }
  return terminators
}

function splitHeredocBlocks(command) {
  const lines = command.split('\n')
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i]
    const bodies = []
    for (const terminator of heredocTerminators(head)) {
      let body = ''
      while (i + 1 < lines.length) {
        i++
        body += `${lines[i]}\n`
        if (lines[i].trim() === terminator)
          break
      }
      bodies.push(body)
    }
    blocks.push({ head, bodies })
  }
  return blocks
}

// 依 |、;、&、&&、|| 切段，但引號內（單／雙引號）的分隔符不算——
// 否則 `sed -i '' 's/a/b/;s/c/d/' <凍結檔>` 會被 `;` 切散，動詞與目標分屬不同段而漏放。
// 單一 `&`（背景執行）也是指令分隔符，否則 `echo hi & tee <凍結檔>` 整條併一段、tee 不在
// 指令位置而漏放；但 `>&`／`<&`／`&>`／`&>>`（含 `2>&1`）是同段內的 fd 重導向，不切。
// 逐字元掃描而非 regex：避免遮蔽／還原佔位符，也沒有回溯成本。
function splitSegments(text) {
  const segments = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      cur += c
      if (c === quote)
        quote = ''
      continue
    }
    if (c === '\'' || c === '"') {
      quote = c
      cur += c
      continue
    }
    const prev = text[i - 1]
    const next = text[i + 1]
    const isSeparator = c === ';' || c === '|'
      || (c === '&' && (next === '&' || (prev !== '>' && prev !== '<' && next !== '>')))
    if (!isSeparator) {
      cur += c
      continue
    }
    if ((c === '&' && next === '&') || (c === '|' && next === '|'))
      i++
    segments.push(cur)
    cur = ''
  }
  segments.push(cur)
  return segments
}

function tokenize(text) {
  return text.split(/[\s"'()`;&|<>]+/).filter(Boolean)
}

// 只有「指令位置」的 token 才算動詞：段落第一個 token，或 sudo／xargs／find -exec 等前綴
// 之後、或 shell 變數指派之後。這樣 heredoc 內文與訊息字串裡散落的 ed／restore 不會被誤判。
function commandVerbs(words) {
  const verbs = []
  for (let i = 0; i < words.length; i++) {
    if (i === 0 || COMMAND_PREFIX.has(words[i - 1]) || /^\w+=/.test(words[i - 1]))
      verbs.push(baseName(words[i]))
  }
  return verbs
}

// git 的子指令只認緊接 git 之後的第一個非旗標 token（-C／-c 會吃掉一個值），
// 否則 `git commit -m "… restore …"` 的訊息內文會被當成 git restore。
function gitWriteSubcmd(words) {
  const gi = words.findIndex(w => baseName(w) === 'git')
  if (gi === -1)
    return false
  for (let i = gi + 1; i < words.length; i++) {
    if (words[i] === '-C' || words[i] === '-c') {
      i++
      continue
    }
    if (words[i].startsWith('-'))
      continue
    return GIT_WRITE_SUBCMDS.has(words[i])
  }
  return false
}

function hasWriteVerb(words) {
  return commandVerbs(words).some(v => WRITE_VERBS.has(v))
    || (words.some(w => INPLACE_TOOLS.has(baseName(w))) && words.some(w => INPLACE_FLAG.test(w)))
    || gitWriteSubcmd(words)
}

// 解析 Bash command，回傳會被寫入的凍結路徑清單（repo 相對、小寫）
function bashFrozenWrites(command) {
  const targets = new Set()
  for (const { head, bodies } of splitHeredocBlocks(command)) {
    let bodyAt = 0
    for (const seg of splitSegments(head)) {
      const words = tokenize(seg)
      // heredoc 內文歸給「含 << 開啟符的那一段」（動詞在指令行、目標在內文，如
      // `patch -p1 <<'EOF' && echo done`——內文屬於 patch 段，不是 echo 段）；
      // 一行多個 heredoc 時依開啟符出現順序各歸各段。內文只用來找凍結路徑，不參與動詞與重導向判斷。
      const opened = heredocTerminators(seg).length
      const bodyWords = bodies.slice(bodyAt, bodyAt + opened).flatMap(tokenize)
      bodyAt += opened
      const frozen = [...words, ...bodyWords].map(frozenRelOf).filter(Boolean)
      if (!frozen.length)
        continue
      if (hasWriteVerb(words)) {
        frozen.forEach(t => targets.add(t))
        continue
      }
      // 無寫入動詞的段落：只有重導向（> >>）目標比中凍結路徑才算寫入
      for (const m of seg.matchAll(/>{1,2}\s*["']?([^\s"'<>|;&]+)/g)) {
        const rel = frozenRelOf(m[1])
        if (rel)
          targets.add(rel)
      }
    }
  }
  // 直譯器防線：對「整條指令」（跨 \n、不切段）判斷，heredoc 把直譯器詞與寫入 API
  // 拆到不同行也吃得到。優先用 capture 抓到的字面值路徑當寫入目標（精準，不誤傷同指令
  // 內被唯讀讀取的凍結檔）；只有引數抓不到字面值（變數／運算式）時才回退整條指令 flood。
  const allWords = tokenize(command)
  if (hasScriptInterpreter(allWords)) {
    const { anyCall, anyDynamic, literalPaths } = scriptWriteAnalysis(command)
    if (anyCall) {
      for (const p of literalPaths) {
        const rel = frozenRelOf(p)
        if (rel)
          targets.add(rel)
      }
      if (anyDynamic) {
        for (const rel of allWords.map(frozenRelOf).filter(Boolean))
          targets.add(rel)
      }
    }
  }
  return [...targets]
}

// 一次性授權通道：全部目標都在 sentinel 清單內才放行，並一次消耗
function tryConsumeSentinel(rels) {
  const sentinel = resolve(projectRoot, '.claude/tmp/frozen-allow.json')
  if (!existsSync(sentinel))
    return false
  try {
    const allow = JSON.parse(readFileSync(sentinel, 'utf8'))
    const files = Array.isArray(allow?.files) ? allow.files : []
    const used = []
    for (const rel of new Set(rels)) {
      const i = files.findIndex((f, fi) => !used.includes(fi) && String(f).toLowerCase() === rel)
      if (i === -1)
        return false
      used.push(i)
    }
    const remaining = files.filter((_, i) => !used.includes(i))
    if (remaining.length === 0)
      rmSync(sentinel)
    else
      writeFileSync(sentinel, JSON.stringify({ ...allow, files: remaining }, null, 2))
    return true
  }
  catch {
    return false // sentinel 壞掉視同不存在，維持擋下的預設
  }
}

function deny(rels) {
  console.error(
    `凍結區保護：${rels.join('、')} 屬於凍結路徑，禁止修改既有檔案。`
    + `依 .claude/rules/frozen-paths.md 處理：停下來，向使用者說明衝突並列出選項`
    + `（調整目標／走 spec 變更迭代流／由使用者自行修改規格）。新增全新檔案不受此限。`,
  )
  process.exit(2)
}

let raw = ''
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  let input
  try {
    input = JSON.parse(raw)
  }
  catch {
    process.exit(0) // 輸入解析失敗時不擋，避免鎖壞掉時癱瘓所有編輯
  }

  if (input?.tool_name === 'Bash') {
    const command = typeof input?.tool_input?.command === 'string' ? input.tool_input.command : ''
    if (!command)
      process.exit(0)
    // 只擋「既有檔」；寫入不存在的目標＝新增，放行
    const existing = bashFrozenWrites(command).filter(targetExists)
    if (!existing.length)
      process.exit(0)
    if (tryConsumeSentinel(existing))
      process.exit(0)
    deny(existing)
  }

  const filePath = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path
  if (!filePath)
    process.exit(0)

  let abs = resolve(projectRoot, filePath)
  if (existsSync(abs)) {
    try {
      abs = realpath(abs)
    }
    catch {}
  }
  const rel = relative(projectRoot, abs).toLowerCase()
  if (!matchFrozen(rel))
    process.exit(0)

  // Write 到不存在的檔案 = 授權產出者新增合約，放行
  if (input.tool_name === 'Write' && !existsSync(abs))
    process.exit(0)

  if (tryConsumeSentinel([rel]))
    process.exit(0)
  deny([rel])
})
