// autoAdjust Worker とメインスレッドのメッセージ型

import type { AutoAdjustProgress, AutoAdjustResult } from '../lib/autoAdjust'
import type { GridSpec } from '../lib/grid'
import type { BeadColor } from '../lib/palette'
import type { PipelineParams } from '../lib/pipeline'
import type { ImageLike } from '../lib/quantize'

export interface AutoAdjustRequest {
  base: ImageLike
  mask: Float32Array | null
  seed: PipelineParams
  spec: GridSpec
  palette: BeadColor[]
}

export type AutoAdjustMessage =
  | ({ type: 'progress' } & AutoAdjustProgress)
  | { type: 'done'; result: AutoAdjustResult }
  | { type: 'error'; message: string }
