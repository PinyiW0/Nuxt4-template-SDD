---
name: portfolio-video
description: 把產品功能錄成作品集精華影片：timeline 驅動的 HyperFrames 骨架＋每個產品自寫的 scene＋CC0 音效與配樂混音，三段確認（文案 → 10 秒樣片 → 完整版）後輸出編號不覆蓋的有聲 MP4。Use when 使用者要做作品集影片、產品精華片、demo reel，或說「幫我剪一支作品集影片」「把這個產品做成影片」。
argument-hint: "[產品名或工作資料夾(選填)]"
disable-model-invocation: true
---

# Portfolio Video：產品功能 → 作品集精華影片

**規則用腳本鎖死，外觀留給每支影片自己寫。**

- `timeline.json` 是唯一真理來源：段落、文案、素材、秒數。改它，畫面與音效的時間點一起動。
- `scripts/gen.mjs` 只產生時間正確的骨架（片頭、大字轉場、導覽列、片尾、背景、音效觸發清單）。
- 每段產品畫面（scene）的 HTML／CSS／GSAP 由你為**這個產品**另外寫；配色、進場方式、版面每支影片可以不同，但要讀 `spec/ui-config/creative-direction.md` 定風格。
- 混音腳本只讀 `cues.json`，不另抄時間；輸出自動編號，永不覆蓋。

範圍外：任何產品專屬的文案與素材都不在本 skill 內；HyperFrames／MusicGen 不進 repo 的 `package.json`（在 `<work>` 按需安裝）；配樂檔不進 repo。

## 前置條件

| 項目 | 說明 |
|---|---|
| 測試機可登入 | 登入資料只能放 `<work>/auth.json`，格式與 cookie 寫法見 [references/capture.md](references/capture.md)；用完就刪（`--purge` 只加在最後一支素材，或 Phase 5 統一 `rm`） |
| 工具 | `ffmpeg`／`ffprobe`、Node（版本見 `.nvmrc`）；`@playwright/test` 走 repo 的 `node_modules`；首次 `npx hyperframes` 會下載 CLI 與瀏覽器（1–3 分鐘） |
| 網路 | gsap 從 jsDelivr CDN 載入（render 時需連線）、首次 `npx` 下載 hyperframes、`mix.mjs` 缺音效時下載 CC0 音效 |
| 工作資料夾 `<work>` | scratchpad 下 `portfolio-video/<產品名>/`。**所有產物**（HyperFrames 專案、素材、音檔、MP4、cookie）都在這裡，repo 不放任何媒體檔 |
| 風格依據 | `spec/ui-config/creative-direction.md`（風格 preset、動效原則）；寫 scene 前必讀 |

`<work>` 結構：`timeline.json`、`scenes/<id>.html`、`assets/`（原始素材）、`sfx/`（自動下載）、`bgm.wav`、`auth.json`（暫時）、`hf/`、`hf-sample/`、`cues.json`、`cues.sample.json`、`mix.wav`、`mix.sample.wav`、`render/`、`out/`。

## 流程（三個確認點：Phase 1 文案、Phase 3 樣片、Phase 4 完整版）

```
0 盤點 → 1 文案表【確認】→ 2 錄素材 → 3 寫 scene＋10 秒樣片【確認】→ 4 完整版【確認】→ 5 驗證＋清 cookie
```

### Phase 0：盤點

1. 問清楚：產品名、測試機網址、登入方式、要不要指定輸出資料夾。
2. 掃產品的路由與 `data-testid`，列出「哪些功能有真實且完整的資料」——列表、月曆、圖表要挑**資料填滿**的場次；沒有真實資料的功能先標記，Phase 1 一起問要不要納入。
3. 建 `<work>` 即可，`hf/` 由 `gen.mjs` 自動產生（含 `package.json` 與 `hyperframes.json`），不要手動建。

### Phase 1：文案表（確認前不產生任何影片）

列一張表給使用者，欄位：段落順序｜類型｜大字轉場兩行｜scene 標題（＝導覽列名稱）｜一句說明｜用哪個功能畫面｜秒數。另附片頭（eyebrow／產品名／副標）與片尾（引言／功能列）。

- 大字轉場兩行各 ≤ 8 個字（去掉句尾標點），**不加章節編號**。
- 說明句最多 1 個「，」，每段 ≤ 12 字（去掉句尾標點）；顯示時在逗號處換行。
- 總長建議 30–50 秒；scene 3–6 秒、kinetic 0.8–1.1 秒、片頭 2.2 秒、片尾 3.5 秒。

使用者確認後才寫 `<work>/timeline.json`，並把 `confirmed` 設為 `true`。在那之前**禁止**：建 `<work>/hf`、錄素材、執行 `gen`／`render`。欄位說明見 [references/timeline-schema.md](references/timeline-schema.md)。

