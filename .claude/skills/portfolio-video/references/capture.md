# 錄素材：capture.mjs

`scripts/capture.mjs` 用 Playwright 把任意網頁錄成無聲 mp4。用法與結束碼見檔頭；本檔講怎麼用、為什麼這樣設計。

## 登入：auth.json 與 cookie

- 前端若把登入狀態放在 cookie（值是 URL 編碼後的 JSON），把那個物件存成 `<work>/auth.json`，例如 `{"token":"...","refresh":"...","expires":1700000000}`；欄位名依專案實際格式。
- `--auth` 會把整個物件 `encodeURIComponent(JSON.stringify(obj))` 寫成 cookie，預設名稱 `auth`、domain `localhost`；專案不同用 `--cookie-name`、`--cookie-domain` 改。
- 登入檔只能放 `<work>/`（不入 repo），`--purge` 只加在最後一支素材（腳本結束，含失敗，時自動刪；前面的支加了後面就沒登入檔），或 Phase 5 統一手動 `rm`。
- 沒給 `--auth` 就不登入。檔案讀不到或 cookie 寫不進去，結束碼 1。

## 等就緒、裁掉載入段

流程：`load` → `networkidle`（最多 5 秒，逾時略過）→ 有 `--ready <testid>` 就等該元素可見（20 秒逾時，結束碼 2）。

- 一般模式從開頁就在錄，載入畫面會留在影片開頭；腳本記下就緒時間，轉檔時用 `-ss` 裁掉。
- `--step` 模式截圖從就緒後才開始，天生沒有載入段。
- `--ready` 請選頁面主要內容完成後才出現的元素，避免裁太早。

## 為什麼 3D／canvas 一定要 --step

headless 沒有 GPU，WebGL 走 swiftshader 軟體算圖，即時錄影實測只有約 6 fps，播起來一格一格卡。腳本已帶 `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` 讓 WebGL 能跑，但速度救不了。

`--step` 的做法：`page.clock.install()` 接管時鐘並在就緒後暫停，每格 `runFor(1000/fps)` 讓頁面前進一格、`screenshot` 存成 jpg，最後 ffmpeg 合成固定 `--fps`。算得再慢，成品也是 30 fps。代價是只有受假時鐘控制的動畫會前進（JS 計時器、requestAnimationFrame）；純 CSS 動畫與影片元素不一定跟著動，錄完要看。截圖預設 `--dpr 2`（`deviceScaleFactor: 2`），輸出是 viewport 的 2 倍解析度，給之後要推近的畫面用；不推近就 `--dpr 1`。兩種模式輸出都強制偶數邊長與 `yuv420p`。解析度看用途：放進骨架視窗用預設 `--viewport 1440x900`（視窗 16:10）；要鋪滿全畫面用 `--viewport 1920x1080`。

2D 靜態頁、純 DOM 操作可用一般模式，快很多。

## actions 檔

`--actions <file.mjs>`，default 匯出 `async ({ page, shoot, mark })`。`shoot(n)` 拍 n 格（一般模式等 n/fps 秒），`mark(label)` 記目前格號與秒數到 `<out>.marks.tsv`（欄位 label、frame、seconds），給後製對時間點用。

```js
// 點按鈕：游標分格滑過去再點
export default async ({ page, shoot, mark }) => {
  const box = await page.getByTestId('some-button').boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(100 + ((x - 100) * i) / 10, 100 + ((y - 100) * i) / 10)
    await shoot(1)
  }
  mark('click')
  await page.mouse.click(x, y)
  await shoot(30)
}
```

```js
// 拖曳旋轉：按下後分格移動，每移一步拍一格
export default async ({ page, shoot, mark }) => {
  await page.mouse.move(700, 450)
  await page.mouse.down()
  mark('drag-start')
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(700 + i * 6, 450 + i)
    await shoot(1)
  }
  await page.mouse.up()
  await shoot(15)
}
```

- 動作要拆成「一步一格」，影片裡的游標才會平順移動；一次 `mouse.move` 跳到定點，影片裡就是瞬移。
- 點擊漣漪與假游標由腳本注入，不用自己畫；`#nuxt-devtools-container` 已隱藏。

## 轉檔參數

一般模式 webm → mp4、step 模式 jpg → mp4 都用同一組：`-c:v libx264 -pix_fmt yuv420p -crf 20 -preset slow -movflags +faststart -an`，輸出 `-r 30`（`--fps` 可改）。`yuv420p` 讓瀏覽器與剪輯軟體都能播，`faststart` 把索引放檔頭，`-an` 因為素材無聲。

## 錄完檢查

```bash
# 首幀不是空白：YAVG ≤ 20（純黑）或 ≥ 230（純白）就是空白，代表裁太早或頁面沒畫出來
ffmpeg -i x.mp4 -vf "select=eq(n\,0),signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null - 2>&1 | grep YAVG

# 重複幀：去重後剩下的幀數要 ≥ 總幀數 × 0.98，否則畫面其實沒動（時鐘沒前進、卡住）
ffprobe -v error -count_frames -select_streams v -show_entries stream=nb_read_frames -of csv=p=0 x.mp4
ffmpeg -i x.mp4 -vf mpdecimate -an -f null - 2>&1 | grep -o 'frame= *[0-9]*' | tail -1

# contact sheet：每秒一張縮圖拼成一張圖，一眼看整段內容
ffmpeg -i x.mp4 -vf "fps=1,scale=480:-1,tile=4x4" -frames:v 1 sheet.png
```

- 檢查用的輸出放 `<work>/`，不要放進 repo。
- 第一個 mpdecimate 比例超過 2% 就該懷疑：該動的地方沒動。
