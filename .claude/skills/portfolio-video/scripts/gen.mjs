// timeline.json → HyperFrames 骨架 index.html ＋ 音效觸發清單 cues.json。
// 規則（時間、導覽列、大字轉場、片頭片尾、音效點）全在這裡鎖死；產品畫面由 scene 片段提供。
// HTML 的 data-start 與 cues 的時間來自同一個累加陣列，混音不必再讀 timeline。
// 用法：node gen.mjs <work> [--sample <scene-id>]
//   一般：寫 <work>/hf/（index.html、assets/、package.json、hyperframes.json）與 <work>/cues.json
//   --sample：只取「前一個 kinetic ＋ 該 scene ＋ end」（>10 秒先砍 end 再截 scene 尾），
//             寫 <work>/hf-sample/ 與 <work>/cues.sample.json，時間從 0 重算
// 規則補充：導覽列名稱一律＝scene.title（timeline 不可有 nav 欄位）；clips 複製為 assets/<sceneId>-<別名><副檔名>，同名檔不互蓋；
//   音效 id 以 references/sfx.md 表為準；kinetic 大字不加章節編號；至少要有一個 scene。
// 規則補充（續）：選填 theme {bg, accent, accent2}（#rrggbb，可只給部分欄位，缺的用內建靛藍組）決定骨架配色；
//   scene.title ≤10 字；desc 的「，」與「,」合計最多 1 個；<video> 只接受 <video data-clip="別名"></video>（不可自閉合、不可有子元素）；
//   desc 最多 1 個「，」且每段 ≤12 字、kinetic 每行 ≤8 字；cue gain 0–2、pan −1–1、pattern 只能 "ticker"。
//   輸出內容與既有相同就不寫（保留 mtime）；素材目的檔存在、大小相同且不比來源舊才略過複製。--sample 截短後 scene 至少 2 秒。
// 結束碼：0 成功；1 schema 或 scene 片段合約違規（印 scene id＋行號）；2 素材缺檔；5 timeline.confirmed 不是 true
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// 音效 id 清單讀 references/sfx.md（與 mix.mjs 同一個 8 欄 parser），表上沒有的 id 才拒絕
const SFX_IDS = []
for (const line of readFileSync(join(HERE, '../references/sfx.md'), 'utf8').split('\n')) {
  const c = line.split('|').slice(1, -1).map((s) => s.trim())
  if (c.length >= 8 && /^[a-z_]+$/.test(c[0]) && c[6].startsWith('http')) SFX_IDS.push(c[0])
}
const DEFAULT_GAIN = { whip: 0.3, whoosh_deep: 0.28, whoosh_little: 0.25, tick: 0.22, scroll: 0.2, click: 0.28, hit_ambient: 0.3, boom: 0.32 }
const GAIN_FALLBACK = 0.3 // 表上有、但 DEFAULT_GAIN 沒列到的 id
const SAMPLE_MAX = 10
const SAMPLE_MIN_SCENE = 2 // --sample 截短後 scene 的長度下限（秒）
const clipFile = (seg, a) => `${seg.id}-${a}${extname(seg.clips[a])}`
const r3 = (x) => Math.round(x * 1000) / 1000
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function fail(code, msg) {
  console.error(msg)
  process.exit(code)
}

// ── 參數 ──
const args = process.argv.slice(2)
const sampleAt = args.indexOf('--sample')
const sampleId = sampleAt >= 0 ? args[sampleAt + 1] : null
const work = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : null
if (!work || (sampleAt >= 0 && !sampleId)) fail(1, '用法：node gen.mjs <work> [--sample <scene-id>]')

let tlJson
try {
  tlJson = JSON.parse(readFileSync(join(work, 'timeline.json'), 'utf8'))
} catch (e) {
  fail(1, `讀不到或解析失敗 ${join(work, 'timeline.json')}：${e.message}`)
}
if (tlJson.confirmed !== true) fail(5, 'timeline.json 的 confirmed 不是 true：文案未確認，不產生影片')

