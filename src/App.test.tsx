// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { AutoAdjustButton } from './components/AutoAdjustButton'
import { GridSettings } from './components/GridSettings'
import { IllustSettings } from './components/IllustSettings'
import { ImageDropzone } from './components/ImageDropzone'
import { PaletteSelector } from './components/PaletteSelector'
import { PRESETS, PresetChips } from './components/Presets'
import { autoAdjust, type AutoAdjustResult } from './lib/autoAdjust'
import { DEFAULT_PIPELINE_PARAMS, runPipeline } from './lib/pipeline'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './lib/settings'
import { segmentSubject } from './segmentation'
import type { AutoAdjustMessage } from './worker/autoAdjustTypes'

// Keep React's real state/effect lifecycle; expose the App's input handlers without
// coupling these concurrency tests to the controls' markup or image decoding.
vi.mock('./components/AutoAdjustButton', () => ({
  AutoAdjustButton: vi.fn(({ children }) => <>{children}</>),
}))
vi.mock('./components/GridSettings', () => ({ GridSettings: vi.fn(() => null) }))
vi.mock('./components/IllustSettings', async (importOriginal) => ({
  ...await importOriginal<typeof import('./components/IllustSettings')>(),
  IllustSettings: vi.fn(() => null),
}))
vi.mock('./components/ImageDropzone', () => ({ ImageDropzone: vi.fn(() => null) }))
vi.mock('./components/PaletteSelector', () => ({ PaletteSelector: vi.fn(() => null) }))
vi.mock('./components/Presets', async (importOriginal) => ({
  ...await importOriginal<typeof import('./components/Presets')>(),
  PresetChips: vi.fn(() => null),
}))
vi.mock('./lib/pipeline', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/pipeline')>(),
  runPipeline: vi.fn(),
}))
vi.mock('./lib/autoAdjust', () => ({ autoAdjust: vi.fn() }))
vi.mock('./segmentation', () => ({ segmentSubject: vi.fn() }))

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<AutoAdjustMessage>) => void) | null = null
  onerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()

  constructor() {
    FakeWorker.instances.push(this)
  }

  // Deliberately deliver queued callbacks even after termination.
  emit(message: AutoAdjustMessage) {
    this.onmessage?.({ data: message } as MessageEvent<AutoAdjustMessage>)
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const autoProps = () => vi.mocked(AutoAdjustButton).mock.calls.at(-1)![0]
const gridProps = () => vi.mocked(GridSettings).mock.calls.at(-1)![0]
const illustProps = () => vi.mocked(IllustSettings).mock.calls.at(-1)![0]
const paletteProps = () => vi.mocked(PaletteSelector).mock.calls.at(-1)![0]
const presetProps = () => vi.mocked(PresetChips).mock.calls.at(-1)![0]
const finished = {
  params: { ...DEFAULT_PIPELINE_PARAMS, colors: 16 },
  seedScore: { total: 40 },
  score: { total: 70 },
  evaluated: 12,
} as AutoAdjustResult
const progress = { type: 'progress', done: 2, totalEstimate: 10, bestScore: 50 } as const
let container: HTMLDivElement
let root: Root | null

async function flushPipeline() {
  await act(async () => { await vi.runAllTimersAsync() })
}

async function mount(background: 'auto' | 'none' = 'none') {
  saveSettings({ ...DEFAULT_SETTINGS, illust: { ...DEFAULT_SETTINGS.illust, background } })
  root = createRoot(container)
  await act(async () => { root!.render(<App />) })
  await act(async () => {
    vi.mocked(ImageDropzone).mock.calls.at(-1)![0].onImage(
      { width: 1, height: 1 } as ImageBitmap, 'photo.png',
    )
  })
  await flushPipeline()
}

async function start() {
  await act(async () => { autoProps().onRun() })
  return FakeWorker.instances.at(-1)!
}

async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text)
  expect(button).toBeDefined()
  await act(async () => { button!.click() })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(callback, 0))
  FakeWorker.instances = []
  localStorage.clear()
  vi.mocked(autoAdjust).mockReset()
  vi.mocked(autoAdjust).mockResolvedValue(finished)
  vi.mocked(runPipeline).mockResolvedValue(null)
  vi.mocked(segmentSubject).mockResolvedValue(new Float32Array([1]))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255]) }),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,')
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  if (root) await act(async () => { root!.unmount() })
  root = null
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('auto-adjust run lifecycle', () => {
  it('applies a current result and clears its progress', async () => {
    await mount()
    const worker = await start()
    await act(async () => { worker.emit(progress) })
    expect(autoProps().running?.done).toBe(2)
    await act(async () => { worker.emit({ type: 'done', result: finished }) })
    expect(illustProps().options.colors).toBe(16)
    expect(loadSettings()?.illust.colors).toBe(16)
    expect(autoProps().running).toBeNull()
    expect(autoProps().note).toBe('スコア 40 → 70')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it.each(['preset', 'reset', 'illustration', 'adjustment', 'grid', 'conversion', 'palette', 'photo', 'cancel'])(
    'invalidates a run on %s and ignores all stale callbacks', async (input) => {
      await mount()
      const worker = await start()
      await act(async () => {
        if (input === 'preset') presetProps().onApply(PRESETS[1])
        if (input === 'illustration') illustProps().onChange({ ...illustProps().options, colors: 3 })
        if (input === 'adjustment') gridProps().onAdjust({ ...gridProps().adjust, brightness: 150 })
        if (input === 'grid') gridProps().onSpec({ ...gridProps().spec, cols: 5 })
        if (input === 'conversion') gridProps().onOptions({ ...gridProps().options, dither: true })
        if (input === 'palette') paletteProps().onChange(new Set())
        if (input === 'cancel') autoProps().onCancel()
      })
      if (input === 'reset') await click('すべての設定をリセット')
      if (input === 'photo') await click('別の写真にする')
      const settingsAfterEdit = loadSettings()
      await act(async () => {
        worker.emit(progress)
        worker.emit({ type: 'error', message: 'late failure' })
        worker.onerror?.()
        worker.emit({ type: 'done', result: finished })
      })
      expect(loadSettings()).toEqual(settingsAfterEdit)
      expect(worker.terminate).toHaveBeenCalledTimes(1)
      if (input !== 'photo') {
        expect(autoProps().running).toBeNull()
        expect(autoProps().note).toBe('')
      }
      expect(autoAdjust).not.toHaveBeenCalled()
      if (input === 'photo') expect(container.textContent).toContain('写真が、')
    },
  )

  it('does not let a cancelled run clear or overwrite its replacement', async () => {
    await mount()
    const oldWorker = await start()
    await act(async () => { autoProps().onCancel() })
    const worker = await start()
    await act(async () => {
      worker.emit(progress)
      oldWorker.emit({ type: 'done', result: finished })
      oldWorker.onerror?.()
    })
    expect(autoProps().running?.done).toBe(2)
    expect(illustProps().options.colors).toBe(8)
    expect(autoAdjust).not.toHaveBeenCalled()
    await act(async () => { autoProps().onCancel() })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('prevents duplicate starts before React renders', async () => {
    await mount()
    const onRun = autoProps().onRun
    await act(async () => { onRun(); onRun() })
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('invalidates a run while its segmentation mask is pending', async () => {
    const mask = deferred<Float32Array>()
    vi.mocked(segmentSubject).mockReturnValue(mask.promise)
    await mount('auto')
    await start()
    expect(FakeWorker.instances).toHaveLength(0)
    await act(async () => { presetProps().onApply(PRESETS[1]) })
    await act(async () => { mask.resolve(new Float32Array([1])) })
    expect(FakeWorker.instances).toHaveLength(0)
    expect(autoProps().running).toBeNull()
    expect(illustProps().options.colors).toBe(6)
  })

  it('stops and ignores an obsolete main-thread fallback after restarting', async () => {
    const result = deferred<AutoAdjustResult>()
    vi.mocked(autoAdjust).mockReturnValue(result.promise)
    await mount()
    const oldWorker = await start()
    await act(async () => { oldWorker.onerror?.() })
    const hooks = vi.mocked(autoAdjust).mock.calls[0][5]!
    await act(async () => { autoProps().onCancel() })
    const worker = await start()
    expect(hooks.shouldStop?.()).toBe(true)
    await act(async () => {
      worker.emit(progress)
      void hooks.onProgress?.({ done: 9, totalEstimate: 10, bestScore: 80 })
      result.resolve(finished)
    })
    expect(autoProps().running?.done).toBe(2)
    expect(illustProps().options.colors).toBe(8)
    await act(async () => { autoProps().onCancel() })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('falls back only once and ignores further messages from the retired worker', async () => {
    const result = deferred<AutoAdjustResult>()
    vi.mocked(autoAdjust).mockReturnValue(result.promise)
    await mount()
    const worker = await start()
    await act(async () => {
      worker.emit({ type: 'error', message: 'worker failed' })
      worker.onerror?.()
      worker.emit({ type: 'done', result: finished })
    })
    expect(autoAdjust).toHaveBeenCalledTimes(1)
    expect(illustProps().options.colors).toBe(8)
    await act(async () => { result.resolve(finished) })
    expect(illustProps().options.colors).toBe(16)
    expect(autoProps().running).toBeNull()
  })

  it('handles a fallback failure and permits a retry', async () => {
    vi.mocked(autoAdjust).mockRejectedValue(new Error('failed'))
    await mount()
    const worker = await start()
    await act(async () => { worker.onerror?.() })
    expect(autoProps().running).toBeNull()
    expect(autoProps().note).toContain('失敗')
    await start()
    expect(FakeWorker.instances).toHaveLength(2)
  })

  it.each(['unavailable', 'postMessage throws'])('falls back when Worker is %s', async (failure) => {
    await mount()
    if (failure === 'unavailable') {
      vi.stubGlobal('Worker', undefined)
    } else {
      vi.stubGlobal('Worker', class extends FakeWorker {
        postMessage = vi.fn(() => { throw new Error('could not post') })
      })
    }
    await start()
    expect(autoAdjust).toHaveBeenCalledTimes(1)
    expect(illustProps().options.colors).toBe(16)
    expect(autoProps().running).toBeNull()
    if (failure === 'postMessage throws') {
      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
    }
  })

  it('does not show an obsolete fallback error over a new run', async () => {
    const result = deferred<AutoAdjustResult>()
    vi.mocked(autoAdjust).mockReturnValue(result.promise)
    await mount()
    const oldWorker = await start()
    await act(async () => { oldWorker.onerror?.() })
    await act(async () => { autoProps().onCancel() })
    const worker = await start()
    await act(async () => {
      worker.emit(progress)
      result.reject(new Error('late failure'))
    })
    expect(autoProps().running?.done).toBe(2)
    expect(autoProps().note).toBe('')
  })

  it('keeps only the replacement run when both awaited the same mask', async () => {
    const mask = deferred<Float32Array>()
    vi.mocked(segmentSubject).mockReturnValue(mask.promise)
    await mount('auto')
    await start()
    await act(async () => { autoProps().onCancel() })
    await start()
    await act(async () => { mask.resolve(new Float32Array([1])) })
    expect(FakeWorker.instances).toHaveLength(1)
    await act(async () => { FakeWorker.instances[0].emit({ type: 'done', result: finished }) })
    expect(illustProps().options.colors).toBe(16)
  })

  it('invalidates a pending mask on unmount before it can create a Worker', async () => {
    const mask = deferred<Float32Array>()
    vi.mocked(segmentSubject).mockReturnValue(mask.promise)
    await mount('auto')
    await start()
    await act(async () => { root!.unmount(); root = null })
    await act(async () => { mask.resolve(new Float32Array([1])) })
    expect(FakeWorker.instances).toHaveLength(0)
    expect(autoAdjust).not.toHaveBeenCalled()
  })

  it('terminates and invalidates the run on unmount', async () => {
    await mount()
    const worker = await start()
    const settings = loadSettings()
    await act(async () => { root!.unmount(); root = null })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    await act(async () => {
      worker.emit(progress)
      worker.onerror?.()
      worker.emit({ type: 'done', result: finished })
    })
    expect(autoAdjust).not.toHaveBeenCalled()
    expect(loadSettings()).toEqual(settings)
  })
})
