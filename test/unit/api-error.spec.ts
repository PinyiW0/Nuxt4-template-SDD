import type { ApiErrorKind } from '~/utils/api-error'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import ApiErrorState from '~/components/ApiErrorState.vue'
import { ERROR_COPY, ERROR_TITLE, getErrorCode, getErrorKind, getErrorStatus, getFieldErrors, readApiError } from '~/utils/api-error'

// 沒收到回應：以 spy 讓底層 fetch 拋 TypeError（斷網的真實形狀），不開真實連線
const NO_RESPONSE_URL = 'http://offline.test/x'

function mockOffline() {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
}

afterEach(() => {
  vi.restoreAllMocks()
})

// 環境限制：vitest 的 registerEndpoint 走 h3 sendError，回應 body 沒有 message 欄位，
// 所以 fetchError()（走 registerEndpoint）只能驗狀態碼分類與固定文案，不可用來驗 message 取值。
// 驗取值鏈與文案守衛的測項一律用手造 body（fetchErrorLike()），形狀照真實環境的回應內容。
// 這不是風格偏好，是 vitest 環境的能力缺口；真實環境的行為由 /ship 的 L5 在 dev 與 production server 上實測把關。

// 讓假端點以指定狀態碼回錯，回傳 $fetch 拋出的真實 FetchError
async function fetchError(status: number, statusMessage = 'Raw Status Text'): Promise<unknown> {
  const url = `/api/err-${status}`
  registerEndpoint(url, () => {
    throw createError({ statusCode: status, statusMessage })
  })
  return $fetch(url).catch((e: unknown) => e)
}

// 以真實 FetchError 的形狀手造：回應 body 整包落在 err.data（statusMessage／message 都在 data 內）
// data 預設帶真實 body 的固定欄位（error／url／statusCode／statusMessage／message），呼叫端只覆寫要驗的差異
function fetchErrorLike(status: number, data: Record<string, unknown>) {
  const body = { error: true, url: '/api/x', statusCode: status, statusMessage: 'Server Error', message: '', ...data }
  return { name: 'FetchError', statusCode: status, response: { status }, data: body }
}

// 經過 useFetch 的錯誤：FetchError 會被包成 NuxtError
async function useFetchError(url: string): Promise<unknown> {
  let captured: unknown
  const Comp = defineComponent({
    async setup() {
      const { error } = await useFetch(url, { key: url })
      captured = error.value
      return () => h('div')
    },
  })
  await mountSuspended(Comp)
  return captured
}

