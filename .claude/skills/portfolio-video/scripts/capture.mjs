// 用途：用 Playwright 把任意網頁錄成作品集素材 mp4（與產品無關）。
//   一般模式 recordVideo 即時錄影；--step 用假時鐘逐格截圖再合成，3D／canvas 畫面一定要用它
//   （headless 軟體算圖即時錄只有約 6 fps，逐格拍才會滿 30 fps）。
// 用法：node capture.mjs <url> <out.mp4> [--auth <work>/auth.json] [--seconds N] [--ready <testid>]
//   [--step] [--actions <file.mjs>] [--purge] [--viewport 1440x900] [--fps 30]
//   [--cookie-name auth] [--cookie-domain localhost] [--dpr 2]
//   --dpr     只影響 --step 的 deviceScaleFactor（預設 2，輸出 2x 尺寸；1 則與 viewport 同尺寸）
//   輸出一律偶數邊長、yuv420p（limited range）；一般模式輸出長度＝就緒後實際拍攝秒數，不含收尾時間
//   --auth    讀 JSON 檔，整個物件 JSON 字串化後 encodeURIComponent 寫成 cookie；沒給就不登入
//   --actions 該檔 default 匯出 async ({ page, shoot, mark }) => {}；shoot(n) 拍 n 格（一般模式等 n/fps 秒），
//             mark(label) 把目前格號／秒數記到 <out>.marks.tsv；沒給就只拍 --seconds（預設 5）
//   --purge   結束（含失敗）時刪掉 --auth 指到的檔
// 依賴：@playwright/test（從專案 node_modules 解析）、系統 ffmpeg。
// 結束碼：0 成功；1 登入檔讀不到或 cookie 寫入失敗；2 ready 逾時；3 ffmpeg 失敗。
import { chromium } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { positionals, values: o } = (await import('node:util')).parseArgs({
  allowPositionals: true,
  options: {
    auth: { type: 'string' }, seconds: { type: 'string', default: '5' }, ready: { type: 'string' },
    step: { type: 'boolean', default: false }, actions: { type: 'string' }, purge: { type: 'boolean', default: false },
    viewport: { type: 'string', default: '1440x900' }, fps: { type: 'string', default: '30' }, dpr: { type: 'string', default: '2' },
    'cookie-name': { type: 'string', default: 'auth' }, 'cookie-domain': { type: 'string', default: 'localhost' },
  },
})
const [url, out] = positionals
if (!url || !out) {
  console.error('用法：node capture.mjs <url> <out.mp4> [options]，見檔頭說明')
  process.exit(1)
}
const [W, H] = o.viewport.split('x').map(Number)
const FPS = Number(o.fps)
const seconds = Number(o.seconds)

// 假游標與點擊漣漪，並隱藏 Nuxt devtools 浮層
const CURSOR_JS = `
(() => {
  if (window.__demoCursor) return; window.__demoCursor = true
  const install = () => {
    const st = document.createElement('style')
    st.textContent = '#nuxt-devtools-container{display:none!important}'
    document.documentElement.appendChild(st)
    const c = document.createElement('div')
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,80,60,.55);border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.5);z-index:2147483647;pointer-events:none;transition:transform .08s'
    document.documentElement.appendChild(c)
    document.addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
    document.addEventListener('mousedown', e => {
      c.style.transform = 'scale(.7)'
      const r = document.createElement('div')
      r.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;border:3px solid rgba(255,80,60,.9);z-index:2147483646;pointer-events:none;transition:all .45s ease-out'
      document.documentElement.appendChild(r)
      requestAnimationFrame(() => { r.style.width = r.style.height = '56px'; r.style.margin = '-28px 0 0 -28px'; r.style.opacity = '0' })
      setTimeout(() => r.remove(), 500)
    }, true)
    document.addEventListener('mouseup', () => { c.style.transform = '' }, true)
  }
  if (document.documentElement) install(); else document.addEventListener('DOMContentLoaded', install)
})()
`

class Fail extends Error {
  constructor(code, msg) { super(msg); this.code = code }
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Fail(3, `ffmpeg 失敗：${r.stderr || r.error}`)
}

const ENC = ['-c:v', 'libx264', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2:out_range=tv,format=yuv420p', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', '-an']
const tmp = mkdtempSync(join(tmpdir(), 'capture-'))
let browser
let code = 0

try {
  let cookie
  if (o.auth) {
    try {
      const obj = JSON.parse(readFileSync(o.auth, 'utf8'))
      cookie = { name: o['cookie-name'], value: encodeURIComponent(JSON.stringify(obj)), domain: o['cookie-domain'], path: '/' }
    }
    catch (e) { throw new Fail(1, `登入檔讀不到或格式錯：${e.message}`) }
  }

  browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: o.step ? Number(o.dpr) : 1,
    ...(o.step ? {} : { recordVideo: { dir: tmp, size: { width: W, height: H } } }),
  })
  if (cookie) {
    try { await ctx.addCookies([cookie]) }
    catch (e) { throw new Fail(1, `cookie 寫入失敗：${e.message}`) }
  }
  await ctx.addInitScript(CURSOR_JS)
  const t0 = Date.now() // 錄影從 newPage 開始，readySec 以此為基準
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  if (o.step) await page.clock.install()

  // 等就緒：load → networkidle（最多 5 秒）→ ready testid
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
  if (o.ready) {
    try { await page.getByTestId(o.ready).waitFor({ state: 'visible', timeout: 20000 }) }
    catch { throw new Fail(2, `ready（${o.ready}）逾時 20 秒`) }
  }
  const readySec = (Date.now() - t0) / 1000

  let frame = 0
  const marks = []
  if (o.step) {
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(now + 100)
  }
  const tReady = Date.now()
  async function shoot(n) {
    if (!o.step) {
      await page.waitForTimeout((n / FPS) * 1000)
      frame += n
      return
    }
    for (let i = 0; i < n; i++) {
      await page.clock.runFor(1000 / FPS)
      await page.screenshot({ path: join(tmp, `${String(frame++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 })
    }
  }
  function mark(label) {
    const sec = o.step ? frame / FPS : (Date.now() - tReady) / 1000
    marks.push(`${label}\t${o.step ? frame : Math.round(sec * FPS)}\t${sec.toFixed(2)}`)
  }

  if (o.actions) {
    const mod = await import(pathToFileURL(resolve(o.actions)).href)
    await mod.default({ page, shoot, mark })
  }
  else await shoot(Math.round(seconds * FPS))

  const shotSec = (Date.now() - t0) / 1000 - readySec // 就緒後到最後一次 shoot 結束的實際秒數
  if (marks.length) writeFileSync(`${out}.marks.tsv`, `label\tframe\tseconds\n${marks.join('\n')}\n`)

  if (o.step) {
    await ctx.close()
    ffmpeg(['-framerate', String(FPS), '-i', join(tmp, '%05d.jpg'), '-r', String(FPS), ...ENC, out])
  }
  else {
    const webm = await page.video().path()
    await ctx.close()
    ffmpeg(['-i', webm, '-ss', readySec.toFixed(2), '-t', shotSec.toFixed(2), '-r', String(FPS), ...ENC, out])
  }
}
catch (e) {
  code = e instanceof Fail ? e.code : 1
  console.error(e.message)
}
finally {
  await browser?.close().catch(() => {})
  rmSync(tmp, { recursive: true, force: true })
  if (o.purge && o.auth) rmSync(o.auth, { force: true })
}
process.exit(code)
