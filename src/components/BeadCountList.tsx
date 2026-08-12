import type { Pattern } from '../lib/pattern'
import { countBeads, emptyCellCount, totalBeads } from '../lib/pattern'

interface Props {
  pattern: Pattern
}

export function BeadCountList({ pattern }: Props) {
  const counts = countBeads(pattern)
  const total = totalBeads(pattern)
  const empty = emptyCellCount(pattern)
  const max = counts[0]?.count ?? 1

  return (
    <section className="card reveal" aria-label="必要なビーズ">
      <h2>必要なビーズ</h2>
      <div className="count-summary">
        <span className="count-pill">
          合計 <b>{total}</b> 個
        </span>
        <span className="count-pill">
          <b>{counts.length}</b> 色
        </span>
        {empty > 0 && (
          <span className="count-pill">
            空きマス <b>{empty}</b>
          </span>
        )}
      </div>
      <ul className="count-list">
        {counts.map(({ color, count }) => {
          const [r, g, b] = color.rgb
          return (
            <li key={color.id} className="count-item">
              <span className="count-dot" style={{ background: `rgb(${r},${g},${b})` }} />
              <div className="count-name">
                <div className="name">
                  {color.name}
                  {color.type === 'sparkle' && ' ✦'}
                </div>
                <div className="count-bar">
                  <i
                    style={{
                      width: `${(count / max) * 100}%`,
                      background: `rgb(${r},${g},${b})`,
                    }}
                  />
                </div>
              </div>
              <span className="count-num">
                ×{count} <small>({color.code})</small>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
