import { describe, expect, it } from 'vitest'
import type { DeltaEMethod, Lab } from './colorspace'
import { deltaE, deltaE76, deltaE2000, srgbToLab } from './colorspace'

describe('srgbToLab', () => {
  it('白は L≈100, a≈0, b≈0', () => {
    const lab = srgbToLab([255, 255, 255])
    expect(lab.L).toBeCloseTo(100, 1)
    expect(lab.a).toBeCloseTo(0, 1)
    expect(lab.b).toBeCloseTo(0, 1)
  })

  it('黒は L=0', () => {
    expect(srgbToLab([0, 0, 0]).L).toBeCloseTo(0, 5)
  })

  it('中間グレー (118,118,118) は L≈50', () => {
    expect(srgbToLab([118, 118, 118]).L).toBeCloseTo(50, 0)
  })
})

describe.each<DeltaEMethod>(['cie76', 'ciede2000'])('deltaE (%s)', (method) => {
  it('同じ色の距離は0', () => {
    const lab = srgbToLab([120, 80, 200])
    expect(deltaE(lab, lab, method)).toBeCloseTo(0, 5)
  })

  it('対称: d(a,b) = d(b,a)', () => {
    const a = srgbToLab([231, 0, 18])
    const b = srgbToLab([0, 122, 196])
    expect(deltaE(a, b, method)).toBeCloseTo(deltaE(b, a, method), 5)
  })

  it('知覚順序: 赤にとってオレンジは青より近い', () => {
    const red = srgbToLab([231, 0, 18])
    const orange = srgbToLab([244, 152, 0])
    const blue = srgbToLab([0, 122, 196])
    expect(deltaE(red, orange, method)).toBeLessThan(deltaE(red, blue, method))
  })
})

describe('deltaE76', () => {
  it('定義どおりのユークリッド距離', () => {
    const a: Lab = { L: 50, a: 0, b: 0 }
    const b: Lab = { L: 50, a: 3, b: 4 }
    expect(deltaE76(a, b)).toBeCloseTo(5, 10)
  })
})

describe('deltaE2000: Sharma et al. (2005) 公式テストベクタ', () => {
  const cases: Array<[Lab, Lab, number]> = [
    // [色1, 色2, 期待ΔE00]
    [{ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }, 2.0425],
    [{ L: 50, a: 3.1571, b: -77.2803 }, { L: 50, a: 0, b: -82.7485 }, 2.8615],
    [{ L: 50, a: 2.8361, b: -74.02 }, { L: 50, a: 0, b: -82.7485 }, 3.4412],
    [{ L: 50, a: -1.3802, b: -84.2814 }, { L: 50, a: 0, b: -82.7485 }, 1.0],
    [{ L: 50, a: -1.1848, b: -84.8006 }, { L: 50, a: 0, b: -82.7485 }, 1.0],
    [{ L: 50, a: -0.9009, b: -85.5211 }, { L: 50, a: 0, b: -82.7485 }, 1.0],
    [{ L: 50, a: 0, b: 0 }, { L: 50, a: -1, b: 2 }, 2.3669],
    [{ L: 50, a: -1, b: 2 }, { L: 50, a: 0, b: 0 }, 2.3669],
    // ペア9-15: a軸近傍で色相角がラップする境界ケース（hbar の ±360 分岐を守る）
    [{ L: 50, a: 2.49, b: -0.001 }, { L: 50, a: -2.49, b: 0.0009 }, 7.1792],
    [{ L: 50, a: 2.49, b: -0.001 }, { L: 50, a: -2.49, b: 0.001 }, 7.1792],
    [{ L: 50, a: 2.49, b: -0.001 }, { L: 50, a: -2.49, b: 0.0011 }, 7.2195],
    [{ L: 50, a: 2.49, b: -0.001 }, { L: 50, a: -2.49, b: 0.0012 }, 7.2195],
    [{ L: 50, a: -0.001, b: 2.49 }, { L: 50, a: 0.0009, b: -2.49 }, 4.8045],
    [{ L: 50, a: -0.001, b: 2.49 }, { L: 50, a: 0.001, b: -2.49 }, 4.8045],
    [{ L: 50, a: -0.001, b: 2.49 }, { L: 50, a: 0.0011, b: -2.49 }, 4.7461],
    [{ L: 50, a: 2.5, b: 0 }, { L: 50, a: 0, b: -2.5 }, 4.3065],
    [{ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 }, 27.1492],
    [{ L: 50, a: 2.5, b: 0 }, { L: 61, a: -5, b: 29 }, 22.8977],
    [{ L: 50, a: 2.5, b: 0 }, { L: 56, a: -27, b: -3 }, 31.903],
    [{ L: 50, a: 2.5, b: 0 }, { L: 58, a: 24, b: 15 }, 19.4535],
    [{ L: 50, a: 2.5, b: 0 }, { L: 50, a: 3.1736, b: 0.5854 }, 1.0],
    [{ L: 50, a: 2.5, b: 0 }, { L: 50, a: 3.2972, b: 0 }, 1.0],
    [{ L: 50, a: 2.5, b: 0 }, { L: 50, a: 1.8634, b: 0.5757 }, 1.0],
    [{ L: 50, a: 2.5, b: 0 }, { L: 50, a: 3.2592, b: 0.335 }, 1.0],
  ]

  it.each(cases.map((c, i) => [i + 1, ...c] as const))(
    'ベクタ%i: ΔE00 = %s',
    (_i, c1, c2, expected) => {
      expect(deltaE2000(c1, c2)).toBeCloseTo(expected, 4)
    },
  )
})
