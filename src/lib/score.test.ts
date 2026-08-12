import { describe, expect, it } from 'vitest'
import { applyAdjust } from './adjust'
import { STANDARD_TRAY } from './grid'
import { AQUA_PALETTE, beadColorById } from './palette'
import type { ImageLike } from './quantize'
import { imageToPatternWithStats } from './quantize'
import { scorePattern } from './score'

function gradientImage(w: number, h: number): ImageLike {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      const v = Math.round((x / (w - 1)) * 255)
      data[p] = v
      data[p + 1] = Math.round((y / (h - 1)) * 200)
      data[p + 2] = 255 - v
      data[p + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

function grayGradient(w: number, h: number): ImageLike {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      const v = Math.round((x / (w - 1)) * 255)
      data[p] = v
      data[p + 1] = v
      data[p + 2] = v
      data[p + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

function score(image: ImageLike, palette = AQUA_PALETTE, options = {}) {
  const { pattern, stats } = imageToPatternWithStats(image, STANDARD_TRAY, palette, options)
  return scorePattern(pattern, stats, palette, STANDARD_TRAY)
}

describe('scorePattern', () => {
  it('決定的（同一入力で同一スコア）', () => {
    const img = gradientImage(220, 226)
    const a = score(img)
    const b = score(img)
    expect(b).toEqual(a)
  })

  it('スコアは 0-100 の範囲', () => {
    const s = score(gradientImage(220, 226))
    expect(s.total).toBeGreaterThanOrEqual(0)
    expect(s.total).toBeLessThanOrEqual(100)
    expect(Number.isFinite(s.meanDeltaE)).toBe(true)
    expect(Number.isFinite(s.p90DeltaE)).toBe(true)
  })

  it('コントラストを潰した画像はスコアが下がる（もやし化ガード）', () => {
    const img = gradientImage(220, 226)
    const crushed = applyAdjust(img, { brightness: 100, contrast: 15, saturation: 100 })
    const good = score(img)
    const bad = score(crushed)
    expect(bad.total).toBeLessThan(good.total)
    // ディテールか L レンジの少なくとも一方が明確に劣化している
    expect(bad.detail * bad.lRangeUsed).toBeLessThan(good.detail * good.lRangeUsed)
  })

  it('単色画像には使用色数ペナルティが付く', () => {
    const data = new Uint8ClampedArray(220 * 226 * 4)
    for (let p = 0; p < data.length; p += 4) {
      data[p] = 231
      data[p + 1] = 0
      data[p + 2] = 18
      data[p + 3] = 255
    }
    const s = score({ width: 220, height: 226, data })
    expect(s.colorsUsed).toBe(1)
    expect(s.penalties.some((p) => p.name === 'few-colors')).toBe(true)
  })

  it('白黒2色パレットのグレーグラデはディザ有の方が忠実（近傍平均評価）', () => {
    const bw = [beadColorById('m14')!, beadColorById('m16')!] // しろ・くろ
    const img = grayGradient(220, 226)
    const withDither = score(img, bw, { dither: true })
    const noDither = score(img, bw, { dither: false })
    expect(withDither.meanDeltaE).toBeLessThanOrEqual(noDither.meanDeltaE)
  })

  it('空きマスだらけの図案には mostly-empty ペナルティ', () => {
    // ほぼ全面透明の画像
    const data = new Uint8ClampedArray(220 * 226 * 4) // alpha=0 で初期化
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const p = (y * 220 + x) * 4
        data[p] = 231
        data[p + 3] = 255
      }
    }
    const s = score({ width: 220, height: 226, data })
    expect(s.emptyRatio).toBeGreaterThan(0.85)
    expect(s.penalties.some((p) => p.name === 'mostly-empty')).toBe(true)
  })
})
