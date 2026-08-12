import type { BackgroundMode } from '../lib/pipeline'
import { Segmented, SliderRow, SwitchRow } from './controls'

export type { BackgroundMode }

export interface IllustOptions {
  /** 背景除去: なし / AI / 単色背景（四隅の色ベース） */
  background: BackgroundMode
  /** 背景除去後、被写体をグリッドいっぱいにズーム */
  autoZoom: boolean
  /** k-means 減色でベタ塗り化 */
  posterize: boolean
  /** ベタ塗りの色数 */
  colors: number
  /** エッジ保存平滑化（Kuwahara） */
  smooth: boolean
  /** Kuwahara 半径（大きいほど強く潰す） */
  smoothRadius: number
  /** 輪郭ビーズ */
  outline: boolean
  /** 輪郭の強さ 0-100（大きいほど輪郭が増える） */
  outlineStrength: number
  /** セルを空きマスにする不透明率の下限 0.1-0.6 */
  emptyBelow: number
}

export const DEFAULT_ILLUST: IllustOptions = {
  background: 'auto',
  autoZoom: true,
  posterize: true,
  colors: 8,
  smooth: true,
  smoothRadius: 2,
  outline: true,
  outlineStrength: 50,
  emptyBelow: 0.35,
}

interface Props {
  options: IllustOptions
  onChange: (options: IllustOptions) => void
  segError: boolean
}

export function IllustSettings({ options, onChange, segError }: Props) {
  return (
    <section className="card reveal" aria-label="イラスト化">
      <h2>イラスト化</h2>

      <div className="field">
        <div className="field-label">背景</div>
        <Segmented
          value={options.background}
          onChange={(v) => onChange({ ...options, background: v })}
          items={[
            { value: 'auto', label: '自動（AI）' },
            { value: 'simple', label: '単色背景' },
            { value: 'none', label: 'なし' },
          ]}
        />
        <p className="field-hint">
          自動は被写体を AI で切り抜き（初回はモデル約4.5MBを読み込み）。単色背景は四隅の色を背景とみなします。
          背景はビーズを置かない「空きマス」になります。
        </p>
        {segError && options.background === 'auto' && (
          <p className="field-hint" style={{ color: '#b25000' }}>
            AI モデルを読み込めなかったため、背景除去なしで表示しています。
          </p>
        )}
        {options.background !== 'none' && (
          <div style={{ marginTop: 10 }}>
            <SwitchRow
              label="被写体ズーム"
              hint="切り抜いた被写体をグリッドいっぱいに配置"
              checked={options.autoZoom}
              onChange={(v) => onChange({ ...options, autoZoom: v })}
            />
          </div>
        )}
      </div>

      <div className="field">
        <SwitchRow
          label="ベタ塗り化"
          hint="色数を絞って面をフラットにします"
          checked={options.posterize}
          onChange={(v) => onChange({ ...options, posterize: v })}
        />
        {options.posterize && (
          <SliderRow
            label="色数"
            value={options.colors}
            onChange={(v) => onChange({ ...options, colors: v })}
            min={3}
            max={16}
            suffix="色"
          />
        )}
      </div>

      <div className="field">
        <SwitchRow
          label="なめらか化"
          hint="細かい模様やノイズを潰します"
          checked={options.smooth}
          onChange={(v) => onChange({ ...options, smooth: v })}
        />
      </div>

      <div className="field">
        <SwitchRow
          label="輪郭ビーズ"
          hint="輪郭を最も暗い手持ち色で縁取ります"
          checked={options.outline}
          onChange={(v) => onChange({ ...options, outline: v })}
        />
        {options.outline && (
          <SliderRow
            label="強さ"
            value={options.outlineStrength}
            onChange={(v) => onChange({ ...options, outlineStrength: v })}
            min={0}
            max={100}
          />
        )}
      </div>

      <details className="advanced">
        <summary>詳細設定</summary>
        <div className="field">
          <SliderRow
            label="空きマス閾値"
            value={Math.round(options.emptyBelow * 100)}
            onChange={(v) => onChange({ ...options, emptyBelow: v / 100 })}
            min={10}
            max={60}
            suffix="%"
          />
          <p className="field-hint">
            セル内の不透明部分がこの割合未満なら空きマスにします。下げると被写体の輪郭が欠けにくく、上げると背景の残りが消えます。
          </p>
        </div>
        {options.smooth && (
          <div className="field">
            <SliderRow
              label="なめらか半径"
              value={options.smoothRadius}
              onChange={(v) => onChange({ ...options, smoothRadius: v })}
              min={1}
              max={4}
            />
            <p className="field-hint">大きいほど強く平滑化します（イラスト感が増す）。</p>
          </div>
        )}
      </details>
    </section>
  )
}
