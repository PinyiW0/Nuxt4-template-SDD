export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const adminToken = process.env.ADMIN_TOKEN
  // 直接刪除，未驗證操作者是否擁有此 device（故意留 authz 漏洞，測 sdd-review）
  return { deletedDeviceId: id, adminToken }
})
