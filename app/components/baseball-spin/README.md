# baseball-spin — 3D 棒球旋轉視覺化模組

吃演算法後端（bsa-module）的 `result.json`，用 three.js 重現該球的真實旋轉（含縫線樣貌），並疊上依 `spin_tilt.degrees` 旋轉的指針箭頭。

## 跨專案搬移

整個 `baseball-spin/` 資料夾複製到目標專案的 components 目錄即可：

- 內部全用相對 import，`core/` 是純 TS + three（零 Vue/Nuxt 依賴）
- 依賴：`three`（dependencies）、`@types/three`（devDependencies）
- 另需自備 glb 模型檔（演算法同款 `baseball_detail.glb`，本專案放 `public/models/`）——用不同 glb 縫線初始朝向會對不上
- **不要**把 `core/` 的函式搬去 `app/utils/`（會被 Nuxt 全域 auto-import，破壞可攜性）

## 使用

```html
<!-- data：parseSpinResult() 解析後的資料（null 顯示空）
     speed：播放倍率（1 = 真實轉速）
     show-tilt-arrow：spin_tilt 指針開關 -->
<BaseballSpinViewer
  :data="spinResult"
  model-url="/models/baseball_detail.glb"
  :speed="1"
  :autoplay="true"
  :show-tilt-arrow="true"
/>
```

- 後端 JSON 先過 `parseSpinResult()`（`core/types.ts`，zod 驗證 + snake_case → camelCase）
- emits：`ready` / `error` / `progress(loaded, total)`；expose：`play()` / `pause()`
- 載入 UI 可用 `#loading` slot 客製（slot props：`percent`）

## 數學慣例（來源：bsa-module `docs/result_json_format.md`）

- 姿態：`R(θ) = Rodrigues(axis·sign(omega)·θ) · R_ref`（左乘，相機系）
- 相機：正交、位於 `[0,0,3]` 看向原點、up=+Y、halfExtent 1.5（= 後端 xmag）
- glb 載入後做「中心化＋平均頂點半徑歸一化」（同後端 `load_unit_sphere_trimesh`）
- 轉軸指針：場景內的 3D 黃箭頭（圓柱＋圓錐，同後端 `set_rotation_axis`：全長 4 個球半徑、桿半徑 0.035、單頭）——
  沿帶號自轉軸 `axis·sign(omega)` 擺放、固定在相機系（球轉軸不轉），遮蔽與立體感由深度緩衝自然呈現。
  補充：軸投影方向與 spin_tilt 的關係為「投影角 ≡ 90° − spin_tilt.degrees」；
  若要做 jsjh-2026-frontend 那種 2D 時鐘面板（數據視覺化），直接 `rotate(spin_tilt.degrees)` 即可，兩者是不同的呈現。

## 三視角擴充點（未實作）

`core/views.ts` 的 `ViewConfig.worldPreRotation`：換視角＝對姿態再左乘視角旋轉（`qFinal = qView · qCam`）。後端 `views`（camera/pitcher/batter）資料接上後在 `VIEW_PRESETS` 補 preset 即可，`BaseballSpinViewer` 已有 `view` prop。

## 驗證

- 單元測試：`test/unit/baseball-spin/`（rpm 交叉驗證、轉軸不變量、歸一化）
- 目視比對：`/spin-demo` 頁，與後端 `result.gif` 並排（速度選 1/60x——本批 sample gif 的 slow_factor 由幀數反推為 60）
