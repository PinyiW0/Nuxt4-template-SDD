---
name: pr
description: 把當前 feature 分支發成對 default branch（通常 main）的 PR — push + 產繁中標題/內文草案 + gh pr create。一律先出草案待確認才開 PR；偵測未 commit 改動或人在 default branch 上會停下來引導，不越界。Use when 使用者要發 PR、開 PR、送出 pull request、或說「幫我發 PR」「開個 PR」時。
argument-hint: "[reviewer / assignee / label / draft / copilot / 補充說明(選填)]"
---

# PR

把當前 **feature 分支** 發成一個對 repo **default branch**（通常 `main`）的 Pull Request。職責是 **push → 產草案 → `gh pr create`**，與 `/commit` 解耦。本 skill 為**模板衍生專案通用**——不依賴 SDD 目錄結構，任何 GitHub repo 都能用。

**核心鐵律：永遠先列出「PR 標題 + 內文草案」給使用者確認，得到同意後才 `git push` + `gh pr create`。** 不先斬後奏。

## 與 /commit 的分工（單一職責）

本專案 commit 與發 PR 是兩段獨立流程，乾淨銜接 —— `/commit` 故意不 push，正好留給 `/pr` 接手：

```
/commit  →  把改動變成 commit（明確不 push）
/pr      →  接手：push → 產 PR 草案 → gh pr create
```

`/pr` **不負責 commit**。偵測到有未 commit 改動時，停下來叫使用者先跑 `/commit`，不越界代勞。

## 流程

### 1. 前置檢查（硬關卡，不通過就停）

依序檢查，任一不通過就停下說明，不硬幹：

| 檢查 | 命令 | 不通過 → |
|------|------|---------|
| gh CLI 可用且已認證 | `gh auth status` | 提示安裝 / `gh auth login` |
| 取得 default branch（下稱 `<default>`） | `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` | 取不到 → 預設 `main` |
| 不在 `<default>` 上 | `git branch --show-current` | **停**，引導先開 feature 分支（見下） |
| 工作區乾淨（無未 commit） | `git status --short` | **停**，叫先跑 `/commit`，不自己 commit |
| 是否已有對應 PR | `gh pr view --json url,state` | 命令報錯＝無 PR → 正常往下建；state=OPEN → 轉「只 push 更新」不重開；state=MERGED/CLOSED → 照常開新 PR |

**在 default branch 上是硬紅線**：開發一律走 feature 分支，不可直接動 default branch。此時停下來引導使用者建分支，命名慣例：

- `feature/#<issue>-<簡述>`（如 `feature/#2-development-skill`）
- `chore/<簡述>`、`fix/<簡述>`

### 2. 收集素材

先同步遠端再比對——本地 default branch 在多人 repo 幾乎一定落後，直接拿本地比會把別人已 merge 的 commit 算進草案：

```
git fetch origin
git log origin/<default>..HEAD --oneline    # 本分支所有 commit
git diff origin/<default>...HEAD --stat     # 變更檔案總覽
```

#### 解析 issue 編號（三層，由結構化到猜測）

1. **主：查 GitHub linked-branch 關聯**（結構化 SoT——不管分支是誰用什麼方式建的，只要掛在 issue 的 Development 側欄就查得到）：

   ```
   gh api graphql -f query='query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){issues(states:OPEN,first:50,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number linkedBranches(first:5){nodes{ref{name}}}}}}}' -f owner=<owner> -f repo=<repo>
   ```

   在結果中找 `ref.name` 等於當前分支名的 issue，取其編號。
2. **fallback 1：分支名 `#(\d+)`**（本專案慣例 `feature/#2-...`，也涵蓋 release 變體 `feature/1.2-#15-...`）。
3. **fallback 2：分支名開頭 `^(\d+)-`**（GitHub UI「Create a branch」與 `gh issue develop` 未帶 `--name` 的原生格式，如 `15-add-login`）。

三層都解析不到 → 略過 `Closes`，不硬湊。

**解析到編號時，內文結尾固定補一行 `Closes #<編號>`** —— PR 合併進 `main` 時 GitHub 會自動關閉該 issue，不必再手動關。不論內文用 PR 模板或內建三段式，都在最後補這行。注意：

- 關鍵字須**獨立成行、緊接編號**才生效（寫進清單項或被其他字包住會失效）。
- 跨 repo 的 issue 用 `owner/repo#<編號>`。
- 三層都解析不到編號 → 略過這行，不硬湊。

### 3. 產生標題 + 內文草案（全繁中）

**標題**：綜觀本分支所有 commit，摘一句**繁中**標題講清楚這個 PR 做了什麼 —— 不直接照搬英文 commit subject。

**內文**：

- repo 有 `.github/pull_request_template.md` → **以它為準**填寫。
- 沒有 → 用內建三段式：

```
## 摘要
<1–3 句：這個 PR 做了什麼、為什麼>

## 變更
- <對應本分支 commits 的重點邏輯改動>

## 測試
- <如何驗證；本專案 CI 自動跑 build + eslint + sdd-review>

Closes #<編號>
```

