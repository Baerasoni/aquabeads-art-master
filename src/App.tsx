import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { BeadCountList } from './components/BeadCountList'
import type { Adjust, ConvertOptions } from './components/GridSettings'
import { GridSettings } from './components/GridSettings'
import type { IllustOptions } from './components/IllustSettings'
import { DEFAULT_ILLUST, IllustSettings } from './components/IllustSettings'
import { ImageDropzone } from './components/ImageDropzone'
import { PaletteSelector } from './components/PaletteSelector'
import { PatternGrid } from './components/PatternGrid'
import { PrintSheet } from './components/PrintSheet'
import type { GridSpec } from './lib/grid'
import { STANDARD_TRAY, totalCells } from './lib/grid'
import { AQUA_PALETTE, DEFAULT_OWNED_IDS } from './lib/palette'
import {
  cropToSubject,
  kuwahara,
  posterizeKMeans,
  removeBackgroundSimple,
  sobelMagnitude,
} from './lib/preprocess'
import type { ImageLike, QuantizeOptions } from './lib/quantize'
import { imageToPattern } from './lib/quantize'
import { applyMask, segmentSubject } from './segmentation'

const OWNED_KEY = 'aqua.ownedIds'
const HERO_BEAD_IDS = ['m01', 'm02', 'm03', 'm09', 'm07', 'm06', 'm05', 'm04']
const MAX_SIZE = 640

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

/** 前処理パイプラインの段階キャッシュ。各キーは上流段のキーを含む合成キー */
interface StageCache {
  filteredKey: string
  filtered: ImageData | null
  maskSeq: number
  maskPromise: Promise<Float32Array> | null
  bgKey: string
  bg: ImageLike | null
  cropKey: string
  crop: ImageLike | null
  smoothKey: string
  smooth: ImageLike | null
}

const emptyStages = (): StageCache => ({
  filteredKey: '',
  filtered: null,
  maskSeq: -1,
  maskPromise: null,
  bgKey: '',
  bg: null,
  cropKey: '',
  crop: null,
  smoothKey: '',
  smooth: null,
})

