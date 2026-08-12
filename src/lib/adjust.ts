// 画像調整（明るさ・コントラスト・彩度）の純関数実装
//
// 従来は canvas の ctx.filter（CSS filter）で行っていたが、
// - Node（MCP サーバー / CLI）でも同じ結果を得る
// - Web Worker（おまかせ調整の探索）で canvas なしに実行する
// - ctx.filter 非対応ブラウザ（Safari の一部）でも動く
// ため、Filter Effects 仕様の定義式をそのまま実装する。
//
// 適用順は従来の filter 文字列と同じ brightness → contrast → saturate。
// いずれも sRGB 空間の線形変換（仕様どおり）で、3つを1つの 3×4 行列に
// 合成して1パスで適用する。alpha は変更しない。

import type { ImageLike } from './quantize'

export interface AdjustParams {
  /** % 値（100 = 無調整） */
  brightness: number
  contrast: number
  saturation: number
}

export const DEFAULT_ADJUST: AdjustParams = { brightness: 100, contrast: 100, saturation: 100 }

export function isIdentityAdjust(a: AdjustParams): boolean {
  return a.brightness === 100 && a.contrast === 100 && a.saturation === 100
}

/**
 * brightness(b) → contrast(c) → saturate(s) を合成した 3×3 行列 + オフセットを返す。
 * - brightness: v' = v·b
 * - contrast:   v' = (v − 127.5)·c + 127.5
 * - saturate:   Filter Effects の彩度行列（行和 1 のためオフセットは不変）
 */
function composeMatrix(a: AdjustParams): { m: number[]; off: number } {
  const b = a.brightness / 100
  const c = a.contrast / 100
  const s = a.saturation / 100
  const g = b * c // 線形係数はスカラー合成できる
  // 彩度行列（Filter Effects: saturate type）
  const m = [
    (0.213 + 0.787 * s) * g, (0.715 - 0.715 * s) * g, (0.072 - 0.072 * s) * g,
    (0.213 - 0.213 * s) * g, (0.715 + 0.285 * s) * g, (0.072 - 0.072 * s) * g,
    (0.213 - 0.213 * s) * g, (0.715 - 0.715 * s) * g, (0.072 + 0.928 * s) * g,
  ]
  return { m, off: 127.5 * (1 - c) }
}

/** 明るさ・コントラスト・彩度を適用した新しい画像を返す（非破壊、alpha 不変） */
export function applyAdjust(image: ImageLike, adjust: AdjustParams): ImageLike {
  if (isIdentityAdjust(adjust)) {
    return { width: image.width, height: image.height, data: image.data.slice() }
  }
  const { m, off } = composeMatrix(adjust)
  const src = image.data
  const out = new Uint8ClampedArray(src.length)
  for (let p = 0; p < src.length; p += 4) {
    const r = src[p]
    const g = src[p + 1]
    const b = src[p + 2]
    // Uint8ClampedArray への代入で 0-255 クランプ + 丸めされる
    out[p] = m[0] * r + m[1] * g + m[2] * b + off
    out[p + 1] = m[3] * r + m[4] * g + m[5] * b + off
    out[p + 2] = m[6] * r + m[7] * g + m[8] * b + off
    out[p + 3] = src[p + 3]
  }
  return { width: image.width, height: image.height, data: out }
}

/** RGBA 画像のバイリニア縮小（長辺 maxSize 以下に）。拡大はしない */
export function resizeImage(image: ImageLike, maxSize: number): ImageLike {
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
  if (scale >= 1) {
    return { width: image.width, height: image.height, data: image.data.slice() }
  }
  const dw = Math.max(1, Math.round(image.width * scale))
  const dh = Math.max(1, Math.round(image.height * scale))
  const { width: sw, height: sh, data: src } = image
  const dst = new Uint8ClampedArray(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    // 端で外挿しないよう補間座標をクランプする（segmentation.ts の resizeBilinear と同方式）
    let fy = ((y + 0.5) * sh) / dh - 0.5
    fy = Math.max(0, Math.min(sh - 1, fy))
    const y0 = Math.floor(fy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < dw; x++) {
      let fx = ((x + 0.5) * sw) / dw - 0.5
      fx = Math.max(0, Math.min(sw - 1, fx))
      const x0 = Math.floor(fx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const tx = fx - x0
      const p00 = (y0 * sw + x0) * 4
      const p01 = (y0 * sw + x1) * 4
      const p10 = (y1 * sw + x0) * 4
      const p11 = (y1 * sw + x1) * 4
      const q = (y * dw + x) * 4
      for (let ch = 0; ch < 4; ch++) {
        const top = src[p00 + ch] * (1 - tx) + src[p01 + ch] * tx
        const bot = src[p10 + ch] * (1 - tx) + src[p11 + ch] * tx
        dst[q + ch] = top * (1 - ty) + bot * ty
      }
    }
  }
  return { width: dw, height: dh, data: dst }
}

/** Float32 マップ（AI マスク等）のバイリニアリサイズ */
export function resizeMask(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const dst = new Float32Array(dw * dh)
  for (let y = 0; y < dh; y++) {
    let fy = ((y + 0.5) * sh) / dh - 0.5
    fy = Math.max(0, Math.min(sh - 1, fy))
    const y0 = Math.floor(fy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < dw; x++) {
      let fx = ((x + 0.5) * sw) / dw - 0.5
      fx = Math.max(0, Math.min(sw - 1, fx))
      const x0 = Math.floor(fx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const tx = fx - x0
      const a = src[y0 * sw + x0]
      const b = src[y0 * sw + x1]
      const c = src[y1 * sw + x0]
      const d = src[y1 * sw + x1]
      dst[y * dw + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
    }
  }
  return dst
}
