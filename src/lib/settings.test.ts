import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings'

describe('sanitizeSettings', () => {
  it('完全な設定はそのまま通る（round-trip）', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      adjust: { brightness: 120, contrast: 80, saturation: 140 },
      illust: { ...DEFAULT_SETTINGS.illust, colors: 12, emptyBelow: 0.25 },
      options: { deltaE: 'cie76', repColor: 'mode', dither: true },
      spec: { rows: 30, cols: 24, longFirst: true },
    }
    expect(sanitizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  it('null / 空オブジェクトは既定値になる', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('欠損フィールドは既定値で補われる（旧バージョンからの移行）', () => {
    // smoothRadius / emptyBelow を持たない古い保存データ
    const old = {
      v: 1,
      adjust: { brightness: 110, contrast: 100, saturation: 100 },
      illust: { background: 'simple', colors: 6 },
      options: { dither: true },
    }
    const s = sanitizeSettings(old)
    expect(s.adjust.brightness).toBe(110)
    expect(s.illust.background).toBe('simple')
    expect(s.illust.colors).toBe(6)
    expect(s.illust.smoothRadius).toBe(2)
    expect(s.illust.emptyBelow).toBe(0.35)
    expect(s.options.dither).toBe(true)
    expect(s.spec).toEqual(DEFAULT_SETTINGS.spec)
  })

  it('型不正・範囲外はクランプまたは既定値になる', () => {
    const s = sanitizeSettings({
      adjust: { brightness: 999, contrast: 'abc', saturation: -5 },
      illust: { background: 'invalid', colors: 100, emptyBelow: 2 },
      options: { deltaE: 42, repColor: 'nope' },
      spec: { rows: 0, cols: 1000 },
    })
    expect(s.adjust.brightness).toBe(160)
    expect(s.adjust.contrast).toBe(100)
    expect(s.adjust.saturation).toBe(40)
    expect(s.illust.background).toBe('auto')
    expect(s.illust.colors).toBe(16)
    expect(s.illust.emptyBelow).toBe(0.8)
    expect(s.options.deltaE).toBe('ciede2000')
    expect(s.options.repColor).toBe('median')
    expect(s.spec.rows).toBe(2)
    expect(s.spec.cols).toBe(80)
  })
})