function drawScaled(bitmap: ImageBitmap, w: number, h: number, filter?: string): ImageData | null {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  if (filter) ctx.filter = filter
  ctx.drawImage(bitmap, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

function copyImage(img: ImageLike): ImageLike {
  return { width: img.width, height: img.height, data: img.data.slice() }
}

/** busy 表示などを描画してから重い同期処理に入るための待機 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (document.hidden) {
      // 非表示タブでは rAF が発火しない
      setTimeout(resolve, 0)
    } else {
      requestAnimationFrame(() => setTimeout(resolve, 0))
    }
  })
}

export default function App() {
  const [source, setSource] = useState<{
    bitmap: ImageBitmap
    name: string
    seq: number
  } | null>(null)
  const seqRef = useRef(0)
  const [sourceUrl, setSourceUrl] = useState('')
  const [imageData, setImageData] = useState<ImageLike | null>(null)
  const [spec, setSpec] = useState<GridSpec>(STANDARD_TRAY)
  const [ownedIds, setOwnedIds] = useState<Set<string>>(loadOwnedIds)
  const [adjust, setAdjust] = useState<Adjust>({ brightness: 100, contrast: 100, saturation: 100 })
  const [options, setOptions] = useState<ConvertOptions>({
    deltaE: 'ciede2000',
    repColor: 'median',
    dither: false,
  })
  const [illust, setIllust] = useState<IllustOptions>(DEFAULT_ILLUST)
  const [showCodes, setShowCodes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [segError, setSegError] = useState(false)
  const runId = useRef(0)
  // 前処理は段階ごとに合成キーでキャッシュし、変わったパラメータ以降の段だけ再計算する。
  // 特に AI マスクは写真 (seq) ごとに1回だけ推論し、調整スライダーでは再実行しない
  const stages = useRef<StageCache>(emptyStages())

  // 手持ち色の永続化
  useEffect(() => {
    localStorage.setItem(OWNED_KEY, JSON.stringify([...ownedIds]))
  }, [ownedIds])

  // 画像 + 調整 + イラスト化 → ImageLike（前処理パイプライン）
  useEffect(() => {
    // source クリアを含むあらゆる変更で進行中の run を無効化する
    const id = ++runId.current
    if (!source) {
      setImageData(null)
      setBusy(false)
      stages.current = emptyStages()
      return
    }
    const run = async () => {
      setBusy(true)
      try {
        // busy を描画してから重い処理に入る。古くなった run はここで脱落する
        await yieldToPaint()
        if (runId.current !== id) return
        const c = stages.current
        const { bitmap } = source
        const scale = Math.min(1, MAX_SIZE / Math.max(bitmap.width, bitmap.height))
        const w = Math.max(1, Math.round(bitmap.width * scale))
        const h = Math.max(1, Math.round(bitmap.height * scale))

        const filteredKey = `${source.seq}:${adjust.brightness}:${adjust.contrast}:${adjust.saturation}`
        let filtered = c.filteredKey === filteredKey ? c.filtered : null
        if (!filtered) {
          // 透明部分は保持する（空きマスになる）。白下地は敷かない
          filtered = drawScaled(
            bitmap,
            w,
            h,
            `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%) saturate(${adjust.saturation}%)`,
          )
          if (!filtered) return
          c.filtered = filtered
          c.filteredKey = filteredKey
        }

        let mask: Float32Array | null = null
        if (illust.background === 'auto') {
          // マスクは被写体の形にのみ依存し、segmentSubject は画像内最大画素値で正規化する
          // ため明るさ等の調整に影響されない。無調整の元画像から写真ごとに1回だけ推論する
          if (c.maskSeq !== source.seq || !c.maskPromise) {
            const original = drawScaled(bitmap, w, h)
            if (!original) return
            const p = segmentSubject(original)
            c.maskSeq = source.seq
            c.maskPromise = p
            // 失敗は次の run で再試行できるようにキャッシュから外す
            p.catch(() => {
              if (c.maskPromise === p) c.maskPromise = null
            })
          }
          try {
            mask = await c.maskPromise
            if (runId.current === id) setSegError(false)
          } catch {
            if (runId.current === id) setSegError(true)
            mask = null
          }
          if (runId.current !== id) return
        }

        const bgKey = `${filteredKey}|${illust.background}|${mask ? 'm' : '-'}`
        let bg = c.bgKey === bgKey ? c.bg : null
        if (!bg) {
          if (mask) {
            // applyMask は唯一の破壊的関数なので、キャッシュ済み filtered のコピーに適用する
            const masked = copyImage(filtered)
            applyMask(masked, mask)
            bg = masked
          } else if (illust.background === 'simple') {
            await yieldToPaint()
            if (runId.current !== id) return
            bg = removeBackgroundSimple(filtered)
          } else {
            // 下流の関数はすべて非破壊なのでキャッシュを共有してよい
            bg = filtered
          }
          c.bg = bg
          c.bgKey = bgKey
        }

        const cropKey = `${bgKey}|${illust.background !== 'none' && illust.autoZoom}`
        let crop = c.cropKey === cropKey ? c.crop : null
        if (!crop) {
          crop = illust.background !== 'none' && illust.autoZoom ? cropToSubject(bg) : bg
          c.crop = crop
          c.cropKey = cropKey
        }

        const smoothKey = `${cropKey}|${illust.smooth}`
        let smooth = c.smoothKey === smoothKey ? c.smooth : null
        if (!smooth) {
          if (illust.smooth) {
            await yieldToPaint()
            if (runId.current !== id) return
            smooth = kuwahara(crop, 2)
          } else {
            smooth = crop
          }
          c.smooth = smooth
          c.smoothKey = smoothKey
        }

        let img: ImageLike = smooth
        if (illust.posterize) {
          await yieldToPaint()
          if (runId.current !== id) return
          img = posterizeKMeans(img, illust.colors)
        }

        if (runId.current === id) setImageData(img)
      } finally {
        if (runId.current === id) setBusy(false)
      }
    }
    run()
    // outline / outlineStrength は quantizeOptions 側でのみ使うため依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, adjust, illust.background, illust.autoZoom, illust.smooth, illust.posterize, illust.colors])

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

  // Sobel は image にのみ依存するため巻き上げ、輪郭の強さ変更で再計算されないようにする
  const edgeMag = useMemo(
    () => (imageData && illust.outline ? sobelMagnitude(imageData) : null),
    [imageData, illust.outline],
  )

  const quantizeOptions = useMemo<QuantizeOptions>(
    () => ({
      ...options,
      outline: illust.outline
        ? { density: 0.04 + ((100 - illust.outlineStrength) / 100) * 0.16 }
        : undefined,
      edgeMag: edgeMag ?? undefined,
    }),
    [options, illust.outline, illust.outlineStrength, edgeMag],
  )

  const pattern = useMemo(() => {
    if (!imageData || ownedPalette.length === 0) return null
    return imageToPattern(imageData, spec, ownedPalette, quantizeOptions)
  }, [imageData, spec, ownedPalette, quantizeOptions])

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
              <ImageDropzone
                onImage={(bitmap, name) => setSource({ bitmap, name, seq: ++seqRef.current })}
              />
            </div>
          ) : (
            <>
              <div className="source-bar reveal">
                {sourceUrl && <img className="source-thumb" src={sourceUrl} alt="" />}
                <div className="source-meta">
                  <strong>{source.name}</strong>
                  <span>
                    {source.bitmap.width}×{source.bitmap.height}px → {spec.cols}×{spec.rows}（
                    {totalCells(spec)}マス）
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
                      {busy && !pattern ? (
                        <p className="pattern-empty">
                          {illust.background === 'auto'
                            ? 'AI が被写体を切り抜いています…'
                            : '変換中…'}
                        </p>
                      ) : pattern ? (
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
                      {busy && pattern && <span className="pattern-note">更新中…</span>}
                      <span className="pattern-note">
                        ピッチ5.0mm ・ 六角配置 ・ 実寸 {Math.round((spec.cols - 1) * 5 + 5)}mm 幅
                      </span>
                    </div>
                  </section>
                  {pattern && <BeadCountList pattern={pattern} />}
                </div>

                <div className="stack">
                  <IllustSettings options={illust} onChange={setIllust} segError={segError} />
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
