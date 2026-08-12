// AI 背景除去（被写体セグメンテーション）
//
// U²-Net の軽量版 u2netp（Apache-2.0, https://github.com/xuebinqin/U-2-Net）を
// onnxruntime-web でブラウザ内実行する。画像は端末の外に送信されない。
// モデル (public/models/u2netp.onnx) と wasm ランタイム (public/ort/) は自前ホスト。

// wasm 専用エントリを使う（デフォルトエントリは WebGPU 用の jsep 版 wasm を要求し、
// 配置している ort-wasm-simd-threaded.{mjs,wasm}（非 jsep 版）と一致しない）
import * as ort from 'onnxruntime-web/wasm'
import type { ImageLike } from './lib/quantize'

const MODEL_SIZE = 320

let sessionPromise: Promise<ort.InferenceSession> | null = null

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    // GitHub Pages に COOP/COEP ヘッダーがないためマルチスレッドは使えない
    ort.env.wasm.numThreads = 1
    // wasm はバンドル済みモジュールから動的 import されるため、
    // 相対パスだと assets/ 基準に解決されてしまう。ページ基準の絶対 URL にする
    const base = new URL(import.meta.env.BASE_URL, document.baseURI).href
    ort.env.wasm.wasmPaths = `${base}ort/`
    sessionPromise = fetch(`${base}models/u2netp.onnx`)
      .then((res) => {
        if (!res.ok) throw new Error(`モデルの取得に失敗しました (${res.status})`)
        return res.arrayBuffer()
      })
      .then((buf) => ort.InferenceSession.create(buf, { executionProviders: ['wasm'] }))
    // 失敗したら次回呼び出しで再試行できるようにする
    sessionPromise.catch(() => {
      sessionPromise = null
    })
  }
  return sessionPromise
}

function resizeBilinear(
  src: Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const dst = new Float32Array(dw * dh)
  for (let y = 0; y < dh; y++) {
    const fy = ((y + 0.5) * sh) / dh - 0.5
    const y0 = Math.max(0, Math.floor(fy))
    const y1 = Math.min(sh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) * sw) / dw - 0.5
      const x0 = Math.max(0, Math.floor(fx))
      const x1 = Math.min(sw - 1, x0 + 1)
      const tx = fx - x0
      const a = src[y0 * sw + x0]
      const b = src[y0 * sw + x1]
      const c = src[y1 * sw + x0]
      const d = src[y1 * sw + x1]
      dst[y * dw + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
    }
  }
  return dst
}

/**
 * 被写体マスク（画像と同サイズ、0=背景〜1=被写体）を推論する。
 * 初回はモデル読み込みが入るため数秒かかる。
 */
export async function segmentSubject(image: ImageLike): Promise<Float32Array> {
  const session = await getSession()

  // 元画像 → 320×320 に縮小
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = image.width
  srcCanvas.height = image.height
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.putImageData(new ImageData(image.data.slice(), image.width, image.height), 0, 0)

  const small = document.createElement('canvas')
  small.width = MODEL_SIZE
  small.height = MODEL_SIZE
  const smallCtx = small.getContext('2d', { willReadFrequently: true })!
  smallCtx.drawImage(srcCanvas, 0, 0, MODEL_SIZE, MODEL_SIZE)
  const d = smallCtx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data

  // ImageNet 正規化（透明画素は白として扱う）
  const n = MODEL_SIZE * MODEL_SIZE
  const input = new Float32Array(3 * n)
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const a = d[p + 3] / 255
    const w = 255 * (1 - a)
    input[i] = ((d[p] * a + w) / 255 - mean[0]) / std[0]
    input[n + i] = ((d[p + 1] * a + w) / 255 - mean[1]) / std[1]
    input[2 * n + i] = ((d[p + 2] * a + w) / 255 - mean[2]) / std[2]
  }

  const tensor = new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE])
  const outputs = await session.run({ [session.inputNames[0]]: tensor })
  const raw = outputs[session.outputNames[0]].data as Float32Array

  // min-max 正規化して 0..1 に
  let mn = Infinity
  let mx = -Infinity
  for (let i = 0; i < n; i++) {
    const v = raw[i]
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  const range = mx - mn || 1
  const mask320 = new Float32Array(n)
  for (let i = 0; i < n; i++) mask320[i] = (raw[i] - mn) / range

  return resizeBilinear(mask320, MODEL_SIZE, MODEL_SIZE, image.width, image.height)
}

/** マスクを alpha チャンネルに適用する（smoothstep で軽くフェザリング） */
export function applyMask(image: ImageLike, mask: Float32Array): void {
  for (let i = 0; i < mask.length; i++) {
    let t = (mask[i] - 0.25) / 0.5
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const s = t * t * (3 - 2 * t)
    const p = i * 4 + 3
    const a = Math.round(s * 255)
    if (a < image.data[p]) image.data[p] = a
  }
}
