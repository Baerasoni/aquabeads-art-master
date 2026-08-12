// 設定の localStorage 永続化
//
// adjust / illust / options / spec を1キーにまとめて保存する。
// 読み込みはフィールド単位で検証し、欠損・型不正は既定値で補う
// （バージョンアップでフィールドが増えても古い保存データから移行できる）。

import type { GridSpec } from './grid'
import { STANDARD_TRAY } from './grid'
import type { BackgroundMode } from './pipeline'
import type { DeltaEMethod } from './colorspace'
import type { RepColorMethod } from './quantize'

// components からも lib からも使うため、UI 側の型と同じ形をここに定義する
// （lib → components の依存を作らない）
export interface PersistedAdjust {
  brightness: number
  contrast: number
  saturation: number
}

export interface PersistedIllust {
  background: BackgroundMode
  autoZoom: boolean
  posterize: boolean
  colors: number
  smooth: boolean
  smoothRadius: number
  outline: boolean
  outlineStrength: number
  emptyBelow: number
}

export interface PersistedConvert {
  deltaE: DeltaEMethod
  repColor: RepColorMethod
  dither: boolean
}

export interface PersistedSettings {
  v: 1
  adjust: PersistedAdjust
  illust: PersistedIllust
  options: PersistedConvert
  spec: GridSpec
}

export const SETTINGS_KEY = 'aqua.settings.v1'

export const DEFAULT_SETTINGS: PersistedSettings = {
  v: 1,
  adjust: { brightness: 100, contrast: 100, saturation: 100 },
  illust: {
    background: 'auto',
    autoZoom: true,
    posterize: true,
    colors: 8,
    smooth: true,
    smoothRadius: 2,
    outline: true,
    outlineStrength: 50,
    emptyBelow: 0.35,
  },
  options: { deltaE: 'ciede2000', repColor: 'median', dither: false },
  spec: STANDARD_TRAY,
}

const num = (v: unknown, def: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def

const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def)

const oneOf = <T extends string>(v: unknown, values: readonly T[], def: T): T =>
  typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : def

/** 未知の JSON を検証しつつ PersistedSettings に正規化する */
export function sanitizeSettings(raw: unknown): PersistedSettings {
  const d = DEFAULT_SETTINGS
  const o = (raw ?? {}) as Record<string, unknown>
  const adjust = (o.adjust ?? {}) as Record<string, unknown>
  const illust = (o.illust ?? {}) as Record<string, unknown>
  const options = (o.options ?? {}) as Record<string, unknown>
  const spec = (o.spec ?? {}) as Record<string, unknown>
  return {
    v: 1,
    adjust: {
      brightness: num(adjust.brightness, d.adjust.brightness, 40, 160),
      contrast: num(adjust.contrast, d.adjust.contrast, 40, 160),
      saturation: num(adjust.saturation, d.adjust.saturation, 40, 160),
    },
    illust: {
      background: oneOf(illust.background, ['none', 'auto', 'simple'], d.illust.background),
      autoZoom: bool(illust.autoZoom, d.illust.autoZoom),
      posterize: bool(illust.posterize, d.illust.posterize),
      colors: Math.round(num(illust.colors, d.illust.colors, 3, 16)),
      smooth: bool(illust.smooth, d.illust.smooth),
      smoothRadius: Math.round(num(illust.smoothRadius, d.illust.smoothRadius, 1, 4)),
      outline: bool(illust.outline, d.illust.outline),
      outlineStrength: num(illust.outlineStrength, d.illust.outlineStrength, 0, 100),
      emptyBelow: num(illust.emptyBelow, d.illust.emptyBelow, 0.05, 0.8),
    },
    options: {
      deltaE: oneOf(options.deltaE, ['ciede2000', 'cie76'], d.options.deltaE),
      repColor: oneOf(options.repColor, ['median', 'mean', 'mode'], d.options.repColor),
      dither: bool(options.dither, d.options.dither),
    },
    spec: {
      rows: Math.round(num(spec.rows, d.spec.rows, 2, 80)),
      cols: Math.round(num(spec.cols, d.spec.cols, 2, 80)),
      longFirst: bool(spec.longFirst, d.spec.longFirst),
    },
  }
}

/** 保存済み設定を読む。保存がない・壊れている場合は null */
export function loadSettings(): PersistedSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return null
    return sanitizeSettings(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveSettings(s: PersistedSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // ストレージ不可（プライベートモード等）は黙って諦める
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY)
  } catch {
    // 同上
  }
}
