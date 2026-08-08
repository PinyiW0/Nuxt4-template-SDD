# Codex Workflow Quick Reference

這份文件把 Claude slash command 對應到 Codex 自然語言觸發方式。Codex 不需要斜線指令；直接用表中的「Codex 說法」要求即可。

| Claude 指令 | Codex 說法 | 主要輸入 | 主要輸出 |
|-------------|-----------|----------|----------|
| `/sharpen <概念>` | `用 sharpen 幫我把這個需求磨精準：<概念>` | 粗略概念（文字或檔案路徑，可留空） | 六段精準 prompt ＋ 執行建議（可直接執行或輸出複製） |

## 常用限制語

- `只產出 prompt，不執行`
- `不用問我，全部用假設帶過`（跳過釐清、快速產出）
