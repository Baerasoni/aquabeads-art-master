// おまかせ自動調整
//
// 品質スコア（score.ts）を目的関数に、パイプラインのパラメータを座標降下で探索する。
// - ヒストグラム由来の決定的シード（明るさ・コントラスト・彩度の初期候補）
// - 軸ごとに候補を評価し、最良値を固定して次の軸へ。全軸を2周
// - 評価は約40回。PipelineCache の使い回しで、軸によっては下流段のみの再計算になる
// - 呼び出し側は base を 320px 程度に縮小して渡す（探索の高速化。確定後の
//   フル解像度適用は通常パイプラインが行う）
//
// posterizeKMeans が決定的（乱数不使用）なため、探索は再現可能。
// Web Worker（ブラウザ）と Node（MCP サーバー）の両方から使う。DOM 非依存。

import type { GridSpec } from './grid'
import type { BeadColor } from './palette'
import type { PipelineParams } from './pipeline'
import { createPipelineCache, runPipeline } from './pipeline'
import type { ImageLike } from './quantize'
import type { QualityScore } from './score'
import { scorePattern } from './score'
import { srgbToLab } from './colorspace'

export interface AutoAdjustProgress {
  done: number
  totalEstimate: number
  bestScore: number
}

export interface AutoAdjustResult {
  params: PipelineParams
  score: QualityScore
  seedScore: QualityScore
  evaluated: number
}

export interface AutoAdjustHooks {
  onProgress?: (p: AutoAdjustProgress) => void | Promise<void>
  /** true を返すと中断し、その時点の最良で確定する */
  shouldStop?: () => boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * 被写体（マスクがあればマスク内、なければ不透明画素）の輝度分布から
 * 明るさ・コントラスト・彩度の決定的な初期候補を導く
 */
export function histogramSeed(
  base: ImageLike,
  mask: Float32Array | null,
  palette: BeadColor[],
): { brightness: number; contrast: number; saturation: number } {
  const { data } = base
  const hist = new Uint32Array(256)
  let chromaSum = 0
  let n = 0
  for (let i = 0; i < base.width * base.height; i++) {
    if (mask && mask[i] < 0.5) continue
    const p = i * 4
    if (data[p + 3] < 128) continue
    const r = data[p]
    const g = data[p + 1]
    const b = data[p + 2]
    const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    hist[luma]++
    chromaSum += Math.max(r, g, b) - Math.min(r, g, b)
    n++
  }
  if (n === 0) return { brightness: 100, contrast: 100, saturation: 100 }

  const pct = (p: number) => {
    const target = p * n
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc >= target) return v
    }
    return 255
  }
  const p1 = pct(0.01)
  const p50 = pct(0.5)
  const p99 = pct(0.99)

  // コントラスト: 被写体の輝度レンジを 0-230 程度へ伸長（伸ばしすぎは白飛びする）
  const contrast = clamp(Math.round((230 / Math.max(20, p99 - p1)) * 100), 40, 160)

  // 明るさ: 中央値をパレットの明度中央付近（0-255 換算）へ寄せる
  let minL = Infinity
  let maxL = -Infinity
  for (const c of palette) {
    const { L } = srgbToLab(c.rgb)
    if (L < minL) minL = L
    if (L > maxL) maxL = L
  }
  const targetMid = (((minL + maxL) / 2) * 255) / 100
  const brightness = clamp(Math.round((targetMid / Math.max(20, p50)) * 100), 40, 160)

  // 彩度: くすんだ画像は持ち上げ、ド派手な画像は少し落とす
  const meanChroma = chromaSum / n
  const saturation = meanChroma < 30 ? 130 : meanChroma > 90 ? 85 : 100

  return { brightness, contrast, saturation }
}

