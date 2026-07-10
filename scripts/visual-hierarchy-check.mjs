#!/usr/bin/env node
// 視覺層級硬規則檢查（規範：spec/ui-config/visual-hierarchy.md）
// 只檢查可機器判定的違規，語意層級（一頁一主標等）仍由規範文件約束。
// 由 npm run eslint 串跑；違規列出 file:line 並以 exit 1 失敗。

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const SCAN_DIR = 'app'

const RULES = [
  {
    pattern: /\btext-\[\d+(?:\.\d+)?(?:px|rem|em|pt)\]/,
    message: '任意值字級（text-[Npx]）——改用內建字級，或先在 @theme 定義具名 token',
  },
  {
    pattern: /\bfont-(?:thin|extralight|light)\b/,
    message: 'font-light 以下字重——小字不可讀，最低用 font-normal',
  },
  {
    pattern: /\btext-(?:5xl|6xl|7xl|8xl|9xl)\b/,
    message: 'text-5xl 以上——後台介面最大 text-3xl（統計數值）',
  },
  {
    pattern: /\boutline-none\b/,
    message: 'outline-none 未補 focus-visible 替代——鍵盤使用者會失去焦點指示',
    exempt: line => line.includes('focus-visible'),
  },
]

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  }
  catch {
    return []
  }
  return entries.flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory())
      return walk(path)
    return e.name.endsWith('.vue') ? [path] : []
  })
}

const files = walk(SCAN_DIR)
const violations = []

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line) && !rule.exempt?.(line))
        violations.push(`${file}:${i + 1} ${rule.message}`)
    }
  })
}

if (violations.length) {
  console.error(`視覺層級檢查失敗：\n${violations.map(v => `  ${v}`).join('\n')}`)
  process.exit(1)
}
console.log(`視覺層級檢查通過（掃描 ${files.length} 個 .vue 檔）`)
