// 変換パイプライン（画像調整 → 背景除去 → ズーム → 平滑化 → 減色 → 図案化）
//
// App.tsx（メインスレッド）・おまかせ調整の Web Worker・MCP サーバー（Node）で
// 同一の変換を共有するための純関数モジュール。canvas / DOM には依存しない。
// AI マスクの推論（segmentation.ts）だけは呼び出し側の責務で、
// ここには推論済みの Float32Array を渡す。
//
// PipelineCache は App.tsx の旧 StageCache と同じ「上流キーを含む合成キー」方式。
// 変わったパラメータより下流の段だけが再計算される。旧実装と異なり
// posterize（k-means）と quantize（図案化）もキャッシュ対象。

import type { AdjustParams } from './adjust'
import { applyAdjust } from './adjust'
import type { GridSpec } from './grid'
import type { BeadColor } from './palette'
import type { Pattern } from './pattern'
import {
  cropToSubject,
  kuwahara,
  posterizeKMeans,
  removeBackgroundSimple,
  sobelMagnitude,
} from './preprocess'
import type { CellStats, ImageLike, QuantizeOptions } from './quantize'
import { imageToPatternWithStats } from './quantize'
import type { DeltaEMethod } from './colorspace'
import type { RepColorMethod } from './quantize'

export type BackgroundMode = 'none' | 'auto' | 'simple'

/** パイプライン全体のパラメータ（UI の3状態 Adjust / IllustOptions / ConvertOptions の合流点） */
export interface PipelineParams {
  adjust: AdjustParams
  /** 背景除去: auto はマスク（AI）があれば使い、なければ除去なしにフォールバック */
  background: BackgroundMode
  autoZoom: boolean
  posterize: boolean
  colors: number
  smooth: boolean
  /** Kuwahara 半径（1-4、既定 2） */
  smoothRadius: number
  outline: boolean
  outlineStrength: number
  /** セルを空きマスにする不透明率の下限（既定 0.35） */
  emptyBelow: number
  deltaE: DeltaEMethod
  repColor: RepColorMethod
  dither: boolean
}

export const DEFAULT_PIPELINE_PARAMS: PipelineParams = {
  adjust: { brightness: 100, contrast: 100, saturation: 100 },
  background: 'auto',
  autoZoom: true,
  posterize: true,
  colors: 8,
  smooth: true,
  smoothRadius: 2,
  outline: true,
  outlineStrength: 50,
  emptyBelow: 0.35,
  deltaE: 'ciede2000',
  repColor: 'median',
  dither: false,
}

/** 輪郭の強さ（0-100、大きいほど輪郭が増える）→ エッジ密度閾値 */
export function outlineDensity(outlineStrength: number): number {
  return 0.04 + ((100 - outlineStrength) / 100) * 0.16
}

export interface PipelineResult {
  /** 図案化直前の前処理済み画像 */
  image: ImageLike
  pattern: Pattern
  stats: CellStats
}

/** 段階キャッシュ。base / mask はオブジェクト同一性で判定し、変わったら全段無効化 */
export interface PipelineCache {
  baseRef: ImageLike | null
  maskRef: Float32Array | null
  filteredKey: string
  filtered: ImageLike | null
  bgKey: string
  bg: ImageLike | null
  cropKey: string
  crop: ImageLike | null
  smoothKey: string
  smooth: ImageLike | null
  posterKey: string
  poster: ImageLike | null
  edgeKey: string
  edgeMag: Float32Array | null
  quantKey: string
  quant: { pattern: Pattern; stats: CellStats } | null
}

export function createPipelineCache(): PipelineCache {
  return {
    baseRef: null,
    maskRef: null,
    filteredKey: '',
    filtered: null,
    bgKey: '',
    bg: null,
    cropKey: '',
    crop: null,
    smoothKey: '',
    smooth: null,
    posterKey: '',
    poster: null,
    edgeKey: '',
    edgeMag: null,
    quantKey: '',
    quant: null,
  }
}

function copyImage(img: ImageLike): ImageLike {
  return { width: img.width, height: img.height, data: img.data.slice() }
}

/** マスクを alpha に適用（segmentation.ts の applyMask と同一の smoothstep フェザリング） */
export function applyMask(image: ImageLike, mask: Float32Array): void {
  for (let i = 0; i < mask.length; i++) {
    let t = (mask[i] - 0.25) / 0.5
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const s = t * t * (3 - 2 * t)
    const p = i * 4 + 3
    const a = Math.round(s * 255)
    if (a < image.data[p]) image.data[p] = a
  }
}

export interface RunPipelineHooks {
  /** 重い段の直前に呼ばれる（UI 側は描画 yield に使う） */
  onStage?: (stage: 'bg' | 'smooth' | 'posterize' | 'quantize') => void | Promise<void>
  /** true を返すと中断し、runPipeline は null を返す */
  shouldStop?: () => boolean
}

