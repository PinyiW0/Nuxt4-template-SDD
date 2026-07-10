# 視覺層級規範

> **定位**：AI 生成 UI 時的預設值，不是凍結合約——vibe 階段依 `rules/vibe-ui.md`，使用者有明確指示時可偏離。
> **消費點**：`/feature-to-ui` Phase 3-5（SKILL.md `@` 載入）＋ `rules/ui-conventions.md`（SDD 流程外修改 UI 時指讀）。
> **核心原則**：一個畫面只有一個主焦點。層級靠「尺寸 × 字重 × 顏色」三者組合表達，不靠單一大字。

## 0. 字級三層規則（硬規則）

1. **預設**只用 Tailwind 內建字級（`text-xs` ~ `text-4xl`）與 Nuxt UI 語意色。
2. **需要新字級**時，先在 `app/assets/css/main.css` 的 `@theme` 定義具名 token 才可使用，並把新層級補進本檔表格：
   ```css
   @theme static {
     --text-h2: 2rem;
     --text-h2--line-height: 1.25;
   }
   ```
3. **禁止**：`text-[13px]` 這類任意值字級（規範漂移的主要來源）；使用未在 `@theme` 定義的具名 token（如 `text-h2` 未定義就用——class 會**靜默失效**，樣式不出現也不報錯）。

> 可機器判定的硬規則（任意值字級、`font-light` 以下、`text-5xl+`、裸 `outline-none`）由 `npm run eslint` 串的 `scripts/visual-hierarchy-check.mjs` 強制檢查。

## 1. 文字層級

| 層級 | 使用時機 | class | 每頁數量 |
|------|---------|-------|---------|
| 頁面主標題 | 每頁唯一大標（PageHeader） | `text-2xl font-bold text-neutral-900 dark:text-white` | **一頁一個** |
| 區塊標題 | 頁內分區的 eyebrow 式小字眉標，不與主標搶焦點 | `text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400` | 不限 |
| Modal / Slideover 標題 | 覆蓋層標題一律降級，不用大字 | `text-lg font-semibold text-neutral-900 dark:text-white` | 每個覆蓋層一個 |
| 卡片 / 列表項標題 | 卡片內主要名稱、列表項標題 | `text-base font-semibold` 或 `text-sm font-medium`（配主要文字色） | 不限 |
| 內文 / 表格儲存格 | 一般內容 | `text-sm text-neutral-700 dark:text-neutral-300` | — |
| 輔助文字 | 欄位說明、時間戳、次要資訊 | `text-xs text-neutral-500 dark:text-neutral-400` | — |
| 空狀態 | 永遠最低調：小字、無彩色底、不搶焦點 | `text-sm text-neutral-500 dark:text-neutral-400`（icon 用 `text-neutral-400`） | 最低層級 |

### 表格文字

- 表頭與儲存格**同字級**（`text-sm`），只用字重分層：表頭 `font-semibold`、儲存格 `font-normal`——不放大表頭
- 數字欄一律**右對齊**＋`tabular-nums`；文字欄左對齊
- 截斷（`truncate`）必須配 tooltip 顯示全文，不能讓內容無路可看

### 數值展示例外（非標題，不佔主標名額）

統計卡、儀表板數值可用 `text-2xl` / `text-3xl font-semibold tabular-nums`——數值是資料不是標題。

### 字重與標籤

- 禁用 `font-light` 以下字重（小字直接不可讀）；強調＝同字級**升一級字重**（normal→medium→semibold），不跳級亂配 `font-bold`
- 不單獨用 `leading-*`／`tracking-*` 拆散內建字級自帶的行高配套（例外：眉標 `tracking-wider`、統計數值可 `tracking-tight`）
- 視覺層級只決定 class，**不決定 HTML 標籤**——`h1`~`h6` 依文件大綱獨立選擇，一頁只有一個 `<h1>`

### 空狀態三分型（依成因給不同文案與動作）

- **首次使用**（尚無資料）→ 一句說明＋「建立」主要動作
- **搜尋/篩選無結果** → 說明原因＋「清除篩選」動作，**不放建立按鈕**
- **錯誤/無權限** → 說明使用者能自行做什麼
- 空狀態動作最多一主一次

### 禁止

- 頁內 section 標題用 `text-2xl`（與頁面主標同級互搶焦點）
- Modal / Slideover 標題用 `text-2xl` 以上
- 一頁出現兩個以上 `text-3xl` 以上的大字（統計數值除外）
- 後台介面使用 `text-5xl` 以上（僅公開行銷頁適用）
- 空狀態加大字、彩色底或裝飾（它的職責是安靜地說「沒資料」）

