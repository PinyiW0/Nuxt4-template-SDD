# Copilot review 的行為與踩坑

來源：PinyiW0/Nuxt4-template-SDD PR #132 實跑，2026-09-01。七輪 review 才收斂，以下每一條都對應真實付出的代價。

## 1. re-request 必須走 GraphQL

REST `POST /repos/{o}/{r}/pulls/{N}/requested_reviewers -f 'reviewers[]=copilot-pull-request-reviewer[bot]'` 對 **re-request 無效**：回 200、回傳完整 PR 物件，但 `requested_reviewers` 始終是空陣列，Copilot 也不會來。實測靜置兩小時零反應；改用 GraphQL 後 10 分鐘內就收到 review。

GitHub 對認不得的 reviewer 是**靜默忽略**，不報錯——所以只看 HTTP 狀態碼會誤判成功。

有效做法是 `requestReviews` mutation 的 `botIds`（REST 只認 user／team，這是它失效的原因）：

```bash
.claude/skills/review-loop/scripts/copilot.sh request <PR編號>
```

bot node ID 由 `copilot.sh bot-id` 解出：掃 repo 近 50 個 PR 的 review 作者，取 `__typename == "Bot"` 且 login 命中 `copilot.*review` 的，**去重後必須唯一**——撈到多個不同 id 就報錯要人工指定，不猜（請錯 bot 一樣會回成功，然後 review 永遠不會來）。

**不要比對完整 login 字串**，它隨端點而異（實測 2026-09-02）：GraphQL review author 是 `copilot-pull-request-reviewer`、REST `/pulls/N/reviews` 是 `copilot-pull-request-reviewer[bot]`、REST `/pulls/N/comments` 是 `Copilot`。但也不能只用 `contains("copilot")`——那會連 `copilot-swe-agent` 一起撈進來，污染輪詢的基準線。

> **與 `/pr`、`/ship` 現有寫法的關係**：那兩個 skill 寫的 REST 版本是給**初次**請求用的，在「repo 沒開自動 Copilot review」的情況下有效；`/ship` 的「回 200 但空陣列不用排查」也只對初次成立。第一輪 review 結束後 ruleset 不會再自動觸發，REST 也請不動，此時只有 GraphQL 有效。

## 2. review 常錨在舊 commit

Copilot 會在你 push 新 commit **之前**就開始跑，完成時 review 錨的是舊 head。實測七輪裡有三輪如此，同一個問題被重複提出，其中「import 不完整」被提了兩次、「SKILL.md 交叉引用」被提了兩次。

**每次拿到 review 先比對錨點**：

```bash
gh api repos/<o>/<r>/pulls/comments/<留言id> --jq .commit_id   # inline 留言
git rev-parse --short HEAD
```

suppressed comment 沒有自己的留言 id，看該則 review 的 `commit_id`（`copilot.sh reviews` 已一併輸出）。

錨點不等於 HEAD 時，**先讀遠端實際內容**確認問題是否已修掉：

```bash
git show origin/<branch>:<path>
```

已修掉就**只回覆說明、不重改也不重 commit**，回覆裡附上 commit 對照與遠端實際內容當證據，然後 re-request 讓它跑在最新 commit 上。為了「看起來有回應」而把已修好的東西再改一次，是這個坑最貴的失敗模式。

## 3. 問題常藏在 review body 的 Suppressed comments

Copilot 的 review body 可能夾帶結構化的 `Suppressed comments (N)` 區塊，**帶明確的 file:line 與完整建議**，但 inline 留言數是 **0**。實測七輪中有四輪是這種形態——只讀 inline 留言會整輪漏掉，而且不會有任何徵兆。

review body 一定要讀完，不能只當摘要跳過。`copilot.sh reviews` 的輸出含 `body` 就是為了這個。

`/pr-feedback` 步驟 2 的四路抓法只涵蓋 inline 留言與 review 總結本體，未特別處理這個區塊——它把 (c) review 當「沒有 file:line 的總結」，而 suppressed 區塊**自己帶著 file:line 與完整建議**，照那個指引會被當純摘要略過。委派它抓留言時要自己另外補這一步。

## 4. Copilot 給的行號不可靠

它在 review body 摘要裡標的行號，與 inline 留言標的行號、以及檔案真實行號，三者可能互不相符（實測差 2–4 行）。它說「同檔案其他行也有此問題」時給的行號同樣不可信。

一律用它描述的**內容**去檔案裡搜，不要直接跳到它給的行號。

## 5. 回覆留言的兩種端點

| 留言形態 | 回覆方式 |
|---|---|
| inline 留言（有 comment id） | `gh api repos/<o>/<r>/pulls/<N>/comments/<id>/replies -f body='…'`，回在原討論串 |
| suppressed comment、review 總結 | 沒有 thread 可掛 → `gh pr comment <N> --body '…'` |

回覆內容要能被第三者驗證：附 `commit_id` 對照、遠端實際檔案內容、或實測數據。判定為誤判時說清楚理由，不要只寫「已處理」。
