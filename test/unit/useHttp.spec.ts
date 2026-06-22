import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { useHttp } from '~/composables/useHttp'

// runtime 煙霧測試：真的透過 useHttp 打假端點，驗證 baseURL 套上、path 替換、AsyncData / Promise 行為
describe('useHttp 共用 domain（runtime 煙霧測試）', () => {
  it('getOnce：baseURL（apiBase /api）有套上、$fetch 取得資料', async () => {
    registerEndpoint('/api/ping', () => ({ ok: true }))
    const res = await useHttp().getOnce<{ ok: boolean }>('/ping')
    expect(res.ok).toBe(true)
  })

  it('getOnce：path params 在 runtime 被替換', async () => {
    registerEndpoint('/api/users/42', () => ({ id: '42' }))
    const res = await useHttp().getOnce<{ id: string }>('/users/{id}', { pathParams: { id: 42 } })
    expect(res.id).toBe('42')
  })

  it('post：寫入走 $fetch（method POST）', async () => {
    registerEndpoint('/api/users', { method: 'POST', handler: () => ({ created: true }) })
    const res = await useHttp().post<{ created: boolean }>('/users', { body: { name: 'x' } })
    expect(res.created).toBe(true)
  })

  it('get：reactive 讀取（useFetch）回 AsyncData 且資料正確', async () => {
    registerEndpoint('/api/teams', () => [{ id: 't1' }])
    const Comp = defineComponent({
      async setup() {
        const { data } = await useHttp().get<{ id: string }[]>('/teams')
        return () => h('div', JSON.stringify(data.value))
      },
    })
    const wrapper = await mountSuspended(Comp)
    expect(wrapper.text()).toContain('t1')
  })

  it('get：getter url（reactive 形式）可解析', async () => {
    registerEndpoint('/api/teams/t9', () => ({ id: 't9' }))
    const Comp = defineComponent({
      async setup() {
        const id = ref('t9')
        const { data } = await useHttp().get<{ id: string }>(() => `/teams/${id.value}`)
        return () => h('div', JSON.stringify(data.value))
      },
    })
    const wrapper = await mountSuspended(Comp)
    expect(wrapper.text()).toContain('t9')
  })
})

// envelope 模式（apiEnvelope 預設 on）：useHttp 自動拆掉 { success, data } 外層
describe('useHttp envelope 拆封', () => {
  it('getOnce：success envelope 自動拆出裸 data', async () => {
    registerEndpoint('/api/account', () => ({ success: true, message: 'ok', data: { accountId: 'a1' } }))
    const res = await useHttp().getOnce<{ accountId: string }>('/account')
    expect(res).toEqual({ accountId: 'a1' })
  })

  it('getOnce：分頁 envelope（data.items）攤平成陣列', async () => {
    registerEndpoint('/api/accounts', () => ({
      success: true,
      data: { items: [{ accountId: 'a1' }, { accountId: 'a2' }] },
      meta: { pagination: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 } },
    }))
    const res = await useHttp().getOnce<{ accountId: string }[]>('/accounts')
    expect(res).toEqual([{ accountId: 'a1' }, { accountId: 'a2' }])
  })

  it('非 envelope 回應直通（裸物件不被動到）', async () => {
    registerEndpoint('/api/bare', () => ({ accountId: 'b1' }))
    const res = await useHttp().getOnce<{ accountId: string }>('/bare')
    expect(res).toEqual({ accountId: 'b1' })
  })

  it('get：reactive 讀取也會拆 envelope', async () => {
    registerEndpoint('/api/me', () => ({ success: true, data: { name: '小明' } }))
    const Comp = defineComponent({
      async setup() {
        const { data } = await useHttp().get<{ name: string }>('/me')
        return () => h('div', JSON.stringify(data.value))
      },
    })
    const wrapper = await mountSuspended(Comp)
    expect(wrapper.text()).toContain('小明')
    expect(wrapper.text()).not.toContain('success')
  })
})
