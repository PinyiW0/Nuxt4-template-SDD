import type { Mat3, SpinAnimation, Vec3 } from './types'
import { Matrix4, Quaternion, Vector3 } from 'three'

// 姿態數學（只用 three 的數學類別，無 WebGL，可在 node/vitest 執行）。
// 慣例來源 bsa-module docs/result_json_format.md：
//   R(θ) = Rodrigues(axis·sign(omega)·θ) · R_ref（左乘，axis 為相機系向量）

// row-major 3×3 → three Quaternion。
// Matrix4.set 收 row-major 引數（內部儲存 column-major，不可直接塞 .elements）；
// normalize 同時吸收 R_ref 只存 6 位小數造成的非正交誤差。
export function rotationMatrixToQuaternion(rows: Mat3): Quaternion {
  const [r0, r1, r2] = rows
  const m = new Matrix4().set(
    r0[0],
    r0[1],
    r0[2],
    0,
    r1[0],
    r1[1],
    r1[2],
    0,
    r2[0],
    r2[1],
    r2[2],
    0,
    0,
    0,
    0,
    1,
  )
  return new Quaternion().setFromRotationMatrix(m).normalize()
}

// 自轉軸：normalize 並把 omega 符號折進軸向（負轉速 = 反向軸）
export function spinAxis(axis: Vec3, omega: number): Vector3 {
  const v = new Vector3(...axis).normalize()
  return omega < 0 ? v.negate() : v
}

const _qSpin = new Quaternion()

// 任一時刻姿態：q(θ) = qSpin(axis, θ) · qRef（qSpin 在前 = 矩陣左乘 = 繞相機系軸自轉）
export function attitudeAt(
  qRef: Quaternion,
  axisSigned: Vector3,
  theta: number,
  out: Quaternion = new Quaternion(),
): Quaternion {
  const qSpin = _qSpin.setFromAxisAngle(axisSigned, theta)
  return out.multiplyQuaternions(qSpin, qRef)
}

// 真實角速度（rad/s）＝每影格弧度 × 影格率
export function angularSpeedRadPerSec(anim: SpinAnimation): number {
  return Math.abs(anim.omegaRadPerFrame) * anim.fps
}

// 由 animation 反推 rpm，與 result.json 的 rpm 欄位互驗
export function rpmFromAnimation(anim: SpinAnimation): number {
  return angularSpeedRadPerSec(anim) * 60 / (2 * Math.PI)
}
