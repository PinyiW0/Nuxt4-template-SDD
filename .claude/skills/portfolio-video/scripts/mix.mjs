#!/usr/bin/env node
// 用途：只讀 <work>/cues.json，把配樂起伏與音效疊成一條音軌，再用 loudnorm 兩段式標準化響度。
//   缺的音效依 references/sfx.md 的「下載網址」自動抓到 <work>/sfx/<id>.mp3；每次都用 ffprobe 長度對表（容許 max(表上秒數×10%, 0.05 秒)），
//   對表失敗的檔會被刪除，避免下次沿用錯檔。
// 用法：node mix.mjs <work> [--sample] [--lufs -16] [--tp -1.5]
//   --sample 改讀 cues.sample.json、輸出 mix.sample.wav；預設輸出 <work>/mix.wav（48 kHz 立體聲）。
// 結束碼：0 成功；1 音效缺且下載失敗，或長度不符（該檔已刪除）；2 ffmpeg 失敗；3 輸出長度與 cues.total 差 >0.05 秒，或配樂比 cues.total 短超過 0.5 秒。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 48000
const args = process.argv.slice(2)
const flag = (name, def) => { const i = args.indexOf(name); return i < 0 ? def : args[i + 1] }
const sample = args.includes('--sample')
const lufs = Number(flag('--lufs', -16))
const tp = Number(flag('--tp', -1.5))
const work = args.find((a, i) => !a.startsWith('--') && !['--lufs', '--tp'].includes(args[i - 1]))
if (!work) { console.error('用法：node mix.mjs <work> [--sample] [--lufs -16] [--tp -1.5]'); process.exit(1) }
const W = resolve(work)

function fail(code, msg) { console.error(msg); process.exit(code) }

function run(cmd, argv, input) {
  const r = spawnSync(cmd, argv, { input, maxBuffer: 1 << 30 })
  if (r.status !== 0) fail(2, `${cmd} 失敗：\n${r.stderr?.toString().slice(-800)}`)
  return r
}

// 解成 48 kHz 立體聲 f32，回傳交錯的 Float32Array；filter 可選
function decode(file, filter) {
  const a = ['-loglevel', 'error', '-i', file, ...(filter ? ['-af', filter] : []), '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-']
  const buf = run('ffmpeg', a).stdout
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)))
}

function peakOf(a) { let p = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v } return p }

function duration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  return Number(r.stdout?.toString().trim())
}

// ── 讀 cues 與 sfx 表 ──
const cuesPath = join(W, sample ? 'cues.sample.json' : 'cues.json')
if (!existsSync(cuesPath)) fail(1, `找不到 ${cuesPath}`)
const cues = JSON.parse(readFileSync(cuesPath, 'utf8'))

const sfxMd = join(dirname(fileURLToPath(import.meta.url)), '../references/sfx.md')
const table = {}
for (const line of readFileSync(sfxMd, 'utf8').split('\n')) {
  const c = line.split('|').slice(1, -1).map((s) => s.trim())
  if (c.length >= 8 && /^[a-z_]+$/.test(c[0]) && c[6].startsWith('http')) table[c[0]] = { page: c[5], url: c[6], sec: Number(c[7]) }
}

