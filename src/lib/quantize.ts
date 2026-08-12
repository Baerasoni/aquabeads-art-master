// 画像 → 図案の量子化
//
// 六角配置のため「canvas 縮小で1セル=1画素」は使えない。
// 画像をグリッド外形 (mm) に cover 配置し、各セル円内の画素を集めて
// 代表色を決め、パレットの知覚的最近傍色に割り当てる。
// 代表色の決め方（mean / median / mode）・ΔE 方式・ディザリング・輪郭ビーズは選択できる。
//
// 空きマス: セル円内の不透明画素の割合が閾値未満なら EMPTY_CELL（ビーズを置かない）。
// 背景除去（alpha=0）された領域は自動的に空きマスになる。

import type { GridSpec } from './grid'
import {
  BEAD_DIAMETER_MM,
  cellCenterMm,
  gridHeightMm,
  gridWidthMm,
  isLongRow,
  rowLength,
} from './grid'
import type { BeadColor } from './palette'
import type { DeltaEMethod, Lab, RGB } from './colorspace'
import { deltaE, srgbToLab } from './colorspace'
import type { Pattern } from './pattern'
import { EMPTY_CELL } from './pattern'
import { sobelMagnitude } from './preprocess'

/** ImageData 互換の最小型（テストでは素のオブジェクトを渡せる） */
export interface ImageLike {
  width: number
  height: number
  /** RGBA 順・行優先 */
  data: Uint8ClampedArray
}

export type RepColorMethod = 'mean' | 'median' | 'mode'

export interface OutlineOptions {
  /** セル円内で「強エッジ画素」が占める割合がこの値以上なら輪郭ビーズにする（0.04〜0.20 目安） */
  density: number
}

export interface QuantizeOptions {
  /** セル代表色の決め方（デフォルト: median） */
  repColor?: RepColorMethod
  /** 色距離の方式（デフォルト: ciede2000） */
  deltaE?: DeltaEMethod
  /** 誤差拡散ディザリング（デフォルト: false） */
  dither?: boolean
  /** 輪郭ビーズ。指定すると強エッジのセルと空きマス隣接セルを最暗色にする */
  outline?: OutlineOptions
  /** セルを空きマスにする不透明率の下限（デフォルト: 0.35） */
  emptyBelow?: number
  /** sobelMagnitude(image) の事前計算値。同じ image への再計算を避けたい場合に渡す */
  edgeMag?: Float32Array
}

function channelMedian(pixels: RGB[], k: 0 | 1 | 2): number {
  // ソートだと 3ch × 全セルで数千回になるため 256 ビンのヒストグラムで求める。
  // 画素値は 0-255 の整数で、sort 版の sorted[floor(n/2)]（上側中央値）と同じ値を返す
  const hist = new Uint32Array(256)
  for (const p of pixels) hist[p[k]]++
  const mid = pixels.length >> 1
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc > mid) return v
  }
  return 255
}

/**
 * セル円内の画素群からセルの代表色を決める。pixels は1個以上を前提とする。
 * - mean:   チャンネル平均。滑らかだが輪郭がにじむ
 * - median: チャンネル別中央値。ノイズと輪郭のにじみに強い
 * - mode:   量子化ビン（各チャンネル16階調）の最頻値。輪郭がくっきり残る
 */
export function representativeColor(pixels: RGB[], method: RepColorMethod = 'median'): RGB {
  if (pixels.length === 0) throw new Error('representativeColor: pixels が空です')

  if (method === 'mean') {
    let r = 0
    let g = 0
    let b = 0
    for (const p of pixels) {
      r += p[0]
      g += p[1]
      b += p[2]
    }
    const n = pixels.length
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
  }

  if (method === 'median') {
    return [channelMedian(pixels, 0), channelMedian(pixels, 1), channelMedian(pixels, 2)]
  }

  // mode: 4bit/チャンネルのビンで最頻を探し、そのビン内の平均を返す
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (const [r, g, b] of pixels) {
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    let bin = bins.get(key)
    if (!bin) {
      bin = { n: 0, r: 0, g: 0, b: 0 }
      bins.set(key, bin)
    }
    bin.n++
    bin.r += r
    bin.g += g
    bin.b += b
  }
  let best: { n: number; r: number; g: number; b: number } | undefined
  for (const bin of bins.values()) {
    if (!best || bin.n > best.n) best = bin
  }
  const b = best!
  return [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)]
}