/** base（320px 推奨）に対して最良パラメータを探索する。中断時も最良を返す */
export async function autoAdjust(
  base: ImageLike,
  mask: Float32Array | null,
  seed: PipelineParams,
  spec: GridSpec,
  palette: BeadColor[],
  hooks: AutoAdjustHooks = {},
): Promise<AutoAdjustResult> {
  const { onProgress, shouldStop } = hooks
  const cache = createPipelineCache()
  const memo = new Map<string, QualityScore>()
  let evaluated = 0
  let done = 0

  const keyOf = (p: PipelineParams) =>
    JSON.stringify([
      p.adjust.brightness,
      p.adjust.contrast,
      p.adjust.saturation,
      p.colors,
      p.posterize,
      p.smooth,
      p.smoothRadius,
      p.outline,
      p.outlineStrength,
      p.emptyBelow,
      p.repColor,
      p.dither,
      p.deltaE,
    ])

  const evaluate = async (p: PipelineParams): Promise<QualityScore | null> => {
    const key = keyOf(p)
    const hit = memo.get(key)
    if (hit) return hit
    const result = await runPipeline(base, mask, p, spec, palette, cache)
    if (!result) return null
    evaluated++
    const s = scorePattern(result.pattern, result.stats, palette, spec)
    memo.set(key, s)
    return s
  }

  const seedScore = (await evaluate(seed))!
  let best = seed
  let bestScore = seedScore

  // 各軸の候補。先頭に「現在の最良値」を置き、同点なら現状維持になるようにする
  const histAdjust = histogramSeed(base, mask, palette)
  const axes: ((current: PipelineParams) => PipelineParams[])[] = [
    // 色数
    (c) =>
      c.posterize ? [6, 8, 10, 12].map((colors) => ({ ...c, colors })) : [c],
    // 明るさ・コントラスト・彩度（現状 / ヒストグラム由来 / 中間）
    (c) => [
      c,
      { ...c, adjust: histAdjust },
      {
        ...c,
        adjust: {
          brightness: Math.round((c.adjust.brightness + histAdjust.brightness) / 2),
          contrast: Math.round((c.adjust.contrast + histAdjust.contrast) / 2),
          saturation: Math.round((c.adjust.saturation + histAdjust.saturation) / 2),
        },
      },
    ],
    // コントラスト局所refine
    (c) => [0, -15, 15].map((d) => ({
      ...c,
      adjust: { ...c.adjust, contrast: clamp(c.adjust.contrast + d, 40, 160) },
    })),
    // 明るさ局所refine
    (c) => [0, -15, 15].map((d) => ({
      ...c,
      adjust: { ...c.adjust, brightness: clamp(c.adjust.brightness + d, 40, 160) },
    })),
    // 代表色 × ディザ（ディザは少色数のときだけ試す）
    (c) => {
      const reps: PipelineParams[] = [
        { ...c, repColor: 'median', dither: false },
        { ...c, repColor: 'mode', dither: false },
      ]
      if (c.colors <= 8) reps.push({ ...c, repColor: 'median', dither: true })
      return [c, ...reps]
    },
    // 空きマス閾値（背景除去時のみ意味がある）
    (c) =>
      c.background !== 'none'
        ? [c.emptyBelow, 0.25, 0.35, 0.5].map((emptyBelow) => ({ ...c, emptyBelow }))
        : [c],
    // 輪郭
    (c) => [
      c,
      { ...c, outline: false },
      { ...c, outline: true, outlineStrength: 40 },
      { ...c, outline: true, outlineStrength: 70 },
    ],
  ]

  const PASSES = 2
  // 進捗表示用の概算（重複候補は memo ヒットで即時に済むため上限の目安）
  const totalEstimate = PASSES * axes.reduce((s, axis) => s + axis(seed).length, 0)

  for (let pass = 0; pass < PASSES; pass++) {
    for (const axis of axes) {
      for (const candidate of axis(best)) {
        if (shouldStop?.()) {
          return { params: best, score: bestScore, seedScore, evaluated }
        }
        const s = await evaluate(candidate)
        done++
        if (onProgress) await onProgress({ done, totalEstimate, bestScore: bestScore.total })
        if (!s) continue
        // 同点では乗り換えない（現状・既定値寄りを優先して安定させる）
        if (s.total > bestScore.total + 0.01) {
          best = candidate
          bestScore = s
        }
      }
    }
  }

  return { params: best, score: bestScore, seedScore, evaluated }
}
