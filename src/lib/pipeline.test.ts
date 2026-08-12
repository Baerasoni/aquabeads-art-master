import { describe, expect, it } from 'vitest'
import { AQUA_PALETTE } from './palette'
import { STANDARD_TRAY } from './grid'
import type { ImageLike } from './quantize'
import type { PipelineParams } from './pipeline'
import { createPipelineCache, DEFAULT_PIPELINE_PARAMS, outlineDensity, runPipeline } from './pipeline'
import { isValidPattern } from './pattern'

function gradientImage(w: number, h: number): ImageLike {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      data[p] = Math.round((x / (w - 1)) * 255)
      data[p + 1] = Math.round((y / (h - 1)) * 255)
      data[p + 2] = 128
      data[p + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

const PARAMS: PipelineParams = { ...DEFAULT_PIPELINE_PARAMS, background: 'none', autoZoom: false }

describe('runPipeline', () => {
  it('有効な図案を返し、同一パラメータの再実行はキャッシュを返す', async () => {
    const base = gradientImage(160, 160)
    const cache = createPipelineCache()
    const a = await runPipeline(base, null, PARAMS, STANDARD_TRAY, AQUA_PALETTE, cache)
    expect(a).not.toBeNull()
    expect(isValidPattern(a!.pattern)).toBe(true)
    const b = await runPipeline(base, null, PARAMS, STANDARD_TRAY, AQUA_PALETTE, cache)
    // 全段キャッシュヒット → 同一オブジェクト
    expect(b!.pattern).toBe(a!.pattern)
    expect(b!.image).toBe(a!.image)
  })

  it('quantize 段のみのパラメータ変更では前処理画像を再計算しない', async () => {
    const base = gradientImage(160, 160)
    const cache = createPipelineCache()
    const a = await runPipeline(base, null, PARAMS, STANDARD_TRAY, AQUA_PALETTE, cache)
    const b = await runPipeline(
      base,
      null,
      { ...PARAMS, emptyBelow: 0.5, repColor: 'mode' },
      STANDARD_TRAY,
      AQUA_PALETTE,
      cache,
    )
    expect(b!.image).toBe(a!.image) // 前処理はキャッシュヒット
    expect(b!.pattern).not.toBe(a!.pattern) // 図案は再計算
  })

  it('base が変わるとキャッシュは全段無効化される', async () => {
    const cache = createPipelineCache()
    const a = await runPipeline(gradientImage(160, 160), null, PARAMS, STANDARD_TRAY, AQUA_PALETTE, cache)
    const b = await runPipeline(gradientImage(160, 160), null, PARAMS, STANDARD_TRAY, AQUA_PALETTE, cache)
    expect(b!.image).not.toBe(a!.image)
    // 同一内容の別画像なので結果は等しい（決定性）
    expect(b!.pattern.cells).toEqual(a!.pattern.cells)
  })

  it('shouldStop が true を返すと null で中断する', async () => {
    const result = await runPipeline(
      gradientImage(160, 160),
      null,
      PARAMS,
      STANDARD_TRAY,
      AQUA_PALETTE,
      createPipelineCache(),
      { shouldStop: () => true },
    )
    expect(result).toBeNull()
  })

  it('outlineDensity: 強さ 0-100 が 0.20-0.04 の閾値に対応（強いほど閾値が低い）', () => {
    expect(outlineDensity(0)).toBeCloseTo(0.2)
    expect(outlineDensity(100)).toBeCloseTo(0.04)
    expect(outlineDensity(50)).toBeCloseTo(0.12)
  })

  it('マスクを渡すと背景が空きマスになる', async () => {
    const base = gradientImage(160, 160)
    // 中央 1/4 のみ被写体のマスク
    const mask = new Float32Array(160 * 160)
    for (let y = 60; y < 100; y++) {
      for (let x = 60; x < 100; x++) mask[y * 160 + x] = 1
    }
    const result = await runPipeline(
      base,
      mask,
      { ...PARAMS, background: 'auto', autoZoom: false },
      STANDARD_TRAY,
      AQUA_PALETTE,
      createPipelineCache(),
    )
    const cells = result!.pattern.cells.flat()
    expect(cells.some((c) => c === -1)).toBe(true) // 空きマスあり
    expect(cells.some((c) => c >= 0)).toBe(true) // 被写体あり
  })
})
