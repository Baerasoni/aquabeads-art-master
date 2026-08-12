import { describe, expect, it } from 'vitest'
import type { AdjustParams } from './adjust'
import { applyAdjust, isIdentityAdjust, resizeImage, resizeMask } from './adjust'
import type { ImageLike } from './quantize'

function px(image: ImageLike, x: number, y: number): number[] {
  const p = (y * image.width + x) * 4
  return [...image.data.slice(p, p + 4)]
}

function makeImage(w: number, h: number, fill: (x: number, y: number) => number[]): ImageLike {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y)
      const p = (y * w + x) * 4
      data[p] = r
      data[p + 1] = g
      data[p + 2] = b
      data[p + 3] = a
    }
  }
  return { width: w, height: h, data }
}

const ID: AdjustParams = { brightness: 100, contrast: 100, saturation: 100 }

describe('applyAdjust', () => {
  it('100/100/100 は恒等（コピーを返し元を変更しない）', () => {
    const img = makeImage(2, 2, (x, y) => [x * 100, y * 100, 50, 200])
    const out = applyAdjust(img, ID)
    expect(out.data).toEqual(img.data)
    expect(out.data).not.toBe(img.data)
    expect(isIdentityAdjust(ID)).toBe(true)
  })

  it('brightness: 画素値の線形スケール', () => {
    const img = makeImage(1, 1, () => [100, 200, 40, 255])
    expect(px(applyAdjust(img, { ...ID, brightness: 50 }), 0, 0)).toEqual([50, 100, 20, 255])
    // 200% で 255 にクランプ
    expect(px(applyAdjust(img, { ...ID, brightness: 200 }), 0, 0)).toEqual([200, 255, 80, 255])
  })

  it('brightness 0 で黒', () => {
    const img = makeImage(1, 1, () => [123, 45, 67, 255])
    expect(px(applyAdjust(img, { ...ID, brightness: 0 }), 0, 0)).toEqual([0, 0, 0, 255])
  })

  it('contrast: 127.5 中心のスケール（中間グレーは不変）', () => {
    const gray = makeImage(1, 1, () => [128, 128, 128, 255])
    // (128 - 127.5) * 1.6 + 127.5 = 128.3 → 128
    expect(px(applyAdjust(gray, { ...ID, contrast: 160 }), 0, 0)).toEqual([128, 128, 128, 255])
    const img = makeImage(1, 1, () => [200, 55, 127, 255])
    // (200-127.5)*1.5+127.5 = 236.25 → 236, (55-127.5)*1.5+127.5 = 18.75 → 19
    const out = px(applyAdjust(img, { ...ID, contrast: 150 }), 0, 0)
    expect(out[0]).toBe(236)
    expect(out[1]).toBe(19)
  })

  it('contrast 0 で全画素が 127.5（丸めて 127 か 128）', () => {
    const img = makeImage(1, 1, () => [0, 255, 80, 255])
    const out = px(applyAdjust(img, { ...ID, contrast: 0 }), 0, 0)
    for (const v of out.slice(0, 3)) expect(Math.abs(v - 127.5)).toBeLessThanOrEqual(0.5)
  })

  it('saturate 0 は輝度グレー（Filter Effects の係数 0.213/0.715/0.072）', () => {
    const img = makeImage(1, 1, () => [255, 0, 0, 255])
    const out = px(applyAdjust(img, { ...ID, saturation: 0 }), 0, 0)
    const luma = Math.round(0.213 * 255)
    expect(out[0]).toBe(luma)
    expect(out[1]).toBe(luma)
    expect(out[2]).toBe(luma)
  })

  it('saturate はグレーを変化させない', () => {
    const img = makeImage(1, 1, () => [90, 90, 90, 255])
    expect(px(applyAdjust(img, { ...ID, saturation: 160 }), 0, 0)).toEqual([90, 90, 90, 255])
  })

  it('alpha は常に不変', () => {
    const img = makeImage(2, 1, (x) => [200, 100, 50, x === 0 ? 0 : 77])
    const out = applyAdjust(img, { brightness: 130, contrast: 70, saturation: 150 })
    expect(px(out, 0, 0)[3]).toBe(0)
    expect(px(out, 1, 0)[3]).toBe(77)
  })

  it('適用順は brightness → contrast → saturate', () => {
    // brightness 200% (=v*2) の後 contrast 50%: (v*2-127.5)*0.5+127.5
    // 逆順 ((v-127.5)*0.5+127.5)*2 とは異なる値になることで順序を検証
    const img = makeImage(1, 1, () => [40, 40, 40, 255])
    const out = px(applyAdjust(img, { brightness: 200, contrast: 50, saturation: 100 }), 0, 0)
    const expected = Math.round((40 * 2 - 127.5) * 0.5 + 127.5) // 104
    expect(out[0]).toBe(expected)
  })
})

describe('resizeImage', () => {
  it('maxSize 以下ならコピーを返す', () => {
    const img = makeImage(4, 3, (x, y) => [x, y, 0, 255])
    const out = resizeImage(img, 10)
    expect(out.width).toBe(4)
    expect(out.height).toBe(3)
    expect(out.data).toEqual(img.data)
    expect(out.data).not.toBe(img.data)
  })

  it('長辺が maxSize になりアスペクト比を保つ', () => {
    const img = makeImage(8, 4, () => [10, 20, 30, 255])
    const out = resizeImage(img, 4)
    expect(out.width).toBe(4)
    expect(out.height).toBe(2)
    // 単色は縮小しても単色
    expect(px(out, 0, 0)).toEqual([10, 20, 30, 255])
    expect(px(out, 3, 1)).toEqual([10, 20, 30, 255])
  })
})

describe('resizeMask', () => {
  it('定数マップは不変', () => {
    const src = new Float32Array(16).fill(0.5)
    const out = resizeMask(src, 4, 4, 2, 2)
    expect([...out]).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it('値域を保つ（外挿しない）', () => {
    const src = new Float32Array([0, 1, 0, 1])
    const out = resizeMask(src, 2, 2, 4, 4)
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
