// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// frozen-paths-guard.mjs：凍結區門鎖 PreToolUse hook（issue #137，含兩輪對抗審查後的回歸案例）。
// 驅動方式對齊 hook 實際行為：
// - Bash 事件：stdin 讀 { tool_name: 'Bash', tool_input: { command } } JSON
// - Write／Edit 事件：stdin 讀 { tool_name, tool_input: { file_path } } JSON
// 用 CLAUDE_PROJECT_DIR 決定 repo root，擋下時 exit 2、放行時 exit 0。
const HOOK_PATH = fileURLToPath(new URL('../../.claude/hooks/frozen-paths-guard.mjs', import.meta.url))
const FROZEN_FILE = 'test/e2e/specs/01-x.spec.ts'

let tmpDir: string

beforeEach(() => {
  // Arrange：建立假 repo，內含一個已存在的凍結區檔案，以及誤攔回歸案例需要的旁支目錄
  tmpDir = mkdtempSync(join(tmpdir(), 'frozen-guard-'))
  mkdirSync(join(tmpDir, 'test/e2e/specs'), { recursive: true })
  mkdirSync(join(tmpDir, 'spec/e2e-flows'), { recursive: true })
  mkdirSync(join(tmpDir, 'spec/gherkin-feature'), { recursive: true })
  mkdirSync(join(tmpDir, 'spec/report'), { recursive: true })
  mkdirSync(join(tmpDir, 'app/types'), { recursive: true })
  writeFileSync(join(tmpDir, FROZEN_FILE), '// 既有 spec\n')
  writeFileSync(join(tmpDir, 'spec/e2e-flows/a.flow.md'), '# flow\n')
  writeFileSync(join(tmpDir, 'spec/gherkin-feature/a.feature'), 'Feature: x\n')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// 驅動 hook：組成 PreToolUse 的 Bash 事件 payload 餵進 stdin，回傳 spawnSync 結果（status/stderr）
function runGuard(command: string) {
  return spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
    encoding: 'utf8',
    // 正常執行約 80-120ms（見下方 ReDoS 測試），5s 足夠寬裕；
    // 萬一未來重新引入災難性回溯，spawnSync 逾時回傳 status: null，斷言會如實失敗而不是卡住整個 CI
    timeout: 5000,
  })
}

// 驅動 hook：直接指定整包 payload（測非字串 command 等邊界輸入）
function runGuardRaw(payload: unknown) {
  return spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
    encoding: 'utf8',
    timeout: 5000,
  })
}

// 驅動 hook：組成 PreToolUse 的 Write／Edit 事件 payload
function runGuardOnFile(toolName: 'Write' | 'Edit', filePath: string) {
  return spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({ tool_name: toolName, tool_input: { file_path: filePath } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
    encoding: 'utf8',
    timeout: 5000,
  })
}

