import type { FetchError } from 'ofetch'

// 後端 ErrorEnvelope：{ success:false, code, message, errors? }
// 欄位層級驗證錯誤
export interface ErrorEnvelopeFieldError {
  field: string
  message: string
}
export interface ErrorEnvelope {
  success: false
  code: string
  message: string
  errors?: ErrorEnvelopeFieldError[]
}

// 統一從 $fetch / useFetch 拋出的錯誤抽取「使用者可讀訊息」。
// 對齊 ErrorEnvelope 的 message；同時容忍 createError 風格的 statusMessage（裸 schema 後端）。
export function readApiError(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object')
    return fallback
  const e = err as {
    data?: { message?: string, statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  return (
    e.data?.message
    || e.data?.statusMessage
    || e.statusMessage
    || e.message
    || fallback
  )
}

// CONSTANT_CASE 錯誤碼（ErrorEnvelope.code），供 UI 對特定錯誤分支處理
export function getErrorCode(err: unknown): string | null {
  const fetchErr = err as FetchError<ErrorEnvelope | undefined>
  return fetchErr?.data?.code ?? null
}

// 欄位層級驗證錯誤（ErrorEnvelope.errors），供表單顯示
export function getFieldErrors(err: unknown): ErrorEnvelopeFieldError[] {
  const fetchErr = err as FetchError<ErrorEnvelope | undefined>
  return fetchErr?.data?.errors ?? []
}