> 末行 `Closes #<編號>` 僅在分支名解析得到 issue 編號時加；沒有就拿掉。

### 4. 內文精簡易讀守則（重點）

PR 內文是給人讀的，**精簡直觀 > 鉅細靡遺**：

- **摘要 1–3 句**，講「做了什麼 + 為什麼」，砍掉「本 PR 旨在…」「為了提升…整體…」這類開場白廢話。
- **變更講邏輯改動，不逐檔流水帳** —— 檔案清單讓 diff 自己說，別把每個檔名抄一遍。
- **不複製 commit message** —— PR 是更高一層的視角，不是 commit 的拼貼。
- **沒內容的小節就不放** —— 純 skill/docs 改動沒手動測試步驟，「測試」一句帶過或省略，不硬湊。

反例（冗長通病，別這樣）：

```
## 摘要
本 PR 主要新增了一個全新的 skill，目的是為了協助使用者更方便地建立
Pull Request，提升整體開發體驗與工作流程效率。

## 變更內容
- 新增 .claude/skills/pr/SKILL.md
- 定義了 frontmatter
- 撰寫了完整流程說明
- 加入前置檢查邏輯

## 測試
- 已測試相關功能，確認沒有問題
```

正例（精簡）：

```
## 摘要
新增 `pr` skill，把當前 feature 分支一鍵發成對 main 的 PR。與 commit 解耦。

## 變更
- 前置檢查（在 main / 有未 commit 會擋）→ 繁中草案 → 確認後 push + 建 PR
- 進階：reviewer/label 選填、建完開瀏覽器

## 測試
CI 自動跑 build + eslint + sdd-review。

Closes #2
```

### 5. 先出草案 → 等確認 → 才執行

把標題 + 內文草案完整列給使用者，格式：

```
擬發 PR：
標題：<繁中標題>
base：<default>  ←  <當前分支>
assignee：<"@me" / 指定者 / 不指派>

內文：
<完整 markdown 內文>
```

**停下來等使用者回覆。** 確認（或調整）後才執行下一步。

### 6. 執行

```
git push -u origin <branch>        # 沒 upstream 才需 -u；已有就 git push
gh pr create --base <default> --title "<標題>" --body "<內文>" --assignee "<assignee>"
gh pr view --web                   # 開瀏覽器
```

- push 被拒（non-fast-forward，隊友先推過）→ **停**，說明分支上有他人更新，引導使用者 `git pull --rebase origin <branch>` 解完再重跑；**絕不 `--force`**。
- assignee **預設 `"@me"`**（發 PR 者即負責人；預設值與 `/new-issue` 相同）；使用者透過 `$ARGUMENTS` 指定其他人則改帶指定者，明說不指派則整個 `--assignee` 旗標拿掉（同 reviewer/label 的處理）。指定他人須為 repo collaborator，否則 `gh pr create` 會整個失敗——失敗時改不帶 assignee 先建 PR，成功後再 `gh pr edit <N> --add-assignee <人>` 補。
- `$ARGUMENTS` 只給裸名字（如 `alice`）無法判斷是 reviewer 還是 assignee → **停下來問**，不猜。
- 使用者透過 `$ARGUMENTS` 指定了 reviewer / label 才加 `--reviewer <人>` / `--label <標籤>`（預設不帶；label 須 repo 已存在）；提到 draft／草稿 → 加 `--draft`。
- 提到 copilot（要 Copilot review）→ Copilot reviewer 是 bot 帳號，`--reviewer` 對它解析常失敗，一律在 PR 建立後補 API call（`<N>` 取自 `gh pr create` 回傳 URL 結尾）：

  ```
  gh api --method POST repos/<owner>/<repo>/pulls/<N>/requested_reviewers -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
  ```

  前提：開 PR 者有 Copilot seat 且 org policy 啟用 code review；若 repo ruleset 已開「Automatically request Copilot code review」則自動指派，無需帶此參數。

### 7. 收尾

回報 PR URL。若為本模板衍生專案，另提醒一句：PR 會觸發 CI —— `pull_request.yml` 跑 build + eslint；若改到 `app/`、`server/` 還會跑 `sdd-review.yml` 的 AI 語意審查。非模板 repo（無這些 workflow）就不提。

## 注意

- base 一律取 repo 的 default branch（步驟 1 已查得；本模板為 `main`），不寫死。**GitHub 只在 PR merge 進 default branch 時才會自動關閉 `Closes` 的 issue**——base 不是 default branch 時 `Closes` 不生效。
- 絕不在 default branch 上發 PR 或代 commit —— 該停就停，列選項問使用者。
- `$ARGUMENTS` 有值 → 視為 reviewer / assignee / label / 內文補充提示，納入判斷。
- 不確定（標題怎麼下、要不要拆 PR）→ 照樣列草案問使用者，不擅自決定。
