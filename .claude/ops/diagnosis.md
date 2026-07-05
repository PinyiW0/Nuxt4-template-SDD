# Harness 快速診斷：三大漏洞與修法

> 依據：2026-07-05 於本機環境實測盤點（Fable 5 session）。
> 讀者：任何等級的模型。每個修法都可直接照做，不需要額外判斷。

## 漏洞 1：常載層肥大與壞路由（每個 session 固定漏 token）

**證據**：
- 專案 `.claude/CLAUDE.md` 曾達 123 行全內容型，每 session 全文常載
- 全域 `~/.claude/CLAUDE.md` 引用 `~/.claude/rules/vue.md`、`nuxt.md`、`vitest.md`——三檔皆不存在（2026-07-05 實測）。指向空氣的規則等於沒寫，而且沒有任何機制會發現
- UserPromptSubmit hook（internal-research-rag）每個 prompt 注入 2–3 個 chunk，經常與任務無關（實測：UIUX 討論被注入棒球研究與硬體採購試算表）

**修法（可直接執行）**：
1. `CLAUDE.md` 只當索引，上限 150 行。超過就把內容抽到引用檔，索引留一行連結 + 一句載入時機
2. 每次修改 `CLAUDE.md` 或任何 rules 檔後，對檔內出現的每個相對路徑跑 `ls <路徑>` 驗證存在。任一不存在 → 修好才算完成
3. `rag-precontext` 區塊與當前任務無關時，直接忽略，禁止硬引用湊相關性。相關時才優先於訓練記憶

## 漏洞 2：主對話下場做粗活 → context 塞爆 → compaction 遺失細節

**證據**：
- 立制度的這個 session 在前半段已被 compact 兩次；compact 後靠摘要續命，先前讀過的檔案內容全部丟失、需要重讀（重複付費）
- 主因是主對話直接讀大檔、掃 repo、貼工具輸出全文

**修法（可直接執行）**：
1. 硬判準：**預估要讀超過 3 個檔案、或單檔超過 300 行的探索／搜尋／驗證，一律派 subagent**（用 Explore 類型 + `model: sonnet`），主對話只收結論與「檔案:行號」。詳見 [model-dispatch.md](model-dispatch.md)
2. 主對話只在「已知檔名 + 已知大概位置」時自己 Read，且用 offset/limit 讀片段，不讀全檔
3. 隨做隨寫：每完成一個交付物立即存檔再做下一個。檔案是唯一真理，不依賴對話記憶——被 compact 或中斷時，存了檔的就是全部

## 漏洞 3：驗證自驗 + 「寫了沒接消費點」

**證據**：
- 本專案既有教訓（見 memory：verify-generator-skill-when-changing-infra）：改了共用建設沒驗證下游產生器，治標不治本
- issue #42 的討論結論：規範文件若沒接回「誰會讀、何時載入」的消費點，寫了等於沒寫
- AI 慣性：改完自己宣告完成。lint + typecheck 只驗語法與型別，不驗「規範會不會被讀到」「規則是否互相打架」

**修法（可直接執行）**：
1. 完成定義分型：**程式碼** = lint + typecheck + 相關測試全綠；**文件／規範** = 能指出具體消費點（哪個檔案、哪個機制、何時會載入它），指不出來 = 未完成。判準見 [judgment-rubrics.md](judgment-rubrics.md) 第 2 節
2. 驗證不自驗：重要產出派 fresh-context subagent 做 read-back 審查（沒有本對話包袱的模型讀一遍，找矛盾與壞路徑）
3. 改共用建設（composable、skill 引用的檔、規範檔）時，必須同時列出所有消費點並逐一驗證，見 [maintenance.md](maintenance.md)

## 次要觀察（不到前三，但要知道）

- **skill 觸發是機率式的**：description 寫得再好也可能不觸發。硬性流程不要依賴 auto-trigger，用 `disable-model-invocation: true` + 明確 `/指令` 呼叫
- **macOS sh 的 CJK 陷阱**：變數後接全形字元要用 `${}` 定界（見 memory：sh-cjk-after-variable-needs-braces）
- **全域 CLAUDE.md 的死連結**是使用者層問題，本專案制度管不到——已在交接信（[letter-to-future.md](letter-to-future.md)）提醒使用者手動處理