/** rgb に知覚的に最も近いパレット色の index を返す */
export function nearestPaletteIndex(
  rgb: RGB,
  paletteLabs: Lab[],
  method: DeltaEMethod = 'ciede2000',
): number {
  const lab = srgbToLab(rgb)
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < paletteLabs.length; i++) {
    const d = deltaE(lab, paletteLabs[i], method)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** RGBA の1画素を白背景に合成して返す（半透明画素の色ブレを防ぐ） */
function compositeWhite(data: Uint8ClampedArray, i: number): RGB {
  const a = data[i + 3]
  if (a === 255) return [data[i], data[i + 1], data[i + 2]]
  const t = a / 255
  const w = 255 * (1 - t)
  return [
    Math.round(data[i] * t + w),
    Math.round(data[i + 1] * t + w),
    Math.round(data[i + 2] * t + w),
  ]
}

interface CellSample {
  /** 不透明画素のみ（白合成済み）。空きマス判定で除外されたセルは空配列のことがある */
  pixels: RGB[]
  /** セル円内画素のうち不透明（alpha>=128）の割合 */
  opaqueFraction: number
  /** 強エッジ画素の割合（edgeMag 指定時のみ） */
  edgeDensity: number
}

const STRONG_EDGE = 0.22

/** セル円内の画素を収集する。範囲外はクランプし、円が画像外でも最低1画素は評価する */
function sampleCell(
  image: ImageLike,
  cx: number,
  cy: number,
  radius: number,
  edgeMag: Float32Array | null,
): CellSample {
  const pixels: RGB[] = []
  let total = 0
  let opaque = 0
  let strongEdges = 0
  const x0 = Math.max(0, Math.floor(cx - radius))
  const x1 = Math.min(image.width - 1, Math.ceil(cx + radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const y1 = Math.min(image.height - 1, Math.ceil(cy + radius))
  const r2 = radius * radius
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy > r2) continue
      const idx = y * image.width + x
      const i = idx * 4
      total++
      if (edgeMag && edgeMag[idx] >= STRONG_EDGE) strongEdges++
      if (image.data[i + 3] >= 128) {
        opaque++
        pixels.push(compositeWhite(image.data, i))
      }
    }
  }
  if (total === 0) {
    // 画素 i は [i, i+1) を占めるため、座標を含む画素は floor（round だと右下にずれる）
    const px = Math.min(image.width - 1, Math.max(0, Math.floor(cx)))
    const py = Math.min(image.height - 1, Math.max(0, Math.floor(cy)))
    const idx = py * image.width + px
    total = 1
    if (edgeMag && edgeMag[idx] >= STRONG_EDGE) strongEdges = 1
    if (image.data[idx * 4 + 3] >= 128) {
      opaque = 1
      pixels.push(compositeWhite(image.data, idx * 4))
    }
  }
  return { pixels, opaqueFraction: opaque / total, edgeDensity: strongEdges / total }
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** 六角格子の隣接セル座標（同行左右 + 上下行の2つずつ） */
function hexNeighbors(spec: GridSpec, row: number, col: number): [number, number][] {
  const long = isLongRow(spec, row)
  // 長い行のセル col の上下隣は (col-1, col)、短い行のセル col の上下隣は (col, col+1)
  const a = long ? col - 1 : col
  const b = long ? col : col + 1
  return [
    [row, col - 1],
    [row, col + 1],
    [row - 1, a],
    [row - 1, b],
    [row + 1, a],
    [row + 1, b],
  ]
}

/** パレット中で最も暗い色（輪郭ビーズ用）の index */
export function darkestPaletteIndex(palette: BeadColor[]): number {
  let best = 0
  let bestL = Infinity
  for (let i = 0; i < palette.length; i++) {
    const { L } = srgbToLab(palette[i].rgb)
    if (L < bestL) {
      bestL = L
      best = i
    }
  }
  return best
}

/** 画像をグリッドに cover 配置して図案化する */
export function imageToPattern(
  image: ImageLike,
  spec: GridSpec,
  palette: BeadColor[],
  options: QuantizeOptions = {},
): Pattern {
  if (palette.length === 0) throw new Error('パレットが空です（手持ち色を1色以上選択してください）')
  const {
    repColor = 'median',
    deltaE: deMethod = 'ciede2000',
    dither = false,
    outline,
    emptyBelow = 0.35,
  } = options

  const gw = gridWidthMm(spec)
  const gh = gridHeightMm(spec)
  // cover: 画像がグリッド全体を覆う倍率（px / mm）。はみ出た分は中央クロップ。
  // scale は px/mm（グリッド→画像方向）なので cover は min（max だと contain になり
  // グリッド外周が画像外へはみ出す）
  const scale = Math.min(image.width / gw, image.height / gh)
  const offX = (image.width - gw * scale) / 2
  const offY = (image.height - gh * scale) / 2
  const beadR = BEAD_DIAMETER_MM / 2

  const edgeMag = outline ? (options.edgeMag ?? sobelMagnitude(image)) : null

  // pass1: 各セルの代表色（空きマスは null）とエッジ密度
  const targets: (RGB | null)[][] = []
  const edges: number[][] = []
  for (let row = 0; row < spec.rows; row++) {
    const tLine: (RGB | null)[] = []
    const eLine: number[] = []
    for (let col = 0; col < rowLength(spec, row); col++) {
      const { x, y } = cellCenterMm(spec, row, col)
      const cx = offX + (x + beadR) * scale
      const cy = offY + (y + beadR) * scale
      const s = sampleCell(image, cx, cy, beadR * scale, edgeMag)
      tLine.push(s.opaqueFraction < emptyBelow || s.pixels.length === 0
        ? null
        : representativeColor(s.pixels, repColor))
      eLine.push(s.edgeDensity)
    }
    targets.push(tLine)
    edges.push(eLine)
  }

  const hasEmpty = targets.some((line) => line.some((t) => t === null))
  const paletteLabs = palette.map((c) => srgbToLab(c.rgb))
  const outlineIdx = outline ? darkestPaletteIndex(palette) : -1

  // pass2: 量子化（輪郭 → 最近傍 → ディザ）
  const cells: number[][] = []
  for (let row = 0; row < spec.rows; row++) {
    const line: number[] = []
    const rowLen = targets[row].length
    for (let col = 0; col < rowLen; col++) {
      const target = targets[row][col]
      if (target === null) {
        line.push(EMPTY_CELL)
        continue
      }

      if (outline) {
        // シルエット輪郭: 空きマスに隣接する置きマス
        const silhouette =
          hasEmpty &&
          hexNeighbors(spec, row, col).some(([r, c]) => {
            if (r < 0 || r >= spec.rows) return false
            const t = targets[r]
            return c >= 0 && c < t.length && t[c] === null
          })
        if (silhouette || edges[row][col] >= outline.density) {
          line.push(outlineIdx)
          continue // 輪郭セルは誤差拡散に参加しない
        }
      }

      // 誤差の累積でレンジ外になりうるため、最近傍探索の入力だけクランプする
      // （累積値そのものをクランプすると範囲外分の誤差が消失し、明部・暗部で階調が崩れる）
      const clamped: RGB = [clamp255(target[0]), clamp255(target[1]), clamp255(target[2])]
      const idx = nearestPaletteIndex(clamped, paletteLabs, deMethod)
      line.push(idx)

      if (dither) {
        // 六角格子の誤差拡散: 右 7/16、左下 3/16、右下 5/16（残り 1/16 は捨てる）
        const chosen = palette[idx].rgb
        const err: RGB = [
          target[0] - chosen[0],
          target[1] - chosen[1],
          target[2] - chosen[2],
        ]
        const spread = (r: number, c: number, w: number) => {
          if (r >= spec.rows) return
          const t = targets[r]?.[c]
          if (!t) return // 空きマスへは拡散しない
          t[0] += err[0] * w
          t[1] += err[1] * w
          t[2] += err[2] * w
        }
        const long = isLongRow(spec, row)
        spread(row, col + 1, 7 / 16)
        spread(row + 1, long ? col - 1 : col, 3 / 16)
        spread(row + 1, long ? col : col + 1, 5 / 16)
      }
    }
    cells.push(line)
  }
  return { spec, palette, cells }
}
