// 設定 UI の共通コントロール（segmented / slider / switch / number）

import { useState } from 'react'

export function Segmented<T extends string>({
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

export function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  suffix = '',
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  suffix?: string
}) {
  // 変換パイプラインが重いため、ドラッグ中はローカル値の表示だけ更新し、
  // 離した時（pointerup / keyup / blur）に1回だけ onChange で確定する
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  const commit = () => {
    if (draft !== null && draft !== value) onChange(draft)
    setDraft(null)
  }
  return (
    <div className="slider-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={shown}
        aria-label={label}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="value">
        {shown}
        {suffix}
      </span>
    </div>
  )
}

export function NumberField({
  value,
  onCommit,
  min,
  max,
}: {
  value: number
  onCommit: (v: number) => void
  min: number
  max: number
}) {
  // 入力途中の値では変換しない。blur / Enter で clamp して確定する
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const v = Math.max(min, Math.min(max, Number(draft) || min))
    setDraft(null)
    if (v !== value) onCommit(v)
  }
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="switch-row">
      <div>
        <div className="field-label" style={{ marginBottom: 2 }}>
          {label}
        </div>
        {hint && (
          <p className="field-hint" style={{ marginTop: 0 }}>
            {hint}
          </p>
        )}
      </div>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      />
    </div>
  )
}
