// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { judgeBackoff, maxAttemptsWithin } from '../../.claude/skills/realtime/scripts/backoff-401.mjs'

// backoff-401.mjs：401 重連節奏驗收腳本的純判定（issue #164）。
// 餵假間隔驗證：正確倍增要過、固定間隔要被抓到、慢網路在上限容差內要過。瀏覽器量測部分不在此測。
const LIMITS = { base: 500, max: 60_000 }

describe('backoff-401 judgeBackoff：固定間隔重試必須被抓到', () => {
  it.each([
    ['固定 500ms（第 2 個間隔低於下限 900）', [500, 500, 500, 500]],
    ['固定 1000ms（第 3 個間隔低於下限 1900）', [1000, 1000, 1000, 1000]],
    ['固定 2000ms（第 1 個間隔超過上限 1500）', [2000, 2000, 2000, 2000]],
  ])('%s → 有失敗訊息', (_label, gaps) => {
    // Arrange：固定間隔的假量測；Act：判定；Assert：至少一條失敗
    const failures = judgeBackoff(gaps, LIMITS)
    expect(failures.length).toBeGreaterThan(0)
  })

  it('第 3 個間隔縮短（4000 → 1000） → 指出該間隔短於預期', () => {
    const failures = judgeBackoff([500, 1000, 1000, 4000], LIMITS)
    expect(failures.some(f => f.includes('第 3 個間隔'))).toBe(true)
  })
})

describe('backoff-401 judgeBackoff：正確倍增要通過', () => {
  it('精準 BASE→×2 直到 MAX → 無失敗', () => {
    const gaps = [500, 1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]
    expect(judgeBackoff(gaps, LIMITS)).toEqual([])
  })

  it('倍增但每段多 800ms 預檢延遲（dev 慢） → 在上限容差內，無失敗', () => {
    const gaps = [1300, 1800, 2800, 4800, 8800]
    expect(judgeBackoff(gaps, LIMITS)).toEqual([])
  })

  it('到達上限後的間隔可長到 MAX × 1.25 → 無失敗', () => {
    const gaps = [500, 1000, 2000, 4000, 8000, 16000, 32000, 60000, 75000]
    expect(judgeBackoff(gaps, LIMITS)).toEqual([])
  })

  it('間隔不足 2 個 → 無法判定，回失敗', () => {
    expect(judgeBackoff([500], LIMITS)).toHaveLength(1)
  })
})

describe('backoff-401 maxAttemptsWithin：理論次數上限', () => {
  it('180s 觀察期、500→60000 → 首次 1 ＋ 7 段倍增（0.5…32s，累計 63.5s）＋ 1 段 60s（累計 123.5s，再一段就超過）＝ 9 次，＋1 次容錯 = 10', () => {
    expect(maxAttemptsWithin(180_000, LIMITS)).toBe(10)
  })
})
