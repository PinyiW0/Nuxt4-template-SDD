# 執行方式判準（fallback）

> 本檔為 `.claude/ops/model-dispatch.md` §1／§3 的可攜精簡複製件；**該檔存在時一律以該檔為準**，改 SSOT 時同步本檔。
> 供 Phase 2 Step 3 使用：判定精準 prompt 該「主線直接做」還是「派 subagent」。

## 派工判準（任一命中就建議派）

| 任務型態 | 判準 | 建議派給 |
|----------|------|----------|
| 探索／搜尋 | 預估要開超過 3 個檔案，或不確定目標在哪 | Explore |
| 大檔閱讀 | 單檔超過 300 行且**不知道**目標在檔內何處 | Explore |
| 批次改檔 | 同 pattern 改 3 個檔案以上 | general-purpose |
| 網頁調查 | 需要開超過 2 個網頁 | general-purpose |
| 審查／第二意見 | 一律 fresh subagent（驗證不自驗）；機械檢查（lint／測試）由產出者自跑並附輸出 | general-purpose |

- 全部不命中 → **主線直接做**。
- 例外：已知檔名＋已知大概位置的單點確認，自己做比交辦便宜——區分軸是**知不知道位置**，不是行數。
- 多階段任務可混合：如「先派 Explore 盤點，回來後主線實作」。

## model 對照（派工時顯式帶上，不指定會繼承主線模型）

| 任務 | model |
|------|-------|
| 存在性檢查、列清單、read-back 比對 | `haiku` |
| 需讀懂內容的搜尋、盤點、摘要；有明確驗收的實作、重構 | `sonnet` |
| 對抗審查、架構設計、複雜除錯 | `opus` |

主線模型不派給 subagent。subagent 類型（Explore／general-purpose 等）以當前 session 的 harness 宣告清單為準，不要假設固定存在。

輸出格式定義於 phase-2-compose.md Step 3（本檔只提供判準，不重複格式）。
