import { z } from 'zod'

// 本模組為可攜核心（複製資料夾即用），型別自含、不依賴 ~/types/api/；
// 未來後端 API 接上時由宿主專案的 client 層呼叫 parseSpinResult 轉入。

export type Vec3 = [number, number, number]
export type Mat3 = [Vec3, Vec3, Vec3]

export interface ClockValue {
  hhmm: string
  degrees: number
}

export interface SpinAnimation {
  /** body → camera 起始姿態（row-major 3×3，僅 6 位小數，套用前需正交化） */
  rRef: Mat3
  /** 每一原始影格的旋轉弧度，帶號（符號 = 旋轉方向） */
  omegaRadPerFrame: number
  /** 原始擷取影格率，換算真實角速度用 */
  fps: number
}

export interface SpinResult {
  timestamp: string
  rpm: number
  /** 相機系自轉軸單位向量 */
  axis: Vec3
  animation: SpinAnimation
  spinDir: ClockValue
  spinTilt: ClockValue
}

const vec3Schema = z.tuple([z.number(), z.number(), z.number()])
const clockSchema = z.object({ hhmm: z.string(), degrees: z.number() })

// wire 格式（snake_case）→ 模組型別（camelCase）
const spinResultSchema = z.object({
  timestamp: z.string(),
  rpm: z.number(),
  axis: vec3Schema,
  animation: z.object({
    R_ref: z.tuple([vec3Schema, vec3Schema, vec3Schema]),
    omega_rad_per_frame: z.number(),
    fps: z.number().positive(),
  }),
  spin_dir: clockSchema,
  spin_tilt: clockSchema,
}).transform((raw): SpinResult => ({
  timestamp: raw.timestamp,
  rpm: raw.rpm,
  axis: raw.axis,
  animation: {
    rRef: raw.animation.R_ref,
    omegaRadPerFrame: raw.animation.omega_rad_per_frame,
    fps: raw.animation.fps,
  },
  spinDir: raw.spin_dir,
  spinTilt: raw.spin_tilt,
}))

// 解析後端 result.json；格式不符丟 ZodError
export function parseSpinResult(json: unknown): SpinResult {
  return spinResultSchema.parse(json)
}