// ── schema 檢查 ──
const errs = []
const bad = (m) => errs.push(m)
const isStr = (v) => typeof v === 'string' && v.length > 0
if (!isStr(tlJson.product?.name)) bad('product.name 必填')
if (!isStr(tlJson.end?.quote)) bad('end.quote 必填')
if (!Array.isArray(tlJson.end?.features)) bad('end.features 必須是陣列')
const THEME_DEFAULT = { bg: '#070b16', accent: '#4f6bff', accent2: '#22d3c5' }
const theme = { ...THEME_DEFAULT, ...(tlJson.theme ?? {}) }
if (tlJson.theme !== undefined) {
  if (typeof tlJson.theme !== 'object' || tlJson.theme === null || Array.isArray(tlJson.theme)) bad('theme 必須是物件 { bg, accent, accent2 }')
  else for (const k of ['bg', 'accent', 'accent2']) if (tlJson.theme[k] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(tlJson.theme[k])) bad(`theme.${k} 必須是 #rrggbb（目前：${JSON.stringify(tlJson.theme[k])}）`)
}
const strip = (x) => x.replace(/[。，、！？；：,.!?;:\s]+$/u, '')
const cnt = (x) => [...x].length
const segsIn = Array.isArray(tlJson.segments) ? tlJson.segments : []
if (segsIn[0]?.type !== 'title') bad('segments 第一段必須是 title')
if (segsIn.at(-1)?.type !== 'end') bad('segments 最後一段必須是 end')
if (!segsIn.some((s) => s?.type === 'scene')) bad('segments 至少要有一個 scene')
const seen = new Set()
segsIn.forEach((s, i) => {
  const at = `segments[${i}]`
  if (!['title', 'kinetic', 'scene', 'end'].includes(s.type)) return bad(`${at}.type 不合法`)
  if (!(Number.isFinite(s.duration) && s.duration > 0)) bad(`${at}.duration 必須是正數`)
  if ((s.type === 'title' || s.type === 'end') && i !== 0 && i !== segsIn.length - 1) bad(`${at} 的 ${s.type} 只能在頭尾`)
  if (s.type === 'end' && s.duration < 2.7) bad(`${at}.duration 至少 2.7 秒（片尾引言→品牌名需要時間）`)
  if (s.type === 'kinetic' || s.type === 'scene') {
    if (!/^[a-z0-9-]+$/.test(s.id ?? '')) bad(`${at}.id 須符合 ^[a-z0-9-]+$`)
    else if (seen.has(s.id)) bad(`${at}.id 重複：${s.id}`)
    else seen.add(s.id)
  }
  if (s.type === 'kinetic' && !(Array.isArray(s.lines) && s.lines.length === 2 && s.lines.every(isStr))) bad(`${at}.lines 必須是 2 個字串`)
  else if (s.type === 'kinetic' && s.lines.some((l) => /^[0-9０-９]/.test(l.trim()))) bad(`${at}.lines 大字轉場不加章節編號（行首不可為數字）`)
  if (s.type === 'kinetic' && Array.isArray(s.lines)) s.lines.filter(isStr).forEach((l, j) => cnt(strip(l.trim())) > 8 && bad(`${at}.lines[${j}]「${l}」${cnt(strip(l.trim()))} 字，kinetic 每行最多 8 字`))
  if (s.type === 'scene') {
    for (const k of ['title', 'desc', 'html']) if (!isStr(s[k])) bad(`${at}.${k} 必填`)
    if (isStr(s.title) && cnt(s.title) > 10) bad(`${at}.title ${cnt(s.title)} 字，最多 10 字（導覽列與標題不折行）`)
    if (isStr(s.desc)) {
      const parts = s.desc.split(/[，,]/)
      if (parts.length > 2) bad(`${at}.desc 最多 1 個逗號（全形「，」半形「,」合計，目前 ${parts.length - 1} 個）`)
      parts.forEach((p, j) => cnt(strip(p.trim())) > 12 && bad(`${at}.desc 第 ${j + 1} 段「${p}」${cnt(strip(p.trim()))} 字，每段最多 12 字`))
    }
    if ('nav' in s) bad(`${at}.nav 已移除，導覽列一律用 title`)
    ;(s.cues ?? []).forEach((c, j) => {
      if (!(Number.isFinite(c.at) && c.at >= 0 && c.at < s.duration)) bad(`${at}.cues[${j}].at 須在 0 ~ duration 之間`)
      if (!SFX_IDS.includes(c.sfx)) bad(`${at}.cues[${j}].sfx 不在音效清單：${c.sfx}`)
      if (c.gain !== undefined && !(typeof c.gain === 'number' && c.gain >= 0 && c.gain <= 2)) bad(`${at}.cues[${j}].gain 須是 0–2 的數字（目前 ${JSON.stringify(c.gain)}）`)
      if (c.pan !== undefined && !(typeof c.pan === 'number' && c.pan >= -1 && c.pan <= 1)) bad(`${at}.cues[${j}].pan 須是 −1–1 的數字（目前 ${JSON.stringify(c.pan)}）`)
      if (c.pattern !== undefined && c.pattern !== 'ticker') bad(`${at}.cues[${j}].pattern 只能是 "ticker"（目前 ${JSON.stringify(c.pattern)}）`)
    })
    ;(s.bgm ?? []).forEach((k, j) => {
      if (!(Array.isArray(k) && k.length === 3 && k.every(Number.isFinite))) bad(`${at}.bgm[${j}] 須為 [秒, dB, 悶度]`)
    })
  }
})
if (errs.length) fail(1, 'timeline.json 違規：\n  ' + errs.join('\n  '))

