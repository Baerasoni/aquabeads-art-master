import { BEAD_DIAMETER_MM, cellCenterMm, gridHeightMm, gridWidthMm } from '../lib/grid'
import type { Pattern } from '../lib/pattern'
import { countBeads, totalBeads } from '../lib/pattern'

interface Props {
  pattern: Pattern
}

/**
 * 印刷用の原寸シート。
 * SVG に mm 単位の実寸を指定し、公式イラストシートと同様に
 * 印刷してトレイの下に敷いて使う。倍率100%（実際のサイズ）で印刷すること。
 */
export function PrintSheet({ pattern }: Props) {
  const { spec, palette, cells } = pattern
  const gw = gridWidthMm(spec)
  const gh = gridHeightMm(spec)
  const beadR = BEAD_DIAMETER_MM / 2
  // 公式シートの位置マーカーと同じ直径4mmの円で印刷する
  const markR = 2
  const counts = countBeads(pattern)

  return (
    <div className="print-only print-sheet">
      <div className="print-header">
        <strong>アクアビーズアートマスター</strong>
        <span>
          {spec.cols}×{spec.rows}（{totalBeads(pattern)}個） ・ 原寸（倍率100%で印刷）
        </span>
      </div>

      <svg
        width={`${gw}mm`}
        height={`${gh}mm`}
        viewBox={`0 0 ${gw} ${gh}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect x="0" y="0" width={gw} height={gh} fill="none" stroke="#bbb" strokeWidth="0.2" />
        {cells.map((rowCells, row) =>
          rowCells.map((idx, col) => {
            const { x, y } = cellCenterMm(spec, row, col)
            const cx = x + beadR
            const cy = y + beadR
            if (idx < 0) {
              // 空きマス: 位置だけ薄く示す（ビーズは置かない）
              return (
                <circle
                  key={`${row}-${col}`}
                  cx={cx}
                  cy={cy}
                  r={markR}
                  fill="none"
                  stroke="#ccc"
                  strokeWidth="0.1"
                />
              )
            }
            const [r, g, b] = palette[idx].rgb
            const luma = 0.299 * r + 0.587 * g + 0.114 * b
            return (
              <g key={`${row}-${col}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={markR}
                  fill={`rgb(${r},${g},${b})`}
                  stroke="rgba(0,0,0,0.25)"
                  strokeWidth="0.1"
                />
                <text
                  x={cx}
                  y={cy}
                  fontSize="1.5"
                  fontFamily="sans-serif"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={luma > 150 ? '#333' : '#fff'}
                >
                  {palette[idx].code}
                </text>
              </g>
            )
          }),
        )}
      </svg>

      <table className="print-legend">
        <tbody>
          {counts.map(({ color, count }) => (
            <tr key={color.id}>
              <td>
                <span
                  className="legend-dot"
                  style={{ background: `rgb(${color.rgb[0]},${color.rgb[1]},${color.rgb[2]})` }}
                />
              </td>
              <td>{color.code}</td>
              <td>
                {color.name}
                {color.type === 'sparkle' ? '（キラキラ）' : ''}
              </td>
              <td className="legend-count">×{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
