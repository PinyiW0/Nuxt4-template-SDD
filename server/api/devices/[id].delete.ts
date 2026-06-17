// ⚠️ 測試用端點：故意埋入授權缺失與敏感資料外洩，驗證 sdd-review 雲端模式能否抓到。
// 驗證完即刪。
export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const adminToken = process.env.ADMIN_TOKEN

  // 直接刪除，未驗證操作者是否擁有此 device
  return {
    deletedDeviceId: id,
    adminToken, // 回傳帶出內部 token
  }
})