### Phase 2：錄素材

照 [references/capture.md](references/capture.md) 用 `scripts/capture.mjs` 錄；每支素材錄完立刻用下方「素材」規則檢查。重點：

- 3D／canvas／WebGL 畫面**一律** `--step`（假時鐘逐格）。無畫面模式即時錄影只有約 6 fps，看起來像卡住。`--step` 預設 `--dpr 2`（輸出 2 倍解析度，給要推近的畫面用）；不推近就 `--dpr 1`。
- 解析度看用途：放進骨架視窗的畫面用預設 `--viewport 1440x900`（視窗是 16:10）；要鋪滿全畫面的用 `--viewport 1920x1080`。
- cookie 預設寫到 `localhost`；測試機不是 localhost 時加 `--cookie-domain <主機名>`，否則會靜默沒登入。
- `--ready <testid>` 等資料真的出現才開始錄；載入骨架、「—」、「計算中」不可入鏡。
- 3D 從動作已經開始的那一格切入，不要讓畫面先靜止 1 秒。
- 操作用 `--actions` 檔寫，游標分格滑到目標再點。
- `--purge` 只加在最後一支素材（前面的加了，後面的就沒登入檔可用），或全部錄完在 Phase 5 統一 `rm <work>/auth.json`。

### Phase 3：寫 scene 片段＋10 秒樣片

1. 先依 `creative-direction.md` 定 `theme`（`bg`／`accent`／`accent2`，寫進 timeline.json），再寫 scene；質感與每個 scene 的進場方式**不重複**（傾斜飛入、翻面、斜切滑入、四格組合、拉遠成視窗…）。
2. 依 [references/timeline-schema.md](references/timeline-schema.md) 的片段合約寫 `scenes/<id>.html`：一個 `<style>`、一個 `<script>`、媒體只寫 `<video data-clip="…">`；時間一律 `T0 + 相對秒`；數字用骨架的 `H.pop`／`H.wheel`，對應的 `tick`／`click` cue 寫進 timeline 的 `scene.cues`。
3. 配樂：MusicGen 生成（見 [references/audio.md](references/audio.md)，**非商用**）或自備 `<work>/bgm.wav`。
4. 跑樣片：`node scripts/gen.mjs <work> --sample <scene-id>` → `node scripts/mix.mjs <work> --sample` → `sh scripts/render.sh <work> sample <名稱>-sample`（名稱一律加 `-sample` 後綴，例 `demo-sample`，避免占走完整版編號）。
5. 把 `out/<名稱>-sample-NN.mp4` 給使用者確認風格、節奏、音量。沒過就改 scene 或 timeline 再跑，**不要**直接跳完整版。

### Phase 4：完整版

`node scripts/gen.mjs <work>` → `node scripts/mix.mjs <work>` → `sh scripts/render.sh <work> full <名稱>`。
跑完先把 `out/<名稱>-NN.mp4` 給使用者看，**確認後**才問輸出資料夾，複製 `-NN.mp4`、`-NN.jpg`（封面）過去；目的地已有同名檔就改編號，不覆蓋。只調音量或音效時重跑 `mix` 與 `render.sh` 即可，`render.sh` 看到 `render/` 內的無聲影片比 `hf/index.html` 與 `hf/assets/` 內所有檔都新才直接重用，重錄素材後重跑 gen 就會重新渲染。

### Phase 5：驗證＋清 cookie

逐條跑下方四類規則的判斷法，列成勾選表回報；最後 `rm <work>/auth.json`（或 capture 已用 `--purge`），並確認 `git status` 沒有任何 `<work>` 內的檔案。

## 四類規則（每條都附「怎麼從輸出判斷」）

### 素材

| 規則 | 怎麼判斷 |
|---|---|
| 30 fps、yuv420p；解析度 ≥ 它在畫面上顯示的尺寸（視窗內 ≥1440×900，全畫面 ≥1920×1080） | `ffprobe -v error -show_entries stream=width,height,r_frame_rate,pix_fmt -of csv=p=0 <素材>` |
| 載入段已裁掉，首幀不是空白 | `ffmpeg -i <素材> -vf "select=eq(n\,0),signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null - 2>&1 \| grep YAVG`；YAVG ≤ 20 是純黑、≥ 230 是純白，兩者都算空白 |
| 3D／canvas 用逐格拍，沒有重複幀 | 總幀數 `ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 <素材>`；去重後幀數 `ffmpeg -i <素材> -vf mpdecimate -an -f null - 2>&1 \| grep -o 'frame= *[0-9]*' \| tail -1`；去重後 ≥ 總幀數 × 0.98 |
| 列表、月曆、圖表用資料完整的場次，畫面沒有整片「—」或「計算中」 | contact sheet 人眼看：`ffmpeg -i <素材> -vf "fps=1,scale=480:-1,tile=4x4" -frames:v 1 sheet.jpg` |
| 3D 從動作已開始的那格切入 | 前 1 秒抽 3 幀比對，主體有位移 |
| 畫面無測試帳號、內網網址、devtools | 同 contact sheet；capture.mjs 已隱藏 devtools |
| 媒體檔只在 `<work>` | `git ls-files .claude/skills/portfolio-video \| grep -E "\.(mp4\|wav\|mp3\|webm\|jpg\|png)$"` 為空 |

