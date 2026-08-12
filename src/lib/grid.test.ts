import { describe, expect, it } from 'vitest'
import {
  BEAD_DIAMETER_MM,
  cellCenterMm,
  gridHeightMm,
  gridWidthMm,
  PITCH_MM,
  ROW_PITCH_MM,
  rowLength,
  STANDARD_TRAY,
  totalCells,
} from './grid'

describe('grid: 標準ビーズトレイ（公式シート解析値）', () => {
  it('総マス数は559', () => {
    expect(totalCells(STANDARD_TRAY)).toBe(559)
  })

  it('先頭行は21個、次の行は22個で交互', () => {
    expect(rowLength(STANDARD_TRAY, 0)).toBe(21)
    expect(rowLength(STANDARD_TRAY, 1)).toBe(22)
    expect(rowLength(STANDARD_TRAY, 25)).toBe(22)
  })

  it('短い行は半ピッチ（2.5mm）オフセットされる', () => {
    expect(cellCenterMm(STANDARD_TRAY, 0, 0).x).toBeCloseTo(PITCH_MM / 2)
    expect(cellCenterMm(STANDARD_TRAY, 1, 0).x).toBeCloseTo(0)
  })

  it('行間は 5×√3/2 ≈ 4.330mm', () => {
    expect(ROW_PITCH_MM).toBeCloseTo(4.330127, 5)
    expect(cellCenterMm(STANDARD_TRAY, 2, 0).y).toBeCloseTo(2 * ROW_PITCH_MM)
  })

  it('外形サイズは公式トレイ枠（約109×113mm）と整合する', () => {
    // 幅: 21ピッチ + ビーズ径 = 110mm / 高さ: 25行間 + ビーズ径 ≈ 113.3mm
    expect(gridWidthMm(STANDARD_TRAY)).toBeCloseTo((22 - 1) * PITCH_MM + BEAD_DIAMETER_MM)
    expect(gridHeightMm(STANDARD_TRAY)).toBeCloseTo(25 * ROW_PITCH_MM + BEAD_DIAMETER_MM, 1)
  })
})