// ── 累加時間：全檔唯一的一份 ──
function layout(list) {
  let t = 0
  return list.map((s) => {
    const o = { ...s, start: r3(t), end: r3(t + s.duration) }
    t = o.end
    return o
  })
}
const fullSegs = layout(segsIn)
let segs = fullSegs
if (sampleId) {
  const si = fullSegs.findIndex((s) => s.type === 'scene' && s.id === sampleId)
  if (si < 0) fail(1, `--sample：找不到 scene「${sampleId}」`)
  let sub = fullSegs[si - 1]?.type === 'kinetic' ? [fullSegs[si - 1], fullSegs[si]] : [fullSegs[si]]
  const endSeg = fullSegs.at(-1)
  const len = (a) => a.reduce((n, s) => n + s.duration, 0)
  if (len(sub) + endSeg.duration <= SAMPLE_MAX) sub.push(endSeg)
  else if (len(sub) > SAMPLE_MAX) {
    // 截短後 scene 至少 SAMPLE_MIN_SCENE 秒；前面的 kinetic 吃掉太多就不帶 kinetic
    if (sub.length > 1 && SAMPLE_MAX - sub[0].duration < SAMPLE_MIN_SCENE) sub = [sub[1]]
    const keep = len(sub) - fullSegs[si].duration
    const cut = Math.max(SAMPLE_MAX - keep, SAMPLE_MIN_SCENE)
    sub = sub.map((s) => (s.id === sampleId ? { ...s, duration: r3(Math.min(cut, s.duration)) } : s))
  }
  segs = layout(sub)
}
const total = segs.at(-1).end
const clip = (start, dur) => `data-start="${r3(start)}" data-duration="${r3(Math.min(dur, total - start))}"`
const titleSeg = segs.find((s) => s.type === 'title')
const endSeg = segs.find((s) => s.type === 'end')
const kinSegs = segs.filter((s) => s.type === 'kinetic')
const sceneSegs = segs.filter((s) => s.type === 'scene')
const allScenes = fullSegs.filter((s) => s.type === 'scene')

// ── scene 片段合約 ──
// JS 類禁用字只掃 <script> 內容；data-start 只掃 markup 的屬性寫法
const FORBIDDEN = [
  [/Math\.random/, 'Math.random'],
  [/\bDate\b/, 'Date'],
  [/setTimeout|setInterval/, 'setTimeout／setInterval'],
  [/fetch\(/, 'fetch('],
  [/requestAnimationFrame/, 'requestAnimationFrame'],
  [/\.(play|pause)\s*\(/, '.play()／.pause()'],
  [/\.currentTime/, '.currentTime'],
  [/(querySelector(All)?|tl\.\w+|H\.\w+)\(\s*`[^`]*\$\{/, 'template-literal selector（請用字串串接）'],
]
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length

function parseScene(seg) {
  const file = join(work, seg.html)
  if (!existsSync(file)) fail(1, `scene ${seg.id}：找不到片段 ${seg.html}`)
  const text = readFileSync(file, 'utf8')
  const problems = []
  const styles = [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)]
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  if (styles.length !== 1) problems.push(`行 1: 必須恰好一個 <style>（目前 ${styles.length}）`)
  if (scripts.length !== 1) problems.push(`行 1: 必須恰好一個 <script>（目前 ${scripts.length}）`)
  // <style> 內容換成同行數的空行，其餘規則只掃 style 以外的部分
  const masked = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, (m) => m.replace(/[^\n]/g, ''))
  for (const sm of masked.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const base = sm.index + sm[0].indexOf(sm[1])
    for (const [re, label] of FORBIDDEN) {
      const g = new RegExp(re.source, 'g')
      for (const m of sm[1].matchAll(g)) problems.push(`行 ${lineOf(masked, base + m.index)}: 禁用 ${label}`)
    }
  }
  const noScript = masked.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (m) => m.replace(/[^\n]/g, ''))
  for (const m of noScript.matchAll(/\sdata-start\s*=/g)) problems.push(`行 ${lineOf(noScript, m.index)}: 禁用 data-start（時間由 gen 補）`)
  for (const m of masked.matchAll(/\/\*/g)) problems.push(`行 ${lineOf(masked, m.index)}: <style> 外不可有 /* */ 註解（改用 //）`)
  for (const m of masked.matchAll(/<video\b(?![^>]*\bdata-clip=)/g)) problems.push(`行 ${lineOf(masked, m.index)}: <video> 必須是 <video data-clip="別名"></video>`)
  // data-clip 的 <video> 只接受「開標籤＋緊接結束標籤」，自閉合或有子元素都不會被替換
  for (const m of masked.matchAll(/<video\b[^>]*\bdata-clip=[^>]*>(?!\s*<\/video>)/g)) problems.push(`行 ${lineOf(masked, m.index)}: <video data-clip> 不可自閉合或含子元素，請寫成 <video data-clip="別名"></video>`)
  const aliases = new Set(Object.keys(seg.clips ?? {}))
  const used = []
  for (const m of masked.matchAll(/<(video|img)\b[^>]*\bdata-clip="([^"]*)"/g)) {
    if (!aliases.has(m[2])) problems.push(`行 ${lineOf(masked, m.index)}: data-clip="${m[2]}" 未在 timeline clips 定義`)
    used.push(m[2])
  }
  if (problems.length) fail(1, `scene ${seg.id}（${seg.html}）片段違規：\n  ` + problems.join('\n  '))

  let k = 0
  const markup = noScript
    .replace(/<video\b[^>]*\bdata-clip="([^"]*)"[^>]*>\s*<\/video>/g, (_, a) => {
      const id = `s-${seg.id}-${a}`
      return `<video id="${id}" src="assets/${clipFile(seg, a)}" ${clip(seg.start, seg.duration)} data-track-index="${20 + k++}" muted playsinline></video>`
    })
    .replace(/<img\b([^>]*)\bdata-clip="([^"]*)"([^>]*)>/g, (_, p, a, q) => `<img id="s-${seg.id}-${a}" src="assets/${clipFile(seg, a)}" ${(p + q).trim()}>`)
  return { css: styles[0][1], js: scripts[0][1], markup: markup.trim() }
}