## 2. 文字顏色層級

> 分工：rules.md「配色策略」管**哪個語意色用在哪類元件**；rules.md「深淺模式與對比色」管 dark 配對；本章管**文字的層級**——同一畫面的文字靠灰階深淺分主次。

| 層級 | 使用時機 | class |
|------|---------|-------|
| 主要文字 | 標題、資料值、使用者輸入內容 | `text-neutral-900 dark:text-white` |
| 次要文字 | 描述、表頭、標籤 | `text-neutral-500 dark:text-neutral-400` |
| 輔助 / 佔位 | placeholder、停用狀態、浮水印 | `text-neutral-400 dark:text-neutral-500` |

- 語意色文字（`text-success-600` 等）只表達狀態語意，不做裝飾層級。
- `text-primary-*` 只用於連結與強調，不做大面積標題色。
- 徽章語意（UBadge `variant="soft"`）：正向=`success`、警示/待處理=`warning`、負向=`error`、中性=`neutral`。
- **狀態不可只靠顏色傳達**：徽章/狀態點必配文字或 icon（紅綠色盲無法區分紅與綠）。

### 禁止

- 同一段文字塊混用兩種灰階層級
- 把狀態語意色當標題色或裝飾色用

## 3. 載體與響應式字級

策略是 desktop-first（`ui-config.yaml > responsive.strategy`），但 Tailwind class 是 mobile-first——**基準寫行動版，`lg:` 放大**。

- **只有頁面主標題需要響應式**：`text-xl lg:text-2xl`
- 其餘層級全載體固定：`text-sm` / `text-xs` 在手機上仍易讀，再縮反而不可讀

### 禁止

- 內文縮到 `text-xs` 以下
- 每個文字元素都掛斷點
- 三段以上響應式鏈（`sm:text-* md:text-* lg:text-*`）

## 4. 按鈕尺寸（UButton size）

| 情境 | size | 備註 |
|------|------|------|
| 表格列內動作 | `xs` | icon + `variant="ghost"` |
| 工具列、篩選、次要動作 | `sm` | |
| 表單送出、Modal 動作、頁首主動作 | `md`（預設，可不寫） | |
| 頁面級主 CTA（登入送出、空狀態引導） | `lg` | 登入類加 `block` 全寬 |
| 行動裝置全寬主動作 | `lg` + `block` | UButton 最高約 40px，44px 觸控目標靠全寬補足 |

- `xl` 後台幾乎不用（僅公開頁 hero）。
- 同一容器內的同組按鈕 size 必須一致；同組選項用樣式（solid/outline/ghost）分主次，不用尺寸分。
- **破壞性動作不可是預設按鈕**：確認 Modal 的預設焦點給「取消」，刪除鈕（`color="error"`）需明確點擊。

## 5. 表面與層次（elevation）

| 層次 | 用法 |
|------|------|
| 靜態卡片 | `border border-neutral-200 dark:border-neutral-800`，**不用陰影** |
| 浮動元素（dropdown / popover / tooltip） | `shadow-md` |
| 覆蓋層（modal / slideover） | `shadow-xl` |

- 陰影只給「浮在頁面之上」的元素；靜態卡片靠邊框與背景分層。
- dark 模式的深度靠**背景亮度**不靠陰影：浮層背景比頁面亮一階（頁面 `dark:bg-neutral-950` → 卡片 `dark:bg-neutral-900` → 浮層 `dark:bg-neutral-800`），陰影在暗底上失效。
- 背景嵌套最多三層：頁面底色 → 卡片 → 卡片內嵌區塊（well），禁止第四層。

## 6. 互動與表單層級

- **focus**：自訂可互動元素一律 `focus-visible:ring-2`（primary 系）；禁止 `outline-none` 而不補替代指示（Nuxt UI 元件自帶 focus 樣式，不要覆寫掉）。
- **placeholder 不得取代 label**：label 必須存在，必要時用 `sr-only` 視覺隱藏。
- 驗證錯誤訊息在 helper text 的**原位置**顯示（同格互斥、不疊加）；位置實作依 `ui-config.yaml > form.errorMessage`。

## 附錄：間距層級

- 卡片 padding：`p-5`（內容卡）、`p-6`（KPI / 重點卡）
- 頁面大分區：`space-y-8`；避免 `space-y-10` 以上的過大切割
- 區塊內群組：`space-y-4` ~ `space-y-6`
- 水平間距：`gap-3`（緊湊）、`gap-4` / `gap-6`（區塊層級）、`gap-8`（grid 欄間）
