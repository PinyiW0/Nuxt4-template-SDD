export default defineAppConfig({
  ui: {
    // 對齊 spec/ui-config/ui-config.yaml 的「空值預設對應」；專案自訂色由 /feature-to-ui Phase 1 依 ui-config 覆寫
    colors: {
      primary: 'green',
      secondary: 'sky',
      info: 'blue',
      success: 'green',
      warning: 'amber',
      error: 'red',
      neutral: 'neutral',
    },
  },
})
