import { useRef, useState } from 'react'

interface Props {
  onImage: (bitmap: ImageBitmap, name: string) => void
}

/** サンプル画像（虹色グラデーション上のハート）を生成する */
async function createSampleBitmap(): Promise<ImageBitmap> {
  const w = 440
  const h = 452
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!

  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#8ecff0')
  sky.addColorStop(1, '#fdf3d8')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)

  const heart = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.9)
  heart.addColorStop(0, '#f4657a')
  heart.addColorStop(1, '#d21f3c')
  ctx.fillStyle = heart
  ctx.beginPath()
  const cx = w / 2
  const cy = h * 0.56
  const s = w * 0.36
  ctx.moveTo(cx, cy + s * 0.9)
  ctx.bezierCurveTo(cx - s * 1.4, cy - s * 0.1, cx - s * 0.7, cy - s * 1.05, cx, cy - s * 0.35)
  ctx.bezierCurveTo(cx + s * 0.7, cy - s * 1.05, cx + s * 1.4, cy - s * 0.1, cx, cy + s * 0.9)
  ctx.fill()

  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  ctx.ellipse(cx - s * 0.42, cy - s * 0.42, s * 0.16, s * 0.1, -0.6, 0, Math.PI * 2)
  ctx.fill()

  return createImageBitmap(cv)
}

export function ImageDropzone({ onImage }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const loadFile = async (file: File | undefined | null) => {
    if (!file || !file.type.startsWith('image/')) return
    try {
      const bitmap = await createImageBitmap(file)
      onImage(bitmap, file.name)
    } catch {
      alert('この画像は読み込めませんでした。JPEG / PNG をお試しください。')
    }
  }

  return (
    <div
      className={`dropzone${dragging ? ' dragging' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="写真を選択"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        loadFile(e.dataTransfer.files[0])
      }}
    >
      <div className="dropzone-icon" aria-hidden="true" />
      <strong>写真をここにドロップ</strong>
      <p>またはクリックして選択（JPEG / PNG・画像は端末の外に送信されません）</p>
      <div className="dropzone-sample">
        <button
          type="button"
          className="btn-link"
          onClick={async (e) => {
            e.stopPropagation()
            onImage(await createSampleBitmap(), 'サンプル画像')
          }}
        >
          サンプル画像で試す
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          loadFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