const parsed = new Map(sceneSegs.map((s) => [s.id, parseScene(s)]))

// ── 素材 ──
const outName = sampleId ? 'hf-sample' : 'hf'
const outDir = join(work, outName)
const missing = []
for (const s of sceneSegs) for (const f of Object.values(s.clips ?? {})) if (!existsSync(join(work, f))) missing.push(`${s.id}: ${f}`)
if (missing.length) fail(2, '素材缺檔：\n  ' + missing.join('\n  '))

// ── cues ──
const sfx = []
const cue = (t, id, from, extra = {}) => sfx.push({ t: r3(Math.max(0, t)), id, gain: DEFAULT_GAIN[id] ?? GAIN_FALLBACK, ...extra, from })
const keys = []
const key = (t, db, wet) => keys.push([r3(Math.min(Math.max(t, 0), total)), db, wet])
const END_LOGO = 1.6 // 片尾品牌名出現點（相對 end 起點）
for (const s of segs) {
  if (s.type === 'title') {
    cue(s.start + 0.3, 'hit_ambient', 'title', { trim: 2.6, fadeOut: 1.2 })
    key(s.start, -10, 1.0)
    key(Math.min(s.start + 2, s.end), -6, 0.8)
  } else if (s.type === 'kinetic') {
    cue(s.start + 0.02, 'boom', s.id, { trim: 1.4, fadeOut: 0.6 })
    key(s.start, -6, 0.75)
  } else if (s.type === 'scene') {
    cue(s.start - 0.25, 'whoosh_deep', s.id, { trim: 1.3, fadeOut: 0.5 })
    ;(s.cues ?? []).forEach((c, i) => {
      if (c.at >= s.duration) return // --sample 截掉的尾段
      const extra = {}
      if (c.pan !== undefined) extra.pan = c.pan
      if (c.pattern) extra.pattern = c.pattern
      cue(s.start + c.at, c.sfx, `${s.id}.cues[${i}]`, { ...extra, ...(c.gain !== undefined && { gain: c.gain }) })
    })
    if (s.bgm) s.bgm.forEach(([t, db, wet]) => key(s.start + t, db, wet))
    else key(s.start + 0.3, -1, 0)
  } else {
    cue(s.start + END_LOGO, 'hit_ambient', 'end')
    key(s.start, -9, 0.9)
    key(s.start + END_LOGO, -2, 0.1)
  }
}
key(total - 1.2, -3, 0.2)
key(total, -40, 0.6)
sfx.sort((a, b) => a.t - b.t)
keys.sort((a, b) => a[0] - b[0])
const cues = {
  version: 1,
  total,
  sr: 48000,
  segments: segs.map((s) => ({ id: s.id ?? s.type, type: s.type, start: s.start, end: s.end })),
  sfx,
  bgm: { file: tlJson.bgm?.file ?? 'bgm.wav', gain: 0.55, lowpassHz: 650, keys },
}

