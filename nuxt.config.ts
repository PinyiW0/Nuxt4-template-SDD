// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  runtimeConfig: {
    // E2E 專用：允許 production build 下開啟 /api/__test__/reset（CI 的 e2e job 與 scripts/docker-gate.sh
    // 以 NUXT_E2E_RESET=true 注入）。mock 不上正式環境，部署環境不得設此變數；預設 false 時 reset 端點在
    // production 一律 404（守衛範本見 .claude/skills/test/e2e/references/setup.md Step 4）。
    e2eReset: false,
    public: {
      // 統一 API domain，可由 NUXT_PUBLIC_API_BASE 覆蓋
      apiBase: '/api',
      // 後端是否回 envelope（{ success, data, message, meta }）；預設 on，
      // useHttp 自動拆掉外層回傳裸 data。裸 schema 後端設 NUXT_PUBLIC_API_ENVELOPE=false 關閉。
      apiEnvelope: true,
    },
  },
  modules: ['@nuxt/ui', '@nuxt/eslint', '@pinia/nuxt', 'pinia-plugin-persistedstate/nuxt'],
  eslint: {
    config: {
      standalone: false,
    },
  },
  css: ['~/assets/css/main.css'],
  // Nuxt UI 配置
  ui: {
    theme: {
      colors: ['primary', 'secondary', 'info', 'success', 'warning', 'error', 'neutral'],
    },
  },
})
