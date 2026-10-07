# review-loop evals：拿 Copilot 的歷史留言當測試題

目的：回答兩個問題。(a) 本地 `/code-review` 在 push 前能先抓到 Copilot 會抓的問題的幾成——決定 #171「本地先審」值不值得、要不要加 prompt 焦點。(b) `.github/copilot-instructions.md` 上線後，Copilot 的誤判＋範圍外比例有沒有降。

## 檔案

| 檔 | 進版控 | 內容 |
|---|---|---|
| `copilot-cases.tsv` | 是 | 每則 Copilot 意見一列（11 欄，由 `scripts/copilot-harvest.sh` 產）＋ verdict |
| `runs/<日期>/pr-<N>.md` | 否 | 該日對 `eval/pr-<N>` 跑本地 `/code-review` 的 findings 原文 |
| `runs/<日期>/summary.tsv` | 否 | 該日的抓取率與誤判／範圍外比例 |

## 流程

1. **收 case**：`sh .claude/skills/review-loop/scripts/copilot-harvest.sh <PR…> > evals/copilot-cases.tsv`。
2. **填 verdict**：派 **haiku** subagent 依 reply_excerpt 五選一（必修已修／誤判／範圍外／可選／未回覆），輸出「行號 TAB verdict」後用 awk 填回第 11 欄。評分模型要與產生者不同——Copilot 不是 Claude、本地 `/code-review` 是主線模型，haiku 都不是。
3. **(a) 抓取率**：對每個 PR 取**第一則 Copilot review 的 `commit_id`**（`gh api repos/<o>/<r>/pulls/<N>/reviews` 依 id 排序取 `.[0].commit_id`），`git branch -f eval/pr-<N> <sha>`，用 Skill tool 跑 `/code-review eval/pr-<N> --max-findings all`，findings 存 `runs/<日期>/pr-<N>.md`。再派 haiku 對每條 verdict＝必修已修 的 case 判「本地 findings 有沒有同 path 且同一缺陷」→ 抓取率寫 `summary.tsv`。跑完 `git branch -D eval/pr-<N>`。
4. **(b) 政策檔效果**：政策檔上線後對新 PR 再跑 1–2，比 `(誤判＋範圍外) ÷ 總數` 與 baseline。

## baseline（2026-10-07，#151、#135、#141）

- case 123 則：必修已修 56、未回覆 55（多為 Previously missed，無 thread 可對應回覆）、誤判 5、可選 5、範圍外 2。verdict 由 haiku 填，未逐則人工覆核。
- **(a) 抓取率**（同檔且同一缺陷，嚴格判定）：#151 4/18＝22%、#135 5/16＝31%、#141 6/22＝27%，**合計 15/56＝27%**。寬鬆的「同檔命中率」83–100%。本地 /code-review 共 70 則 findings，只有 12 則與 Copilot 的必修重疊——兩者看同一批檔、抓不同缺陷，是互補不是取代。
- **(b) 誤判＋範圍外比例**：7/123＝5.7%（排除未回覆後 10.3%）。政策檔能省的上限就這麼多。
- 對 #171 的含意：本地先審只能先擋掉約四分之一 Copilot 會提的必修，另外會多抓 58 則 Copilot 沒提的缺陷。要拉高抓取率，/code-review 要加焦點。41 則漏抓的分類（haiku，`runs/2026-10-07/miss-categories.md`）：**文件／程式／測試三者描述不同步 19**、邊界值與邏輯驗證 10、shell 相容性寫法 8、環境變數與逾時設定 4——#171 的 1b 與 7b 給 `/code-review` 的焦點至少要含第一類。

## 注意

- **不可用 PR 編號當 `/code-review` 的目標**——那會審修完後的 head，抓取率沒意義。
- Copilot 給的行號會差 2–4 行（`references/copilot-quirks.md` §4），判定看 path＋描述。
- 同一條 Previously missed 會在後續 review 重複列到修掉為止，harvest 已依 path:line 去重。
- 誰消費這份數字：#173 的驗收、`SKILL.md` 第 8 節的目標、`.claude/ops/maintenance.md` §5 的定期健檢。
