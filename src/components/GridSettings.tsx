import type { DeltaEMethod } from '../lib/colorspace'
import type { GridSpec } from '../lib/grid'
import { STANDARD_TRAY, totalCells } from '../lib/grid'
import type { RepColorMethod } from '../lib/quantize'

export interface Adjust {
  brightness: number
  contrast: number
  saturation: number
}

export interface ConvertOptions {
  deltaE: DeltaEMethod
  repColor: RepColorMethod
  dither: boolean
}

interface Props {
  spec: GridSpec
  onSpec: (spec: GridSpec) => void
  adjust: Adjust
  onAdjust: (adjust: Adjust) => void
  options: ConvertOptions
  onOptions: (options: ConvertOptions) => void
}

function Segmented<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T
  onChange: (v: T) => void
  items: { value: T; label: string }[]
}) {
  return (
    <div className="segmented" role="group">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="slider-row">
      <span>{label}</span>
      <input
        type="range"
        min={40}
        max={160}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="value">{value}%</span>
    </div>
  )
}

const isStandard = (spec: GridSpec) =>
  spec.rows === STANDARD_TRAY.rows && spec.cols === STANDARD_TRAY.cols

export function GridSettings({ spec, onSpec, adjust, onAdjust, options, onOptions }: Props) {
  return (
    <section className="card reveal" aria-label="設定">
      <h2>設定</h2>

      <div className="field">
        <div className="field-label">
          トレイ <small>{totalCells(spec)} ビーズ</small>
        </div>
        <div className="chip-row">
          <button
            type="button"
            className="chip"
            aria-pressed={isStandard(spec)}
            onClick={() => onSpec(STANDARD_TRAY)}
          >
            標準ビーズトレイ
          </button>
        </div>
        <div className="grid-custom">
          <label>
            列{' '}
            <input
              type="number"
              min={2}
              max={80}
              value={spec.cols}
              onChange={(e) =>
                onSpec({ ...spec, cols: Math.max(2, Math.min(80, Number(e.target.value) || 2)) })
              }
            />
          </label>
          <span>×</span>
          <label>
            行{' '}
            <input
              type="number"
              min={2}
              max={80}
              value={spec.rows}
              onChange={(e) =>
                onSpec({ ...spec, rows: Math.max(2, Math.min(80, Number(e.target.value) || 2)) })
              }
            />
          </label>
        </div>
      </div>

      <div className="field">
        <div className="field-label">画像調整</div>
        <Slider
          label="明るさ"
          value={adjust.brightness}
          onChange={(v) => onAdjust({ ...adjust, brightness: v })}
        />
        <Slider
          label="コントラスト"
          value={adjust.contrast}
          onChange={(v) => onAdjust({ ...adjust, contrast: v })}
        />
        <Slider
          label="彩度"
          value={adjust.saturation}
          onChange={(v) => onAdjust({ ...adjust, saturation: v })}
        />
        {(adjust.brightness !== 100 || adjust.contrast !== 100 || adjust.saturation !== 100) && (
          <button
            type="button"
            className="btn-link"
            onClick={() => onAdjust({ brightness: 100, contrast: 100, saturation: 100 })}
          >
            リセット
          </button>
        )}
      </div>

      <div className="field">
        <div className="field-label">色の合わせ方（ΔE）</div>
        <Segmented
          value={options.deltaE}
          onChange={(v) => onOptions({ ...options, deltaE: v })}
          items={[
            { value: 'ciede2000', label: '高精度' },
            { value: 'cie76', label: 'シンプル' },
          ]}
        />
        <p className="field-hint">
          高精度（CIEDE2000）は人間の見え方に忠実。シンプル（CIE76）はあっさりした割り当てになります。
        </p>
      </div>

      <div className="field">
        <div className="field-label">セルの代表色</div>
        <Segmented
          value={options.repColor}
          onChange={(v) => onOptions({ ...options, repColor: v })}
          items={[
            { value: 'median', label: '中央値' },
            { value: 'mean', label: '平均' },
            { value: 'mode', label: '最頻色' },
          ]}
        />
        <p className="field-hint">
          中央値はノイズに強くバランス型。平均はなめらか、最頻色は輪郭がくっきりします。
        </p>
      </div>

      <div className="field">
        <div className="switch-row">
          <div>
            <div className="field-label" style={{ marginBottom: 2 }}>
              ディザリング
            </div>
            <p className="field-hint" style={{ marginTop: 0 }}>
              少ない色数で階調を表現します（写真向き）
            </p>
          </div>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={options.dither}
            aria-label="ディザリング"
            onClick={() => onOptions({ ...options, dither: !options.dither })}
          />
        </div>
      </div>
    </section>
  )
}
