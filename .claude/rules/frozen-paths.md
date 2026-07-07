---
paths:
  - "test/e2e/specs/**"
  - "spec/gherkin-feature/**"
  - "spec/e2e-flows/**"
---

# 主 spec 凍結（SSOT 政策）

**你正在修改的路徑屬於凍結區。停下來。**（唯讀讀取不受限，本規則管的是修改與刪除）

> 技術強制：`.claude/hooks/frozen-paths-guard.mjs`（PreToolUse hook）會擋下凍結區**既有檔**的 Edit/Write（含 subagent 內）；**新增全新檔**放行（授權產出流程不受影響）。本規則的 paths 觸發僅在主對話生效、subagent 內不注入（2026-07-06 實測），hook 才是實際防線。

| 凍結路徑 | 內容 | 誰能改 |
|----------|------|--------|
| `test/e2e/specs/` | 主 spec（測試合約，UI 的唯一真理） | 只有 `/test e2e spec` 流程在使用者確認下產出；vibe / UI 修改絕不可動 |
| `spec/gherkin-feature/` | `.feature` 業務規格（外部產出，含 `.dsl.feature` 變體與上游 codegen 匯出） | 外部置入（使用者手動或上游腳本產出），AI 不改 |
| `spec/e2e-flows/` | `.flow.md`（business invariant + E2E 流程） | 只有 `/feature-to-flow` 流程產出，下游不回頭改 |

如果任務看起來「不改凍結檔就做不到」：

1. 不要改。先停。
2. 把衝突具體說明給使用者：哪條 invariant／哪個 spec 擋住了什麼目標。
3. 列出選項讓使用者決定（例如：調整目標、走正規 spec 變更迭代流、或由使用者自行修改規格）。

> 唯一例外：使用者明確指示走「spec 變更迭代流」（見 `.claude/CLAUDE.md` SDD 段），此時由對應 skill 依流程更新，仍需使用者逐步確認。
