// 図案データ型と集計

import type { GridSpec } from './grid'
import { rowLength } from './grid'
import type { BeadColor } from './palette'

/** ビーズを置かない空きマス（背景除去された領域など） */
export const EMPTY_CELL = -1

export interface Pattern {
  spec: GridSpec
  /** 使用パレット（手持ち色でフィルタ済み） */
  palette: BeadColor[]
  /**
   * 行ごとのセル配列。値は palette への index、または EMPTY_CELL (-1)。
   * 行の長さは rowLength(spec, row) と一致する
   */
  cells: number[][]
}

export interface BeadCount {
  color: BeadColor
  count: number
}

/** 色別の必要ビーズ数（使用数の多い順）。空きマスは数えない */
export function countBeads(pattern: Pattern): BeadCount[] {
  const counts = new Array<number>(pattern.palette.length).fill(0)
  for (const row of pattern.cells) {
    for (const idx of row) {
      if (idx >= 0) counts[idx]++
    }
  }
  return counts
    .map((count, i) => ({ color: pattern.palette[i], count }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
}

/** 実際に置くビーズの総数（空きマスを除く） */
export function totalBeads(pattern: Pattern): number {
  return pattern.cells.reduce((sum, row) => sum + row.filter((idx) => idx >= 0).length, 0)
}

/** 空きマスの数 */
export function emptyCellCount(pattern: Pattern): number {
  return pattern.cells.reduce((sum, row) => sum + row.filter((idx) => idx < 0).length, 0)
}

/** cells の形が spec と一致し、値が有効範囲か（テスト・デバッグ用） */
export function isValidPattern(pattern: Pattern): boolean {
  if (pattern.cells.length !== pattern.spec.rows) return false
  return pattern.cells.every(
    (row, r) =>
      row.length === rowLength(pattern.spec, r) &&
      row.every((idx) => idx >= EMPTY_CELL && idx < pattern.palette.length),
  )
}
