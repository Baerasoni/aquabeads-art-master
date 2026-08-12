import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import type { AutoAdjustRunState } from './components/AutoAdjustButton'
import { AutoAdjustButton } from './components/AutoAdjustButton'
import { BeadCountList } from './components/BeadCountList'
import type { Adjust, ConvertOptions } from './components/GridSettings'
import { GridSettings } from './components/GridSettings'
import type { IllustOptions } from './components/IllustSettings'
import { DEFAULT_ILLUST, IllustSettings } from './components/IllustSettings'
import { ImageDropzone } from './components/ImageDropzone'
import { PaletteSelector } from './components/PaletteSelector'
import { PatternGrid } from './components/PatternGrid'
import type { Preset } from './components/Presets'
import { PresetChips } from './components/Presets'
import { PrintSheet } from './components/PrintSheet'
import { resizeImage, resizeMask } from './lib/adjust'
import type { AutoAdjustResult } from './lib/autoAdjust'
import { autoAdjust } from './lib/autoAdjust'
import type { GridSpec } from './lib/grid'
import { STANDARD_TRAY, totalCells } from './lib/grid'
import { AQUA_PALETTE, DEFAULT_OWNED_IDS } from './lib/palette'
import type { PipelineCache, PipelineParams, PipelineResult } from './lib/pipeline'
import { createPipelineCache, runPipeline } from './lib/pipeline'
import type { ImageLike } from './lib/quantize'
import { clearSettings, DEFAULT_SETTINGS, loadSettings, saveSettings } from './lib/settings'
import { segmentSubject } from './segmentation'
import type { AutoAdjustMessage, AutoAdjustRequest } from './worker/autoAdjustTypes'

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

/**
 * 写真ごとの前段キャッシュ。base（調整前・縮小済み画像）と AI マスクは seq ごとに
 * 1回だけ作り、パラメータ変更では lib/pipeline.ts の PipelineCache が
 * 変わった段以降だけを再計算する
 */
interface SourceCache {
  baseSeq: number
  base: ImageLike | null
  maskSeq: number
  maskPromise: Promise<Float32Array> | null
  pipe: PipelineCache
}

const emptySourceCache = (): SourceCache => ({
  baseSeq: -1,
  base: null,
  maskSeq: -1,
  maskPromise: null,
  pipe: createPipelineCache(),
})

