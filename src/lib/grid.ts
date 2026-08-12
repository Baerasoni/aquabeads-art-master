// 六角（オフセット）グリッドの幾何定義
//
// 公式「オリジナル用ビーズトレイシート」PDF の解析値に基づく確定仕様:
// - 横ピッチ 5.0mm、行間 5×√3/2 ≈ 4.330mm（六角密充填）
// - 行ごとに半ピッチ（2.5mm）オフセット
// - 標準ビーズトレイ: 21個の行と22個の行が交互 × 26行 = 559マス（先頭行は21個）
//
// 座標系: mm 単位。行0・「長い行」の左端ビーズの中心を x=0 とし、y=0 が行0の中心。
// 短い行は +2.5mm オフセット。

export interface GridSpec {
  rows: number
  /** 長い行の列数（短い行は cols - 1） */
  cols: number
  /** 先頭行（row 0）が長い行かどうか。標準トレイは false（先頭は21個） */
  longFirst: boolean
}

export const STANDARD_TRAY: GridSpec = { rows: 26, cols: 22, longFirst: false }

export const PITCH_MM = 5.0
export const ROW_PITCH_MM = (PITCH_MM * Math.sqrt(3)) / 2
export const BEAD_DIAMETER_MM = 5.0

export function isLongRow(spec: GridSpec, row: number): boolean {
  return (row % 2 === 0) === spec.longFirst
}

export function rowLength(spec: GridSpec, row: number): number {
  return isLongRow(spec, row) ? spec.cols : spec.cols - 1
}

export function totalCells(spec: GridSpec): number {
  let n = 0
  for (let r = 0; r < spec.rows; r++) n += rowLength(spec, r)
  return n
}

/** セル中心の mm 座標（左上の長い行の左端ビーズ中心が原点） */
export function cellCenterMm(spec: GridSpec, row: number, col: number): { x: number; y: number } {
  const x = (isLongRow(spec, row) ? 0 : PITCH_MM / 2) + col * PITCH_MM
  return { x, y: row * ROW_PITCH_MM }
}

/** ビーズ外形込みのグリッド全体の幅（mm） */
export function gridWidthMm(spec: GridSpec): number {
  return (spec.cols - 1) * PITCH_MM + BEAD_DIAMETER_MM
}

/** ビーズ外形込みのグリッド全体の高さ（mm） */
export function gridHeightMm(spec: GridSpec): number {
  return (spec.rows - 1) * ROW_PITCH_MM + BEAD_DIAMETER_MM
}