// ── 導覽列：kinetic 起點切到下一個 scene（沒有 kinetic 就在 scene 起點切）──
const navItems = allScenes.map((s) => `<span class="nv" id="nv${allScenes.indexOf(s)}">${esc(s.title)}<i></i></span>`).join('')
const navSwitches = sceneSegs.map((s) => {
  const i = segs.indexOf(s)
  return { idx: allScenes.findIndex((a) => a.id === s.id), t: segs[i - 1]?.type === 'kinetic' ? segs[i - 1].start : s.start }
})
const navStart = navSwitches[0].t
const navEnd = endSeg ? endSeg.start : total - 0.4

// ── HTML 片段 ──
const kinHtml = kinSegs
  .map((k) => `      <div id="kin-${k.id}" class="clip kin" ${clip(k.start, k.duration)} data-track-index="2">
        <div class="kl kl-1">${esc(k.lines[0])}</div><div class="kl kl-2">${esc(k.lines[1])}</div>
      </div>`)
  .join('\n')

const sceneHtml = sceneSegs
  .map((s) => {
    const desc = esc(s.desc).replace(/[，,]/g, (m) => `${m}<br>`)
    return `      <div id="s-${s.id}" class="scene">
        <div id="s-${s.id}-pl" class="pl"><div class="pl-rule"></div><div class="pl-title">${esc(s.title)}</div><div class="pl-desc">${desc}</div></div>
${parsed.get(s.id).markup.replace(/^/gm, '        ')}
      </div>`
  })
  .join('\n')

const titleHtml = titleSeg
  ? `      <div id="title" class="clip" ${clip(0, titleSeg.end + 0.3)} data-track-index="1">
        <div id="t-eye">${esc(tlJson.product.eyebrow ?? '')}</div>
        <div id="t-logo">${esc(tlJson.product.name)}</div>
        <div id="t-sub">${esc(tlJson.product.tagline ?? '')}</div>
      </div>`
  : ''
const endHtml = endSeg
  ? `      <div id="end" class="clip" ${clip(endSeg.start, endSeg.duration)} data-track-index="8">
        <div id="e-quote">${esc(tlJson.end.quote)}</div>
        <div id="e-logo">${esc(tlJson.product.name)}</div>
        <div id="e-sub">${esc(tlJson.product.tagline ?? '')}</div>
        <div id="e-feat">${tlJson.end.features.map(esc).join(' · ')}</div>
      </div>`
  : ''

