#!/usr/bin/env node
// 視覺層級硬規則檢查（規範：spec/ui-config/visual-hierarchy.md ＋ creative-direction.md §3/§4）
// 只檢查可機器判定的違規，語意層級（一頁一主標等）仍由規範文件約束。
// 行銷頁（app/pages/(marketing)/）依 creative-direction.md §3 放行 display 級規則，
// 改用 marketingPattern 檢查（text-8xl+、font-extralight 以下仍禁）。
// 色彩／動效規則只掃 Tailwind class 字面值；<style> 區塊與複合 shadow 中段的色值不在範圍。
// 由 npm run eslint 串跑；違規列出 file:line 並以 exit 1 失敗。

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const SCAN_DIR = 'app'

// transition 任意值允許的屬性（paint/composite 層；layout 屬性動畫走 transform 取代）
const TRANSITION_ALLOW = new Set(['color', 'background-color', 'border-color', 'opacity', 'transform', 'translate', 'scale', 'rotate', 'box-shadow', 'filter', 'backdrop-filter', 'outline-color', 'text-decoration-color', 'fill', 'stroke'])
const TRANSITION_ARBITRARY = /\btransition-\[([^\]]+)\]/

const RULES = [
  {
    pattern: /\btext-\[\d+(?:\.\d+)?(?:px|rem|em|pt)\]/,
    message: '任意值字級（text-[Npx]）——改用內建字級，或先在 @theme 定義具名 token',
  },
  {
    pattern: /\bfont-(?:thin|extralight|light)\b/,
    message: 'font-light 以下字重——小字不可讀，最低用 font-normal',
    marketingPattern: /\bfont-(?:thin|extralight)\b/,
    marketingMessage: 'font-extralight 以下字重——行銷頁僅 font-light 可配 display 大字（creative-direction.md §3）',
  },
  {
    pattern: /\btext-(?:5xl|6xl|7xl|8xl|9xl)\b/,
    message: 'text-5xl 以上——後台介面最大 text-3xl（統計數值）',
    marketingPattern: /\btext-(?:8xl|9xl)\b/,
    marketingMessage: 'text-8xl 以上——行銷頁 display 上限 text-7xl（creative-direction.md §3）',
  },
  {
    // 行判定：替代指示需與 outline-none 同行（focus-visible / focus-within 皆可過關）。
    // 容器 focus-within＋內部 input outline-none 的合法模式，input 同行帶 focus-within 相關
    // class（如 group-focus-within:*）即放行。
    pattern: /\boutline-none\b/,
    message: 'outline-none 未補 focus-visible 替代（需同行）——鍵盤使用者會失去焦點指示',
    exempt: line => line.includes('focus-visible') || line.includes('focus-within'),
  },
  {
    pattern: /-\[(?:#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb|color)\()/,
    message: 'Tailwind class 任意值色彩（-[#hex]／rgb()…）——用語意色或 @theme token',
  },
  {
    pattern: /\btransition-all\b/,
    message: 'transition-all——改用 transition 或列舉具體屬性（只動 paint/composite 屬性）',
  },
  {
    pattern: /\btransition-\[[^\]]+\]/,
    message: 'transition 任意值含白名單外屬性——只動 transform/opacity 等 paint/composite 屬性（creative-direction.md §4）',
    exempt: (line) => {
      const m = line.match(TRANSITION_ARBITRARY)
      return !m || m[1].split(',').every(p => TRANSITION_ALLOW.has(p.trim()))
    },
  },
  {
    pattern: /\b(?:duration|ease|delay)-\[/,
    message: 'duration/ease/delay 任意值——duration 用內建三檔（150/250/400），easing 用 @theme motion token（creative-direction.md §4）',
  },
  {
    pattern: /\bduration-(?!150\b|250\b|400\b)\d/,
    message: 'duration 檔位外——只用 duration-150/250/400 三檔（creative-direction.md §4）',
  },
  {
    pattern: /\bbg-clip-text\b/,
    message: 'gradient text（bg-clip-text）——AI 模板味，禁用（creative-direction.md §3）',
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

// 行銷頁路徑（依專案校準：模板慣例是 (marketing) route group；
// 真實專案若以 middleware 定義公開性，把對應頁面目錄加進此陣列）
const MARKETING_PATHS = [join(SCAN_DIR, 'pages', '(marketing)')]
// 共用元件僅行銷頁使用且需要 display 級時，檔頭前 5 行加此註記豁免
const MARKETING_MARKER = 'visual-hierarchy: marketing'

const files = walk(SCAN_DIR)
const violations = []

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const isMarketing = MARKETING_PATHS.some(p => file.startsWith(p))
    || lines.slice(0, 5).some(l => l.includes(MARKETING_MARKER))
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      const pattern = isMarketing && rule.marketingPattern ? rule.marketingPattern : rule.pattern
      const message = isMarketing && rule.marketingMessage ? rule.marketingMessage : rule.message
      if (pattern.test(line) && !rule.exempt?.(line))
        violations.push(`${file}:${i + 1} ${message}`)
    }
  })
}

if (violations.length) {
  console.error(`視覺層級檢查失敗：\n${violations.map(v => `  ${v}`).join('\n')}`)
  process.exit(1)
}
console.log(`視覺層級檢查通過（掃描 ${files.length} 個 .vue 檔）`)