describe('frozen-paths-guard：直譯器繞道防線', () => {
  it('案例1：python3 heredoc 用 write_text 改既有凍結檔 → 擋下', () => {
    // Arrange：直譯器詞在首行、寫入 API 在後續行，逐段（依 \n 切）判斷會漏放
    const command = [
      'python3 - <<\'PY\'',
      'from pathlib import Path',
      `Path('${FROZEN_FILE}').write_text('hacked')`,
      'PY',
    ].join('\n')

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(2)
  })

  it('案例2：node -e 用 writeFileSync 改既有凍結檔 → 擋下', () => {
    // Arrange
    const command = `node -e "require('fs').writeFileSync('${FROZEN_FILE}','')"`

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(2)
  })

  it('案例3（既有防線回歸）：sed -i 改既有凍結檔 → 擋下', () => {
    // Arrange
    const command = `sed -i '' 's/a/b/' ${FROZEN_FILE}`

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(2)
  })

  it('案例4：cat heredoc 建立全新檔 → 放行', () => {
    // Arrange：目標檔案在假 repo 內不存在，屬於新增
    const command = [
      'cat > test/e2e/specs/99-new.spec.ts <<\'EOF\'',
      '// 新檔',
      'EOF',
    ].join('\n')

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('案例5：python3 -c 僅呼叫 open 讀取（唯讀 API，非寫入） → 放行', () => {
    // Arrange
    const command = `python3 -c "print(open('${FROZEN_FILE}').read())"`

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('案例6a：寫入路徑是字面值（/tmp/out.txt）、字串內另含凍結路徑名 → 放行', () => {
    // Arrange：capture 抓到真正的寫入目標是 /tmp/out.txt（非凍結區），
    // 凍結路徑名只是被寫入的「內容」字串，不應被當成寫入目標（對抗審查修正：不再整條指令 flood）
    const command = [
      'python3 - <<\'PY\'',
      'from pathlib import Path',
      `Path('/tmp/out.txt').write_text('reference: ${FROZEN_FILE}')`,
      'PY',
    ].join('\n')

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('案例6b（已知極限：flood 取捨）：寫入路徑是變數、同指令另含唯讀的凍結路徑字面值 → 一併擋下', () => {
    // Arrange：open(target, 'w') 的 target 是變數，capture 抓不到字面值，
    // 依規格退回整條指令 flood——print() 裡只是被印出來的凍結路徑 token 也一併視為寫入目標。
    // 這是刻意接受的誤擋代價，不是 bug：靜態解析無從得知 target 實際指向哪裡。
    const command = [
      'python3 - <<\'PY\'',
      'import os',
      'target = os.environ.get(\'OUT\')',
      'open(target, \'w\').write(\'x\')',
      `print('ref ${FROZEN_FILE}')`,
      'PY',
    ].join('\n')

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(2)
  })
})

describe('frozen-paths-guard：誤攔回歸（唯讀讀取凍結檔＋寫到別處 → 一律放行）', () => {
  it('node 讀 flow 寫 route-map → 放行', () => {
    // Arrange：flow 檔只是被 readFileSync 讀取內容，真正寫入目標是 spec/report/route-map.yaml
    const command = 'node -e "require(\'fs\').writeFileSync(\'spec/report/route-map.yaml\', '
      + 'require(\'fs\').readFileSync(\'spec/e2e-flows/a.flow.md\',\'utf8\'))"'

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('python heredoc 讀 feature 寫 app/types → 放行', () => {
    // Arrange
    const command = [
      'python3 - <<\'PY\'',
      'src = open(\'spec/gherkin-feature/a.feature\').read()',
      'open(\'app/types/gen.ts\', \'w\').write(src)',
      'PY',
    ].join('\n')

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('git diff 凍結檔 | python3 寫 /tmp → 放行', () => {
    // Arrange：git diff 只是唯讀比對凍結檔，管線後段的寫入目標在 /tmp
    const command = `git diff ${FROZEN_FILE} | python3 -c "open('/tmp/d.txt','w').write(1)"`

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('grep 搜尋字串含 API 名（整條指令無直譯器詞，直譯器防線不觸發） → 放行', () => {
    // Arrange：grep 本身不是直譯器，SCRIPT_WRITE_API 那條防線根本不會啟動
    const command = 'grep -rn "createWriteStream(" test/e2e/specs/'

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('git commit message 同時含 API 名與凍結路徑（無直譯器） → 放行', () => {
    // Arrange：訊息字串裡帶凍結路徑，才驗得出「有凍結路徑但沒有寫入動詞 → 放行」
    const command = `git commit -m "refactor: writeFileSync(${FROZEN_FILE}) usage"`

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('playwright 對凍結檔跑測試、輸出重導向到 /tmp（非寫入類動詞） → 放行', () => {
    // Arrange
    const command = `npx playwright test ${FROZEN_FILE} --reporter=json > /tmp/r.json`

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('管線唯讀段（cat 凍結檔 | grep > /tmp） → 放行', () => {
    // Arrange：確認引號感知切段沒有讓 | 失去切段能力
    const command = `cat ${FROZEN_FILE} | grep foo > /tmp/o.txt`

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('案例 B4：grep 的搜尋樣式含 API 名＋未閉合引號，同段另有直譯器詞 → 放行', () => {
    // Arrange："createWriteStream(" 的引號在 ( 之後就收尾，第一引數閉不起來 ＝ 只是提及，
    // 不算呼叫；node -v 讓直譯器防線啟動，才驗得出「提及不觸發 flood」
    const command = 'grep -rn "createWriteStream(" test/e2e/specs/ && node -v'

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('案例 B5：git add 凍結檔 && commit 訊息含 API 名與省略號引數 → 放行', () => {
    // Arrange：writeFileSync(...) 的第一引數是 `.`，不是可解析的引數 ＝ 只是提及；
    // git add 不在會改寫工作區的子指令清單內
    const command = `git add ${FROZEN_FILE} && git commit -m "refactor: node writeFileSync(...)"`

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })
})

describe('frozen-paths-guard：切段引號感知（引號內的 ; | 不該把動詞與目標拆散）', () => {
  it('sed -i 多個 s 命令用 ; 串接 → 擋下', () => {
    const result = runGuard(`sed -i '' 's/a/b/;s/c/d/' ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('sed 正則含跳脫的 \\| → 擋下', () => {
    const result = runGuard(`sed -i '' 's/a\\|b/c/' ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('perl -pi 多個表達式用 ; 串接 → 擋下', () => {
    const result = runGuard('perl -pi -e \'s/a/b/; s/c/d/\' spec/e2e-flows/a.flow.md')
    expect(result.status).toBe(2)
  })

  it('ruby -i -pe 內含 ; → 擋下', () => {
    const result = runGuard(`ruby -i -pe 'gsub(/a/,"b"); nil' ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('cp 來源檔名含 ; → 擋下', () => {
    const result = runGuard(`cp '/tmp/a;b' ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('git checkout pathspec 含 | 與 glob → 擋下', () => {
    // Arrange：glob 目標無法逐一比對，退回檢查最近的非 glob 祖先目錄是否存在（寧可誤擋）
    const result = runGuard('git checkout main -- \'test/e2e/specs/*|x\'')
    expect(result.status).toBe(2)
  })

  it('ex -sc 命令內含 | → 擋下', () => {
    const result = runGuard(`ex -sc '%s/a/b/|x' ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('引號外的 && 仍正常切段 → 擋下後段的 tee', () => {
    const result = runGuard(`echo hi && tee ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('引號外的 ; 仍正常切段 → 擋下後段的 cp', () => {
    const result = runGuard(`echo hi; cp a.txt ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('單一 & 背景執行子也切段，echo hi & tee <frozen> → 擋下後段的 tee', () => {
    const result = runGuard(`echo hi & tee ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })
})

describe('frozen-paths-guard：open 變形與 `,\'w\')` 形狀降噪', () => {
  it('open(path, \'w\', encoding=...)（mode 後還有引數） → 擋下', () => {
    const result = runGuard(`python3 -c "open('${FROZEN_FILE}','w',encoding='utf-8')"`)
    expect(result.status).toBe(2)
  })

  it('open(path, \'w\', newline=\'\') → 擋下', () => {
    const result = runGuard(`python3 -c "open('${FROZEN_FILE}', 'w', newline='')"`)
    expect(result.status).toBe(2)
  })

  it('open(path, \'w\', 1)（buffering 位置引數） → 擋下', () => {
    const result = runGuard(`python3 -c "open('${FROZEN_FILE}','w',1)"`)
    expect(result.status).toBe(2)
  })

  it('print(\'x\', \'a\')（第一引數是純短字串，非路徑樣） → 放行', () => {
    // Arrange：'a' 剛好是合法的寫入 mode 字元，只有第一引數的語境條件能把它排除
    const result = runGuard(`python3 -c "print('x', 'a')"; cat ${FROZEN_FILE}`)
    expect(result.status).toBe(0)
  })

  it('字串 replace(\'o\', \'bar\')（第一引數是純短字串） → 放行', () => {
    const result = runGuard(`node -e "console.log('foo'.replace('o', 'bar'))"; cat ${FROZEN_FILE}`)
    expect(result.status).toBe(0)
  })

  it('open(凍結檔, \'w\') → 擋下', () => {
    const result = runGuard(`python3 -c "open('${FROZEN_FILE}','w')"`)
    expect(result.status).toBe(2)
  })

  it('變數當路徑 p=凍結檔; open(p, \'w\') → 擋下（capture 抓不到字面值，退回 flood）', () => {
    const result = runGuard(`python3 -c "p='${FROZEN_FILE}'; open(p,'w')"`)
    expect(result.status).toBe(2)
  })

  it('案例 A23：shell 變數包在引號內 open(\'$p\', \'w\') → 擋下', () => {
    // Arrange：'$p' 要 shell 展開才知道指向哪，抓成字面值會誤判成非凍結路徑而放行；
    // 含 $ 的引號字串一律當動態引數，退回 flood 後由指令原文的 p=<凍結檔> token 命中
    const result = runGuard(`p='${FROZEN_FILE}'; python3 -c "open('$p','w')"`)
    expect(result.status).toBe(2)
  })

  it('open(path, mode=\'w\') → 擋下', () => {
    const result = runGuard(`python3 -c "open('${FROZEN_FILE}', mode='w')"`)
    expect(result.status).toBe(2)
  })

  it('open(path, \'r+\')（r+ 視為寫入模式） → 擋下', () => {
    const result = runGuard(`python3 -c "open('${FROZEN_FILE}','r+')"`)
    expect(result.status).toBe(2)
  })

  it('open(os.path.join(...), \'w\')（引數是運算式） → 擋下', () => {
    const result = runGuard(`python3 -c "import os; open(os.path.join(os.getcwd(),'${FROZEN_FILE}'),'w')"`)
    expect(result.status).toBe(2)
  })

  it('呼叫 Path(...).open(\'w\') → 擋下', () => {
    const result = runGuard(`python3 -c "from pathlib import Path; Path('${FROZEN_FILE}').open('w')"`)
    expect(result.status).toBe(2)
  })

  it('fs.openSync(path, \'w\') → 擋下', () => {
    const result = runGuard(`node -e "require('fs').openSync('${FROZEN_FILE}','w')"`)
    expect(result.status).toBe(2)
  })

  it('fs.open(path, \'w\', cb)（非同步版） → 擋下', () => {
    const result = runGuard(`node -e "require('fs').open('${FROZEN_FILE}','w',()=>{})"`)
    expect(result.status).toBe(2)
  })
})

describe('frozen-paths-guard：漏防回歸（刪除／截斷／複製類 API、擴充直譯器）', () => {
  it('node rmSync 刪既有凍結檔 → 擋下', () => {
    const result = runGuard(`node -e "require('fs').rmSync('${FROZEN_FILE}')"`)
    expect(result.status).toBe(2)
  })

  it('node unlinkSync 刪既有凍結檔 → 擋下', () => {
    const result = runGuard(`node -e "require('fs').unlinkSync('${FROZEN_FILE}')"`)
    expect(result.status).toBe(2)
  })

  it('node rmdirSync 砍凍結資料夾 → 擋下', () => {
    const result = runGuard('node -e "require(\'fs\').rmdirSync(\'test/e2e/specs\')"')
    expect(result.status).toBe(2)
  })

  it('node truncateSync 截斷既有凍結檔 → 擋下', () => {
    const result = runGuard(`node -e "require('fs').truncateSync('${FROZEN_FILE}')"`)
    expect(result.status).toBe(2)
  })

  it('node truncate（非同步版）截斷既有凍結檔 → 擋下', () => {
    const result = runGuard(`node -e "require('fs').truncate('${FROZEN_FILE}',0,()=>{})"`)
    expect(result.status).toBe(2)
  })

  it('node cpSync 複製到既有凍結檔 → 擋下', () => {
    const result = runGuard(`node -e "require('fs').cpSync('a.txt','${FROZEN_FILE}')"`)
    expect(result.status).toBe(2)
  })

  it('node cp（非同步版）複製到既有凍結檔 → 擋下', () => {
    const result = runGuard(`node -e "require('fs').cp('/tmp/a','${FROZEN_FILE}',()=>{})"`)
    expect(result.status).toBe(2)
  })

  it('python os.remove 刪既有凍結檔 → 擋下', () => {
    const result = runGuard(`python3 -c "import os; os.remove('${FROZEN_FILE}')"`)
    expect(result.status).toBe(2)
  })

  it('python shutil.rmtree 砍凍結資料夾 → 擋下', () => {
    const result = runGuard('python3 -c "import shutil; shutil.rmtree(\'test/e2e/specs\')"')
    expect(result.status).toBe(2)
  })

  it('python os.symlink 覆蓋既有凍結檔 → 擋下', () => {
    const result = runGuard(`python3 -c "import os; os.symlink('/tmp/a','${FROZEN_FILE}')"`)
    expect(result.status).toBe(2)
  })

  it('python os.link 覆蓋既有凍結檔 → 擋下', () => {
    const result = runGuard(`python3 -c "import os; os.link('/tmp/a','${FROZEN_FILE}')"`)
    expect(result.status).toBe(2)
  })

  it('npx tsx -e 用 writeFileSync 改凍結檔（tsx 直譯器） → 擋下', () => {
    const result = runGuard(`npx tsx -e "require('fs').writeFileSync('${FROZEN_FILE}','x')"`)
    expect(result.status).toBe(2)
  })

  it('python3.11（帶版本號的直譯器）heredoc 寫凍結檔 → 擋下', () => {
    const command = [
      'python3.11 - <<\'PY\'',
      `open('${FROZEN_FILE}','w')`,
      'PY',
    ].join('\n')
    const result = runGuard(command)
    expect(result.status).toBe(2)
  })

  it('patch -p1 套用 heredoc diff（diff header 指向凍結檔，無 CLI 明確目標） → 擋下', () => {
    // Arrange：unified diff 常見寫法，patch 從 --- / +++ header 讀出目標檔名，
    // 逐行切段會把 `patch` 動詞與 heredoc 內文的檔名拆到不同段而漏放，故加 heredoc 合併防線
    const command = [
      'patch -p1 <<\'EOF\'',
      `--- a/${FROZEN_FILE}`,
      `+++ b/${FROZEN_FILE}`,
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'EOF',
    ].join('\n')

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(2)
  })

  it('printf 內容透過 ed -s 就地改凍結檔 → 擋下', () => {
    const result = runGuard(`printf 'x' | ed -s ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })
})

describe('frozen-paths-guard：rename／move 來源與目的都算目標', () => {
  it('fs.renameSync 目的是凍結檔 → 擋下', () => {
    const result = runGuard(`node -e "require('fs').renameSync('/tmp/a','${FROZEN_FILE}')"`)
    expect(result.status).toBe(2)
  })

  it('fs.renameSync 來源是凍結檔（搬走等同刪除） → 擋下', () => {
    const result = runGuard(`node -e "require('fs').renameSync('${FROZEN_FILE}','/tmp/a')"`)
    expect(result.status).toBe(2)
  })

  it('os.rename 來源是凍結檔 → 擋下', () => {
    const result = runGuard(`python3 -c "import os; os.rename('${FROZEN_FILE}','/tmp/a')"`)
    expect(result.status).toBe(2)
  })

  it('os.replace 來源是凍結檔 → 擋下', () => {
    const result = runGuard(`python3 -c "import os; os.replace('${FROZEN_FILE}','/tmp/a')"`)
    expect(result.status).toBe(2)
  })

  it('shutil.move 來源是凍結檔 → 擋下', () => {
    const result = runGuard(`python3 -c "import shutil; shutil.move('${FROZEN_FILE}','/tmp/a')"`)
    expect(result.status).toBe(2)
  })

  it('ruby File.rename 來源是凍結檔 → 擋下', () => {
    const result = runGuard(`ruby -e "File.rename('${FROZEN_FILE}','/tmp/a')"`)
    expect(result.status).toBe(2)
  })

  it('shutil.copy 來源是凍結檔（不動原檔） → 放行', () => {
    const result = runGuard(`python3 -c "import shutil; shutil.copy('${FROZEN_FILE}','/tmp/a')"`)
    expect(result.status).toBe(0)
  })

  it('fs.cpSync 來源是凍結檔（不動原檔） → 放行', () => {
    const result = runGuard(`node -e "require('fs').cpSync('${FROZEN_FILE}','/tmp/a')"`)
    expect(result.status).toBe(0)
  })
})

describe('frozen-paths-guard：heredoc 邊界（<< 左移、內文散字）', () => {
  it('位元左移 1 << 8 不該被當成 heredoc 而吞掉後續指令 → 放行', () => {
    // Arrange：若 << 後允許空白接數字，終止符「8」永遠等不到，
    // 後兩行會被併進同一塊，rm 與凍結路徑同段而誤擋
    const command = [
      'node -e "console.log(1 << 8)"',
      'rm -rf /tmp/cache',
      `cat ${FROZEN_FILE}`,
    ].join('\n')

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('heredoc 內文散落寫入動詞字樣（ed）、真正寫入目標在 /tmp → 放行', () => {
    // Arrange：內文只是文件敘述，動詞只認指令位置的 token
    const command = [
      'cat > /tmp/n.md <<\'EOF\'',
      `see ${FROZEN_FILE} (deprecated ed)`,
      'EOF',
    ].join('\n')

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
  })

  it('git commit 訊息字串內含 restore 與凍結路徑 → 放行', () => {
    // Arrange：git 子指令只認緊接 git 之後的第一個非旗標 token（此處是 commit）
    const result = runGuard(`git commit -m "chore: restore 依 ${FROZEN_FILE} 調整"`)
    expect(result.status).toBe(0)
  })

  it('sudo rm 凍結檔（動詞不在第一位但在指令位置） → 擋下', () => {
    const result = runGuard(`sudo rm ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('find -exec rm 凍結目錄（動詞在 -exec 之後） → 擋下', () => {
    const result = runGuard('find test/e2e/specs -name \'*.ts\' -exec rm {} \\;')
    expect(result.status).toBe(2)
  })

  it('bash -c "rm 凍結檔"（動詞在巢狀 shell 字串內） → 擋下', () => {
    const result = runGuard(`bash -c "rm ${FROZEN_FILE}"`)
    expect(result.status).toBe(2)
  })

  it('sh -c \'tee 凍結檔\' → 擋下', () => {
    const result = runGuard(`sh -c 'tee ${FROZEN_FILE}'`)
    expect(result.status).toBe(2)
  })

  it('git -c user.name=x commit 訊息含 restore 與凍結路徑 → 放行', () => {
    // Arrange：git 的 -c 全域選項會吃掉一個值，子指令要往後找到 commit
    const result = runGuard(`git -c user.name=x commit -m "chore: restore 依 ${FROZEN_FILE} 調整"`)
    expect(result.status).toBe(0)
  })

  // PR #141 review 第 1、2、4、6 輪抓出的繞道，2026-09-11 修補後轉為正常回歸案例
  it('<< 後接空白（如 << EOF）也辨識為 heredoc，內文指向凍結檔 → 擋下', () => {
    const command = [
      'patch -p1 << EOF',
      `--- a/${FROZEN_FILE}`,
      `+++ b/${FROZEN_FILE}`,
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'EOF',
    ].join('\n')
    const result = runGuard(command)
    expect(result.status).toBe(2)
  })

  it('heredoc 開啟符不在該行最後一段（如 <<\'EOF\' && echo done）內文歸給開啟符所在段 → 擋下', () => {
    const command = [
      'patch -p1 <<\'EOF\' && echo done',
      `--- a/${FROZEN_FILE}`,
      `+++ b/${FROZEN_FILE}`,
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'EOF',
    ].join('\n')
    const result = runGuard(command)
    expect(result.status).toBe(2)
  })

  it('呼叫 Path(...).open("r+")（r+ 視為寫入模式） → 擋下', () => {
    const result = runGuard(`python3 -c "from pathlib import Path; Path('${FROZEN_FILE}').open('r+')"`)
    expect(result.status).toBe(2)
  })
})

describe('frozen-paths-guard：既有防線回歸（sed/tee/cp/redirect/git/perl）', () => {
  it('tee 寫既有凍結檔 → 擋下', () => {
    const result = runGuard(`echo x | tee ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('cp 覆蓋既有凍結檔 → 擋下', () => {
    const result = runGuard(`cp a.txt ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('echo 重導向覆蓋既有凍結檔 → 擋下', () => {
    const result = runGuard(`echo x > ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('git checkout -- 還原既有凍結檔 → 擋下', () => {
    const result = runGuard(`git checkout -- ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('perl -pi 就地改既有凍結檔 → 擋下', () => {
    const result = runGuard(`perl -pi -e 's/a/b/' ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })
})

describe('frozen-paths-guard：Write／Edit 工具路徑', () => {
  it('以 Write 工具改既有凍結檔 → 擋下', () => {
    // Act
    const result = runGuardOnFile('Write', FROZEN_FILE)

    // Assert
    expect(result.status).toBe(2)
  })

  it('以 Write 工具建立全新凍結路徑檔（尚不存在） → 放行', () => {
    // Act
    const result = runGuardOnFile('Write', 'test/e2e/specs/02-new.spec.ts')

    // Assert
    expect(result.status).toBe(0)
  })

  it('以 Edit 工具改既有凍結檔 → 擋下', () => {
    // Act
    const result = runGuardOnFile('Edit', FROZEN_FILE)

    // Assert
    expect(result.status).toBe(2)
  })

  it('以 Edit 工具改非凍結路徑檔 → 放行', () => {
    // Arrange
    mkdirSync(join(tmpDir, 'app'), { recursive: true })
    writeFileSync(join(tmpDir, 'app/foo.ts'), '// 一般檔案\n')

    // Act
    const result = runGuardOnFile('Edit', 'app/foo.ts')

    // Assert
    expect(result.status).toBe(0)
  })

  it('（已知極限）tool_input.command 不是字串 → 放行', () => {
    // Act
    const result = runGuardRaw({ tool_name: 'Bash', tool_input: { command: 123 } })

    // Assert
    expect(result.status).toBe(0)
  })
})

describe('frozen-paths-guard：sentinel 一次性授權', () => {
  it('案例7a：sentinel 只列該檔 → 放行，且 sentinel 被刪除（清空）', () => {
    // Arrange
    mkdirSync(join(tmpDir, '.claude/tmp'), { recursive: true })
    const sentinelPath = join(tmpDir, '.claude/tmp/frozen-allow.json')
    writeFileSync(sentinelPath, JSON.stringify({ reason: '測試授權', files: [FROZEN_FILE] }))
    const command = [
      'python3 - <<\'PY\'',
      'from pathlib import Path',
      `Path('${FROZEN_FILE}').write_text('x')`,
      'PY',
    ].join('\n')

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
    expect(existsSync(sentinelPath)).toBe(false)
  })

  it('案例7b：sentinel 列出別的檔 → 仍擋下，且 sentinel 內容不變', () => {
    // Arrange
    mkdirSync(join(tmpDir, '.claude/tmp'), { recursive: true })
    const sentinelPath = join(tmpDir, '.claude/tmp/frozen-allow.json')
    const original = { reason: '測試授權', files: ['test/e2e/specs/other.spec.ts'] }
    writeFileSync(sentinelPath, JSON.stringify(original))
    const command = [
      'python3 - <<\'PY\'',
      'from pathlib import Path',
      `Path('${FROZEN_FILE}').write_text('x')`,
      'PY',
    ].join('\n')

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(2)
    expect(JSON.parse(readFileSync(sentinelPath, 'utf8'))).toEqual(original)
  })

  it('案例7c：sentinel 列兩檔、指令只寫其一 → 放行，且 sentinel 只消耗該檔（剩另一檔）', () => {
    // Arrange
    mkdirSync(join(tmpDir, '.claude/tmp'), { recursive: true })
    const sentinelPath = join(tmpDir, '.claude/tmp/frozen-allow.json')
    const otherFile = 'test/e2e/specs/02-other.spec.ts'
    writeFileSync(sentinelPath, JSON.stringify({ reason: '測試授權', files: [FROZEN_FILE, otherFile] }))
    const command = [
      'python3 - <<\'PY\'',
      'from pathlib import Path',
      `Path('${FROZEN_FILE}').write_text('x')`,
      'PY',
    ].join('\n')

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(0)
    const remaining = JSON.parse(readFileSync(sentinelPath, 'utf8'))
    expect(remaining.files).toEqual([otherFile])
  })
})

describe('frozen-paths-guard：擋下訊息', () => {
  it('擋下時 stderr 含被擋的凍結路徑，方便使用者定位', () => {
    // Arrange
    const command = `sed -i '' 's/a/b/' ${FROZEN_FILE}`

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(FROZEN_FILE)
  })

  it('flood 路徑擋下時 stderr 也列出實際被擋的凍結路徑', () => {
    // Arrange：引數是 os.path.join(...) 運算式，capture 抓不到字面值而退回 flood
    const command = `python3 -c "import os; open(os.path.join(os.getcwd(),'${FROZEN_FILE}'),'w')"`

    // Act
    const result = runGuard(command)

    // Assert
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(FROZEN_FILE)
  })

  it('glob 目標擋下時 stderr 列出 glob 字串本身（sentinel 要照這個字串填）', () => {
    // Act
    const result = runGuard('git checkout main -- \'test/e2e/specs/*\'')

    // Assert
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('test/e2e/specs/*')
  })
})

describe('frozen-paths-guard：ReDoS 防護', () => {
  it('80KB 惡意輸入（,\' 後接超長寫入模式字元串）不會回溯爆炸', () => {
    // Arrange：mode 字元類若用無界量詞（[rwaxb+]*[wax+][rwaxb+]*），
    // 這種輸入的比對成本是輸入長度的平方，80KB 要跑十秒以上
    const command = `python3 -c "open(p,'${'w'.repeat(80 * 1024)}"`

    // Act
    const startedAt = Date.now()
    const result = runGuard(command)
    const elapsed = Date.now() - startedAt

    // Assert：實測（darwin, node 22）約 80–120ms；門檻放寬到 1s 只為避開機器負載抖動，
    // 真的回溯爆炸會是數秒到數十秒，仍抓得到
    expect(result.status).toBe(0)
    expect(elapsed).toBeLessThan(1000)
  })
})

// PR #141 review 後續輪抓出的七則繞道，2026-09-11 使用者裁決後修補，轉為正常回歸案例
describe('frozen-paths-guard：MODE／OPEN_ARGS／OPEN_FIRST_ARG 邊界', () => {
  it('open(path, "wt")（Python 文字寫入模式） → 擋下', () => {
    const result = runGuard(`python3 -c "open('${FROZEN_FILE}','wt')"`)
    expect(result.status).toBe(2)
  })

  it('open(path, "rt")（純讀文字模式） → 放行，避免 t 被誤判成寫入指標', () => {
    const result = runGuard(`python3 -c "open('${FROZEN_FILE}','rt')"`)
    expect(result.status).toBe(0)
  })

  it('open() 第一引數是超過 120 字元的合法運算式（os.path.join 接長變數名） → 仍擋下', () => {
    const longExpr = 'a'.repeat(200)
    const result = runGuard(`python3 -c "open(os.path.join(${longExpr}, '${FROZEN_FILE}'), 'w')"`)
    expect(result.status).toBe(2)
  })

  it('open(1, "w")（數字檔案代號，非路徑） → 放行，不誤判成動態呼叫', () => {
    const result = runGuard(`python3 -c "open(1, 'w')"`)
    expect(result.status).toBe(0)
  })

  it('open(1, "w") 與唯讀提及凍結路徑同指令 → 放行，不因誤判觸發 flood 誤擋', () => {
    const result = runGuard(`python3 -c "open(1, 'w'); print('${FROZEN_FILE}')"`)
    expect(result.status).toBe(0)
  })
})

describe('frozen-paths-guard：heredoc 數字終止符與 >& 重導向', () => {
  it('heredoc 數字終止符 <<1（無空白） → 擋下', () => {
    const command = [
      'patch -p1 <<1',
      `--- a/${FROZEN_FILE}`,
      `+++ b/${FROZEN_FILE}`,
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '1',
    ].join('\n')
    const result = runGuard(command)
    expect(result.status).toBe(2)
  })

  it('1 << 8 位元左移仍不誤判成 heredoc（新增數字終止符分支後的回歸） → 放行', () => {
    const result = runGuard('console.log(1 << 8)')
    expect(result.status).toBe(0)
  })

  it('echo x >& 既有凍結檔（stdout/stderr 一起導檔） → 擋下', () => {
    const result = runGuard(`echo x >& ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('2>&1（fd 複製，目標是數字非路徑） → 放行', () => {
    const result = runGuard(`echo x 2>&1 | tee /tmp/not-frozen`)
    expect(result.status).toBe(0)
  })

  it('cat 既有凍結檔 &>/dev/null（唯讀讀取） → 放行', () => {
    const result = runGuard(`cat ${FROZEN_FILE} &>/dev/null`)
    expect(result.status).toBe(0)
  })
})

// PR #141 review round 13：驗過的迴歸與新繞道，2026-09-11 使用者裁決後修補
describe('frozen-paths-guard：$(( )) 算術展開不誤判成 heredoc（round 12 的迴歸修復）', () => {
  it('$((1<<1)) 換行後接真正的寫入指令 → 擋下（round 12 曾把它誤判成 heredoc 內文而漏放）', () => {
    const command = `echo $((1<<1))\nrm ${FROZEN_FILE}`
    const result = runGuard(command)
    expect(result.status).toBe(2)
  })

  it('$((1<<1)) 單獨、後面沒有寫入指令 → 放行', () => {
    const result = runGuard('echo $((1<<1))')
    expect(result.status).toBe(0)
  })

  it('算術展開內含巢狀括號 $(( (1+2) << 1 )) → 放行，不誤判', () => {
    const result = runGuard('echo $(( (1+2) << 1 ))')
    expect(result.status).toBe(0)
  })
})

describe('frozen-paths-guard：xargs -I {} 吃值旗標', () => {
  it('xargs -I {} rm 既有凍結檔（-I 的替換字串吃掉一個 token） → 擋下', () => {
    const result = runGuard(`xargs -I {} rm ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('xargs -I {} cat（唯讀子指令） → 放行', () => {
    const result = runGuard('find . -name x | xargs -I {} cat {}')
    expect(result.status).toBe(0)
  })
})

describe('frozen-paths-guard：wrapper 吃值旗標後的子指令位置（sudo／git）', () => {
  it('sudo -u alice rm 既有凍結檔（-u 吃掉一個值） → 擋下', () => {
    const result = runGuard(`sudo -u alice rm ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('env -u X rm 既有凍結檔（env 的 -u 吃掉一個值） → 擋下', () => {
    const result = runGuard(`env -u X rm ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('sudo rm 非凍結路徑（無吃值旗標） → 放行，確認沒有過度誤擋', () => {
    const result = runGuard('sudo rm /tmp/not-frozen')
    expect(result.status).toBe(0)
  })

  it('git --work-tree /tmp checkout -- 既有凍結檔（--work-tree 吃掉一個值） → 擋下', () => {
    const result = runGuard(`git --work-tree /tmp checkout -- ${FROZEN_FILE}`)
    expect(result.status).toBe(2)
  })

  it('git --git-dir /tmp/.git status（唯讀子指令，--git-dir 吃掉一個值） → 放行', () => {
    const result = runGuard('git --git-dir /tmp/.git status')
    expect(result.status).toBe(0)
  })
})
