# Nuxt UI Page Builder 規範

> 配色、深淺模式、Nuxt UI 類型、API 規範、Pinia store 規範 → 詳見 [rules.md](rules.md)
>
> 色彩主題設定（app.config.ts、main.css）→ 詳見 [phase-1-theme.md](phase-1-theme.md)

---

## DSL Feature 解析

### 從 Background 提取資料結構

```gherkin
Background:
  Given 系統中有以下使用者：
    | account | password | role   |
    | admin   | pass123  | 管理者 |
```

→ TypeScript 型別：

```typescript
interface User {
  account: string
  password: string
  role: '管理者' | '教練'
}
```

### 從 When 提取表單欄位

```gherkin
When 使用者以帳號 "coach1" 密碼 "pass123" 登入
```

→ 表單欄位：`account`, `password`

### 從 Rule 提取驗證規則

| DSL Rule | Zod 驗證 |
|----------|----------|
| `背號範圍為 0-99` | `z.number().min(0).max(99)` |
| `必填欄位` | `z.string().min(1, '請輸入...')` |
| `帳號或密碼錯誤` | API 層驗證，前端顯示錯誤 |

### 從 Then 提取錯誤訊息

```gherkin
Then 操作失敗
And 系統顯示 "帳號或密碼錯誤"
```

→ Toast error 或 Alert

---

## Command 類型對應

| DSL Command | UI 元件 | 必要元素 |
|-------------|---------|----------|
| `登入` | 表單 + UButton | 密碼眼睛 icon |
| `建立 XXX` | 表單 + Modal | |
| `編輯 XXX` | 表單（預填） | |
| `刪除 XXX` | 確認 Modal | |
| `查詢 XXX 列表` | UTable | **必須有搜尋框** |
| `排序 XXX` / `調整順序` | vuedraggable（拖曳） | drag handle icon |
| `篩選 XXX` | USelect / USelectMenu | 篩選條件選項 |
| `批次刪除` / `批次操作` | UTable checkbox + 批次按鈕 | 全選/取消全選 |
| `上傳 XXX` | UInput type="file" / 拖放區 | 檔案格式提示 |
| `切換狀態` / `啟用/停用` | UToggle / USwitch | 狀態標籤文字 |
| `匯出 XXX` | UButton（下載觸發） | loading 狀態 |

> **重要**：「查詢」關鍵字 → UI **必須**包含搜尋框

---

## 操作結果對應

| DSL Then | UI 處理 |
|----------|---------|
| `操作成功` | Toast success + 導向 |
| `操作失敗` | Toast error |
| `系統顯示 "..."` | 顯示錯誤訊息 |
| `系統回傳 ...` | 儲存到 state |

---

## 禁止事項（僅列本檔獨有，配色/testid 規則 → [rules.md](rules.md)）

| 禁止 | 正確做法 |
|------|----------|
| 自行定義網站名稱 | 從 `project.name` 讀取 |
| 寫死 Toast 時間 | 從 `toast.duration` 讀取 |
| 手動定義 `--ui-color-*` / `--ui-*` 變數 | Nuxt UI plugin 自動從 `--color-*` 橋接，禁止手動覆蓋 |
| UFormField 錯誤訊息樣式不確定 | 依 `/nuxt-ui` MCP 文檔的 UFormField 用法為準 |
| app.vue 缺少 UApp 或 NuxtLayout | Phase 3 建 Layout 後必須更新 app.vue |

## testid

> **Phase 5**：直接從 `.spec.ts` 的 `getByTestId()` 複製，不自行推導。
> **Phase 2**：使用 `elements.md` 或 [rules.md](rules.md) > testid 規範。
> 列表內的按鈕（如 `team-delete`）可重複，E2E 用 `first()`, `nth()`, `hasText` 定位。

---

## 表單範本

### 登入表單（含 Auth Store）

> 這是 **auth 專案唯一的 login 範本**（auth scaffold 的 UI 層由此處提供，見 feature-to-api `references/auth-scaffold.md` §3b）。
> 防迴圈：login 頁與其 layout **不得發 authed fetch**；只呼叫 `authStore.login`（內部端點 `handleUnauthorized:false`）。

```vue
<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'
// ⚠️ 必須明確 import store，不可依賴 auto-import
import { useAuthStore } from '~/stores/auth'
import { readApiError } from '~/utils/api-error'

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
    return // 防止重複提交
  isSubmitting.value = true
  try {
    await authStore.login(event.data) // login(body)，登入後內部補抓 /auth/me
    toast.add({ title: '登入成功', color: 'success' })
    await navigateTo(config.authHomePath || '/') // 導向設定的登入後首頁
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
```

### 一般表單

```vue
<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'

const schema = z.object({
  account: z.string().trim().min(1, '請輸入帳號'),
  password: z.string().min(1, '請輸入密碼'),
})

type Schema = z.output<typeof schema>

const state = reactive<Schema>({
  account: '',
  password: '',
})

const loading = ref(false)
const toast = useToast()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: event.data,
    })
    toast.add({ title: '登入成功', color: 'success' })
    await navigateTo('/')
  }
  catch (error: any) {
    const message = error?.data?.message || '操作失敗'
    toast.add({ title: '登入失敗', description: message, color: 'error' })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <UForm
    :schema="schema"
    :state="state"
    data-testid="login-form"
    class="space-y-4"
    @submit="onSubmit"
  >
    <!-- UFormField 用法依 /nuxt-ui MCP 文檔為準 -->
    <UFormField
      label="帳號"
      name="account"
    >
      <UInput
        v-model="state.account"
        data-testid="login-account"
        class="w-full"
      />
    </UFormField>
    <UFormField
      label="密碼"
      name="password"
    >
      <UInput
        v-model="state.password"
        data-testid="login-password"
        type="password"
        class="w-full"
      />
    </UFormField>
    <UButton
      type="submit"
      data-testid="login-submit"
      :loading="loading"
    >
      登入
    </UButton>
  </UForm>
</template>
```

---

## 密碼欄位範本

```vue
<script setup>
const showPassword = ref(false)
</script>

<template>
  <UFormField
    label="密碼"
    name="password"
    class="relative mb-8"
    :ui="{ error: 'absolute top-full left-0 mt-1' }"
  >
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
          :padded="false"
          @click="showPassword = !showPassword"
        />
      </template>
    </UInput>
  </UFormField>
</template>
```

---

## 技術注意事項

### Tailwind v4 !important

```
[X] 舊語法：[&_td]:!h-12
[O] 新語法：[&_td]:h-12!
```

### Icons 套件

```bash
npm i -D @iconify-json/heroicons @iconify-json/lucide
```
