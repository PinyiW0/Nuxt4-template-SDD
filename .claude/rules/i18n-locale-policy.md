---
paths:
  - "i18n/**"
  - ".husky/pre-push"
---

# i18n 語系與 E2E gate 政策

> 來源：#107（下游專案全站日文化實測回灌：改非預設語系檔仍空等完整 gate 約 3 分鐘）。

## 測試語言：以 defaultLocale zh-TW 為準

- E2E spec 的文字斷言一律以 defaultLocale（zh-TW）的文案為準。
- zh-TW 翻譯檔（或未拆 i18n 前的硬編碼中文）是 spec 斷言來源，**視為程式碼**：改動必跑 gate，走一般程式碼驗證流程。

## pre-push gate 白名單

| 檔案 | gate | 原因 |
|------|------|------|
| `i18n/locales/zh-TW.json`（defaultLocale） | 必跑 | E2E 斷言的文案來源，改它可能改掉斷言目標 |
| `i18n/locales/` 其他語系（ja.json、en.json…） | 跳過 | E2E 全數跑在 defaultLocale，非預設語系不影響測試結果 |

實作在 `.husky/pre-push`：採**「整目錄放行、唯獨排除 defaultLocale」**方案——`SKIP_PATTERN` 放行整個 `i18n/locales/`，`FORCE_TEST_PATTERN` 把 defaultLocale 檔拉回強制跑（POSIX ERE 無 lookahead，負向排除用第二段 grep 實作）。逐檔白名單（下游最初做法）也可行，但每新增一個語系都要回來改 pattern，故不採用。

## 維護規則

- **新增語系檔**（如 `ko.json`）：不用動白名單，整目錄放行已涵蓋。
- **defaultLocale 換了**（不再是 zh-TW）：同步改 `.husky/pre-push` 的 `FORCE_TEST_PATTERN` 檔名，並確認 E2E 斷言文案來源跟著換。
- **未來新增「語言切換」E2E 測試情境**：非預設語系檔屆時也會影響測試 → `SKIP_PATTERN` 中 `^i18n/locales/` 這條放行**必須整個拿掉**（`FORCE_TEST_PATTERN` 一併移除）。
- **保守原則**：白名單只收「確定不影響測試」的路徑；判斷不了是否影響測試 → 不加白名單，照跑全套。
