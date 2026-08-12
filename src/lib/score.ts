// 図案の品質スコア
//
// 「元画像にどれだけ忠実か」を1つの数値（0-100）にまとめる。
// おまかせ自動調整（autoAdjust.ts）の探索の目的関数であり、
// MCP サーバー経由で Claude が調整の良し悪しを判断する材料でもある。
//
// 設計方針:
// - 忠実度: セル代表色（ディザ前の target）と選ばれたビーズ色の ΔE2000。
//   ただしセル単体ではなく六角近傍（自セル+隣接6）の平均 Lab 同士を比較する。
//   ディザリングは1セル単位では誤差が大きく見えるが、近傍平均では相殺されるため
//   公平に評価できる
// - ディテール: 近傍との明度差（ΔL 構造)が図案でも保たれているか。
//   コントラストを潰すと ΔE は下がるが構造が消える「もやし化」への対抗項
// - L レンジ: 手持ちパレットの明度幅をどれだけ使えているか
// - ペナルティ: 使用色数過少・空きマス率の異常・輪郭の暴走
//
// すべて決定的。559 セルではサブミリ秒で完了する。

import type { Lab } from './colorspace'
import { deltaE2000, srgbToLab } from './colorspace'
import type { GridSpec } from './grid'
import type { BeadColor } from './palette'
import type { Pattern } from './pattern'
import { EMPTY_CELL } from './pattern'
import type { CellStats } from './quantize'
import { hexNeighbors } from './quantize'

export interface QualityScore {
  /** 総合スコア 0-100（高いほど良い）。決定的 */
  total: number
  /** 近傍平均 ΔE2000 の平均（置きセルのみ） */
  meanDeltaE: number
  /** 同 90 パーセンタイル */
  p90DeltaE: number
  /** 明度構造の保存度 0-1 */
  detail: number
  /** 手持ちパレットの L レンジ活用率 0-1 */
  lRangeUsed: number
  /** 実際に使われた色数 */
  colorsUsed: number
  /** 空きマスの割合 0-1 */
  emptyRatio: number
  /** 輪郭ビーズの割合（置きセル中） 0-1 */
  outlineRatio: number
  /** 減点の内訳（デバッグ・表示用） */
  penalties: { name: string; value: number }[]
}

// スコアの重み。探索の質に効くので調整しやすいよう export しておく
export const SCORE_WEIGHTS = {
  meanDeltaE: 2.2,
  p90DeltaE: 0.8,
  detail: 25,
  lRange: 10,
  fewColors: 15,
  emptyExtreme: 20,
  outlineFlood: 15,
}

interface CellRef {
  row: number
  col: number
  /** 近傍平均 Lab（元画像側） */
  targetLab: Lab
  /** 近傍平均 Lab（ビーズ側） */
  chosenLab: Lab
  /** 自セル単体の L（元画像側 / ビーズ側） */
  targetL: number
  chosenL: number
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))
  return sortedAsc[idx]
}

