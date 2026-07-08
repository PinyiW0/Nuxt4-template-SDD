<script setup lang="ts">
import type { SpinResult } from '~/components/baseball-spin/core/types'
import { parseSpinResult } from '~/components/baseball-spin/core/types'

// baseball-spin 模組驗證頁：我方渲染與後端 result.gif 並排，
// 逐 sample 比對縫線初始樣貌（R_ref）、旋轉方向、一圈時間、框比例、軸指針角度。

const sampleIds = ['sample1', 'sample2', 'sample3']
const selected = ref('sample1')

// server: false — public/ 靜態檔在 dev SSR 的 nitro 內部 fetch 拿不到（404），只在 client 抓
const { data: spinData, error } = useFetch(
  () => `/samples/spin/${selected.value}/result.json`,
  { server: false, transform: json => parseSpinResult(json) },
)

const gifUrl = computed(() => `/samples/spin/${selected.value}/result.gif`)

// 本批 sample gif 由幀數反推 slow_factor = 60（83/69/86 幀 ÷ 30fps ≈ 真實一圈 × 60）
const speedOptions = [
  { label: '1/60x（對照 gif）', value: 1 / 60 },
  { label: '1/50x', value: 1 / 50 },
  { label: '1/45x', value: 1 / 45 },
  { label: '1/30x', value: 1 / 30 },
  { label: '1/8x（慢動作）', value: 0.125 },
  { label: '1x（真實轉速）', value: 1 },
]
const speed = ref(1 / 60)
const showArrow = ref(true)

const viewerRef = ref<{ play: () => void, pause: () => void } | null>(null)

const metrics = computed(() => {
  const d: SpinResult | undefined = spinData.value ?? undefined
  if (!d)
    return []
  return [
    { label: '轉速', value: `${Math.floor(d.rpm)} rpm` },
    { label: '轉軸（spin_tilt）', value: `${d.spinTilt.hhmm}（${d.spinTilt.degrees}°）` },
    { label: '方向（spin_dir）', value: `${d.spinDir.hhmm}（${d.spinDir.degrees}°）` },
    { label: 'omega/frame', value: d.animation.omegaRadPerFrame.toFixed(6) },
    { label: 'fps', value: String(d.animation.fps) },
  ]
})
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6 p-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">
        Baseball Spin 驗證
      </h1>
      <UTabs
        v-model="selected"
        :items="sampleIds.map(id => ({ label: id, value: id }))"
        :content="false"
      />
    </div>

    <UAlert
      v-if="error"
      color="error"
      title="sample 載入失敗"
      :description="String(error)"
    />

    <div class="grid grid-cols-2 gap-6">
      <div class="space-y-2">
        <h2 class="text-sm font-medium opacity-70">
          我方渲染（three.js）
        </h2>
        <div class="rounded-lg bg-neutral-900">
          <BaseballSpinViewer
            ref="viewerRef"
            :data="spinData ?? null"
            :speed="speed"
            :show-axis-arrow="showArrow"
          />
        </div>
      </div>
      <div class="space-y-2">
        <h2 class="text-sm font-medium opacity-70">
          後端參考（result.gif）
        </h2>
        <div class="rounded-lg bg-neutral-900">
          <img :src="gifUrl" alt="後端渲染參考動畫" class="aspect-square w-full object-contain">
        </div>
      </div>
    </div>

    <div class="flex items-center gap-4">
      <UButton size="sm" @click="viewerRef?.play()">
        播放
      </UButton>
      <UButton size="sm" variant="outline" @click="viewerRef?.pause()">
        暫停
      </UButton>
      <USelect v-model="speed" :items="speedOptions" size="sm" class="w-48" />
      <USwitch v-model="showArrow" label="轉軸指針" />
    </div>

    <dl class="grid grid-cols-5 gap-4 text-sm">
      <div v-for="m in metrics" :key="m.label">
        <dt class="opacity-60">
          {{ m.label }}
        </dt>
        <dd class="font-mono">
          {{ m.value }}
        </dd>
      </div>
    </dl>
  </div>
</template>
