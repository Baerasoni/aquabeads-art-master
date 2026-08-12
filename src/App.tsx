import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { BeadCountList } from './components/BeadCountList'
import type { Adjust, ConvertOptions } from './components/GridSettings'
import { GridSettings } from './components/GridSettings'
import { ImageDropzone } from './components/ImageDropzone'
import { PaletteSelector } from './components/PaletteSelector'
import { PatternGrid } from './components/PatternGrid'
import { PrintSheet } from './components/PrintSheet'
import type { GridSpec } from './lib/grid'
import { STANDARD_TRAY, totalCells } from './lib/grid'
import { AQUA_PALETTE, DEFAULT_OWNED_IDS } from './lib/palette'
import { imageToPattern } from './lib/quantize'

const OWNED_KEY = 'aqua.ownedIds'
const HERO_BEAD_IDS = ['m01', 'm02', 'm03', 'm09', 'm07', 'm06', 'm05', 'm04']

function loadOwnedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(OWNED_KEY)
    if (raw) {
      const ids = (JSON.parse(raw) as string[]).filter((id) =>
        AQUA_PALETTE.some((c) => c.id === id),
      )
      if (ids.length > 0) return new Set(ids)
    }
  } catch {
    // 破損データは初期値に戻す
  }
  return new Set(DEFAULT_OWNED_IDS)
}

export default function App() {
  const [source, setSource] = useState<{ bitmap: ImageBitmap; name: string } | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [imageData, setImageData] = useState<ImageData | null>(null)
  const [spec, setSpec] = useState<GridSpec>(STANDARD_TRAY)
  const [ownedIds, setOwnedIds] = useState<Set<string>>(loadOwnedIds)
  const [adjust, setAdjust] = useState<Adjust>({ brightness: 100, contrast: 100, saturation: 100 })
  const [options, setOptions] = useState<ConvertOptions>({
    deltaE: 'ciede2000',
    repColor: 'median',
    dither: false,
  })
  const [showCodes, setShowCodes] = useState(false)

  // 手持ち色の永続化
  useEffect(() => {
    localStorage.setItem(OWNED_KEY, JSON.stringify([...ownedIds]))
  }, [ownedIds])

  // 画像 + 調整 → ImageData（縮小して処理を軽くする）
  useEffect(() => {
    if (!source) {
      setImageData(null)
      return
    }
    const { bitmap } = source
    const MAX = 1000
    const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    // 透過 PNG 対策の白下地（filter 設定前に敷く）
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.filter = `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturation}%)`
    ctx.drawImage(bitmap, 0, 0, w, h)
    setImageData(ctx.getImageData(0, 0, w, h))
  }, [source, adjust])

  // サムネイル URL
  useEffect(() => {
    if (!source) {
      setSourceUrl('')
      return
    }
    const cv = document.createElement('canvas')
    const s = 88 / Math.max(source.bitmap.width, source.bitmap.height)
    cv.width = Math.max(1, Math.round(source.bitmap.width * s))
    cv.height = Math.max(1, Math.round(source.bitmap.height * s))
    cv.getContext('2d')?.drawImage(source.bitmap, 0, 0, cv.width, cv.height)
    setSourceUrl(cv.toDataURL())
  }, [source])

  const ownedPalette = useMemo(() => AQUA_PALETTE.filter((c) => ownedIds.has(c.id)), [ownedIds])

  const pattern = useMemo(() => {
    if (!imageData || ownedPalette.length === 0) return null
    return imageToPattern(imageData, spec, ownedPalette, options)
  }, [imageData, spec, ownedPalette, options])

  return (
    <>
      <div className="app">
        <header className="header">
          <div className="header-inner">
            <div className="brand">
              <span className="brand-bead" aria-hidden="true" />
              アクアビーズアートマスター
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!pattern}
                onClick={() => window.print()}
              >
                原寸シートを印刷
              </button>
            </div>
          </div>
        </header>

        <main className="app-main">
          {!source ? (
            <div className="hero reveal">
              <h1>
                写真が、
                <br />
                ビーズになる。
              </h1>
              <p className="lede">
                写真をドロップするだけ。図案、必要なビーズの数、原寸の印刷シートまで、
                ぜんぶブラウザの中で。
              </p>
              <div className="hero-beads" aria-hidden="true">
                {HERO_BEAD_IDS.map((id, i) => {
                  const c = AQUA_PALETTE.find((p) => p.id === id)!
                  return (
                    <span
                      key={id}
                      style={{
                        background: `rgb(${c.rgb[0]},${c.rgb[1]},${c.rgb[2]})`,
                        animationDelay: `${i * 0.18}s`,
                      }}
                    />
                  )
                })}
              </div>
              <ImageDropzone onImage={(bitmap, name) => setSource({ bitmap, name })} />
            </div>
          ) : (
            <>
              <div className="source-bar reveal">
                {sourceUrl && <img className="source-thumb" src={sourceUrl} alt="" />}
                <div className="source-meta">
                  <strong>{source.name}</strong>
                  <span>
                    {source.bitmap.width}×{source.bitmap.height}px → {spec.cols}×{spec.rows}（
                    {totalCells(spec)}ビーズ）
                  </span>
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => setSource(null)}>
                  別の写真にする
                </button>
              </div>

              <div className="workspace">
                <div className="stack">
                  <section className="card pattern-card reveal" aria-label="図案">
                    <h2>図案</h2>
                    <div className="pattern-frame">
                      {pattern ? (
                        <PatternGrid pattern={pattern} showCodes={showCodes} />
                      ) : (
                        <p className="pattern-empty">
                          手持ちの色が選ばれていません。
                          <br />
                          右の「手持ちの色」から1色以上選んでください。
                        </p>
                      )}
                    </div>
                    <div className="pattern-toolbar">
                      <label
                        style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
                      >
                        <input
                          type="checkbox"
                          checked={showCodes}
                          onChange={(e) => setShowCodes(e.target.checked)}
                        />
                        色番号を表示
                      </label>
                      <span className="pattern-note">
                        ピッチ5.0mm ・ 六角配置 ・ 実寸 {Math.round((spec.cols - 1) * 5 + 5)}mm 幅
                      </span>
                    </div>
                  </section>
                  {pattern && <BeadCountList pattern={pattern} />}
                </div>

                <div className="stack">
                  <GridSettings
                    spec={spec}
                    onSpec={setSpec}
                    adjust={adjust}
                    onAdjust={setAdjust}
                    options={options}
                    onOptions={setOptions}
                  />
                  <PaletteSelector ownedIds={ownedIds} onChange={setOwnedIds} />
                </div>
              </div>
            </>
          )}
        </main>

        <footer className="footer">
          画像はすべてブラウザ内で処理され、外部に送信されません。
          アクアビーズはエポック社の登録商標です。本アプリは非公式のファンメイドツールです。
        </footer>
      </div>

      {pattern && <PrintSheet pattern={pattern} />}
    </>
  )
}
