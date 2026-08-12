// おまかせ自動調整を Web Worker で実行する（メインスレッドの UI を固めない）。
// lib/ が純関数のため、ここは autoAdjust を呼んで結果を返すだけの薄い層

import type { AutoAdjustRequest, AutoAdjustMessage } from './autoAdjustTypes'
import { autoAdjust } from '../lib/autoAdjust'

const post = (msg: AutoAdjustMessage) => self.postMessage(msg)

self.onmessage = async (e: MessageEvent<AutoAdjustRequest>) => {
  const { base, mask, seed, spec, palette } = e.data
  try {
    const result = await autoAdjust(base, mask, seed, spec, palette, {
      onProgress: (p) => post({ type: 'progress', ...p }),
    })
    post({ type: 'done', result })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
