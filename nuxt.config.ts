// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
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
