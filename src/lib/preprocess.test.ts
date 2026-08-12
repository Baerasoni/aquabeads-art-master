import { describe, expect, it } from 'vitest'
import type { ImageLike } from './quantize'
import {
  cropToSubject,
  kuwahara,
  posterizeKMeans,
  removeBackgroundSimple,
  sobelMagnitude,
} from './preprocess'

function makeImage(w: number, h: number, rgba: [number, number, number, number]): ImageLike {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0]
    data[i + 1] = rgba[1]
    data[i + 2] = rgba[2]
    data[i + 3] = rgba[3]
  }
  return { width: w, height: h, data }
}

function setRect(
  img: ImageLike,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgba: [number, number, number, number],
) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4
      img.data[i] = rgba[0]
      img.data[i + 1] = rgba[1]
      img.data[i + 2] = rgba[2]
      img.data[i + 3] = rgba[3]
    }
  }
}

function distinctOpaqueColors(img: ImageLike): number {
  const set = new Set<number>()
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] >= 128) {
      set.add((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2])
    }
  }
  return set.size
}

describe('kuwahara', () => {
  it('単色画像は変化しない', () => {
    const img = makeImage(20, 20, [100, 150, 200, 255])
    const out = kuwahara(img, 2)
    expect(out.data[0]).toBe(100)
    expect(out.data[1]).toBe(150)
    expect(out.data[2]).toBe(200)
    expect(out.data[3]).toBe(255)
  })

  it('くっきりした境界を保つ（境界の両側で色が混ざらない）', () => {
    const img = makeImage(20, 20, [255, 255, 255, 255])
    setRect(img, 0, 0, 10, 20, [0, 0, 0, 255]) // 左半分くろ
    const out = kuwahara(img, 2)
    // 境界から十分離れた点は元の色のまま
    expect(out.data[(10 * 20 + 2) * 4]).toBe(0)
    expect(out.data[(10 * 20 + 17) * 4]).toBe(255)
    // 境界ぎわ（x=9, x=10）も中間色にならず黒/白を保つ（エッジ保存性）
    expect(out.data[(10 * 20 + 9) * 4]).toBeLessThan(30)
    expect(out.data[(10 * 20 + 10) * 4]).toBeGreaterThan(225)
  })

  it('alpha は変更しない', () => {
    const img = makeImage(10, 10, [50, 50, 50, 255])
    img.data[3] = 0
    const out = kuwahara(img, 2)
    expect(out.data[3]).toBe(0)
    expect(out.data[7]).toBe(255)
  })
})

describe('posterizeKMeans', () => {
  it('多色のグラデーションが k 色以下になる', () => {
    const img = makeImage(64, 64, [0, 0, 0, 255])
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4
        img.data[i] = x * 4
        img.data[i + 1] = y * 4
        img.data[i + 2] = 128
      }
    }
    expect(distinctOpaqueColors(img)).toBeGreaterThan(100)
    const out = posterizeKMeans(img, 6)
    expect(distinctOpaqueColors(out)).toBeLessThanOrEqual(6)
  })

  it('決定的（同じ入力から同じ出力）', () => {
    const img = makeImage(32, 32, [0, 0, 0, 255])
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (i * 7) % 256
      img.data[i + 1] = (i * 13) % 256
    }
    const a = posterizeKMeans(img, 4)
    const b = posterizeKMeans(img, 4)
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('透明画素はそのまま残る', () => {
    const img = makeImage(16, 16, [200, 100, 50, 255])
    img.data[3] = 0 // 左上を透明に
    const out = posterizeKMeans(img, 2)
    expect(out.data[3]).toBe(0)
  })
})

describe('removeBackgroundSimple', () => {
  it('単色背景 + 中央の被写体 → 背景だけ透明になる', () => {
    const img = makeImage(40, 40, [240, 240, 240, 255]) // 白背景
    setRect(img, 12, 12, 28, 28, [200, 30, 30, 255]) // 赤い被写体
    const out = removeBackgroundSimple(img)
    expect(out.data[3]).toBe(0) // 隅は透明
    const center = (20 * 40 + 20) * 4
    expect(out.data[center + 3]).toBe(255) // 被写体は不透明のまま
  })

  it('被写体に囲まれた背景色の領域は残る（穴を開けない）', () => {
    const img = makeImage(40, 40, [240, 240, 240, 255])
    setRect(img, 8, 8, 32, 32, [200, 30, 30, 255])
    setRect(img, 16, 16, 24, 24, [240, 240, 240, 255]) // 被写体内部の白
    const out = removeBackgroundSimple(img)
    const inner = (20 * 40 + 20) * 4
    expect(out.data[inner + 3]).toBe(255) // 内側の白は外周と連結していないので残る
  })
})

describe('cropToSubject', () => {
  it('不透明領域の外接矩形（+マージン）で切り出す', () => {
    const img = makeImage(100, 100, [0, 0, 0, 0])
    setRect(img, 40, 30, 60, 70, [255, 0, 0, 255]) // 20×40 の被写体
    const out = cropToSubject(img, 128, 0.1)
    // マージン 10% (= 40*0.1 = 4px) 込みでおよそ 28×48
    expect(out.width).toBeGreaterThanOrEqual(20)
    expect(out.width).toBeLessThanOrEqual(30)
    expect(out.height).toBeGreaterThanOrEqual(40)
    expect(out.height).toBeLessThanOrEqual(50)
  })

  it('不透明画素がなければ元画像を返す', () => {
    const img = makeImage(50, 50, [0, 0, 0, 0])
    expect(cropToSubject(img)).toBe(img)
  })
})

describe('sobelMagnitude', () => {
  it('単色画像はほぼゼロ、境界は強い値', () => {
    const img = makeImage(20, 20, [255, 255, 255, 255])
    setRect(img, 0, 0, 10, 20, [0, 0, 0, 255])
    const mag = sobelMagnitude(img)
    expect(mag[10 * 20 + 3]).toBeCloseTo(0, 5) // 一様領域
    expect(mag[10 * 20 + 10]).toBeGreaterThan(0.3) // 境界
  })
})
