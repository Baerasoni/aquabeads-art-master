import { useEffect, useRef } from 'react'
import { BEAD_DIAMETER_MM, cellCenterMm, gridHeightMm, gridWidthMm } from '../lib/grid'
import type { Pattern } from '../lib/pattern'

interface Props {
  pattern: Pattern
  showCodes: boolean
}

/** 図案をビーズの穴あきリングとして描画する */
export function PatternGrid({ pattern, showCodes }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { spec, palette, cells } = pattern

    const PX_PER_MM = 4.4 // 表示スケール
    const gw = gridWidthMm(spec)
    const gh = gridHeightMm(spec)
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    canvas.width = Math.round(gw * PX_PER_MM * dpr)
    canvas.height = Math.round(gh * PX_PER_MM * dpr)
    canvas.style.width = `${Math.round(gw * PX_PER_MM)}px`
    canvas.style.aspectRatio = `${gw} / ${gh}`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const s = PX_PER_MM * dpr
    ctx.setTransform(s, 0, 0, s, 0, 0) // 以降は mm 座標で描く

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, gw, gh)

    const beadR = BEAD_DIAMETER_MM / 2
    const holeR = beadR * 0.34
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    for (let row = 0; row < cells.length; row++) {
      for (let col = 0; col < cells[row].length; col++) {
        const idx = cells[row][col]
        const { x, y } = cellCenterMm(spec, row, col)
        const cx = x + beadR
        const cy = y + beadR

        if (idx < 0) {
          // 空きマス: 薄いリングだけ描く
          ctx.beginPath()
          ctx.arc(cx, cy, beadR * 0.94, 0, Math.PI * 2)
          ctx.lineWidth = 0.12
          ctx.strokeStyle = 'rgba(0,0,0,0.07)'
          ctx.stroke()
          continue
        }

        const color = palette[idx]
        const [r, g, b] = color.rgb

        ctx.beginPath()
        ctx.arc(cx, cy, beadR * 0.94, 0, Math.PI * 2)
        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fill()
        ctx.lineWidth = 0.12
        ctx.strokeStyle = 'rgba(0,0,0,0.12)'
        ctx.stroke()

        // ビーズの穴
        ctx.beginPath()
        ctx.arc(cx, cy, holeR, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()

        if (showCodes) {
          const luma = 0.299 * r + 0.587 * g + 0.114 * b
          ctx.fillStyle = luma > 150 ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.92)'
          ctx.font = `700 1.3px 'Outfit', sans-serif`
          ctx.fillText(color.code, cx, cy + beadR * 0.62)
        }
      }
    }
  }, [pattern, showCodes])

  return <canvas ref={canvasRef} aria-label="ビーズ図案" />
}