const CSS = String.raw`
      :root { --bg: ${theme.bg}; --bg-deep: color-mix(in srgb, ${theme.bg} 30%, #000000); --accent: ${theme.accent}; --accent2: ${theme.accent2}; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--bg); }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; font-family: system-ui, sans-serif; color: #f4f6fb; }

      #bg { position: absolute; inset: 0; background: var(--bg); z-index: 0; }
      .glow { position: absolute; border-radius: 50%; filter: blur(60px); }
      #glow-a { left: -200px; top: -260px; width: 1100px; height: 800px; background: color-mix(in srgb, var(--accent) 30%, transparent); }
      #glow-b { right: -260px; bottom: -300px; width: 1000px; height: 760px; background: color-mix(in srgb, var(--accent2) 16%, transparent); }
      #dots { position: absolute; inset: 0; opacity: 0.3; background-image: radial-gradient(rgba(255,255,255,.13) 1px, transparent 1.2px); background-size: 28px 28px; }

      #title { position: absolute; inset: 0; z-index: 3; background: var(--bg-deep); text-align: center; }
      #t-eye { position: absolute; left: 0; width: 100%; top: 380px; font-size: 22px; font-weight: 600; letter-spacing: 0.5em; color: rgba(255,255,255,0.5); }
      #t-logo { position: absolute; left: 0; width: 100%; top: 430px; font-size: 150px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
      #t-sub { position: absolute; left: 0; width: 100%; top: 620px; font-size: 36px; font-weight: 500; letter-spacing: 0.2em; color: rgba(255,255,255,0.72); }

      #sweep { position: absolute; inset: 0; z-index: 2; overflow: hidden; pointer-events: none; }
      .sw-rot { position: absolute; left: -400px; top: -600px; width: 2720px; height: 2280px; transform: rotate(15deg); }
      .sw-band { position: absolute; top: 0; left: 0; width: 760px; height: 100%;
        background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent) 22%, transparent) 38%, rgba(255, 255, 255, 0.10) 50%, color-mix(in srgb, var(--accent) 22%, transparent) 62%, transparent 100%); }

      .kin { position: absolute; inset: 0; z-index: 4; }
      .kl { position: absolute; left: 0; width: 100%; text-align: center; font-size: 136px; font-weight: 800; line-height: 1; letter-spacing: 0.02em; white-space: nowrap; }
      .kl-1 { top: 380px; color: #ffffff; }
      .kl-2 { top: 560px; color: rgba(255, 255, 255, 0.5); }

      .scene { position: absolute; inset: 0; visibility: hidden; z-index: 3; }
      .pl { position: absolute; left: 96px; top: 150px; width: 430px; }
      .pl-rule { height: 3px; width: 64px; margin: 0 0 22px; border-radius: 2px; background: linear-gradient(90deg, var(--accent), var(--accent2)); }
      .pl-title { font-size: 46px; font-weight: 800; line-height: 1.2; white-space: nowrap; }
      .pl-desc { margin-top: 16px; font-size: 24px; line-height: 1.5; white-space: nowrap; color: rgba(226, 232, 245, 0.66); }

      .stat { position: absolute; left: 96px; width: 400px; padding: 20px 26px 22px; border-radius: 22px; z-index: 2;
        background: linear-gradient(160deg, color-mix(in srgb, var(--accent) 18%, var(--bg)), var(--bg-deep));
        box-shadow: 0 30px 70px rgba(0, 0, 0, 0.5), 0 0 0 1px color-mix(in srgb, color-mix(in srgb, var(--accent) 60%, white) 35%, transparent), 0 0 60px color-mix(in srgb, var(--accent) 35%, transparent); }
      .stat-l { font-size: 22px; font-weight: 600; color: color-mix(in srgb, var(--accent) 45%, white); letter-spacing: 0.06em; }
      .stat-v { margin-top: 6px; display: flex; align-items: baseline; gap: 10px; }
      .stat-n { font-family: ui-monospace, monospace; font-size: 84px; font-weight: 700; line-height: 1; color: #ffffff; }
      .stat-u { font-size: 30px; font-weight: 600; color: color-mix(in srgb, var(--accent) 20%, white); }
      .win { position: absolute; left: 528px; top: 150px; width: 1312px; height: 860px; border-radius: 18px; overflow: hidden; background: color-mix(in srgb, var(--bg) 88%, white); transform-origin: 0 0;
        box-shadow: 0 50px 120px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.09); }
      .bar { position: absolute; left: 0; right: 0; top: 0; height: 40px; background: color-mix(in srgb, var(--bg) 80%, white); display: flex; align-items: center; gap: 9px; padding: 0 18px; }
      .bar i { width: 12px; height: 12px; border-radius: 50%; display: block; }
      .bar-t { position: absolute; left: 0; right: 0; text-align: center; font-size: 16px; color: rgba(255, 255, 255, 0.55); }
      .view { position: absolute; left: 0; right: 0; top: 40px; bottom: 0; overflow: hidden; background: #eef0f5; }
      .cam { position: absolute; left: 0; top: 0; width: 100%; height: 100%; transform-origin: 0 0; }
      .cam video, .cam img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

      #nav { position: absolute; left: 0; width: 100%; top: 40px; z-index: 8; text-align: center; }
      #nav-in { display: inline-flex; gap: 24px; padding: 12px 28px; border-radius: 40px; background: color-mix(in srgb, var(--bg) 78%, transparent); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08); }
      .nv { position: relative; font-size: 17px; font-weight: 600; color: #ffffff; opacity: 0.38; white-space: nowrap; }
      .nv i { position: absolute; left: 0; right: 0; bottom: -8px; height: 3px; border-radius: 2px; background: linear-gradient(90deg, var(--accent), var(--accent2)); opacity: 0; }

      #end { position: absolute; inset: 0; z-index: 9; background: var(--bg-deep); text-align: center; }
      #e-quote { position: absolute; left: 0; width: 100%; top: 480px; font-size: 64px; font-weight: 700; letter-spacing: 0.04em; }
      #e-logo { position: absolute; left: 0; width: 100%; top: 380px; font-size: 150px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
      #e-sub { position: absolute; left: 0; width: 100%; top: 570px; font-size: 36px; font-weight: 500; letter-spacing: 0.2em; color: rgba(255,255,255,0.72); }
      #e-feat { position: absolute; left: 0; width: 100%; top: 660px; font-size: 26px; letter-spacing: 0.12em; color: rgba(255,255,255,0.5); }

      #fade-in, #fade-out { position: absolute; inset: 0; background: #000000; z-index: 10; pointer-events: none; }
      #fade-out { opacity: 0; }

      .hf-number-wheel { display: inline-flex; align-items: baseline; gap: 0.02em; font-variant-numeric: tabular-nums; }
      .hf-number-wheel-digit { display: inline-block; height: 1em; overflow: hidden; }
      .hf-number-wheel-strip { display: grid; will-change: transform; }
      .hf-number-wheel-strip span { height: 1em; line-height: 1em; }
`

