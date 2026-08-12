import { describe, expect, it } from 'vitest'
import { autoAdjust, histogramSeed } from './autoAdjust'
import { STANDARD_TRAY } from './grid'
import { AQUA_PALETTE } from './palette'
import type { PipelineParams } from './pipeline'
import { DEFAULT_PIPELINE_PARAMS } from './pipeline'
import type { ImageLike } from './quantize'

/** 低コントラストのくすんだグラデーション + 中央に被写体っぽい矩形 */
function dullImage(w: number, h: number): ImageLike {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      // 90-150 の狭いレンジ（コントラスト不足）
      const v = 90 + Math.round((x / (w - 1)) * 60)
      data[p] = v
      data[p + 1] = v
      data[p + 2] = v
      data[p + 3] = 255
    }
  }
  // 中央に着色矩形
  for (let y = (h / 4) | 0; y < (3 * h) / 4; y++) {
    for (let x = (w / 4) | 0; x < (3 * w) / 4; x++) {
      const p = (y * w + x) * 4
      data[p] = 150
      data[p + 1] = 90
      data[p + 2] = 90
    }
  }
  return { width: w, height: h, data }
}

const SEED: PipelineParams = {
  ...DEFAULT_PIPELINE_PARAMS,
  background: 'none',
  autoZoom: false,
  smooth: false, // テスト高速化
}

describe('histogramSeed', () => {
  it('低コントラスト画像ではコントラストを持ち上げる', () => {
    const seed = histogramSeed(dullImage(64, 64), null, AQUA_PALETTE)
    expect(seed.contrast).toBeGreaterThan(100)
    expect(seed.contrast).toBeLessThanOrEqual(160)
  })

  it('全透明画像では無調整を返す', () => {
    const img: ImageLike = { width: 4, height: 4, data: new Uint8ClampedArray(64) }
    expect(histogramSeed(img, null, AQUA_PALETTE)).toEqual({
      brightness: 100,
      contrast: 100,
      saturation: 100,
    })
  })
})

describe('autoAdjust', () => {
  it('シード以上のスコアの結果を返し、決定的である', async () => {
    const base = dullImage(160, 160)
    const a = await autoAdjust(base, null, SEED, STANDARD_TRAY, AQUA_PALETTE)
    expect(a.score.total).toBeGreaterThanOrEqual(a.seedScore.total)
    expect(a.evaluated).toBeGreaterThan(0)
    const b = await autoAdjust(base, null, SEED, STANDARD_TRAY, AQUA_PALETTE)
    expect(b.params).toEqual(a.params)
    expect(b.score.total).toBe(a.score.total)
  }, 30000)

  it('shouldStop で早期中断してもシード以上の最良を返す', async () => {
    const base = dullImage(160, 160)
    let calls = 0
    const r = await autoAdjust(base, null, SEED, STANDARD_TRAY, AQUA_PALETTE, {
      shouldStop: () => ++calls > 5,
    })
    expect(r.score.total).toBeGreaterThanOrEqual(r.seedScore.total)
  }, 30000)

  it('onProgress が単調増加の done を通知する', async () => {
    const base = dullImage(120, 120)
    const dones: number[] = []
    await autoAdjust(base, null, SEED, STANDARD_TRAY, AQUA_PALETTE, {
      onProgress: (p) => {
        dones.push(p.done)
      },
    })
    expect(dones.length).toBeGreaterThan(0)
    for (let i = 1; i < dones.length; i++) expect(dones[i]).toBeGreaterThan(dones[i - 1])
  }, 30000)
})
