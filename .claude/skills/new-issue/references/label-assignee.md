# label 與 assignee 選擇政策（`/new-issue` 與 `/pr` 共用）

> 單一來源：兩隻 skill 的 label／assignee 行為都以本檔為準，SKILL.md 只留一行摘要＋連結。改政策只改這裡。

## label（由使用者選，無預設）

先查 repo 現有 label：

```
gh label list --json name -q '.[].name'
```

用 AskUserQuestion 列出讓使用者挑選（可複選，附「略過」選項）——**不自動對應、不預選**：

- 使用者已在 `$ARGUMENTS` 指定 label → 直接用，不再問（仍須 repo 已存在）。
- 使用者選「略過」／明說「不用 label」→ 不帶 `--label`。
- 多個 label 就重複 `--label` 旗標。

**自填清單外 label 的處理（兩 skill 唯一差異點）**：

| skill | 行為 |
|-------|------|
| `/new-issue` | 用 AskUserQuestion 問（單選）：**建立它**（`gh label create <X>`，可加 `--description`、`--color`）後帶上，或**本次略過**該 label |
| `/pr` | **不自創、不 `gh label create`**——提示該 label repo 沒有，請改選現有的或先自行建立 |

## assignee（可選，預設自己）

預設 `@me`（發起者即負責人，讓隊友一眼看出誰在做）。

- repo 有其他 collaborator（`gh api repos/<owner>/<repo>/collaborators --jq '.[].login'`）→ 用 AskUserQuestion 列出讓使用者選（預設選項 `@me`，含「不指派」；清單排除自己與 bot 帳號，自己已由 `@me` 代表）。
- **單人 repo 不問，直接 `@me`**。
- 使用者已在 `$ARGUMENTS` 指定就直接用，不再問。
- 「不指派」→ 整個 `--assignee` 旗標拿掉。
- 指定他人須為 repo collaborator，否則 `gh issue create`／`gh pr create` 會整個失敗——失敗時改不帶 assignee 先建立，成功後再 `gh issue edit`／`gh pr edit <N> --add-assignee <人>` 補。
