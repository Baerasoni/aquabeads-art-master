// 図案の SVG レンダリング（純関数）
//
// MCP サーバー / CLI がプレビュー PNG を生成するための元になる。
// UI の PatternGrid とは独立（あちらは DOM/React）。座標系は grid.ts の mm 定義
// を pxPerMm 倍しただけなので、印刷用の原寸とも相似になる。

import type { GridSpec } from './grid'
import { BEAD_DIAMETER_MM, cellCenterMm, gridHeightMm, gridWidthMm, rowLength } from './grid'
import type { Pattern } from './pattern'
import { EMPTY_CELL } from './pattern'

export interface RenderOptions {
  /** 1mm あたりのピクセル数（既定 8 → 標準トレイで約 888×924px） */
  pxPerMm?: number
  /** ビーズに色番号を印字する */
  showCodes?: boolean
  background?: 'white' | 'transparent'
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 図案を SVG 文字列にする */
export function patternToSvg(pattern: Pattern, options: RenderOptions = {}): string {
  const { pxPerMm = 8, showCodes = false, background = 'white' } = options
  const spec: GridSpec = pattern.spec
  const w = gridWidthMm(spec) * pxPerMm
  const h = gridHeightMm(spec) * pxPerMm
  const beadR = (BEAD_DIAMETER_MM / 2) * pxPerMm

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${w} ${h}">`,
  )
  if (background === 'white') {
    parts.push(`<rect width="${w}" height="${h}" fill="#ffffff"/>`)
  }
  for (let row = 0; row < spec.rows; row++) {
    for (let col = 0; col < rowLength(spec, row); col++) {
      const { x, y } = cellCenterMm(spec, row, col)
      const cx = (x + BEAD_DIAMETER_MM / 2) * pxPerMm
      const cy = (y + BEAD_DIAMETER_MM / 2) * pxPerMm
      const idx = pattern.cells[row][col]
      if (idx === EMPTY_CELL) {
        // 空きマス: 薄いリングでトレイの位置だけ示す
        parts.push(
          `<circle cx="${cx}" cy="${cy}" r="${beadR * 0.86}" fill="none" stroke="#dddddd" stroke-width="${pxPerMm * 0.12}"/>`,
        )
        continue
      }
      const color = pattern.palette[idx]
      const [r, g, b] = color.rgb
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${beadR * 0.92}" fill="rgb(${r},${g},${b})" stroke="rgba(0,0,0,0.18)" stroke-width="${pxPerMm * 0.08}"/>`,
      )
      if (showCodes) {
        // 明るい色には黒字、暗い色には白字
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        const fill = luma > 140 ? '#000000' : '#ffffff'
        parts.push(
          `<text x="${cx}" y="${cy}" font-size="${pxPerMm * 1.8}" fill="${fill}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${esc(color.code)}</text>`,
        )
      }
    }
  }
  parts.push('</svg>')
  return parts.join('')
}
