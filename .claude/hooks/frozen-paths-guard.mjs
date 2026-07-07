// 凍結區門鎖（PreToolUse hook）
// 政策：凍結路徑內「修改既有檔」一律擋下（exit 2）；「建立全新檔」放行。
// 為什麼用 hook 不用 rules/frozen-paths.md：paths 觸發規則在 subagent 內不注入
//（2026-07-06 實測），只有 hook 對主對話與所有 subagent 都生效。
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const FROZEN = ['test/e2e/specs', 'spec/gherkin-feature', 'spec/e2e-flows']

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

  const filePath = input?.tool_input?.file_path
  if (!filePath)
    process.exit(0)

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const abs = resolve(projectDir, filePath)
  const rel = relative(projectDir, abs)
  const hit = FROZEN.find(p => rel === p || rel.startsWith(`${p}/`))
  if (!hit)
    process.exit(0)

  // Write 到不存在的檔案 = 授權產出者新增合約，放行
  if (input.tool_name === 'Write' && !existsSync(abs))
    process.exit(0)

  console.error(
    `凍結區保護：${rel} 屬於凍結路徑（${hit}/），禁止修改既有檔案。`
    + `依 .claude/rules/frozen-paths.md 處理：停下來，向使用者說明衝突並列出選項`
    + `（調整目標／走 spec 變更迭代流／由使用者自行修改規格）。新增全新檔案不受此限。`,
  )
  process.exit(2)
})
