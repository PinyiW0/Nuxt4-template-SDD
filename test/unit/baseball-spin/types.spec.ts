import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { parseSpinResult } from '~/components/baseball-spin/core/types'
import sample1 from '../fixtures/spin/sample1.json'
import sample2 from '../fixtures/spin/sample2.json'
import sample3 from '../fixtures/spin/sample3.json'

describe('parseSpinResult：後端 result.json 解析', () => {
  it('三份真實 sample 都能解析並轉成 camelCase', () => {
    for (const sample of [sample1, sample2, sample3]) {
      const result = parseSpinResult(sample)
      expect(result.axis).toHaveLength(3)
      expect(result.animation.rRef).toHaveLength(3)
      expect(result.animation.fps).toBeGreaterThan(0)
      expect(typeof result.spinTilt.degrees).toBe('number')
    }
  })

  it('缺欄位丟 ZodError', () => {
    const { axis: _axis, ...missingAxis } = sample1
    expect(() => parseSpinResult(missingAxis)).toThrow(ZodError)
  })

  it('r_ref 形狀不對（非 3×3）丟 ZodError', () => {
    const bad = structuredClone(sample1) as Record<string, unknown>
    ;(bad.animation as Record<string, unknown>).R_ref = [[1, 0, 0], [0, 1, 0]]
    expect(() => parseSpinResult(bad)).toThrow(ZodError)
  })
})
