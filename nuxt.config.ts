// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  runtimeConfig: {
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
