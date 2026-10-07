# review-loop evals：拿 Copilot 的歷史留言當測試題

目的：回答兩個問題。(a) 本地 `/code-review` 在 push 前能先抓到 Copilot 會抓的問題的幾成——決定 #171「本地先審」值不值得、要不要加 prompt 焦點。(b) `.github/copilot-instructions.md` 上線後，Copilot 的誤判＋範圍外比例有沒有降。

## 檔案

| 檔 | 進版控 | 內容 |
|---|---|---|
| `copilot-cases.tsv` | 是 | 每則 Copilot 意見一列（11 欄，由 `scripts/copilot-harvest.sh` 產）＋ verdict |
| `runs/<日期>/pr-<N>.md` | 否 | 該日對 `eval/pr-<N>` 跑本地 `/code-review` 的 findings 原文 |
| `runs/<日期>/summary.tsv` | 否 | 該日的抓取率與誤判／範圍外比例 |

## 流程

1. **收 case**（在 repo 根目錄執行）：`sh .claude/skills/review-loop/scripts/copilot-harvest.sh <PR…> > .claude/skills/review-loop/evals/copilot-cases.tsv`。
2. **填 verdict**，分兩步：
   - reply_excerpt 為空 → 直接用 awk 填 `未回覆`，**不交給模型**。2026-10-07 第一版把 55 則判成未回覆，其中 34 則其實有回覆——讓模型自己決定「有沒有回覆」會出錯。
   - 其餘派 **sonnet** subagent 四選一（必修已修／誤判／範圍外／可選），**禁止輸出未回覆**，並要求「以最終結論為準，不是開頭」。輸出「行號 TAB verdict TAB 理由」後用 awk 填回第 11 欄。評分模型要與產生者不同：Copilot 不是 Claude，本地 `/code-review` 是主線模型。haiku 在這一步誤判率太高，不用。
3. **(a) 抓取率**：對每個 PR 取**第一則 Copilot review 的 `commit_id`**：`sh .claude/skills/review-loop/scripts/copilot.sh reviews <N> | jq -r 'sort_by(.id) | .[0].commit_id'`。不要直接打 `/pulls/<N>/reviews` 取第一則——那會拿到人類或 `sdd-review.yml` 的 review，`git branch -f eval/pr-<N> <sha>`，用 Skill tool 跑 `/code-review eval/pr-<N> --max-findings all`，findings 存 `runs/<日期>/pr-<N>.md`。再派 haiku 對每條 verdict＝必修已修 的 case（這一步是「同 path 且同缺陷」的比對，haiku 夠用） 判「本地 findings 有沒有同 path 且同一缺陷」→ 抓取率寫 `summary.tsv`。跑完 `git branch -D eval/pr-<N>`。
4. **(b) 政策檔效果**：政策檔上線後對新 PR 再跑 1–2，比 `(誤判＋範圍外) ÷ 總數` 與 baseline。

## baseline（2026-10-07，#151、#135、#141）

第一版 baseline（verdict 由 haiku 全包、回覆只取 200 字）經 /code-review 抓到誤標：55 則「未回覆」有 34 則其實有回覆。下面是修正 harvest 並照第 2 步重判後的數字。

| 指標 | #151 | #135 | #141 | 合計 |
|---|---|---|---|---|
| Copilot 意見（case） | 27 | 24 | 72 | 123 |
| 必修已修（抓取率的分母） | 18 | 11 | 24 | 53 |
| 本地 /code-review 先抓到 | 4 | 4 | 9 | 17 |
| **抓取率** | 22% | 36% | 38% | **32%** |
| 本地 findings 總數 | 16 | 25 | 29 | 70 |

- verdict 分佈：必修已修 53、範圍外 35、未回覆 31、誤判 4、可選 0。
- **誤判＋範圍外＝39/123＝32%**（排除未回覆 42%）。範圍外的 35 則有 29 則落在 #141 的 `frozen-paths-guard.mjs`：作者實測確認是繞道，但裁決列為已知極限、不在該 PR 修。
- 本地 70 則 findings 只有 16 則對上 Copilot 的必修——兩者看同一批檔、抓不同缺陷，是互補不是取代。
- 漏抓 36 則的分類：**文件／程式／測試三者描述不同步 18**、邊界值與邏輯 10、shell 相容寫法 4、環境變數與逾時 4。

對後續 issue 的含意：

- **#171 本地先審**：只能先擋約三分之一 Copilot 必修。給 `/code-review` 的焦點至少要含「文件描述與實作是否一致」，這一類佔漏抓的一半。
- **#173 政策檔**：價值比預期大。把「已裁決的已知極限」寫進 `.github/copilot-instructions.md`，Copilot 才不會再把它們當新問題提（#141 有 29 則屬此類）。效果要等 11 月有額度後用流程 4 驗。

## 注意

- Previously missed 沒有 thread，harvest 只能用「review 之後、提到同 path（優先 path:line）的第一則留言」當回覆，偶爾會對到處理另一則意見的總結留言（2026-10-07 重判時 sonnet 指出 12 則）。這類 case 的 verdict 可信度較低。
- **不可用 PR 編號當 `/code-review` 的目標**——那會審修完後的 head，抓取率沒意義。
- Copilot 給的行號會差 2–4 行（`references/copilot-quirks.md` §4），判定看 path＋描述。
- 同一條 Previously missed 會在後續 review 重複列到修掉為止，harvest 已依 path:line 去重。
- 誰消費這份數字：#173 的驗收、`SKILL.md` 第 8 節的目標、`.claude/ops/maintenance.md` §5 的定期健檢。
