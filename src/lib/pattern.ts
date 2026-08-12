// 図案データ型と集計

import type { GridSpec } from './grid'
import { rowLength } from './grid'
import type { BeadColor } from './palette'

export interface Pattern {
  spec: GridSpec
  /** 使用パレット（手持ち色でフィルタ済み） */
  palette: BeadColor[]
  /** 行ごとのセル配列。値は palette への index。行の長さは rowLength(spec, row) と一致する */
  cells: number[][]
}

export interface BeadCount {
  color: BeadColor
  count: number
}

/** 色別の必要ビーズ数（使用数の多い順） */
export function countBeads(pattern: Pattern): BeadCount[] {
  const counts = new Array<number>(pattern.palette.length).fill(0)
  for (const row of pattern.cells) {
    for (const idx of row) counts[idx]++
  }
  return counts
    .map((count, i) => ({ color: pattern.palette[i], count }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
}

export function totalBeads(pattern: Pattern): number {
  return pattern.cells.reduce((sum, row) => sum + row.length, 0)
}

/** cells の形が spec と一致しているか（テスト・デバッグ用） */
export function isValidPattern(pattern: Pattern): boolean {
  if (pattern.cells.length !== pattern.spec.rows) return false
  return pattern.cells.every((row, r) => row.length === rowLength(pattern.spec, r))
}
