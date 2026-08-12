// 図案化のための前処理（すべて UI 非依存の純関数）
//
// - kuwahara:                エッジ保存平滑化。面をフラットにしてイラスト感を出す
// - posterizeKMeans:         Lab 空間の k-means 減色（決定的初期化。乱数不使用）
// - removeBackgroundSimple:  四隅の色を種にした簡易背景除去（単色背景向け）
// - cropToSubject:           不透明領域の外接矩形で切り出し（被写体ズーム）
// - sobelMagnitude:          輝度勾配マップ（輪郭ビーズ判定用）

import type { RGB } from './colorspace'
import { srgbToLab } from './colorspace'
import type { ImageLike } from './quantize'

function makeImage(width: number, height: number): ImageLike {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

/** エッジ保存平滑化（Kuwahara フィルタ）。alpha は変更しない */
export function kuwahara(image: ImageLike, radius = 2): ImageLike {
  const { width: w, height: h, data: src } = image
  const out = makeImage(w, h)
  const dst = out.data

  // 輝度の事前計算
  const luma = new Float32Array(w * h)
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    luma[i] = 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2]
  }

  // 4象限（原点含む r+1 × r+1 窓）。全画素で回る最内ループのため、
  // イテレータ + 分割代入を避けてフラット配列 + インデックスで持つ
  const qx0 = [-radius, 0, -radius, 0]
  const qx1 = [0, radius, 0, radius]
  const qy0 = [-radius, -radius, 0, 0]
  const qy1 = [0, 0, radius, radius]

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let bestVar = Infinity
      let bR = 0
      let bG = 0
      let bB = 0
      for (let q = 0; q < 4; q++) {
        const dx0 = qx0[q]
        const dx1 = qx1[q]
        const dy0 = qy0[q]
        const dy1 = qy1[q]
        let n = 0
        let sum = 0
        let sum2 = 0
        let r = 0
        let g = 0
        let b = 0
        for (let dy = dy0; dy <= dy1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = dx0; dx <= dx1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            const i = yy * w + xx
            const p = i * 4
            // 透明画素の「隠れ RGB」（背景除去後に残る背景色）を混入させない
            if (src[p + 3] < 128) continue
            const l = luma[i]
            sum += l
            sum2 += l * l
            r += src[p]
            g += src[p + 1]
            b += src[p + 2]
            n++
          }
        }
        if (n === 0) continue
        const mean = sum / n
        const variance = sum2 / n - mean * mean
        if (variance < bestVar) {
          bestVar = variance
          bR = r / n
          bG = g / n
          bB = b / n
        }
      }
      const p = (y * w + x) * 4
      if (bestVar === Infinity) {
        // 全象限が透明画素のみ: 元の画素をそのまま出力
        dst[p] = src[p]
        dst[p + 1] = src[p + 1]
        dst[p + 2] = src[p + 2]
      } else {
        dst[p] = bR
        dst[p + 1] = bG
        dst[p + 2] = bB
      }
      dst[p + 3] = src[p + 3]
    }
  }
  return out
}

/**
 * Lab 空間 k-means による減色（ポスタリゼーション）。
 * 初期値は輝度分位点（決定的）。透明画素（alpha<128）は対象外でそのまま残す。
 */
