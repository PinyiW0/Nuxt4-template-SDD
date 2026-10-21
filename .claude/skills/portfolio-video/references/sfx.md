# 音效清單（CC0）

本表是音效的**唯一真理來源**：`scripts/mix.mjs` 直接讀這張表，缺檔時依「下載網址」欄抓到 `<work>/sfx/<id>.mp3`，再用 ffprobe 比對「秒」欄（±max(10%, 0.05 秒)）確認抓對檔。

- 全部取自 Freesound，授權 **CC0 1.0**（https://creativecommons.org/publicdomain/zero/1.0/ ），不需標示作者，但下表仍保留出處供查核。
- 資料來源：Openverse API 的音檔 metadata；驗證日期 **2026-10-20**。
- 下載網址是 Freesound 的 hq preview（128 kbps mp3），不需 API key。網址失效時到「出處」頁手動下載，放到 `<work>/sfx/<id>.mp3` 即可。
- 表格格式給程式讀：資料列第一欄是 `id`（只含小寫字母與底線），欄位順序固定，**不要調換或增刪欄位**。

| id | 用途 | 標題 | 作者 | 授權 | 出處 | 下載網址 | 秒 |
|---|---|---|---|---|---|---|---|
| whip | 甩鏡 | Swipe Whoosh | qubodup | CC0 1.0 | https://freesound.org/people/qubodup/sounds/60007 | https://cdn.freesound.org/previews/60/60007_71257-hq.mp3 | 0.45 |
| whoosh_deep | 視窗進場 | Deep Whoosh #1 | Kinoton | CC0 1.0 | https://freesound.org/people/Kinoton/sounds/351256 | https://cdn.freesound.org/previews/351/351256_2247456-hq.mp3 | 3.16 |
| whoosh_little | 大字穿過、露出下一段 | Little Whoosh 3 | ch_ase | CC0 1.0 | https://freesound.org/people/ch_ase/sounds/423798 | https://cdn.freesound.org/previews/423/423798_3982955-hq.mp3 | 2.47 |
| tick | 數字滾輪（ticker 連擊） | Tic Toc Click | Breviceps | CC0 1.0 | https://freesound.org/people/Breviceps/sounds/448081 | https://cdn.freesound.org/previews/448/448081_9159316-hq.mp3 | 0.03 |
| scroll | 標籤換段 | Menu Scroll/ Selection Sound | CS279 | CC0 1.0 | https://freesound.org/people/CS279/sounds/200469 | https://cdn.freesound.org/previews/200/200469_3293865-hq.mp3 | 0.22 |
| click | 卡片彈出、多格組合 | UI Button Click | benzix2 | CC0 1.0 | https://freesound.org/people/benzix2/sounds/467951 | https://cdn.freesound.org/previews/467/467951_6769414-hq.mp3 | 0.12 |
| hit_ambient | 片頭、片尾品牌名 | [Ambient Hits] Ambient Hit | waveplaySFX | CC0 1.0 | https://freesound.org/people/waveplaySFX/sounds/529139 | https://cdn.freesound.org/previews/529/529139_1676145-hq.mp3 | 4.01 |
| boom | 大字轉場、甩鏡落地 | Bass Boom | LordHannes | CC0 1.0 | https://freesound.org/people/LordHannes/sounds/268084 | https://cdn.freesound.org/previews/268/268084_3812550-hq.mp3 | 10.35 |

## 混音時的裁切（`gen.mjs` 寫進 `cues.json` 的預設；`mix.mjs` 只照 cues 做，要改長度去改 gen）

| id | 裁切 | 原因 |
|---|---|---|
| boom | 取前 1.4 秒，尾 0.6 秒淡出 | 原檔 10 秒太長，只要「敲一下」 |
| hit_ambient | 取前 2.6 秒，尾 1.2 秒淡出 | 片頭用短版；片尾品牌名用原長 |
| whoosh_deep | 取前 1.3 秒，尾 0.5 秒淡出 | 視窗進場只要風聲的頭段 |

## 配樂

配樂不在本表。預設用 MusicGen 在本機生成（見 `audio.md`），**權重授權 CC BY-NC 4.0，不可商業使用**；要商用時換成自備的授權音樂，放到 `<work>/bgm.wav` 即可。
