import { describe, expect, it } from 'vitest'
import type { GridSpec } from './grid'
import { totalCells } from './grid'
import { AQUA_PALETTE } from './palette'
import type { Pattern } from './pattern'
import { countBeads, isValidPattern, totalBeads } from './pattern'

const tinySpec: GridSpec = { rows: 3, cols: 3, longFirst: false }
// 行0: 2個 / 行1: 3個 / 行2: 2個 = 7マス

function tinyPattern(): Pattern {
  return {
    spec: tinySpec,
    palette: AQUA_PALETTE.slice(0, 3), // あか / オレンジ / きいろ
    cells: [
      [0, 0],
      [1, 0, 2],
      [2, 2],
    ],
  }
}

describe('pattern', () => {
  it('tinySpec の総マス数は7', () => {
    expect(totalCells(tinySpec)).toBe(7)
  })

  it('countBeads は使用数の多い順で、合計が総マス数と一致する', () => {
    const counts = countBeads(tinyPattern())
    expect(counts.map((c) => [c.color.name, c.count])).toEqual([
      ['あか', 3],
      ['きいろ', 3],
      ['オレンジ', 1],
    ])
    const sum = counts.reduce((s, c) => s + c.count, 0)
    expect(sum).toBe(totalBeads(tinyPattern()))
  })

  it('isValidPattern は行の長さ不一致を検出する', () => {
    const bad = tinyPattern()
    bad.cells[0] = [0, 0, 0] // 行0は2個のはず
    expect(isValidPattern(bad)).toBe(false)
  })
})
