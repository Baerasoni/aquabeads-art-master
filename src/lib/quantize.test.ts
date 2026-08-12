import { describe, expect, it } from 'vitest'
import { AQUA_PALETTE, beadColorById } from './palette'
import { STANDARD_TRAY, totalCells } from './grid'
import type { ImageLike, RepColorMethod } from './quantize'
import { imageToPattern, representativeColor } from './quantize'
import { countBeads, isValidPattern, totalBeads } from './pattern'

const METHODS: RepColorMethod[] = ['mean', 'median', 'mode']

function solidImage(w: number, h: number, rgb: [number, number, number]): ImageLike {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0]
    data[i + 1] = rgb[1]
    data[i + 2] = rgb[2]
    data[i + 3] = 255
  }
  return { width: w, height: h, data }
}

describe.each(METHODS)('representativeColor (%s)', (method) => {
  it('全部同じ色ならその色', () => {
    const px: [number, number, number][] = [
      [10, 20, 30],
      [10, 20, 30],
      [10, 20, 30],
    ]
    expect(representativeColor(px, method)).toEqual([10, 20, 30])
  })

  it('1画素だけでも動く', () => {
    expect(representativeColor([[200, 100, 50]], method)).toEqual([200, 100, 50])
  })

  it('外れ値1個に引きずられて全く別の色にならない', () => {
    const px: [number, number, number][] = []
    for (let i = 0; i < 9; i++) px.push([200, 0, 0])
    px.push([0, 0, 200]) // 外れ値
    const [r, , b] = representativeColor(px, method)
    expect(r).toBeGreaterThan(b)
  })

  it('空配列はエラー', () => {
    expect(() => representativeColor([], method)).toThrow()
  })
})

describe('representativeColor: 方式ごとの性質', () => {
  // 多数派 128 + 少数派 255 → 中央値・最頻は多数派を、平均は中間を返す
  const px: [number, number, number][] = []
  for (let i = 0; i < 7; i++) px.push([128, 128, 128])
  for (let i = 0; i < 3; i++) px.push([255, 255, 255])

  it('median / mode は多数派の色そのもの', () => {
    expect(representativeColor(px, 'median')).toEqual([128, 128, 128])
    expect(representativeColor(px, 'mode')).toEqual([128, 128, 128])
  })

  it('mean は中間の色', () => {
    const [r] = representativeColor(px, 'mean')
    expect(r).toBeGreaterThan(128)
    expect(r).toBeLessThan(255)
  })
})

describe('imageToPattern', () => {
  it.each(METHODS)('赤一色の画像 → 全セル「あか」559個（repColor=%s）', (repColor) => {
    const image = solidImage(200, 200, [231, 0, 18])
    const pattern = imageToPattern(image, STANDARD_TRAY, AQUA_PALETTE, { repColor })
    expect(isValidPattern(pattern)).toBe(true)
    expect(totalBeads(pattern)).toBe(totalCells(STANDARD_TRAY))

    const counts = countBeads(pattern)
    expect(counts).toHaveLength(1)
    expect(counts[0].color.name).toBe('あか')
    expect(counts[0].count).toBe(559)
  })

  it.each(['cie76', 'ciede2000'] as const)('ΔE方式 %s でも赤一色は「あか」', (de) => {
    const image = solidImage(120, 120, [231, 0, 18])
    const pattern = imageToPattern(image, STANDARD_TRAY, AQUA_PALETTE, { deltaE: de })
    expect(countBeads(pattern)[0].color.name).toBe('あか')
  })

  it('左右2色の画像 → 左右で色が分かれる', () => {
    const image = solidImage(220, 226, [231, 0, 18])
    // 右半分を「あお」に
    for (let y = 0; y < 226; y++) {
      for (let x = 110; x < 220; x++) {
        const i = (y * 220 + x) * 4
        image.data[i] = 0
        image.data[i + 1] = 122
        image.data[i + 2] = 196
      }
    }
    const pattern = imageToPattern(image, STANDARD_TRAY, AQUA_PALETTE)
    const row = pattern.cells[12]
    expect(pattern.palette[row[0]].name).toBe('あか')
    expect(pattern.palette[row[row.length - 1]].name).toBe('あお')
  })

  it('ディザリング: 灰色一色 + 白黒パレット → 両方の色が混ざる', () => {
    const image = solidImage(200, 200, [128, 128, 128])
    const bw = [beadColorById('m14')!, beadColorById('m16')!] // しろ / くろ
    const flat = imageToPattern(image, STANDARD_TRAY, bw, { dither: false })
    const dithered = imageToPattern(image, STANDARD_TRAY, bw, { dither: true })

    // ディザなし: 全セルが同じ色に潰れる
    expect(countBeads(flat)).toHaveLength(1)
    // ディザあり: 白と黒が混ざり、合計は総マス数のまま
    const counts = countBeads(dithered)
    expect(counts).toHaveLength(2)
    expect(counts.reduce((s, c) => s + c.count, 0)).toBe(559)
    expect(isValidPattern(dithered)).toBe(true)
  })

  it('空パレットはエラー', () => {
    const image = solidImage(10, 10, [0, 0, 0])
    expect(() => imageToPattern(image, STANDARD_TRAY, [])).toThrow()
  })

  // cover 配置の回帰テスト: グリッド比と大きく異なる画像でも全セルが画像内から採色される
  it('横長パノラマ（330×110・左右に別色）→ 左右はクロップされ中央の色1色になる', () => {
    const image = solidImage(330, 110, [244, 244, 244]) // しろ
    for (let y = 0; y < 110; y++) {
      for (let x = 0; x < 330; x++) {
        if (x >= 110 && x < 220) continue
        const i = (y * 330 + x) * 4
        const c = x < 110 ? [231, 0, 18] : [0, 122, 196] // 左:あか / 右:あお
        image.data[i] = c[0]
        image.data[i + 1] = c[1]
        image.data[i + 2] = c[2]
      }
    }
    const counts = countBeads(imageToPattern(image, STANDARD_TRAY, AQUA_PALETTE))
    expect(counts).toHaveLength(1)
    expect(counts[0].color.name).toBe('しろ')
    expect(counts[0].count).toBe(559)
  })

  it('縦長画像（110×330・上下に別色）→ 上下はクロップされ中央の色1色になる', () => {
    const image = solidImage(110, 330, [244, 244, 244])
    for (let y = 0; y < 330; y++) {
      if (y >= 110 && y < 220) continue
      for (let x = 0; x < 110; x++) {
        const i = (y * 110 + x) * 4
        const c = y < 110 ? [231, 0, 18] : [0, 122, 196]
        image.data[i] = c[0]
        image.data[i + 1] = c[1]
        image.data[i + 2] = c[2]
      }
    }
    const counts = countBeads(imageToPattern(image, STANDARD_TRAY, AQUA_PALETTE))
    expect(counts).toHaveLength(1)
    expect(counts[0].color.name).toBe('しろ')
  })

  // 透過 PNG の回帰テスト: 透明画素は白背景に合成される（くろビーズ化しない）
  it('全面透過の画像 → 「くろ」ではなく「しろ」になる', () => {
    const image: ImageLike = {
      width: 50,
      height: 50,
      data: new Uint8ClampedArray(50 * 50 * 4), // 全画素 (0,0,0,0)
    }
    const counts = countBeads(imageToPattern(image, STANDARD_TRAY, AQUA_PALETTE))
    expect(counts).toHaveLength(1)
    expect(counts[0].color.name).toBe('しろ')
  })
})