// 瀏覽器端 helper：selector 一律用字串串接，不用 template literal
const RUNTIME = String.raw`
      window.__timelines = window.__timelines || {};
      // 數字滾輪：每一位數做成 0→目標數字的直條，之後用時間軸往上捲
      document.querySelectorAll(".hf-number-wheel").forEach(function (el) {
        var value = el.dataset.value || "0";
        el.textContent = "";
        for (var c = 0; c < value.length; c++) {
          var ch = value.charAt(c);
          if (!/\d/.test(ch)) { el.append(document.createTextNode(ch)); continue; }
          var stops = 10 + Number(ch);
          var frame = document.createElement("span");
          frame.className = "hf-number-wheel-digit";
          frame.setAttribute("data-layout-ignore", ""); // 滾輪靠 overflow 裁掉其他數字，check 會誤報 text_occluded
          var strip = document.createElement("span");
          strip.className = "hf-number-wheel-strip";
          strip.dataset.target = String(-stops);
          for (var i = 0; i <= stops; i++) { var s = document.createElement("span"); s.textContent = String(i % 10); strip.appendChild(s); }
          frame.appendChild(strip);
          el.appendChild(frame);
        }
      });

      var tl = gsap.timeline({ paused: true });
      var H = {
        show: function (sel, a, z) { tl.set(sel, { visibility: "visible" }, a); tl.set(sel, { visibility: "hidden" }, z); },
        wheel: function (sel, at) {
          tl.fromTo(sel + " .hf-number-wheel-strip", { y: "0em" }, { y: function (_, s) { return s.dataset.target + "em"; }, duration: 1.0, ease: "power3.out", stagger: 0.05 }, at);
        },
        pop: function (sel, at) {
          tl.fromTo(sel, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: "back.out(1.9)" }, at);
          H.wheel(sel, at);
        },
        panelIn: function (sel, at) {
          tl.fromTo(sel + " > *", { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.38, ease: "power3.out", stagger: 0.05 }, at);
        },
        sceneOut: function (sel, z) { tl.to(sel, { opacity: 0, scale: 0.97, duration: 0.25, ease: "power2.in" }, z - 0.25); }
      };
`

// ── 骨架 GSAP：所有 selector 在 Node 端展開成字面字串 ──
const L = []
const t = (s) => L.push('      ' + s)
t(`tl.fromTo("#glow-a", { x: 0, y: 0 }, { x: 220, y: 120, duration: ${total}, ease: "sine.inOut" }, 0);`)
t(`tl.fromTo("#glow-b", { x: 0, y: 0 }, { x: -200, y: -100, duration: ${total}, ease: "sine.inOut" }, 0);`)
t(`tl.fromTo("#fade-in", { opacity: 1 }, { opacity: 0, duration: 0.4, ease: "power1.out" }, 0);`)
t(`tl.fromTo("#fade-out", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.in" }, ${r3(total - 0.4)});`)
if (titleSeg) {
  const z = titleSeg.end
  t(`tl.fromTo("#t-eye", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, 0.2);`)
  t(`tl.fromTo("#t-logo", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 0.35);`)
  t(`tl.fromTo("#t-sub", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0.8);`)
  t(`tl.to(["#t-eye", "#t-logo", "#t-sub"], { opacity: 0, duration: 0.3, ease: "power2.in" }, ${r3(z - 0.3)});`)
  t(`tl.to("#title", { opacity: 0, duration: 0.3, ease: "power1.inOut" }, ${r3(z - 0.05)});`)
}
kinSegs.forEach((k, ki) => {
  const l2 = k.duration > 1 ? 0.35 : 0.22
  t(`tl.fromTo("#kin-${k.id} .kl-1", { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, ${r3(k.start + 0.05)});`)
  t(`tl.fromTo("#kin-${k.id} .kl-2", { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, ${r3(k.start + l2)});`)
  t(`tl.to("#kin-${k.id} > *", { y: -30, opacity: 0, duration: 0.2, ease: "power2.in" }, ${r3(k.start + k.duration - 0.2)});`)
  t(`tl.fromTo("#sw-main", { x: -900 }, { x: 2800, duration: ${r3(k.duration + 0.2)}, ease: "power1.inOut"${ki ? ', immediateRender: false' : ''} }, ${r3(Math.max(0, k.start - 0.1))});`)
})
t(`tl.fromTo("#nav", { opacity: 0, y: -16 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, ${navStart});`)
for (const n of navSwitches) {
  t(`tl.to(".nv", { opacity: 0.38, duration: 0.3 }, ${n.t});`)
  t(`tl.to(".nv i", { opacity: 0, duration: 0.3 }, ${n.t});`)
  t(`tl.to("#nv${n.idx}", { opacity: 1, duration: 0.3 }, ${n.t});`)
  t(`tl.to("#nv${n.idx} i", { opacity: 1, duration: 0.3 }, ${n.t});`)
}
t(`tl.to("#nav", { opacity: 0, duration: 0.3 }, ${r3(navEnd - 0.3)});`)
for (const s of sceneSegs) {
  L.push('')
  t(`// scene ${s.id}`)
  t(`H.show("#s-${s.id}", ${s.start}, ${s.end});`)
  t(`(function (tl, T0, DUR, H) {`)
  L.push(parsed.get(s.id).js.replace(/^\n+|\s+$/g, '').replace(/^/gm, '        '))
  t(`})(tl, ${s.start}, ${s.duration}, H);`)
}
if (endSeg) {
  const E = endSeg.start
  L.push('')
  t(`tl.fromTo("#end", { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power1.inOut" }, ${E});`)
  t(`tl.fromTo("#e-quote", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, ${r3(E + 0.2)});`)
  t(`tl.to("#e-quote", { opacity: 0, duration: 0.3, ease: "power2.in" }, ${r3(E + 1.3)});`)
  t(`tl.fromTo("#e-logo", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, ${r3(E + END_LOGO)});`)
  t(`tl.fromTo("#e-sub", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, ${r3(E + 1.95)});`)
  t(`tl.fromTo("#e-feat", { opacity: 0 }, { opacity: 1, duration: 0.5 }, ${r3(E + 2.2)});`)
}
L.push('')
t(`window.__timelines["main"] = tl;`)
t(`tl.seek(0);`)

