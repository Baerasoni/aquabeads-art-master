import type { BeadColor } from '../lib/palette'
import { AQUA_PALETTE, DEFAULT_OWNED_IDS } from '../lib/palette'

interface Props {
  ownedIds: ReadonlySet<string>
  onChange: (ids: Set<string>) => void
}

function SwatchGroup({
  title,
  colors,
  ownedIds,
  onToggle,
}: {
  title: string
  colors: BeadColor[]
  ownedIds: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  return (
    <div className="palette-group">
      <h3>{title}</h3>
      <div className="swatch-grid">
        {colors.map((c) => (
          <button
            key={c.id}
            type="button"
            className="swatch"
            style={{ background: `rgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})` }}
            aria-pressed={ownedIds.has(c.id)}
            title={`${c.name}（${c.code}）`}
            aria-label={`${c.name}（${c.code}）`}
            onClick={() => onToggle(c.id)}
          />
        ))}
      </div>
    </div>
  )
}

export function PaletteSelector({ ownedIds, onChange }: Props) {
  const toggle = (id: string) => {
    const next = new Set(ownedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  const round = AQUA_PALETTE.filter((c) => c.type === 'round')
  const sparkle = AQUA_PALETTE.filter((c) => c.type === 'sparkle')

  return (
    <section className="card reveal" aria-label="手持ちの色">
      <h2>手持ちの色</h2>
      <div className="palette-actions">
        <button
          type="button"
          className="btn-link"
          onClick={() => onChange(new Set(AQUA_PALETTE.map((c) => c.id)))}
        >
          すべて選択
        </button>
        <button type="button" className="btn-link" onClick={() => onChange(new Set(DEFAULT_OWNED_IDS))}>
          基本16色
        </button>
        <button type="button" className="btn-link" onClick={() => onChange(new Set())}>
          すべて解除
        </button>
      </div>
      <SwatchGroup title="まるビーズ" colors={round} ownedIds={ownedIds} onToggle={toggle} />
      <SwatchGroup title="キラキラビーズ" colors={sparkle} ownedIds={ownedIds} onToggle={toggle} />
      <p className="palette-count">選択中: {ownedIds.size} 色</p>
    </section>
  )
}
