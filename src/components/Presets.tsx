// 被写体タイプ別プリセット（人物 / ロゴ・イラスト / 風景）

import type { ConvertOptions } from './GridSettings'
import type { IllustOptions } from './IllustSettings'

export interface Preset {
  id: string
  label: string
  illust: IllustOptions
  options: ConvertOptions
}

export const PRESETS: Preset[] = [
  {
    id: 'portrait',
    label: '人物',
    illust: {
      background: 'auto',
      autoZoom: true,
      posterize: true,
      colors: 10,
      smooth: true,
      smoothRadius: 2,
      outline: true,
      outlineStrength: 40,
      emptyBelow: 0.35,
    },
    options: { deltaE: 'ciede2000', repColor: 'median', dither: false },
  },
  {
    id: 'logo',
    label: 'ロゴ・イラスト',
    illust: {
      background: 'simple',
      autoZoom: true,
      posterize: true,
      colors: 6,
      smooth: false,
      smoothRadius: 2,
      outline: false,
      outlineStrength: 50,
      emptyBelow: 0.35,
    },
    options: { deltaE: 'ciede2000', repColor: 'mode', dither: false },
  },
  {
    id: 'landscape',
    label: '風景',
    illust: {
      background: 'none',
      autoZoom: false,
      posterize: true,
      colors: 12,
      smooth: true,
      smoothRadius: 2,
      outline: false,
      outlineStrength: 50,
      emptyBelow: 0.35,
    },
    options: { deltaE: 'ciede2000', repColor: 'median', dither: true },
  },
]

function matches(preset: Preset, illust: IllustOptions, options: ConvertOptions): boolean {
  // キー順に依存しないようフィールド単位で比較する
  const il = Object.entries(preset.illust).every(
    ([k, v]) => illust[k as keyof IllustOptions] === v,
  )
  const op = Object.entries(preset.options).every(
    ([k, v]) => options[k as keyof ConvertOptions] === v,
  )
  return il && op
}

interface Props {
  illust: IllustOptions
  options: ConvertOptions
  onApply: (preset: Preset) => void
}

export function PresetChips({ illust, options, onApply }: Props) {
  return (
    <div className="field" style={{ marginTop: 14 }}>
      <div className="field-label">プリセット</div>
      <div className="chip-row">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="chip"
            aria-pressed={matches(p, illust, options)}
            onClick={() => onApply(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
