# timeline.json 與 scene 片段合約

`scripts/gen.mjs` 的輸入規格與輸出格式。時間不寫 start，依 `segments` 順序累加；HTML 的 `data-start` 與 `cues.json` 都來自 gen 內同一個累加陣列。

## 目錄

- [timeline.json 欄位](#timelinejson-欄位)
- [示範](#示範)
- [scene 片段合約](#scene-片段合約)
- [骨架提供的東西](#骨架提供的東西)
- [cues.json 格式](#cuesjson-格式)
- [自動 cue 與 bgm 預設](#自動-cue-與-bgm-預設)
- [--sample 樣片](#--sample-樣片)
- [結束碼](#結束碼)
- [lint 地雷對策](#lint-地雷對策)

## timeline.json 欄位

| 欄位 | 必填 | 說明 |
|---|---|---|
| `confirmed` | 是 | 必須是 `true`；使用者確認文案後才改。`false` 時 gen 結束碼 5 |
| `theme` | 否 | `{bg, accent, accent2}`，三欄皆 `#rrggbb`；缺省 `#070b16`／`#4f6bff`／`#22d3c5`。gen 輸出為 `:root` 的 `--bg`／`--accent`／`--accent2`，scene 片段也可用 `var(--accent)` 等。可只給部分欄位（只驗有給的是否 `#rrggbb`，缺的用預設）；格式錯 → gen exit 1 |
| `product.name` | 是 | 品牌名，片頭、片尾共用 |
| `product.tagline` / `product.eyebrow` | 否 | 副標／片頭上方小字 |
| `end.quote` / `end.features[]` | 是 | 片尾引言、功能列（以 ` · ` 連接）|
| `bgm.file` | 否 | 相對 `<work>`，預設 `bgm.wav`，原樣寫進 cues.json |
| `segments[]` | 是 | 第一段 `title`、最後一段 `end`，中間 `kinetic` → `scene` 交替；每段有 `type`、`duration`（正數秒）|
| `kinetic.id` / `lines[2]` | 是 | id 符合 `^[a-z0-9-]+$` 且全檔唯一；大字兩行，**不加章節編號**（任一行以數字開頭 → gen exit 1）；每行（去掉句尾標點）≤ 8 字，超過 exit 1 |
| `scene.id` | 是 | 同上，與 kinetic 共用唯一性 |
| `scene.title` | 是 | 導覽列文字與左欄標題（同一欄位）；**≤ 10 字**（`.pl-title` 不折行，太長會溢出），超過 gen exit 1 |
| `scene.desc` | 是 | 一句說明；**最多 1 個逗號（全形「，」與半形「,」合計）、每段（去掉句尾標點）≤ 12 字**，違反 gen exit 1；在逗號（全形或半形）後自動插 `<br>`，`.pl-title`／`.pl-desc` 為 `white-space: nowrap` |
| `scene.html` | 是 | scene 片段路徑，相對 `<work>` |
| `scene.clips` | 否 | `{別名: 素材路徑}`，相對 `<work>`；gen 複製到 `hf/assets/<scene id>-<別名><副檔名>`，不同 scene 用同名素材也不會互蓋 |
| `segments` 整體 | — | 至少一個 scene；`nav` 欄位已移除，導覽列一律用 `title`（出現 `nav` → gen exit 1） |
| `scene.cues[]` | 否 | `{at, sfx, gain?, pan?, pattern?}`；`at` 相對 scene 起點、須 < duration；`sfx` 須在 `sfx.md` 清單；`gain` 數字 0–2、`pan` 數字 −1–1、`pattern` 只能是 `"ticker"`（原樣帶進 cues），違反 gen exit 1 |
| `scene.bgm[]` | 否 | `[[相對秒, dB, 悶度 0–1], …]`，覆寫該 scene 的預設 key |
| `end.duration` | — | 至少 2.7 秒（引言 → 品牌名需要時間）|

## 示範

`assets/demo/timeline.json`（總長 15.8 秒）：

```json
{ "confirmed": true,
  "product": { "name": "Demo App", "tagline": "示範素材・不代表任何產品", "eyebrow": "FRONTEND PORTFOLIO" },
  "end": { "quote": "讓每一次操作，都看得見。", "features": ["即時看板", "歷史紀錄"] },
  "theme": { "bg": "#14100c", "accent": "#ff7a3d", "accent2": "#ffd166" },
  "bgm": { "file": "bgm.wav" },
  "segments": [
    { "type": "title", "duration": 2.2 },
    { "type": "kinetic", "id": "k1", "duration": 1.1, "lines": ["每一次操作。", "即時呈現。"] },
    { "type": "scene", "id": "board", "duration": 5.0, "title": "即時看板", "desc": "關鍵數據，操作後即時掌握。",
      "html": "scenes/board.html", "clips": { "main": "assets/demo-board.mp4" },
      "cues": [ { "at": 2.0, "sfx": "click" }, { "at": 2.0, "sfx": "tick", "pattern": "ticker" } ] },
    { "type": "kinetic", "id": "k2", "duration": 0.8, "lines": ["每一筆。", "都有紀錄。"] },
    { "type": "scene", "id": "history", "duration": 3.2, "title": "歷史紀錄", "desc": "依日期查找，隨時回顧。",
      "html": "scenes/history.html", "clips": { "main": "assets/demo-history.mp4" } },
    { "type": "end", "duration": 3.5 } ] }
```

## scene 片段合約

`scenes/<id>.html` 由 AI 為每個產品另寫（配色、版面、進場方式自由，每段進場方式不要重複）。示範見 `assets/demo/scenes/`。

- 恰好一個 `<style>`、一個 `<script>`，其餘是 markup。
- gen 把 markup 包進 `<div id="s-<id>" class="scene">`：無 `data-start`、無 `clip` class；gen 已自動 `H.show` 整個 scene（起點 → 終點）。wrapper 內第一個子元素是 gen 產的左欄 `<div id="s-<id>-pl" class="pl">`（`.pl-rule`／`.pl-title`／`.pl-desc`，由 `title`、`desc` 填入），片段用 `H.panelIn("#s-<id>-pl", …)` 讓它進場；全畫面段落不要左欄時，在片段 `<style>` 寫 `#s-<id>-pl { display: none; }`，標題改由片段自己呈現。
- 媒體只能寫 `<video data-clip="別名"></video>`（只接受這一種：自閉合 `<video … />` 或內有子元素都會被 gen exit 1）或 `<img data-clip="別名">`，別名須在 `clips` 內。gen 補：
  - video：`id="s-<id>-<別名>" src="assets/<id>-<別名><副檔名>" data-start data-duration data-track-index muted playsinline`（scene 內第 k 個 clip 用 track `20 + k`）
  - img：`id="s-<id>-<別名>" src="assets/<id>-<別名><副檔名>"`，不加 `data-start`／`muted`／`playsinline`
- `<script>` 內容被包成 `(function (tl, T0, DUR, H) { … })(tl, <start>, <duration>, H)`；時間一律寫 `T0 + 相對秒`，場長用 `DUR`。
- 所有 id 與 CSS selector 用 `s-<id>-` 前綴；全檔 id 必須唯一（gen 會檢查，重複 → 結束碼 1）。
- 文字只動 transform／opacity。
- 禁用（gen 用 regex 先擋，違規印 scene id＋行號，結束碼 1）：

| 禁用 | 原因 |
|---|---|
| `data-start` | 時間由 gen 補，手寫會與 cues 脫鉤 |
| `Math.random`、`Date` | 非決定性，逐格 render 結果不一致 |
| `setTimeout`、`setInterval`、`requestAnimationFrame` | 不受 GSAP 時間軸控制 |
| `fetch(` | render 時不應有網路依賴 |
| `.play()`、`.pause()`、`.currentTime` | 影片由 HyperFrames 依 `data-start` 驅動 |
| template-literal selector（`querySelector(\`…${`、`tl.xxx(\`…${`、`H.xxx(\`…${`）| lint 無法靜態解析 selector；改用字串串接 |
| `<style>` 外的 `/* */` | lint 規則；`<script>` 內註解請用 `//` |
| 沒有 `data-clip` 的 `<video>` | gen 無法補屬性 |

## 骨架提供的東西

共用 CSS：`.pl*`（左欄）、`.stat*`（數字卡，內含 `<span class="stat-n hf-number-wheel" data-value="…">`）、`.win`／`.bar`／`.bar-t`／`.view`／`.cam`（仿視窗，`.cam` 內放媒體）、`.hf-number-wheel*`。字體只用 `system-ui, sans-serif` 與 `ui-monospace`。

`H` helper（`sel` 是字面 selector 字串，`a`／`at`／`z` 是絕對秒）：

| 簽名 | 作用 |
|---|---|
| `H.show(sel, a, z)` | `tl.set` visibility 在 a 顯示、z 隱藏 |
| `H.panelIn(sel, at)` | `sel` 的直接子元素依序上浮淡入（左欄用）|
| `H.pop(sel, at)` | 卡片 scale 0.5→1 彈出，並對卡內 `.hf-number-wheel` 跑 `H.wheel` |
| `H.wheel(sel, at)` | 卡內數字滾輪滾到 `data-value`（1 秒、逐位延遲 0.05）；搭配 `pattern:"ticker"` 的 cue |
| `H.sceneOut(sel, z)` | 在 z 之前 0.25 秒整段淡出並微縮 |

`tl` 是共用的 GSAP timeline（paused），片段可直接 `tl.fromTo(…)`。

## cues.json 格式

gen 寫、`mix.mjs` 只讀（mix 不讀 timeline）：

```json
{ "version": 1, "total": 15.8, "sr": 48000,
  "segments": [ { "id": "title", "type": "title", "start": 0, "end": 2.2 } ],
  "sfx": [ { "t": 0.3, "id": "hit_ambient", "gain": 0.3, "trim": 2.6, "fadeOut": 1.2, "from": "title" },
           { "t": 5.3, "id": "tick", "gain": 0.22, "pattern": "ticker", "from": "board.cues[1]" } ],
  "bgm": { "file": "bgm.wav", "gain": 0.55, "lowpassHz": 650,
           "keys": [[0, -10, 1.0], [2, -6, 0.8], [15.8, -40, 0.6]] } }
```

- `sfx[]` 依 `t` 排序；`trim`／`fadeOut` 只有骨架 cue 有；`pan`、`pattern` 有給才寫；`from` 標出處（段 id、`<scene>.cues[i]`）。
- `bgm.keys` 是 `[時間, dB, 悶度 0–1]`，依時間排序，頭尾夾在 `[0, total]`。
- `segments[].id`：title／end 段用 type 當 id。

## 自動 cue 與 bgm 預設

| 段 | sfx | gain | bgm key |
|---|---|---|---|
| title | `hit_ambient` @ +0.3（trim 2.6、fadeOut 1.2）| 0.30 | (起點, −10, 1.0)、(起點+2, −6, 0.8) |
| kinetic | `boom` @ +0.02（trim 1.4、fadeOut 0.6）| 0.32 | (起點, −6, 0.75) |
| scene | `whoosh_deep` @ −0.25（trim 1.3、fadeOut 0.5）；加上 `scene.cues`（`at` + scene 起點）| 0.28 | (起點+0.3, −1, 0)；`scene.bgm` 有給就取代 |
| end | `hit_ambient` @ +1.6（品牌名出現點，不裁）| 0.30 | (起點, −9, 0.9)、(起點+1.6, −2, 0.1) |
| 全片 | — | — | (total−1.2, −3, 0.2)、(total, −40, 0.6) |

`scene.cues` 未給 `gain` 時依音效 id 取預設（tick 0.22、click 0.28、scroll 0.2、whip 0.3、whoosh_little 0.25）。

## --sample 樣片

`node gen.mjs <work> --sample <scene-id>`：取「前一個 kinetic（若有）＋該 scene ＋ end」，總長 > 10 秒先砍 end，仍 > 10 秒再截 scene 尾（被截掉的 `scene.cues` 丟棄）；截短後 scene 至少 2 秒（前一個 kinetic 讓 scene 不足 2 秒就不帶 kinetic）；時間從 0 重算。寫到 `<work>/hf-sample/` 與 `<work>/cues.sample.json`。導覽列仍列出全部 scene，只亮樣片內的。

## 結束碼

| 碼 | 意義 |
|---|---|
| 0 | 成功 |
| 1 | schema（含 theme、文案字數、cue 欄位）或片段合約違規（印 scene id＋行號；id 重複也是 1）|
| 2 | `clips` 指到的素材缺檔 |
| 5 | `confirmed !== true` |

## lint 地雷對策

驗證版本見 `assets/hf-project/package.json` 的 pin（lint 用 `npm run --silent lint --prefix <work>/hf -- --json`）。示範產出 0 error；剩下的 warning 是 `nested_structure_needs_subcomposition`（頂層 clip 內有子元素），本骨架刻意不拆子合成，可忽略。

| 地雷 | 為什麼會中 | 骨架怎麼避 |
|---|---|---|
| 全螢幕黑幕 `#fade` 起始可見／整支都在 | 單一 clip 蓋整支片，lint 視為起始可見遮罩 | 拆 `#fade-in`（clip 0–0.4 秒，1→0）與 `#fade-out`（clip 尾 0.4 秒，CSS `opacity:0`，0→1）|
| timeline 未註冊 | 沒有 `window.__timelines["main"]` | 先 `window.__timelines = window.__timelines \|\| {}` 再註冊 `"main"` |
| template-literal selector | lint 無法解析動態 selector | Node 端把 selector 展開成字面字串；瀏覽器端 helper 只用字串串接 |
| id 重複 | 片段與骨架撞名 | scene 內一律 `s-<id>-` 前綴；gen 檢查全檔唯一 |
| clip 超出總長 | start＋duration > total | `clip()` 把 duration 夾在 total 內 |
| 對 `.clip` 動 visibility | HyperFrames 自己管 clip 顯隱 | clip 只動 opacity；顯隱用 `.scene`（非 clip）搭 `tl.set(visibility)` |
| 同 track 時間重疊 | 同 `data-track-index` 的 clip 重疊 | title 1、kinetic 2、bg 0、end 8、fade 9／11、nav 14、sweep 15 各固定；scene 內第 k 個 clip 用 `20 + k` |
| `<video>` 缺屬性 | 缺 id／src／muted／playsinline／data-start／data-duration／data-track-index | gen 由 `data-clip` 一次補齊 |
| `<video data-start>` 放在也有 `data-start` 的父層 | 巢狀 timed 元素 | scene wrapper 不帶 `data-start`／`clip` class |
| `Math.random`／`Date`／`setTimeout`／`fetch`／rAF／`.play()` | 非決定性或不受時間軸控制 | 片段合約禁用清單先擋 |
| `<style>` 外的 `/* */` | lint 規則 | 骨架 JS 不寫 `/* */`；片段禁用 |
| 同一元素多次 `fromTo` 無基準（`gsap_repeated_fromto_without_baseline`）| 後出現的 fromTo 起始值會在 seek 前蓋掉先出現的 | 重複打同一 selector 的 `#sw-main`，第二次起加 `immediateRender: false` |
| 字體 | 非系統字體在 render 機器上不一定有 | 骨架只用 `system-ui, sans-serif` 與 `ui-monospace`；不輸出 `data-end`／`data-layer` |