function drawScaled(bitmap: ImageBitmap, w: number, h: number): ImageData | null {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
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
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [spec, setSpec] = useState<GridSpec>(() => loadSettings()?.spec ?? STANDARD_TRAY)
  const [ownedIds, setOwnedIds] = useState<Set<string>>(loadOwnedIds)
  const [adjust, setAdjust] = useState<Adjust>(
    () => loadSettings()?.adjust ?? DEFAULT_SETTINGS.adjust,
  )
  const [options, setOptions] = useState<ConvertOptions>(
    () => loadSettings()?.options ?? DEFAULT_SETTINGS.options,
  )
  const [illust, setIllust] = useState<IllustOptions>(() => loadSettings()?.illust ?? DEFAULT_ILLUST)
  const [showCodes, setShowCodes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [segError, setSegError] = useState(false)
  const runId = useRef(0)
  // 写真ごとの base / AI マスク + パイプラインの段階キャッシュ。
  // AI マスクは写真 (seq) ごとに1回だけ推論し、調整スライダーでは再実行しない
  const stages = useRef<SourceCache>(emptySourceCache())

  // 手持ち色の永続化
  useEffect(() => {
    localStorage.setItem(OWNED_KEY, JSON.stringify([...ownedIds]))
  }, [ownedIds])

  // 設定の永続化（リロードしても調整が消えない）
  useEffect(() => {
    saveSettings({ v: 1, adjust, illust, options, spec })
  }, [adjust, illust, options, spec])

  const ownedPalette = useMemo(() => AQUA_PALETTE.filter((c) => ownedIds.has(c.id)), [ownedIds])

  // UI の3状態（adjust / illust / options）をパイプラインパラメータへ合流
  const params = useMemo<PipelineParams>(
    () => ({
      adjust,
      background: illust.background,
      autoZoom: illust.autoZoom,
      posterize: illust.posterize,
      colors: illust.colors,
      smooth: illust.smooth,
      smoothRadius: illust.smoothRadius,
      outline: illust.outline,
      outlineStrength: illust.outlineStrength,
      emptyBelow: illust.emptyBelow,
      deltaE: options.deltaE,
      repColor: options.repColor,
      dither: options.dither,
    }),
    [adjust, illust, options],
  )

  // 画像 + 全パラメータ → 図案（lib/pipeline.ts の共有パイプライン）
  useEffect(() => {
    // source クリアを含むあらゆる変更で進行中の run を無効化する
    const id = ++runId.current
    if (!source) {
      setResult(null)
      setBusy(false)
      stages.current = emptySourceCache()
      return
    }
    if (ownedPalette.length === 0) {
      setResult(null)
      setBusy(false)
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

        // base: 調整前・縮小済み RGBA。写真ごとに1回だけ canvas で作る
        if (c.baseSeq !== source.seq || !c.base) {
          const scale = Math.min(1, MAX_SIZE / Math.max(bitmap.width, bitmap.height))
          const w = Math.max(1, Math.round(bitmap.width * scale))
          const h = Math.max(1, Math.round(bitmap.height * scale))
          // 透明部分は保持する（空きマスになる）。白下地は敷かない
          const base = drawScaled(bitmap, w, h)
          if (!base) return
          c.base = base
          c.baseSeq = source.seq
        }

        let mask: Float32Array | null = null
        if (params.background === 'auto') {
          // マスクは被写体の形にのみ依存し、segmentSubject は画像内最大画素値で正規化する
          // ため明るさ等の調整に影響されない。無調整の base から写真ごとに1回だけ推論する
          if (c.maskSeq !== source.seq || !c.maskPromise) {
            const p = segmentSubject(c.base)
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

        const res = await runPipeline(c.base, mask, params, spec, ownedPalette, c.pipe, {
          onStage: yieldToPaint,
          shouldStop: () => runId.current !== id,
        })
        if (res && runId.current === id) setResult(res)
      } finally {
        if (runId.current === id) setBusy(false)
      }
    }
    run()
  }, [source, params, spec, ownedPalette])

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

  const pattern = ownedPalette.length > 0 ? (result?.pattern ?? null) : null

  // --- おまかせ自動調整 ---
  const [autoRun, setAutoRun] = useState<AutoAdjustRunState | null>(null)
  const [autoNote, setAutoNote] = useState('')
  const autoWorker = useRef<Worker | null>(null)
  const autoCancelled = useRef(false)

  const applyAutoResult = (r: AutoAdjustResult) => {
    const p = r.params
    setAdjust(p.adjust)
    setIllust((prev) => ({
      ...prev,
      posterize: p.posterize,
      colors: p.colors,
      smooth: p.smooth,
      smoothRadius: p.smoothRadius,
      outline: p.outline,
      outlineStrength: p.outlineStrength,
      emptyBelow: p.emptyBelow,
    }))
    setOptions({ deltaE: p.deltaE, repColor: p.repColor, dither: p.dither })
    setAutoNote(`スコア ${r.seedScore.total.toFixed(0)} → ${r.score.total.toFixed(0)}`)
  }

  const cancelAutoAdjust = () => {
    autoCancelled.current = true
    autoWorker.current?.terminate()
    autoWorker.current = null
    setAutoRun(null)
  }

  const applyPreset = (p: Preset) => {
    setIllust(p.illust)
    setOptions(p.options)
    setAutoNote('')
  }

  const resetAllSettings = () => {
    clearSettings()
    setAdjust(DEFAULT_SETTINGS.adjust)
    setIllust(DEFAULT_SETTINGS.illust)
    setOptions(DEFAULT_SETTINGS.options)
    setSpec(DEFAULT_SETTINGS.spec)
    setAutoNote('')
  }

  const runAutoAdjust = async () => {
    const c = stages.current
    if (!c.base || autoRun || ownedPalette.length === 0) return
    autoCancelled.current = false
    setAutoNote('')
    setAutoRun({ done: 0, total: 1, best: 0 })

    let mask: Float32Array | null = null
    if (params.background === 'auto' && c.maskPromise) {
      try {
        mask = await c.maskPromise
      } catch {
        mask = null
      }
    }
    if (autoCancelled.current) return

    // 探索は 320px 縮小で行う（確定後のフル解像度適用は通常パイプラインが行う）
    const searchBase = resizeImage(c.base, 320)
    const searchMask = mask
      ? resizeMask(mask, c.base.width, c.base.height, searchBase.width, searchBase.height)
      : null
    const request: AutoAdjustRequest = {
      base: searchBase,
      mask: searchMask,
      seed: params,
      spec,
      palette: ownedPalette,
    }
    const finish = (r: AutoAdjustResult) => {
      autoWorker.current = null
      if (autoCancelled.current) return
      applyAutoResult(r)
      setAutoRun(null)
    }
    // Worker が使えない環境ではメインスレッドで実行する（同一関数のフォールバック）
    const runOnMainThread = async () => {
      const r = await autoAdjust(request.base, request.mask, request.seed, request.spec, request.palette, {
        onProgress: async (p) => {
          setAutoRun({ done: p.done, total: p.totalEstimate, best: p.bestScore })
          await yieldToPaint()
        },
        shouldStop: () => autoCancelled.current,
      })
      finish(r)
    }
    try {
      const worker = new Worker(new URL('./worker/autoAdjust.worker.ts', import.meta.url), {
        type: 'module',
      })
      autoWorker.current = worker
      worker.onmessage = (e: MessageEvent<AutoAdjustMessage>) => {
        const msg = e.data
        if (msg.type === 'progress') {
          setAutoRun({ done: msg.done, total: msg.totalEstimate, best: msg.bestScore })
        } else if (msg.type === 'done') {
          worker.terminate()
          finish(msg.result)
        } else {
          worker.terminate()
          autoWorker.current = null
          runOnMainThread()
        }
      }
      worker.onerror = () => {
        worker.terminate()
        autoWorker.current = null
        runOnMainThread()
      }
      worker.postMessage(request)
    } catch {
      runOnMainThread()
    }
  }

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
                  <AutoAdjustButton
                    disabled={!source || busy || ownedPalette.length === 0}
                    running={autoRun}
                    note={autoNote}
                    onRun={runAutoAdjust}
                    onCancel={cancelAutoAdjust}
                  >
                    <PresetChips illust={illust} options={options} onApply={applyPreset} />
                  </AutoAdjustButton>
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
                  <button type="button" className="btn-link" onClick={resetAllSettings}>
                    すべての設定をリセット
                  </button>
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