### 視覺

| 規則 | 怎麼判斷 |
|---|---|
| 導覽列名稱＝scene 標題 | 同一欄位產生；`grep -o 'class="nv"[^<]*' hf/index.html` 對照 timeline 的 `title` |
| 大字轉場不加章節編號 | `gen.mjs` 擋：`lines` 以數字開頭就 exit 1；再抽一幀 kinetic 中段人眼確認沒有「01」之類的小字 |
| 說明文字在逗號處換行、標題不自動折行、無單字孤行 | `gen.mjs` 擋（desc 最多一個逗號、每段 ≤12 字；kinetic 每行 ≤8 字）＋抽一幀看左欄；`grep -c 'white-space: nowrap' hf/index.html` ≥ 2 |
| 每個 scene 前有一段 kinetic（≤1.2 秒）、每段進場方式不重複 | `jq '.segments[] \| select(.type=="kinetic") \| .end-.start' cues.json`；人眼比對各 scene 的 `<script>` 進場 tween |
| 文字只動 transform／opacity，不用 `transition-all` | `grep -c 'transition-all' hf/index.html` 為 0 |
| 頭尾黑場淡入淡出 0.4 秒 | 首尾幀 YAVG ≤ 20（yuv420p 的純黑是 16）：`ffmpeg -i out/<檔> -vf "select='eq(n\,0)+eq(n\,總幀數-1)',signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null - 2>&1 \| grep YAVG` |
| `hyperframes lint` 0 error | `npm run --silent lint --prefix <work>/hf -- --json \| jq .errorCount`（版本走 `hf/package.json` 的 pin） |

### 聲音

| 規則 | 怎麼判斷 |
|---|---|
| 48 kHz 立體聲、AAC 192k | `ffprobe -v error -select_streams a -show_entries stream=codec_name,sample_rate,channels,bit_rate -of csv=p=0 out/*.mp4` |
| 整體響度 −16 LUFS ±1、True peak ≤ −1.5 dBTP | `ffmpeg -nostats -i out/<檔> -af ebur128=peak=true -f null - 2>&1 \| grep -A 14 'Summary:'`，看 `I:` 與 `Peak:`（`ebur128=peak=true` Summary 的 `Peak:` 行即 true peak，ffmpeg 顯示單位為 dBFS） |
| 音效與畫面事件同源：boom 數＝kinetic 數、whoosh_deep 數＝scene 數 | `jq '[.sfx[]\|select(.id=="boom")]\|length' cues.json` 對照 `[.segments[]\|select(.type=="kinetic")]\|length` |
| 配樂跟著畫面起伏：kinetic 起點比相鄰 scene 段低 ≥4 dB 且 wet ≥0.6，scene 段打開 | `jq '.bgm.keys' cues.json`，看各 kinetic 起點的 dB 與 wet |
| 音軌長度＝畫面長度 ±0.1 秒 | `render.sh` 自動對帳（不符 exit 4）；手動：`ffprobe -show_entries stream=duration` |
| 尾 1.2 秒淡到 −40 dB | `jq '.bgm.keys[-2:]' cues.json` |
| 音效只用 [references/sfx.md](references/sfx.md) 內的 CC0 音效 | `jq -r '.sfx[].id' cues.json \| sort -u` 全部在表內 |
| 配樂若用 MusicGen，**權重授權 CC BY-NC 4.0，不可商用** | 商用場合換自備授權音樂放 `<work>/bgm.wav`，並在交付說明註明配樂來源 |

### 輸出

| 規則 | 怎麼判斷 |
|---|---|
| `out/<名稱>-NN.mp4` 自動編號、永不覆蓋 | 連跑兩次 `render.sh`：出現 `-01`、`-02`，`shasum -a 256 out/<名稱>-01.mp4` 前後相同 |
| sidecar 記錄來源 hash 與 hyperframes 版本 | `cat out/<名稱>-NN.json` |
| `moov` 在檔頭（faststart） | `ffmpeg -v trace -i out/<檔> 2>&1 \| grep -oE "type:'(moov\|mdat)'" \| head -1` 是 `moov` |
| 無聲 render 與 `mix.wav` 分開存；`hf/index.html` 與 `hf/assets/` 都沒變時 `render.sh` 重用舊 render，只重 mux | `ls <work>/render/ <work>/mix.wav`；第二次 `render.sh` 的輸出含「重用」 |
| 封面 jpg 與影片同編號 | `ls out/` |
| `auth.json` 已刪、從未離開 `<work>` | `test ! -f <work>/auth.json`；`git ls-files -- '*auth.json'` 為空 |

