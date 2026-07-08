<script setup lang="ts">
import type { BaseballSpinScene } from './core/scene'
import type { SpinResult } from './core/types'
import type { SpinViewPreset } from './core/views'

// 3D 棒球旋轉檢視器（模組唯一對外元件）。
// 可攜性約束：內部只用相對 import、不用 NuxtUI；three 於 onMounted 內 dynamic import
// （SSR 安全、且不進 server bundle）。載入 UI 交給 #loading slot 由宿主決定。
const props = withDefaults(defineProps<{
  data: SpinResult | null
  modelUrl?: string
  /** 播放速度倍率，1 = 真實轉速；對照後端 gif 用 0.125（slow_factor 8） */
  speed?: number
  autoplay?: boolean
  showAxisArrow?: boolean
  view?: SpinViewPreset
}>(), {
  modelUrl: '/models/baseball_detail.glb',
  speed: 1,
  autoplay: true,
  showAxisArrow: true,
  view: 'camera',
})

const emit = defineEmits<{
  ready: []
  error: [err: Error]
  progress: [loaded: number, total: number]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const progressPercent = ref(0)

let scene: BaseballSpinScene | null = null
let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  if (!containerRef.value)
    return
  try {
    const { BaseballSpinScene } = await import('./core/scene')
    scene = new BaseballSpinScene(containerRef.value, { view: props.view, speed: props.speed })
    scene.setAxisArrowVisible(props.showAxisArrow)

    resizeObserver = new ResizeObserver(() => scene?.resize())
    resizeObserver.observe(containerRef.value)

    await scene.loadModel(props.modelUrl, (loaded, total) => {
      progressPercent.value = total > 0 ? Math.round(loaded / total * 100) : 0
      emit('progress', loaded, total)
    })
    loading.value = false

    if (props.data)
      scene.setData(props.data)
    if (props.autoplay && props.data)
      scene.play()
    emit('ready')
  }
  catch (err) {
    loading.value = false
    emit('error', err instanceof Error ? err : new Error(String(err)))
  }
})

watch(() => props.data, (data) => {
  if (!scene || !data)
    return
  scene.setData(data)
  if (props.autoplay)
    scene.play()
})

watch(() => props.speed, (speed) => {
  scene?.setSpeed(speed)
})

watch(() => props.showAxisArrow, (visible) => {
  scene?.setAxisArrowVisible(visible)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  scene?.dispose()
  scene = null
})

function play(): void {
  scene?.play()
}

function pause(): void {
  scene?.pause()
}

defineExpose({ play, pause })
</script>

<template>
  <div class="relative aspect-square" data-testid="baseball-spin-viewer">
    <div ref="containerRef" class="absolute inset-0" />
    <div v-if="loading" class="absolute inset-0 flex items-center justify-center">
      <slot name="loading" :percent="progressPercent">
        <span class="text-sm opacity-60">模型載入中… {{ progressPercent }}%</span>
      </slot>
    </div>
  </div>
</template>
