---
paths:
  - "app/**/*.vue"
  - "app/stores/**"
  - "app/composables/**"
  - "app/middleware/**"
  - "app/plugins/**"
  - "nuxt.config.ts"
---

# 前端安全慣例

每條對應 OWASP 常青風險，管 client 端信任邊界——server 端慣例見 `server-security.md`。

## 禁止事項

| # | 禁止行為 | 正確做法 |
|---|----------|----------|
| 1 | `v-html` 渲染任何含使用者輸入的內容（XSS） | 一律 `{{ }}` 插值或結構化渲染；確需富文本先過 sanitizer，且 SSR 兩端都要過 |
| 2 | 動態 `href`／`src` 直接綁使用者提供的 URL | protocol 白名單（僅 http/https），`javascript:` 等一律擋下 |
| 3 | token／個資寫 `localStorage`／`sessionStorage` | auth token 走 auth-scaffold 的 cookie persist，不自行另存 |
| 4 | 機敏值放 `runtimeConfig.public` 或 `NUXT_PUBLIC_*`（會打包進 client bundle） | 機敏值放 private `runtimeConfig`（server-only）；public 只放可公開值 |
| 5 | 把入口隱藏（`v-if`）或 route middleware 當授權邊界 | 授權必在 server（requireRole／requireOwnership）；前端守門只是 UX |

## 一行示例（最常踩的兩條）

```vue
<!-- [X] 1：使用者留言直接進 v-html -->
<div v-html="comment.content" />
<!-- [O] 1：插值渲染，HTML 自動轉義 -->
<p>{{ comment.content }}</p>
```

```ts
// [X] 3：token 另存 localStorage
localStorage.setItem('token', token)
// [O] 3：交給 auth store 的 cookie persist（auth-scaffold §3a），不自行落地
```

## 消費地圖

角色與 JWT 的信任邊界（前端不解 JWT、roles 走 `/auth/me`）住 `.claude/skills/feature-to-api/references/rbac-scaffold.md`；
審查查法住 `.claude/skills/sdd-review/references/checks.md` §4。
本檔在 subagent 內不會自動注入——feature-to-ui 產元件／頁面前須明文指讀本檔。
