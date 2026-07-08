import type { Quaternion } from 'three'
import type { Vec3 } from './types'

// 視角預設（未來三視角擴充點）。
// R_ref 是 body → camera，姿態管線輸出的是「相機座標系」的 quaternion；
// 換視角 = 對最終姿態再左乘一個視角旋轉（qFinal = qView · qCam），
// 或未來後端提供 extrinsics 時由 worldPreRotation 帶入。
// 本次只實作 'camera'（與後端渲染同視角），pitcher / catcher 待後端 views 資料接上再填。

export type SpinViewPreset = 'camera' | 'pitcher' | 'catcher'

export interface ViewConfig {
  cameraPosition: Vec3
  up: Vec3
  /** 正交相機半幅，對映後端 OrthographicCamera 的 xmag/ymag */
  orthoHalfExtent: number
  /** 視角前置旋轉（qFinal = worldPreRotation · qCam），camera 視角不需要 */
  worldPreRotation?: Quaternion
  /** 軸指針是該視角下的投影，由視角決定預設開關 */
  showAxisArrow: boolean
}

const VIEW_PRESETS: Partial<Record<SpinViewPreset, ViewConfig>> = {
  // 後端渲染慣例：正交相機在 +Z（距離 3）看向原點、up = +Y；gif 顯示軸時 xmag = 1.5
  camera: {
    cameraPosition: [0, 0, 3],
    up: [0, 1, 0],
    orthoHalfExtent: 1.5,
    showAxisArrow: true,
  },
}

export function resolveViewConfig(view: SpinViewPreset): ViewConfig {
  const config = VIEW_PRESETS[view]
  if (!config)
    throw new Error(`視角 "${view}" 尚未實作（目前僅支援 camera）`)
  return config
}
