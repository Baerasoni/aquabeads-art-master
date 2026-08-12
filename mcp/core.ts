// ヘッドレス変換コア（Node 専用・MCP サーバー / CLI 共用）
//
// ブラウザの canvas 相当（デコード・縮小・PNG 化）だけを sharp で行い、
// 変換パイプライン本体は src/lib/ の純関数をそのまま使う。
// AI 背景除去（U²-Net / onnxruntime）は v1 では未対応 —
// background: 'auto' は 'simple'（四隅色ベース）に読み替えて警告を返す。

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { AutoAdjustResult } from '../src/lib/autoAdjust'
import { autoAdjust } from '../src/lib/autoAdjust'
import { resizeImage } from '../src/lib/adjust'
import type { GridSpec } from '../src/lib/grid'
import { STANDARD_TRAY } from '../src/lib/grid'
import type { BeadColor } from '../src/lib/palette'
import { AQUA_PALETTE, DEFAULT_OWNED_IDS } from '../src/lib/palette'
import type { BeadCount, Pattern } from '../src/lib/pattern'
import { countBeads, emptyCellCount, totalBeads } from '../src/lib/pattern'
import type { PipelineParams } from '../src/lib/pipeline'
import { DEFAULT_PIPELINE_PARAMS, runPipeline } from '../src/lib/pipeline'
import type { ImageLike } from '../src/lib/quantize'
import type { RenderOptions } from '../src/lib/renderSvg'
import { patternToSvg } from '../src/lib/renderSvg'
import type { QualityScore } from '../src/lib/score'
import { scorePattern } from '../src/lib/score'

export const MAX_SIZE = 640

/** 画像ファイルを RGBA の ImageLike に読み込む（長辺 maxSize 以下に縮小） */
export async function loadImage(imagePath: string, maxSize = MAX_SIZE): Promise<ImageLike> {
  const { data, info } = await sharp(imagePath)
    .rotate() // EXIF の向きを反映
    .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
  }
}

export interface ConvertRequest {
  imagePath: string
  params?: Partial<PipelineParams>
  spec?: GridSpec
  /** 手持ち色 ID。省略時は基本16色 */
  ownedIds?: string[]
}

export interface ConvertResult {
  pattern: Pattern
  score: QualityScore
  beadCounts: BeadCount[]
  totalBeads: number
  emptyCells: number
  paramsUsed: PipelineParams
  svg: string
  warnings: string[]
}

export function resolvePalette(ownedIds?: string[]): BeadColor[] {
  const ids = new Set(ownedIds && ownedIds.length > 0 ? ownedIds : DEFAULT_OWNED_IDS)
  return AQUA_PALETTE.filter((c) => ids.has(c.id))
}

/** background: 'auto'（AI）は Node では未対応のため 'simple' に読み替える */
function resolveParams(partial: Partial<PipelineParams> | undefined, warnings: string[]): PipelineParams {
  const params: PipelineParams = {
    ...DEFAULT_PIPELINE_PARAMS,
    ...partial,
    adjust: { ...DEFAULT_PIPELINE_PARAMS.adjust, ...partial?.adjust },
  }
  if (params.background === 'auto') {
    warnings.push(
      'AI 背景除去 (background: "auto") は MCP サーバーでは未対応のため、単色背景除去 ("simple") で代替しました。',
    )
    params.background = 'simple'
  }
  return params
}

export async function convertImage(request: ConvertRequest): Promise<ConvertResult> {
  const warnings: string[] = []
  const params = resolveParams(request.params, warnings)
  const spec = request.spec ?? STANDARD_TRAY
  const palette = resolvePalette(request.ownedIds)
  if (palette.length === 0) throw new Error('ownedIds に一致する色がありません')

  const base = await loadImage(request.imagePath)
  const result = await runPipeline(base, null, params, spec, palette)
  if (!result) throw new Error('パイプラインが中断されました')

  const score = scorePattern(result.pattern, result.stats, palette, spec)
  return {
    pattern: result.pattern,
    score,
    beadCounts: countBeads(result.pattern),
    totalBeads: totalBeads(result.pattern),
    emptyCells: emptyCellCount(result.pattern),
    paramsUsed: params,
    svg: patternToSvg(result.pattern),
    warnings,
  }
}

export interface AutoAdjustRequestHeadless {
  imagePath: string
  seedParams?: Partial<PipelineParams>
  spec?: GridSpec
  ownedIds?: string[]
}

export async function autoAdjustImage(
  request: AutoAdjustRequestHeadless,
): Promise<{ auto: AutoAdjustResult; converted: ConvertResult; warnings: string[] }> {
  const warnings: string[] = []
  const seed = resolveParams(request.seedParams, warnings)
  const spec = request.spec ?? STANDARD_TRAY
  const palette = resolvePalette(request.ownedIds)
  if (palette.length === 0) throw new Error('ownedIds に一致する色がありません')

  const base = await loadImage(request.imagePath)
  // 探索は 320px 縮小で（ブラウザ版と同じ流儀）、確定パラメータでフル解像度変換
  const searchBase = resizeImage(base, 320)
  const auto = await autoAdjust(searchBase, null, seed, spec, palette, {})
  const converted = await convertImage({
    imagePath: request.imagePath,
    params: auto.params,
    spec,
    ownedIds: request.ownedIds,
  })
  return { auto, converted, warnings: [...warnings, ...converted.warnings] }
}

/** SVG を PNG ファイルに書き出し、そのパスを返す */
export async function svgToPng(svg: string, outPath: string): Promise<string> {
  await mkdir(path.dirname(outPath), { recursive: true })
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  await writeFile(outPath, png)
  return outPath
}

/** SVG を PNG バッファに変換する（MCP の image content 用） */
export async function svgToPngBuffer(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** 元画像を縮小 PNG にして書き出す（並べて比較する用） */
export async function renderOriginalPng(imagePath: string, outPath: string, maxSize = 640): Promise<string> {
  await mkdir(path.dirname(outPath), { recursive: true })
  await sharp(imagePath)
    .rotate()
    .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toFile(outPath)
  return outPath
}

/** 図案を patternToSvg のオプション付きでレンダリングし PNG バッファを返す */
export async function renderPatternPng(pattern: Pattern, options: RenderOptions = {}): Promise<Buffer> {
  return svgToPngBuffer(patternToSvg(pattern, options))
}
