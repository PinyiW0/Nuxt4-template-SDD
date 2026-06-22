<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'
// ⚠️ 必須明確 import store，不可依賴 auto-import
import { useAuthStore } from '~/stores/auth'
import { readApiError } from '~/utils/api-error'

// 防迴圈：login 頁與其 layout 不得發 authed fetch（只呼叫 authStore.login，內部 handleUnauthorized:false）
const authStore = useAuthStore()
const config = useRuntimeConfig().public
const toast = useToast()

const schema = z.object({
  account: z.string().trim().min(1, '請輸入帳號'),
  password: z.string().min(1, '請輸入密碼'),
})
type Schema = z.output<typeof schema>

const state = reactive<Schema>({ account: '', password: '' })
const isSubmitting = ref(false)
const showPassword = ref(false)

async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (isSubmitting.value)
    return
  isSubmitting.value = true
  try {
    await authStore.login(event.data)
    toast.add({ title: '登入成功', color: 'success' })
    await navigateTo(config.authHomePath || '/')
  }
  catch (error) {
    toast.add({ title: '登入失敗', description: readApiError(error, '帳號或密碼錯誤'), color: 'error' })
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <UForm
    :schema="schema"
    :state="state"
    data-testid="login-form"
    class="mx-auto w-full max-w-sm space-y-4"
    @submit="onSubmit"
  >
    <UFormField label="帳號" name="account">
      <UInput v-model="state.account" data-testid="login-account" class="w-full" />
    </UFormField>
    <UFormField label="密碼" name="password">
      <UInput
        v-model="state.password"
        data-testid="login-password"
        :type="showPassword ? 'text' : 'password'"
        class="w-full"
      >
        <template #trailing>
          <UButton
            :icon="showPassword ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
            color="neutral"
            variant="link"
            size="sm"
            @click="showPassword = !showPassword"
          />
        </template>
      </UInput>
    </UFormField>
    <UButton type="submit" data-testid="login-submit" :loading="isSubmitting" block>
      登入
    </UButton>
  </UForm>
</template>