export function posterizeKMeans(image: ImageLike, k: number, maxIter = 12): ImageLike {
  const { width: w, height: h, data: src } = image
  const out = makeImage(w, h)
  out.data.set(src)
  if (k < 2) return out

  // 不透明画素をストライドサンプリング（最大 16384 点）
  const opaqueIdx = new Int32Array(w * h)
  let opaqueCount = 0
  for (let i = 0; i < w * h; i++) {
    if (src[i * 4 + 3] >= 128) opaqueIdx[opaqueCount++] = i
  }
  if (opaqueCount === 0) return out
  const stride = Math.max(1, Math.floor(opaqueCount / 16384))
  const samples: { lab: { L: number; a: number; b: number }; rgb: RGB }[] = []
  for (let s = 0; s < opaqueCount; s += stride) {
    const p = opaqueIdx[s] * 4
    const rgb: RGB = [src[p], src[p + 1], src[p + 2]]
    samples.push({ lab: srgbToLab(rgb), rgb })
  }

  // 初期セントロイド: 輝度でソートして分位点を取る（決定的）
  const sorted = [...samples].sort((a, b) => a.lab.L - b.lab.L)
  const centroids: { L: number; a: number; b: number }[] = []
  for (let c = 0; c < k; c++) {
    const idx = Math.min(sorted.length - 1, Math.floor(((c + 0.5) / k) * sorted.length))
    centroids.push({ ...sorted[idx].lab })
  }

  const assign = new Array<number>(samples.length).fill(0)
  const assignAll = () => {
    let changed = false
    for (let s = 0; s < samples.length; s++) {
      const lab = samples[s].lab
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < k; c++) {
        const dl = lab.L - centroids[c].L
        const da = lab.a - centroids[c].a
        const db = lab.b - centroids[c].b
        const d = dl * dl + da * da + db * db
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (assign[s] !== best) {
        assign[s] = best
        changed = true
      }
    }
    return changed
  }
  let converged = false
  for (let iter = 0; iter < maxIter; iter++) {
    if (!assignAll()) {
      converged = true
      break
    }
    const acc = Array.from({ length: k }, () => ({ L: 0, a: 0, b: 0, n: 0 }))
    for (let s = 0; s < samples.length; s++) {
      const a = acc[assign[s]]
      a.L += samples[s].lab.L
      a.a += samples[s].lab.a
      a.b += samples[s].lab.b
      a.n++
    }
    for (let c = 0; c < k; c++) {
      if (acc[c].n > 0) {
        centroids[c] = { L: acc[c].L / acc[c].n, a: acc[c].a / acc[c].n, b: acc[c].b / acc[c].n }
      }
    }
  }
  // maxIter 到達時はセントロイド更新が最終代入より後になるため、最終状態で取り直す
  // （収束で抜けた場合は代入済みで再実行しても変化しないため省く）
  if (!converged) assignAll()

  // 各クラスタの代表 RGB（クラスタ内平均）
  const rgbAcc = Array.from({ length: k }, () => ({ r: 0, g: 0, b: 0, n: 0 }))
  for (let s = 0; s < samples.length; s++) {
    const a = rgbAcc[assign[s]]
    a.r += samples[s].rgb[0]
    a.g += samples[s].rgb[1]
    a.b += samples[s].rgb[2]
    a.n++
  }
  const centroidRgb: RGB[] = rgbAcc.map((a, c) => {
    if (a.n > 0) return [Math.round(a.r / a.n), Math.round(a.g / a.n), Math.round(a.b / a.n)]
    // 空クラスタ: L からグレー近似（Lab の a=b=0 は無彩色）
    const v = Math.max(0, Math.min(255, Math.round(centroids[c].L * 2.55)))
    return [v, v, v] as RGB
  })

  // 全不透明画素を最近傍セントロイドに置換（5bit 量子化キーの LUT でキャッシュ。
  // キーは 15bit なので Map より固定長 Int16Array の方が速い。-1 = 未計算）
  const cache = new Int16Array(32768).fill(-1)
  for (let s = 0; s < opaqueCount; s++) {
    const p = opaqueIdx[s] * 4
    const key = ((src[p] >> 3) << 10) | ((src[p + 1] >> 3) << 5) | (src[p + 2] >> 3)
    let c = cache[key]
    if (c < 0) {
      const lab = srgbToLab([src[p], src[p + 1], src[p + 2]])
      let bestD = Infinity
      c = 0
      for (let j = 0; j < k; j++) {
        const dl = lab.L - centroids[j].L
        const da = lab.a - centroids[j].a
        const db = lab.b - centroids[j].b
        const d = dl * dl + da * da + db * db
        if (d < bestD) {
          bestD = d
          c = j
        }
      }
      cache[key] = c
    }
    out.data[p] = centroidRgb[c][0]
    out.data[p + 1] = centroidRgb[c][1]
    out.data[p + 2] = centroidRgb[c][2]
  }
  return out
}

/**
 * 簡易背景除去: 画像の四隅の色を「背景色の種」とし、
 * 種に近い色（Lab 距離 < tolerance）の画素を外周から連結探索して透明化する。
 * 単色〜ゆるいグラデーション背景向け。
 */