/**
 * base（調整前・縮小済み RGBA）から図案までを一気に変換する。
 * cache を渡すと変わったパラメータ以降の段だけ再計算される。
 */
export async function runPipeline(
  base: ImageLike,
  mask: Float32Array | null,
  params: PipelineParams,
  spec: GridSpec,
  palette: BeadColor[],
  cache: PipelineCache = createPipelineCache(),
  hooks: RunPipelineHooks = {},
): Promise<PipelineResult | null> {
  const { onStage, shouldStop } = hooks
  const stop = () => (shouldStop ? shouldStop() : false)

  // base / mask が変わったら全段無効化
  if (cache.baseRef !== base || cache.maskRef !== mask) {
    Object.assign(cache, createPipelineCache())
    cache.baseRef = base
    cache.maskRef = mask
  }

  const a = params.adjust
  const filteredKey = `${a.brightness}:${a.contrast}:${a.saturation}`
  let filtered = cache.filteredKey === filteredKey ? cache.filtered : null
  if (!filtered) {
    filtered = applyAdjust(base, a)
    cache.filtered = filtered
    cache.filteredKey = filteredKey
  }

  const useMask = params.background === 'auto' && mask !== null
  const bgKey = `${filteredKey}|${params.background}|${useMask ? 'm' : '-'}`
  let bg = cache.bgKey === bgKey ? cache.bg : null
  if (!bg) {
    if (onStage) await onStage('bg')
    if (stop()) return null
    if (useMask) {
      // applyMask は破壊的なので、キャッシュ済み filtered のコピーに適用する
      const masked = copyImage(filtered)
      applyMask(masked, mask)
      bg = masked
    } else if (params.background === 'simple') {
      bg = removeBackgroundSimple(filtered)
    } else {
      // 下流の関数はすべて非破壊なのでキャッシュを共有してよい
      bg = filtered
    }
    cache.bg = bg
    cache.bgKey = bgKey
  }

  const doCrop = params.background !== 'none' && params.autoZoom
  const cropKey = `${bgKey}|${doCrop}`
  let crop = cache.cropKey === cropKey ? cache.crop : null
  if (!crop) {
    crop = doCrop ? cropToSubject(bg) : bg
    cache.crop = crop
    cache.cropKey = cropKey
  }

  const smoothKey = `${cropKey}|${params.smooth ? params.smoothRadius : 'off'}`
  let smooth = cache.smoothKey === smoothKey ? cache.smooth : null
  if (!smooth) {
    if (params.smooth) {
      if (onStage) await onStage('smooth')
      if (stop()) return null
      smooth = kuwahara(crop, params.smoothRadius)
    } else {
      smooth = crop
    }
    cache.smooth = smooth
    cache.smoothKey = smoothKey
  }

  const posterKey = `${smoothKey}|${params.posterize ? params.colors : 'off'}`
  let poster = cache.posterKey === posterKey ? cache.poster : null
  if (!poster) {
    if (params.posterize) {
      if (onStage) await onStage('posterize')
      if (stop()) return null
      poster = posterizeKMeans(smooth, params.colors)
    } else {
      poster = smooth
    }
    cache.poster = poster
    cache.posterKey = posterKey
  }

  // Sobel は画像にのみ依存する。輪郭の強さ変更では再計算しない
  const edgeKey = `${posterKey}|${params.outline}`
  let edgeMag = cache.edgeKey === edgeKey ? cache.edgeMag : null
  if (params.outline && !edgeMag) {
    edgeMag = sobelMagnitude(poster)
    cache.edgeMag = edgeMag
    cache.edgeKey = edgeKey
  } else if (!params.outline) {
    cache.edgeMag = null
    cache.edgeKey = edgeKey
  }

  const paletteKey = palette.map((c) => c.id).join(',')
  const specKey = `${spec.rows}x${spec.cols}x${spec.longFirst}`
  const quantKey = [
    posterKey,
    specKey,
    paletteKey,
    params.deltaE,
    params.repColor,
    params.dither,
    params.outline ? outlineDensity(params.outlineStrength).toFixed(4) : 'off',
    params.emptyBelow,
  ].join('|')
  let quant = cache.quantKey === quantKey ? cache.quant : null
  if (!quant) {
    if (onStage) await onStage('quantize')
    if (stop()) return null
    const qOptions: QuantizeOptions = {
      repColor: params.repColor,
      deltaE: params.deltaE,
      dither: params.dither,
      emptyBelow: params.emptyBelow,
      outline: params.outline ? { density: outlineDensity(params.outlineStrength) } : undefined,
      edgeMag: edgeMag ?? undefined,
    }
    quant = imageToPatternWithStats(poster, spec, palette, qOptions)
    cache.quant = quant
    cache.quantKey = quantKey
  }

  return { image: poster, pattern: quant.pattern, stats: quant.stats }
}
