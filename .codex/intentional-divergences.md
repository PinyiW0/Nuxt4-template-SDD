# Intentional Divergences（sharpen）

Claude 版（`.claude/skills/sharpen/`）與 Codex 版（`.codex/skills/sharpen/`）的刻意差異。改 Claude 版時對照本清單同步 Codex 版。

| # | 差異 | Claude 版 | Codex 版 | 原因 |
|---|------|-----------|----------|------|
| 1 | 互動機制 | `<action>AskUserQuestion({...})</action>` 結構化提問 | 編號清單＋字母選項，STOP 等回覆 | Codex 無 AskUserQuestion 工具 |
| 2 | 檔案結構 | SKILL.md ＋ 2 個 phase 檔（協作型規範） | SKILL.md 壓平（Phase 直接寫入本體） | phase 檔的 `<action>` 語法無法移植，拆檔維護成本大於價值 |
| 3 | 執行建議 | `dispatch-fallback.md`：派 subagent（Explore／general-purpose）＋ model（haiku／sonnet／opus） | `execution-advice.md`：run directly／split tasks／codex exec／fresh-session review ＋ complexity note | Codex 無 Agent tool 與 subagent；不編造 Codex model 清單 |
| 4 | ops 引用 | `.claude/ops/model-dispatch.md` 存在時優先引用 | 一律不引用 `.claude/ops/` | 該檔判準綁 Claude Code 的 Agent tool 語意 |
| 5 | 語言 | SKILL.md 繁中 | SKILL.md 英文（frontmatter 僅 name + description） | 沿用既有 Codex 翻譯慣例 |
| 6 | references | blindspot-checklist／prompt-template 為原始版 | 直接 cp ＋ 檔頭英文說明（AskUserQuestion 讀作「一輪提問」；`.claude/` 路徑僅為出處註記） | 保留中文偵測詞——它們是使用者輸入語言的特徵 |

## 全域安裝

想在所有專案使用：

```bash
cp -r .codex/skills/sharpen ~/.codex/skills/     # Codex 版
cp -r .claude/skills/sharpen ~/.claude/skills/   # Claude 版同理
```

（或用 symlink；複製後兩邊改動需自行同步。）