/** pattern と stats（imageToPatternWithStats の出力）から品質スコアを計算する */
export function scorePattern(
  pattern: Pattern,
  stats: CellStats,
  palette: BeadColor[],
  spec: GridSpec,
): QualityScore {
  const paletteLabs = palette.map((c) => srgbToLab(c.rgb))

  // セルごとの Lab（target は null あり）
  const targetLabs: (Lab | null)[][] = stats.targets.map((line) =>
    line.map((t) => (t ? srgbToLab(t) : null)),
  )
  const chosenLabs: (Lab | null)[][] = pattern.cells.map((line) =>
    line.map((idx) => (idx === EMPTY_CELL ? null : paletteLabs[idx])),
  )

  let totalCellCount = 0
  let emptyCount = 0
  let outlineCount = 0
  const usedColors = new Set<number>()
  const cells: CellRef[] = []

  for (let row = 0; row < pattern.cells.length; row++) {
    for (let col = 0; col < pattern.cells[row].length; col++) {
      totalCellCount++
      const idx = pattern.cells[row][col]
      if (idx === EMPTY_CELL) {
        emptyCount++
        continue
      }
      usedColors.add(idx)
      if (stats.outlineCells[row][col]) {
        outlineCount++
        continue // 輪郭は意図的な上書きなので忠実度評価から除外
      }
      const t = targetLabs[row][col]
      if (!t) continue

      // 六角近傍平均（自セル + 有効な隣接セル）。target/chosen 両方が
      // 存在するセルだけを対にして混ぜる（比較の対称性を保つ）
      let tL = t.L
      let ta = t.a
      let tb = t.b
      const c0 = chosenLabs[row][col]!
      let cL = c0.L
      let ca = c0.a
      let cb = c0.b
      let n = 1
      for (const [r, c] of hexNeighbors(spec, row, col)) {
        if (r < 0 || r >= pattern.cells.length) continue
        const tn = targetLabs[r]?.[c]
        const cn = chosenLabs[r]?.[c]
        if (!tn || !cn) continue
        tL += tn.L
        ta += tn.a
        tb += tn.b
        cL += cn.L
        ca += cn.a
        cb += cn.b
        n++
      }
      cells.push({
        row,
        col,
        targetLab: { L: tL / n, a: ta / n, b: tb / n },
        chosenLab: { L: cL / n, a: ca / n, b: cb / n },
        targetL: t.L,
        chosenL: c0.L,
      })
    }
  }

  const placedCount = totalCellCount - emptyCount
  const emptyRatio = totalCellCount > 0 ? emptyCount / totalCellCount : 0
  const outlineRatio = placedCount > 0 ? outlineCount / placedCount : 0

  // --- 忠実度: 近傍平均 ΔE2000 ---
  const des = cells.map((c) => deltaE2000(c.targetLab, c.chosenLab))
  const meanDeltaE = des.length > 0 ? des.reduce((s, d) => s + d, 0) / des.length : 0
  const p90DeltaE = percentile([...des].sort((a, b) => a - b), 0.9)

  // --- ディテール: 隣接セルとの ΔL 構造の保存度 ---
  // 各セルと隣接セルの明度差が、元画像と図案でどれだけ一致するか。
  // 差の食い違いを K で正規化して 0-1 に落とす
  const K = 25
  let detail = 1
  {
    const cellMap = new Map<string, CellRef>()
    for (const c of cells) cellMap.set(`${c.row}:${c.col}`, c)
    let acc = 0
    let n = 0
    for (const c of cells) {
      for (const [r, cc] of hexNeighbors(spec, c.row, c.col)) {
        const nb = cellMap.get(`${r}:${cc}`)
        if (!nb) continue
        const dTarget = c.targetL - nb.targetL
        const dChosen = c.chosenL - nb.chosenL
        acc += Math.abs(dTarget - dChosen)
        n++
      }
    }
    if (n > 0) detail = Math.max(0, 1 - acc / n / K)
  }

  // --- L レンジ活用率 ---
  let lRangeUsed = 1
  {
    let minPal = Infinity
    let maxPal = -Infinity
    for (const lab of paletteLabs) {
      if (lab.L < minPal) minPal = lab.L
      if (lab.L > maxPal) maxPal = lab.L
    }
    const span = maxPal - minPal
    if (span > 1 && cells.length > 0) {
      const ls = cells.map((c) => c.chosenL).sort((a, b) => a - b)
      const used = percentile(ls, 0.95) - percentile(ls, 0.05)
      lRangeUsed = Math.max(0, Math.min(1, used / span))
    }
  }

  // --- ペナルティ ---
  const penalties: { name: string; value: number }[] = []
  const minColors = Math.min(4, palette.length)
  if (placedCount > 0 && usedColors.size < minColors) {
    penalties.push({
      name: 'few-colors',
      value: SCORE_WEIGHTS.fewColors * (minColors - usedColors.size),
    })
  }
  if (emptyRatio > 0.85) {
    penalties.push({ name: 'mostly-empty', value: SCORE_WEIGHTS.emptyExtreme })
  }
  if (outlineRatio > 0.3) {
    penalties.push({
      name: 'outline-flood',
      value: SCORE_WEIGHTS.outlineFlood * ((outlineRatio - 0.3) / 0.7 + 0.5),
    })
  }

  const penaltySum = penalties.reduce((s, p) => s + p.value, 0)
  const raw =
    100 -
    SCORE_WEIGHTS.meanDeltaE * meanDeltaE -
    SCORE_WEIGHTS.p90DeltaE * p90DeltaE -
    SCORE_WEIGHTS.detail * (1 - detail) -
    SCORE_WEIGHTS.lRange * (1 - lRangeUsed) -
    penaltySum

  return {
    total: Math.max(0, Math.min(100, raw)),
    meanDeltaE,
    p90DeltaE,
    detail,
    lRangeUsed,
    colorsUsed: usedColors.size,
    emptyRatio,
    outlineRatio,
    penalties,
  }
}
