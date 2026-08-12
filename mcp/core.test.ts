// ヘッドレスコア（Node / sharp 経由）の統合テスト

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { totalCells, STANDARD_TRAY } from '../src/lib/grid'
import { isValidPattern } from '../src/lib/pattern'
import { convertImage, loadImage, resolvePalette, svgToPng } from './core'

let dir: string
let imagePath: string

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'aquabeads-test-'))
  imagePath = path.join(dir, 'fixture.png')
  // 単色背景 + 赤い円のフィクスチャ
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
    <rect width="128" height="128" fill="#e0e0e8"/>
    <circle cx="64" cy="64" r="44" fill="#d03030"/>
  </svg>`
  await sharp(Buffer.from(svg)).png().toFile(imagePath)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loadImage', () => {
  it('RGBA の ImageLike を返し、長辺を maxSize 以下に縮小する', async () => {
    const img = await loadImage(imagePath, 64)
    expect(img.width).toBe(64)
    expect(img.height).toBe(64)
    expect(img.data.length).toBe(64 * 64 * 4)
  })
})

describe('convertImage', () => {
  it('有効な図案・有限なスコア・ビーズ数を返す', async () => {
    const result = await convertImage({
      imagePath,
      params: { background: 'simple' },
    })
    expect(isValidPattern(result.pattern)).toBe(true)
    expect(Number.isFinite(result.score.total)).toBe(true)
    expect(result.totalBeads + result.emptyCells).toBe(totalCells(STANDARD_TRAY))
    expect(result.beadCounts.length).toBeGreaterThan(0)
    // 赤い円なので「あか」が使われるはず
    expect(result.beadCounts.some((b) => b.color.name === 'あか')).toBe(true)
  })

  it('background auto は simple に読み替えて警告する', async () => {
    const result = await convertImage({ imagePath, params: { background: 'auto' } })
    expect(result.paramsUsed.background).toBe('simple')
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('SVG に全セル分の circle が含まれる', async () => {
    const result = await convertImage({ imagePath, params: { background: 'none' } })
    const circles = result.svg.match(/<circle /g) ?? []
    expect(circles.length).toBe(totalCells(STANDARD_TRAY))
  })

  it('svgToPng が PNG ファイルを生成する', async () => {
    const result = await convertImage({ imagePath })
    const out = await svgToPng(result.svg, path.join(dir, 'preview.png'))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBeGreaterThan(500)
  })
})

describe('resolvePalette', () => {
  it('省略時は基本16色', () => {
    expect(resolvePalette().length).toBe(16)
  })
  it('指定 ID でフィルタされる', () => {
    const p = resolvePalette(['m01', 'm16', 'unknown'])
    expect(p.map((c) => c.id)).toEqual(['m01', 'm16'])
  })
})
