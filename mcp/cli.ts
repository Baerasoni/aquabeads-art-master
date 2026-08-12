// ヘッドレス変換 CLI（テスト・手動確認用）
//
//   npx tsx mcp/cli.ts photo.jpg                     # 既定値で変換
//   npx tsx mcp/cli.ts photo.jpg --colors 8 -o out/  # パラメータ指定
//   npx tsx mcp/cli.ts photo.jpg --auto              # おまかせ自動調整
//
// 出力: プレビュー PNG（<出力先>/<画像名>.pattern.png）とスコア JSON（stdout）

import path from 'node:path'
import process from 'node:process'
import type { PipelineParams } from '../src/lib/pipeline'
import { autoAdjustImage, convertImage, svgToPng } from './core'

function usage(): never {
  console.error(
    'usage: npx tsx mcp/cli.ts <image> [--auto] [-o outDir] [--colors N] [--background none|simple]\n' +
      '       [--brightness N] [--contrast N] [--saturation N] [--dither] [--no-outline]\n' +
      '       [--empty-below F] [--owned id1,id2,...]',
  )
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.length === 0) usage()

const imagePath = path.resolve(args[0])
let outDir = process.cwd()
let auto = false
let ownedIds: string[] | undefined
const params: Partial<PipelineParams> = {}
const adjust: Record<string, number> = {}

for (let i = 1; i < args.length; i++) {
  const a = args[i]
  const next = () => {
    i++
    if (i >= args.length) usage()
    return args[i]
  }
  if (a === '--auto') auto = true
  else if (a === '-o' || a === '--out') outDir = path.resolve(next())
  else if (a === '--colors') params.colors = Number(next())
  else if (a === '--background') params.background = next() as PipelineParams['background']
  else if (a === '--brightness') adjust.brightness = Number(next())
  else if (a === '--contrast') adjust.contrast = Number(next())
  else if (a === '--saturation') adjust.saturation = Number(next())
  else if (a === '--dither') params.dither = true
  else if (a === '--no-outline') params.outline = false
  else if (a === '--empty-below') params.emptyBelow = Number(next())
  else if (a === '--owned') ownedIds = next().split(',')
  else usage()
}
if (Object.keys(adjust).length > 0) {
  params.adjust = { brightness: 100, contrast: 100, saturation: 100, ...adjust }
}

const name = path.basename(imagePath).replace(/\.[^.]+$/, '')

if (auto) {
  const { auto: result, converted } = await autoAdjustImage({ imagePath, seedParams: params, ownedIds })
  const pngPath = await svgToPng(converted.svg, path.join(outDir, `${name}.pattern.png`))
  console.log(
    JSON.stringify(
      {
        preview: pngPath,
        seedScore: result.seedScore.total,
        bestScore: result.score.total,
        evaluated: result.evaluated,
        params: result.params,
        score: converted.score,
        totalBeads: converted.totalBeads,
        emptyCells: converted.emptyCells,
        warnings: converted.warnings,
      },
      null,
      2,
    ),
  )
} else {
  const converted = await convertImage({ imagePath, params, ownedIds })
  const pngPath = await svgToPng(converted.svg, path.join(outDir, `${name}.pattern.png`))
  console.log(
    JSON.stringify(
      {
        preview: pngPath,
        score: converted.score,
        totalBeads: converted.totalBeads,
        emptyCells: converted.emptyCells,
        beadCounts: converted.beadCounts.map((b) => ({ name: b.color.name, code: b.color.code, count: b.count })),
        paramsUsed: converted.paramsUsed,
        warnings: converted.warnings,
      },
      null,
      2,
    ),
  )
}