describe('getErrorKind：依狀態碼分類', () => {
  it.each<[number, ApiErrorKind]>([
    [400, 'client'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'notFound'],
    [409, 'client'],
    [413, 'client'],
    [422, 'client'],
    [429, 'client'],
    [500, 'server'],
    [501, 'server'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [504, 'unavailable'],
  ])('$fetch 回 %i → %s', async (status, kind) => {
    // Arrange
    const err = await fetchError(status)
    // Act & Assert
    expect(getErrorKind(err)).toBe(kind)
    expect(getErrorStatus(err)).toBe(status)
  })

  it('$fetch 沒收到回應 → network，狀態碼為 null', async () => {
    mockOffline()
    const err = await $fetch(NO_RESPONSE_URL).catch((e: unknown) => e)
    expect(getErrorKind(err)).toBe('network')
    expect(getErrorStatus(err)).toBeNull()
  })

  it('useFetch 斷網（狀態碼被補成 500，與程式 bug 無法區分）→ 判為 server', async () => {
    mockOffline()
    const err = await useFetchError(NO_RESPONSE_URL)
    expect(getErrorKind(err)).toBe('server')
  })

  it('useFetch 的 transform 內程式 bug → 判為 server，不回「網路連線中斷」', async () => {
    registerEndpoint('/api/uf-transform', () => ({ ok: true }))
    let captured: unknown
    const Comp = defineComponent({
      async setup() {
        const { error } = await useFetch('/api/uf-transform', {
          key: 'uf-transform',
          transform: () => {
            throw new TypeError('transform bug')
          },
        })
        captured = error.value
        return () => h('div')
      },
    })
    await mountSuspended(Comp)
    expect(getErrorKind(captured)).toBe('server')
    expect(readApiError(captured, '操作失敗')).not.toBe(ERROR_COPY.network)
  })

  it('useFetch 收到 502 → unavailable', async () => {
    registerEndpoint('/api/uf-502', () => {
      throw createError({ statusCode: 502, statusMessage: 'Bad Gateway' })
    })
    const err = await useFetchError('/api/uf-502')
    expect(getErrorKind(err)).toBe('unavailable')
  })

  it('useFetch 收到 500 → server（不會被誤判為 network）', async () => {
    registerEndpoint('/api/uf-500', () => {
      throw new Error('boom')
    })
    const err = await useFetchError('/api/uf-500')
    expect(getErrorKind(err)).toBe('server')
  })

  it('不是 HTTP 錯誤 → unknown', () => {
    expect(getErrorKind(new Error('程式錯誤'))).toBe('unknown')
    expect(getErrorKind('字串')).toBe('unknown')
    expect(getErrorKind(undefined)).toBe('unknown')
  })
})

describe('readApiError：5xx 與沒收到回應用固定文案', () => {
  it.each([500, 502, 503, 504])('$fetch 回 %i → 固定文案，不回傳 HTTP 原文', async (status) => {
    const err = await fetchError(status, status === 500 ? 'Internal Server Error' : 'Bad Gateway')
    const message = readApiError(err, '操作失敗')
    expect(message).toBe(status === 500 ? ERROR_COPY.server : ERROR_COPY.unavailable)
    expect(message).not.toMatch(/Bad Gateway|Internal Server Error/)
  })

  it('沒收到回應 → 網路中斷文案，不回傳 ofetch 原文', async () => {
    mockOffline()
    const err = await $fetch(NO_RESPONSE_URL, { method: 'POST' }).catch((e: unknown) => e)
    const message = readApiError(err, '操作失敗')
    expect(message).toBe(ERROR_COPY.network)
    expect(message).not.toContain('<no response>')
  })

  it('5xx 帶 ErrorEnvelope.message 時仍用固定文案', () => {
    const err = { name: 'FetchError', statusCode: 500, response: { status: 500 }, data: { message: '資料庫連線失敗' } }
    expect(readApiError(err, '操作失敗')).toBe(ERROR_COPY.server)
  })
})

describe('readApiError：4xx 依序取 data.data.message → data.message → fallback', () => {
  it('有 ErrorEnvelope.message → 用後端訊息', () => {
    const err = { name: 'FetchError', statusCode: 409, response: { status: 409 }, data: { success: false, code: 'DUPLICATE', message: '名稱重複' } }
    expect(readApiError(err, '操作失敗')).toBe('名稱重複')
  })

  it('裸 schema 後端用 message 傳中文（statusMessage 為 Nitro 預設）→ 用後端訊息', () => {
    const err = fetchErrorLike(409, { statusCode: 409, statusMessage: 'Server Error', message: '帳號名稱已存在' })
    expect(readApiError(err, '操作失敗')).toBe('帳號名稱已存在')
  })

  it('沒有後端訊息 → 用呼叫端 fallback，不用頂層 statusMessage／message', () => {
    const err = { name: 'FetchError', statusCode: 401, statusMessage: 'Unauthorized', message: '[POST] "/api/login": 401 Unauthorized', response: { status: 401 } }
    expect(readApiError(err, '帳號或密碼錯誤')).toBe('帳號或密碼錯誤')
  })

  it('不是 HTTP 錯誤 → fallback', () => {
    expect(readApiError(new Error('程式錯誤'), '操作失敗')).toBe('操作失敗')
  })
})

describe('readApiError：不讀 statusMessage，以 message 為準（真實位置 data.*）', () => {
  it('404 帶 Nitro 英文 statusMessage → 回 notFound 固定文案', async () => {
    const err = await fetchError(404, 'Cannot find any path matching /api/xxx.')
    const message = readApiError(err, '操作失敗')
    expect(message).toBe(ERROR_COPY.notFound)
    expect(message).not.toMatch(/Cannot find any path/)
  })

  it('403 帶 Server Error → 回 forbidden 固定文案', () => {
    const err = fetchErrorLike(403, { statusCode: 403, statusMessage: 'Server Error', message: '' })
    const message = readApiError(err, '操作失敗')
    expect(message).toBe(ERROR_COPY.forbidden)
    expect(message).not.toContain('Server Error')
  })

  it('409 後端沒給文案（statusMessage=Server Error、message 空）→ 走 fallback，不回 Server Error', () => {
    const err = fetchErrorLike(409, { statusCode: 409, statusMessage: 'Server Error', message: '' })
    const message = readApiError(err, '操作失敗')
    expect(message).toBe('操作失敗')
    expect(message).not.toContain('Server Error')
  })

  it('409 只有 statusMessage、message 為空 → 不讀 statusMessage，走 fallback', () => {
    const err = fetchErrorLike(409, { statusCode: 409, statusMessage: '帳號名稱已存在', message: '' })
    expect(readApiError(err, '操作失敗')).toBe('操作失敗')
  })

  it('409 後端主動轉送英文 message → 照回 Conflict', () => {
    // 這是後端主動轉送英文，前端擋不住，由規範層（schema 定義處寫中文訊息）負責
    const err = fetchErrorLike(409, { statusCode: 409, statusMessage: 'Conflict', message: 'Conflict' })
    expect(readApiError(err, '操作失敗')).toBe('Conflict')
  })

  it('404 帶深層 envelope → 仍走 notFound 固定文案', () => {
    const err = fetchErrorLike(404, { statusCode: 404, statusMessage: 'Server Error', message: '', data: { message: '帳號不存在' } })
    expect(readApiError(err, '操作失敗')).toBe(ERROR_COPY.notFound)
  })

  it('409 帶深層 envelope → 讀得到 data.data.message', () => {
    const err = fetchErrorLike(409, { statusCode: 409, statusMessage: 'Server Error', message: '', data: { message: '帳號不存在' } })
    expect(readApiError(err, '操作失敗')).toBe('帳號不存在')
  })

  it('401 不用固定文案，仍走 fallback', () => {
    const err = { name: 'FetchError', statusCode: 401, response: { status: 401 } }
    expect(readApiError(err, '帳號或密碼錯誤')).toBe('帳號或密碼錯誤')
  })

  it('不傳 fallback → 回 ERROR_COPY[kind]', () => {
    const err = { name: 'FetchError', statusCode: 409, response: { status: 409 } }
    expect(readApiError(err)).toBe(ERROR_COPY.client)
    expect(readApiError(new Error('程式錯誤'))).toBe(ERROR_COPY.unknown)
  })
})

describe('readApiError：後端文案守衛（手造真實形狀）', () => {
  it('data.message 為 Server Error（H3 prod 行為）→ 回 fallback', () => {
    const err = fetchErrorLike(409, { statusCode: 409, statusMessage: 'Server Error', message: 'Server Error' })
    expect(readApiError(err, '操作失敗')).toBe('操作失敗')
  })

  it('data.message 為 ofetch 自組字串（dev 行為）→ 回 fallback，不洩漏上游主機', () => {
    const err = fetchErrorLike(409, { message: '[GET] "http://upstream:8080/orders": 409 Server Error' })
    const message = readApiError(err, '操作失敗')
    expect(message).toBe('操作失敗')
    expect(message).not.toContain('upstream:8080')
  })

  it('data.message 為物件 → 回 fallback，不洩漏內容、回傳是 string', () => {
    const err = fetchErrorLike(409, { message: { detail: 'internal table users_pk' } })
    const message = readApiError(err, '操作失敗')
    expect(typeof message).toBe('string')
    expect(message).toBe('操作失敗')
    expect(message).not.toContain('users_pk')
  })

  it.each([42, []])('data.message 為 %j（非字串）→ 回 fallback', (value) => {
    const err = fetchErrorLike(409, { message: value })
    expect(readApiError(err, '操作失敗')).toBe('操作失敗')
  })

  it('純 ASCII tag 開頭的後端文案（[INFO] "order" 已成立）→ 不被誤殺，照回', () => {
    const err = fetchErrorLike(409, { message: '[INFO] "order" 已成立' })
    expect(readApiError(err, '操作失敗')).toBe('[INFO] "order" 已成立')
  })

  it('ofetch 無回應格式（<no response>）→ 回 fallback', () => {
    const err = fetchErrorLike(409, { message: '[GET] "http://upstream:8080/x": <no response> fetch failed' })
    expect(readApiError(err, '操作失敗')).toBe('操作失敗')
  })

  it('空白字串 → 回 fallback', () => {
    expect(readApiError(fetchErrorLike(409, { message: '   ' }), '操作失敗')).toBe('操作失敗')
  })

  it('data 整個是 undefined（H3 prod 砍掉 data）→ 回 fallback', () => {
    const err = { name: 'FetchError', statusCode: 409, response: { status: 409 }, data: undefined }
    expect(readApiError(err, '操作失敗')).toBe('操作失敗')
  })

  it('深層 data.data.message 為 Server Error → 不放行，往下走 data.message', () => {
    const err = fetchErrorLike(409, { message: '名稱重複', data: { message: 'Server Error' } })
    expect(readApiError(err, '操作失敗')).toBe('名稱重複')
  })

  it('深層與淺層都是框架自產物 → 回 fallback', () => {
    const err = fetchErrorLike(409, { message: 'Server Error', data: { message: 'Server Error' } })
    expect(readApiError(err, '操作失敗')).toBe('操作失敗')
  })
})

describe('模式 A 深層 envelope（createError({ data: envelope })）', () => {
  const err = {
    name: 'FetchError',
    statusCode: 422,
    response: { status: 422 },
    data: {
      statusCode: 422,
      data: { success: false, code: 'VALIDATION_FAILED', message: '欄位有誤', errors: [{ field: 'name', message: '必填' }] },
    },
  }

  it('readApiError／getErrorCode／getFieldErrors 都讀得到深層 envelope', () => {
    expect(readApiError(err, '操作失敗')).toBe('欄位有誤')
    expect(getErrorCode(err)).toBe('VALIDATION_FAILED')
    expect(getFieldErrors(err)).toEqual([{ field: 'name', message: '必填' }])
  })

  it('淺層 envelope 仍可讀', () => {
    const shallow = { name: 'FetchError', statusCode: 409, response: { status: 409 }, data: { code: 'DUP', message: '重複', errors: [] } }
    expect(readApiError(shallow, '操作失敗')).toBe('重複')
    expect(getErrorCode(shallow)).toBe('DUP')
    expect(getFieldErrors(shallow)).toEqual([])
  })
})

describe('讀取錯誤狀態元件（ApiErrorState）', () => {
  it.each([500, 502])('%i → 顯示固定文案與「重新載入」，點擊發出 retry', async (status) => {
    // Arrange
    const error = await fetchError(status)
    const wrapper = await mountSuspended(ApiErrorState, { props: { error } })
    // Act
    const retry = wrapper.findAll('button').find(b => b.text().includes('重新載入'))
    await retry?.trigger('click')
    // Assert
    expect(wrapper.text()).toContain(status === 500 ? ERROR_COPY.server : ERROR_COPY.unavailable)
    expect(wrapper.find('h2').text()).toBe(ERROR_TITLE[status === 500 ? 'server' : 'unavailable'])
    expect(wrapper.find('[role="alert"]').text()).toBe(status === 500 ? ERROR_COPY.server : ERROR_COPY.unavailable)
    expect(wrapper.find('[role="alert"]').find('button').exists()).toBe(false)
    expect(retry).toBeDefined()
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('沒收到回應 → 顯示「重新載入」', async () => {
    mockOffline()
    const error = await $fetch(NO_RESPONSE_URL).catch((e: unknown) => e)
    const wrapper = await mountSuspended(ApiErrorState, { props: { error } })
    expect(wrapper.text()).toContain(ERROR_COPY.network)
    expect(wrapper.text()).toContain('重新載入')
  })

  it('錯誤整句在 description 不在 heading', async () => {
    const error = { name: 'FetchError', statusCode: 500, response: { status: 500 } }
    const wrapper = await mountSuspended(ApiErrorState, { props: { error } })
    expect(wrapper.find('h2').text()).not.toContain(ERROR_COPY.server)
  })

  it.each<[number, ApiErrorKind]>([[403, 'forbidden'], [404, 'notFound']])('%i → 不顯示「重新載入」', async (status, kind) => {
    const error = { name: 'FetchError', statusCode: status, response: { status } }
    const wrapper = await mountSuspended(ApiErrorState, { props: { error } })
    expect(wrapper.text()).toContain(ERROR_COPY[kind])
    expect(wrapper.text()).not.toContain('重新載入')
  })
})