// ── 準備音效檔：缺檔就下載並對長度 ──
const sfxDir = join(W, 'sfx')
mkdirSync(sfxDir, { recursive: true })
for (const id of new Set(cues.sfx.map((s) => s.id))) {
  const f = join(sfxDir, `${id}.mp3`)
  const row = table[id]
  if (!existsSync(f)) {
    if (!row) fail(1, `音效 ${id} 不在 references/sfx.md，也沒有 ${f}；請改 id 或手動放檔`)
    try {
      const res = await fetch(row.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      writeFileSync(f, Buffer.from(await res.arrayBuffer()))
    } catch (e) {
      fail(1, `音效 ${id} 下載失敗（${e.message}）；請到 ${row.page} 手動下載，放到 ${f}`)
    }
  }
  // 每次都對表（含已存在的檔）；不符就刪掉，避免下次靜默沿用錯檔
  if (!row) continue
  const d = duration(f)
  if (!(Math.abs(d - row.sec) <= Math.max(row.sec * 0.1, 0.05))) {
    unlinkSync(f)
    fail(1, `音效 ${id} 長度 ${d}s 與表上 ${row.sec}s 不符（±max(10%, 0.05s)）；檔案已刪除，請重跑讓它重新下載，或到 ${row.page} 手動下載，放到 ${f}`)
  }
}

// ── 疊加音效 ──
const total = cues.total
const N = Math.round((total + 1) * SR)
const mix = new Float32Array(N * 2)
const cache = {}
function load(id) {
  if (!cache[id]) {
    const a = decode(join(sfxDir, `${id}.mp3`))
    const p = Math.max(1e-6, peakOf(a))
    for (let i = 0; i < a.length; i++) a[i] /= p // 先把每個音效峰值拉到 1，再用 gain 控制
    cache[id] = a
  }
  return cache[id]
}

function put(s, t, gain, pan = 0) {
  let a = load(s.id)
  if (s.trim) a = a.slice(0, Math.floor(s.trim * SR) * 2)
  else a = a.slice()
  if (s.fadeOut) {
    const n = Math.min(a.length / 2, Math.floor(s.fadeOut * SR))
    for (let k = 0; k < n; k++) {
      const g = n > 1 ? 1 - k / (n - 1) : 0
      const i = (a.length / 2 - n + k) * 2
      a[i] *= g; a[i + 1] *= g
    }
  }
  const gl = gain * (1 - Math.max(0, pan)), gr = gain * (1 + Math.min(0, pan))
  let i0 = Math.round(t * SR)
  let skip = 0
  if (i0 < 0) { skip = -i0; i0 = 0 }
  const frames = Math.min(a.length / 2 - skip, N - i0)
  for (let k = 0; k < frames; k++) {
    mix[(i0 + k) * 2] += a[(skip + k) * 2] * gl
    mix[(i0 + k) * 2 + 1] += a[(skip + k) * 2 + 1] * gr
  }
}

for (const s of cues.sfx) {
  if (s.pattern === 'ticker') {
    // 數字滾輪減速：時間點照 power3.out 的反函數排，越後面越疏
    const n = 11, dur = 1.0
    for (let k = 0; k < n; k++) {
      const p = k / (n - 1)
      put(s, s.t + dur * (1 - (1 - p) ** (1 / 3)) * 0.9, s.gain * (1 - 0.4 * p), s.pan ?? 0)
    }
  } else put(s, s.t, s.gain, s.pan ?? 0)
}

// ── 配樂：keys 線性插值音量與悶度，乾／濕（零相位低通）交叉混合 ──
const bgmCfg = cues.bgm
const bgmFile = join(W, bgmCfg.file || 'bgm.wav')
if (!existsSync(bgmFile)) fail(1, `找不到配樂 ${bgmFile}`)
const bgmSec = duration(bgmFile)
if (!(bgmSec >= cues.total - 0.5)) fail(3, `配樂 ${bgmSec} 秒短於影片 ${cues.total} 秒，請重生或自備更長配樂`) // 只允許 ≤0.5 秒補零
const lpHz = bgmCfg.lowpassHz || 650
const dry = decode(bgmFile)
const wetRaw = decode(bgmFile, `lowpass=f=${lpHz}:p=2,areverse,lowpass=f=${lpHz}:p=2,areverse`)
const bp = Math.max(1e-6, peakOf(dry))
function fit(a) { // 正規化後補靜音或截斷到 N 個音框
  const o = new Float32Array(N * 2)
  const n = Math.min(a.length, o.length)
  for (let i = 0; i < n; i++) o[i] = a[i] / bp
  return o
}
const bd = fit(dry), bw = fit(wetRaw)
const keys = bgmCfg.keys
let ki = 0
for (let f = 0; f < N; f++) {
  const t = f / SR
  while (ki < keys.length - 2 && t >= keys[ki + 1][0]) ki++
  let db, wet
  if (t <= keys[0][0]) { db = keys[0][1]; wet = keys[0][2] }
  else if (t >= keys[keys.length - 1][0]) { db = keys[keys.length - 1][1]; wet = keys[keys.length - 1][2] }
  else {
    const [t0, d0, w0] = keys[ki], [t1, d1, w1] = keys[ki + 1]
    const u = (t - t0) / (t1 - t0)
    db = d0 + (d1 - d0) * u; wet = w0 + (w1 - w0) * u
  }
  const g = 10 ** (db / 20) * bgmCfg.gain
  mix[f * 2] += ((1 - wet) * bd[f * 2] + wet * bw[f * 2]) * g
  mix[f * 2 + 1] += ((1 - wet) * bd[f * 2 + 1] + wet * bw[f * 2 + 1]) * g
}

// ── 截到總長、防爆音，再做 loudnorm 兩段式 ──
const out = mix.subarray(0, Math.round(total * SR) * 2)
const peak = peakOf(out)
if (peak > 0.95) for (let i = 0; i < out.length; i++) out[i] *= 0.95 / peak
const pcm = Buffer.from(out.buffer, out.byteOffset, out.byteLength)
const inArgs = ['-loglevel', 'info', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', '-']
const base = `I=${lufs}:TP=${tp}:LRA=11`

const m1 = run('ffmpeg', [...inArgs, '-af', `loudnorm=${base}:print_format=json`, '-f', 'null', '-'], pcm)
const jtxt = m1.stderr.toString()
const meas = JSON.parse(jtxt.slice(jtxt.lastIndexOf('{'), jtxt.lastIndexOf('}') + 1))
const outFile = join(W, sample ? 'mix.sample.wav' : 'mix.wav')
run('ffmpeg', ['-y', ...inArgs, '-af',
  `loudnorm=${base}:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true`,
  '-ar', String(SR), '-ac', '2', '-c:a', 'pcm_s16le', outFile], pcm)

const d = duration(outFile)
if (!(Math.abs(d - total) <= 0.05)) fail(3, `輸出長度 ${d}s 與 cues.total ${total}s 差 >0.05 秒`)
