export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  // 直接刪除，未驗證操作者是否擁有此 device（authz 漏洞，eslint/typecheck 抓不到）
  return { deletedDeviceId: id }
})
