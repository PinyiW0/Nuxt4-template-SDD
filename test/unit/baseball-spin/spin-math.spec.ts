import { Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  angularSpeedRadPerSec,
  attitudeAt,
  rotationMatrixToQuaternion,
  rpmFromAnimation,
  spinAxis,
} from '~/components/baseball-spin/core/spin-math'
import { parseSpinResult } from '~/components/baseball-spin/core/types'
import sample1 from '../fixtures/spin/sample1.json'
import sample2 from '../fixtures/spin/sample2.json'
import sample3 from '../fixtures/spin/sample3.json'

const samples = [sample1, sample2, sample3].map(s => parseSpinResult(s))

describe('rpmFromAnimation：與 result.json 自帶 rpm 交叉驗證', () => {
  it('omega × fps 換算的 rpm 與後端 rpm 欄位一致（三個 sample）', () => {
    for (const s of samples) {
      const rpm = rpmFromAnimation(s.animation)
      expect(Math.abs(rpm - s.rpm) / s.rpm).toBeLessThan(1e-3)
    }
  })

  it('角速度恆正（符號已折進軸向）', () => {
    for (const s of samples)
      expect(angularSpeedRadPerSec(s.animation)).toBeGreaterThan(0)
  })
})

describe('rotationMatrixToQuaternion：R_ref 正交化', () => {
  it('回傳單位 quaternion，轉回矩陣與原 R_ref 各元素誤差 < 1e-4', () => {
    for (const s of samples) {
      const q = rotationMatrixToQuaternion(s.animation.rRef)
      expect(Math.abs(q.length() - 1)).toBeLessThan(1e-6)

      const m = new Matrix4().makeRotationFromQuaternion(q)
      const e = m.elements // column-major
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++)
          expect(Math.abs(e[col * 4 + row]! - s.animation.rRef[row]![col]!)).toBeLessThan(1e-4)
      }
    }
  })
})

describe('attitudeAt：R(θ) = Rodrigues(axis·sign·θ) · R_ref', () => {
  it('θ=0 姿態即 R_ref', () => {
    for (const s of samples) {
      const qRef = rotationMatrixToQuaternion(s.animation.rRef)
      const q = attitudeAt(qRef, spinAxis(s.axis, s.animation.omegaRadPerFrame), 0)
      expect(Math.abs(q.dot(qRef))).toBeCloseTo(1, 6)
    }
  })

  it('θ=2π 回到 R_ref（quaternion 雙覆蓋用 |dot|≈1 判斷）', () => {
    for (const s of samples) {
      const qRef = rotationMatrixToQuaternion(s.animation.rRef)
      const q = attitudeAt(qRef, spinAxis(s.axis, s.animation.omegaRadPerFrame), 2 * Math.PI)
      expect(Math.abs(q.dot(qRef))).toBeCloseTo(1, 6)
    }
  })

  it('轉軸不變量：自轉全程中，body 系的轉軸向量在相機系恆指向 axis（左乘正確性）', () => {
    for (const s of samples) {
      const qRef = rotationMatrixToQuaternion(s.animation.rRef)
      const axisSigned = spinAxis(s.axis, s.animation.omegaRadPerFrame)
      // 轉軸在 body 系的表示：b = qRef⁻¹ · axis
      const b = axisSigned.clone().applyQuaternion(qRef.clone().invert())
      for (const theta of [0.3, 1.1, 2.5, 4.8]) {
        const q = attitudeAt(qRef, axisSigned, theta)
        const v = b.clone().applyQuaternion(q)
        expect(v.distanceTo(axisSigned)).toBeLessThan(1e-6)
      }
    }
  })

  it('omega 正負互為逆旋轉', () => {
    const s = samples[0]!
    const qRef = rotationMatrixToQuaternion(s.animation.rRef)
    const theta = 0.7
    const qPos = attitudeAt(qRef, spinAxis(s.axis, 1), theta)
    const qNeg = attitudeAt(qRef, spinAxis(s.axis, -1), theta)
    // 兩姿態對 qRef 的相對旋轉互逆：qPos · qRef⁻¹ = (qNeg · qRef⁻¹)⁻¹
    const relPos = qPos.clone().multiply(qRef.clone().invert())
    const relNegInv = qNeg.clone().multiply(qRef.clone().invert()).invert()
    expect(Math.abs(relPos.dot(relNegInv))).toBeCloseTo(1, 6)
  })
})

describe('spinAxis：軸向處理', () => {
  it('回傳單位向量', () => {
    const v = spinAxis([3, 4, 0], 1)
    expect(Math.abs(v.length() - 1)).toBeLessThan(1e-9)
  })

  it('omega 為負時軸反向', () => {
    const pos = spinAxis([0, 1, 0], 0.5)
    const neg = spinAxis([0, 1, 0], -0.5)
    expect(neg.dot(pos)).toBeCloseTo(-1, 9)
  })

  it('與 three 的 Rodrigues（setFromAxisAngle）語意一致：繞 +Z 轉 90° 把 +X 帶到 +Y', () => {
    const q = new Quaternion().setFromAxisAngle(spinAxis([0, 0, 1], 1), Math.PI / 2)
    const v = new Vector3(1, 0, 0).applyQuaternion(q)
    expect(v.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-9)
  })
})