## 腳本

| 腳本 | 什麼時候用 | 用法 |
|---|---|---|
| [scripts/capture.mjs](scripts/capture.mjs) | Phase 2 錄每一段素材；3D／canvas 加 `--step` | `node scripts/capture.mjs <url> <out.mp4> --auth <work>/auth.json --ready <testid> [--step] [--dpr 2] [--viewport 1440x900] [--cookie-domain localhost] [--actions a.mjs] [--purge]` |
| [scripts/gen.mjs](scripts/gen.mjs) | Phase 3 樣片、Phase 4 完整版；timeline 或 scene 改過就重跑 | `node scripts/gen.mjs <work> [--sample <scene-id>]`；exit 5＝`confirmed` 不是 true，1＝schema（含 theme、文案字數、cue 欄位）或片段違規，2＝素材缺檔 |
| [scripts/mix.mjs](scripts/mix.mjs) | gen 之後；缺音效會自動依 `references/sfx.md` 下載並比對長度 | `node scripts/mix.mjs <work> [--sample] [--lufs -16] [--tp -1.5]`；exit 1 音效缺或長度對不上、2 ffmpeg 失敗、3 配樂比影片短 > 0.5 秒，或輸出長度與 `cues.total` 差 > 0.05 秒 |
| [scripts/render.sh](scripts/render.sh) | mix 之後：lint → 無聲 render → 對帳 → 合音軌 → 編號輸出 | `sh scripts/render.sh <work> [full\|sample] [名稱]`；exit 1＝參數錯誤／hyperframes 版本不一致／lint error（重用舊 render 時不重跑 lint）、2 render 失敗、3 mux／檔已存在、4 長度對不上 |
| [scripts/demo-assets.sh](scripts/demo-assets.sh) | 驗證 skill 本身或教學時，用 ffmpeg 現做示範素材與示範配樂 | `sh scripts/demo-assets.sh <work>` 後接 gen → mix → render |
| [scripts/musicgen.py](scripts/musicgen.py) | 要本機生成配樂時（選用、非商用） | `<work>/venv/bin/python scripts/musicgen.py <work>/bgm.wav <seed> <秒> ["prompt"]`，venv 建法見 audio.md |

示範流程（AC 驗證用）：`W=<scratchpad>/portfolio-video/demo && sh scripts/demo-assets.sh $W && node scripts/gen.mjs $W && node scripts/mix.mjs $W && sh scripts/render.sh $W full demo`。

## 授權與憑證

- 音效：全部 CC0 1.0，清單與出處在 [references/sfx.md](references/sfx.md)。
- 配樂：MusicGen（`facebook/musicgen-small`）**權重授權 CC BY-NC 4.0，不可商業使用**；本 skill 只說明用法，不附任何配樂檔。商用請換自備授權音樂。
- HyperFrames CLI 以 `npx` 在 `<work>` 內執行，不進 repo 依賴。
- 登入 cookie／token 只能存在 `<work>/auth.json`，用完就刪；repo 內不得出現任何憑證、內網位址、測試機資料 id。交付前跑 `git grep -nE "(192\.168\.|refresh[A-Z]|[Bb]earer )" -- .claude/skills/portfolio-video` 確認為空。

## References

| 檔案 | 內容 | 什麼時候讀 |
|---|---|---|
| [references/timeline-schema.md](references/timeline-schema.md) | timeline.json 欄位、scene 片段合約、`H` helper、cues.json 格式、lint 地雷對策 | Phase 1 寫 timeline、Phase 3 寫 scene |
| [references/capture.md](references/capture.md) | cookie 登入、等就緒、逐格拍攝、actions 檔範例、素材檢查指令 | Phase 2 |
| [references/audio.md](references/audio.md) | 配樂起伏預設、loudnorm 參數、MusicGen 建法與授權 | Phase 3 配樂 |
| [references/sfx.md](references/sfx.md) | 8 個 CC0 音效的用途、出處、下載網址 | 換音效或查授權時 |

## 升版 hyperframes

版本 pin 只在兩處：`assets/hf-project/package.json`（lint／check／preview／render 的 scripts 都走它；文件中的 lint 指令一律 `npm run --silent lint --prefix <work>/hf -- --json`，不加 `--silent` 時 npm 橫幅會讓 jq 解析失敗）與 `scripts/render.sh` 的 `HF_VER`。升版步驟：兩處一起改 → 用示範流程重跑 → `lint` 0 error 且 `render.sh` 成功 → 才提交。lint 規則逐版增加，升版後 scene 片段可能新增違規，對照 timeline-schema.md 的地雷表修。
