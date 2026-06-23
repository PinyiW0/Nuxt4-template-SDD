// @vitest-environment node
import openapiTS, { astToString } from 'openapi-typescript'
import { describe, expect, it } from 'vitest'

// codegen 工具鏈 / 合約煙霧測試：用 fixture OpenAPI 跑一次 openapi-typescript，確認
// (1) 工具鏈可用（gen:api 背後就是它）、(2) envelope 的具名 data schema 會產出可被 view 型別 alias 的具名型別、
// (3) 欄位維持 camelCase、(4) 端點以具名 schema 引用（改 schema 即牽動端點型別）。
// 完整「client URL/method + mock 符合 schema」的專案級合約測試範本：
//   見 .claude/skills/feature-to-api/references/openapi-codegen.md § 5。
describe('openapi-typescript codegen 合約', () => {
  const fixture = new URL('./fixtures/openapi-sample.yml', import.meta.url)

  it('具名 data schema → 產出可 alias 的具名型別（view 型別來源）', async () => {
    const out = astToString(await openapiTS(fixture))
    // view 型別靠 components['schemas']['Xxx'] alias，故每個具名 schema 都必須完整產出
    expect(out).toContain('AccountListItem')
    expect(out).toContain('AccountDetail')
    expect(out).toContain('CreateAccountRequest')
    expect(out).toContain('AccountCreatedEvent')
  })

  it('欄位維持 camelCase、端點以具名 schema 引用', async () => {
    const out = astToString(await openapiTS(fixture))
    expect(out).toContain('accountId')
    expect(out).toContain('isActive')
    expect(out).not.toMatch(/account_id/)
    // 端點透過 components 引用具名 schema（不 inline），改 schema 即牽動端點型別 → typelint 紅燈早期發現
    expect(out).toContain('components["schemas"]["AccountListItem"]')
    expect(out).toContain('components["schemas"]["AccountDetail"]')
  })
})
