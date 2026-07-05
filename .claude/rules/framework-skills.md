---
paths:
  - "app/**/*.vue"
  - "app/stores/**"
  - "app/composables/**"
---

# 框架知識 Skill 與裁決

已安裝 Anthony Fu 的 `vue` / `nuxt` / `pinia` skill（`.claude/skills/`），寫對應程式碼時會自動觸發，提供框架正確語法與踩坑提醒。與本專案慣例衝突時，**一律以下列裁決為準**：

- **Pinia store 採 `@pinia/nuxt` 預設 auto-import** — `app/stores/` 下的 store 直接使用、不需手動 import（與 `pinia` skill 一致）
- **本專案是 Nuxt 4** — `nuxt` skill 基於 3.x（整體相容），目錄結構與設定以 Nuxt 4 官方為準
  - data fetching 兩處需注意：`useFetch`/`useAsyncData` 的 `data` 是 `shallowRef`（深層 mutate 不觸發響應、預設值 `undefined`）；`immediate: false` 時初始 `status` 是 `'idle'` 非 `'pending'`

## 與官方同步的維護注意

- 升級框架 major/minor 時，重跑 `npx skills add antfu/skills --skill=vue --skill=nuxt --skill=pinia` 重抓快照
- 定期回查 antfu 是否已出 **Nuxt 4** 版 skill（目前上游仍為 3.x），有則直接替換以消除版本落差
- 已對齊：vue skill(3.5) ↔ vue 3.5.x、pinia skill(3.0.4) ↔ pinia 3.0.x；唯 nuxt 落後一個 major