export function removeBackgroundSimple(image: ImageLike, tolerance = 18): ImageLike {
  const { width: w, height: h, data: src } = image
  const out = makeImage(w, h)
  out.data.set(src)

  // 四隅 3×3 の平均色を種にする
  const seeds: { L: number; a: number; b: number }[] = []
  const cornerAvg = (cx: number, cy: number) => {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const x = Math.min(w - 1, Math.max(0, cx + dx))
        const y = Math.min(h - 1, Math.max(0, cy + dy))
        const p = (y * w + x) * 4
        r += src[p]
        g += src[p + 1]
        b += src[p + 2]
        n++
      }
    }
    return srgbToLab([Math.round(r / n), Math.round(g / n), Math.round(b / n)])
  }
  seeds.push(cornerAvg(0, 0), cornerAvg(w - 3, 0), cornerAvg(0, h - 3), cornerAvg(w - 3, h - 3))

  // Lab 変換を画素ごとに繰り返さないよう、色（24bit RGB）単位で判定結果をキャッシュする。
  // 距離は 2 乗のまま比較して sqrt を省く（sqrt(x) < t ⇔ x < t²）
  const tol2 = tolerance * tolerance
  const bgColorCache = new Map<number, boolean>()
  const isBgColor = (p: number) => {
    const key = (src[p] << 16) | (src[p + 1] << 8) | src[p + 2]
    const cached = bgColorCache.get(key)
    if (cached !== undefined) return cached
    const lab = srgbToLab([src[p], src[p + 1], src[p + 2]])
    let isBg = false
    for (const s of seeds) {
      const dl = lab.L - s.L
      const da = lab.a - s.a
      const db = lab.b - s.b
      if (dl * dl + da * da + db * db < tol2) {
        isBg = true
        break
      }
    }
    bgColorCache.set(key, isBg)
    return isBg
  }

  // 外周の背景色画素から BFS（背景色でも被写体に囲まれた領域は残る）。
  // visited は enqueue 時に立て、同じ画素を複数回キューに積まない
  const visited = new Uint8Array(w * h)
  const queue: number[] = []
  const enqueue = (i: number) => {
    if (!visited[i]) {
      visited[i] = 1
      queue.push(i)
    }
  }
  for (let x = 0; x < w; x++) {
    enqueue(x)
    enqueue((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    enqueue(y * w)
    enqueue(y * w + w - 1)
  }
  const bg = new Uint8Array(w * h)
  while (queue.length > 0) {
    const i = queue.pop()!
    if (!isBgColor(i * 4)) continue
    bg[i] = 1
    const x = i % w
    const y = (i / w) | 0
    if (x > 0) enqueue(i - 1)
    if (x < w - 1) enqueue(i + 1)
    if (y > 0) enqueue(i - w)
    if (y < h - 1) enqueue(i + w)
  }
  for (let i = 0; i < w * h; i++) {
    if (bg[i]) out.data[i * 4 + 3] = 0
  }
  return out
}

/** 不透明領域の外接矩形 + マージンで切り出す。被写体がなければそのまま返す */
export function cropToSubject(image: ImageLike, alphaMin = 128, margin = 0.08): ImageLike {
  const { width: w, height: h, data: src } = image
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[(y * w + x) * 4 + 3] >= alphaMin) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0 || x1 - x0 < 4 || y1 - y0 < 4) return image

  const m = Math.round(Math.max(x1 - x0, y1 - y0) * margin)
  x0 = Math.max(0, x0 - m)
  y0 = Math.max(0, y0 - m)
  x1 = Math.min(w - 1, x1 + m)
  y1 = Math.min(h - 1, y1 + m)

  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1
  const out = makeImage(cw, ch)
  for (let y = 0; y < ch; y++) {
    const srcOff = ((y + y0) * w + x0) * 4
    out.data.set(src.subarray(srcOff, srcOff + cw * 4), y * cw * 4)
  }
  return out
}

/**
 * Sobel 勾配強度マップ（0..1 正規化）。
 * 透明画素は白として扱う（シルエット境界は輪郭判定側で別途処理する前提）。
 */
export function sobelMagnitude(image: ImageLike): Float32Array {
  const { width: w, height: h, data: src } = image
  const luma = new Float32Array(w * h)
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    const a = src[p + 3] / 255
    const wl = 255 * (1 - a)
    luma[i] =
      0.299 * (src[p] * a + wl) + 0.587 * (src[p + 1] * a + wl) + 0.114 * (src[p + 2] * a + wl)
  }
  const out = new Float32Array(w * h)
  const MAX_MAG = Math.hypot(4 * 255, 4 * 255)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx =
        -luma[i - w - 1] + luma[i - w + 1] - 2 * luma[i - 1] + 2 * luma[i + 1] - luma[i + w - 1] + luma[i + w + 1]
      const gy =
        -luma[i - w - 1] - 2 * luma[i - w] - luma[i - w + 1] + luma[i + w - 1] + 2 * luma[i + w] + luma[i + w + 1]
      out[i] = Math.hypot(gx, gy) / MAX_MAG
    }
  }
  return out
}