const sceneCss = sceneSegs.map((s) => `      /* scene ${s.id} */\n${parsed.get(s.id).css.replace(/^\n+|\s+$/g, '')}`).join('\n')

const body = `    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">
      <div id="bg" class="clip" ${clip(0, total)} data-track-index="0">
        <div id="glow-a" class="glow"></div><div id="glow-b" class="glow"></div><div id="dots"></div>
      </div>
${titleHtml}
      <div id="sweep" class="clip" ${clip(0, total)} data-track-index="15"><div class="sw-rot"><div class="sw-band" id="sw-main"></div></div></div>
${kinHtml}
${sceneHtml}
      <div id="nav" class="clip" ${clip(navStart, navEnd - navStart)} data-track-index="14"><div id="nav-in">${navItems}</div></div>
${endHtml}
      <div id="fade-in" class="clip" ${clip(0, 0.4)} data-track-index="9"></div>
      <div id="fade-out" class="clip" ${clip(total - 0.4, 0.4)} data-track-index="11"></div>
    </div>`

// id 必須全檔唯一
const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))]
if (dup.length) fail(1, `id 重複：${dup.join(', ')}（scene 內請用 s-<scene-id>- 前綴）`)

const html = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>${esc(tlJson.product.name)}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>${CSS}${sceneCss}
    </style>
  </head>
  <body>
${body}

    <script>${RUNTIME}
${L.join('\n')}
    </script>
  </body>
</html>
`

// ── 輸出 ──
// 內容相同就不寫（保留 mtime，render.sh 的重用才會生效）
const writeIfChanged = (file, text) => {
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return
  writeFileSync(file, text)
}
const copyIfChanged = (src, dst) => {
  // 大小相同且來源不比目的檔新才略過；同大小的新錄檔靠 mtime 抓到
  if (existsSync(dst) && statSync(dst).size === statSync(src).size && statSync(src).mtimeMs <= statSync(dst).mtimeMs) return
  copyFileSync(src, dst)
}
mkdirSync(join(outDir, 'assets'), { recursive: true })
for (const s of sceneSegs) for (const [a, f] of Object.entries(s.clips ?? {})) copyIfChanged(join(work, f), join(outDir, 'assets', clipFile(s, a)))
for (const f of ['package.json', 'hyperframes.json']) writeIfChanged(join(outDir, f), readFileSync(join(HERE, '../assets/hf-project', f), 'utf8'))
writeIfChanged(join(outDir, 'index.html'), html)
writeIfChanged(join(work, sampleId ? 'cues.sample.json' : 'cues.json'), JSON.stringify(cues, null, 2) + '\n')
console.log(`${outName}/index.html total=${total}s sfx=${sfx.length}`)
