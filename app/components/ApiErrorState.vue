<script setup lang="ts">
import { ERROR_TITLE, getErrorKind, isRetryableKind, readApiError } from '~/utils/api-error'

// 讀取失敗的錯誤狀態：取代「尚無資料」空狀態與「找不到」，讓使用者知道是系統出問題
const props = defineProps<{ error: unknown }>()
const emit = defineEmits<{ retry: [] }>()

const kind = computed(() => getErrorKind(props.error))
const message = computed(() => readApiError(props.error))
const actions = computed(() =>
  isRetryableKind(kind.value)
    ? [{ label: '重新載入', icon: 'i-heroicons-arrow-path', color: 'neutral' as const, variant: 'outline' as const, onClick: handleRetry }]
    : [],
)

function handleRetry() {
  emit('retry')
}
</script>

<template>
  <!-- 短標當 title、整句放 description；role="alert" 只包訊息，不包可聚焦的重試按鈕 -->
  <UEmpty
    icon="i-heroicons-exclamation-triangle"
    :title="ERROR_TITLE[kind]"
    :actions="actions"
  >
    <template #description>
      <p role="alert">
        {{ message }}
      </p>
    </template>
  </UEmpty>
</template>
