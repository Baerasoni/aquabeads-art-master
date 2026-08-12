// アクアビーズ変換 MCP サーバー（stdio）
//
// Claude Code / Claude Desktop から図案変換を反復操作するための開発者向けツール。
// 画像 → 図案のプレビュー PNG と品質スコアを返すので、Claude が結果を見ながら
// パラメータを調整できる。すべてローカル実行（画像は外部送信されない）。
//
// 起動: npx tsx mcp/server.ts（リポジトリの .mcp.json に登録済み）

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { AQUA_PALETTE } from '../src/lib/palette'
import type { PipelineParams } from '../src/lib/pipeline'
import type { ConvertResult } from './core'
import { autoAdjustImage, convertImage, renderOriginalPng, svgToPng } from './core'

const OUT_DIR_DEFAULT = path.join(tmpdir(), 'aquabeads-mcp')

const gridSpecSchema = z
  .object({
    rows: z.number().int().min(2).max(80),
    cols: z.number().int().min(2).max(80),
    longFirst: z.boolean().default(false),
  })
  .describe('グリッド仕様。省略時は標準トレイ (26行 × 22列 = 559マス)')

const paramsSchema = z
  .object({
    adjust: z
      .object({
        brightness: z.number().min(40).max(160).default(100),
        contrast: z.number().min(40).max(160).default(100),
        saturation: z.number().min(40).max(160).default(100),
      })
      .partial()
      .optional()
      .describe('明るさ・コントラスト・彩度 (%)'),
    background: z
      .enum(['none', 'simple', 'auto'])
      .optional()
      .describe('背景除去。auto (AI) は未対応で simple に読み替えられる'),
    autoZoom: z.boolean().optional().describe('被写体の外接矩形にズーム'),
    posterize: z.boolean().optional().describe('k-means 減色を行う'),
    colors: z.number().int().min(3).max(16).optional().describe('減色後の色数'),
    smooth: z.boolean().optional().describe('Kuwahara 平滑化'),
    smoothRadius: z.number().int().min(1).max(4).optional(),
    outline: z.boolean().optional().describe('輪郭ビーズ（最暗色で縁取り）'),
    outlineStrength: z.number().min(0).max(100).optional(),
    emptyBelow: z.number().min(0.05).max(0.8).optional().describe('空きマスにする不透明率の下限'),
    deltaE: z.enum(['ciede2000', 'cie76']).optional(),
    repColor: z.enum(['median', 'mean', 'mode']).optional(),
    dither: z.boolean().optional().describe('誤差拡散ディザリング'),
  })
  .describe('変換パラメータ。省略した項目はアプリの既定値')

const ownedIdsSchema = z
  .array(z.string())
  .optional()
  .describe('手持ちビーズの色 ID（list_palette 参照）。省略時は基本16色')

interface ToolImage {
  type: 'image'
  data: string
  mimeType: string
}

async function previewContent(result: ConvertResult, outDir: string, name: string) {
  const pngPath = path.join(outDir, `${name}.png`)
  await svgToPng(result.svg, pngPath)
  const { readFile } = await import('node:fs/promises')
  const png = await readFile(pngPath)
  const image: ToolImage = { type: 'image', data: png.toString('base64'), mimeType: 'image/png' }
  const summary = {
    previewPath: pngPath,
    score: result.score,
    totalBeads: result.totalBeads,
    emptyCells: result.emptyCells,
    beadCounts: result.beadCounts.map((b) => ({
      id: b.color.id,
      name: b.color.name,
      code: b.color.code,
      count: b.count,
    })),
    paramsUsed: result.paramsUsed,
    warnings: result.warnings,
  }
  return { image, summary }
}

const server = new McpServer({ name: 'aquabeads', version: '1.0.0' })

server.registerTool(
  'convert',
  {
    description:
      '画像をアクアビーズ図案に変換する。プレビュー PNG（画像）と品質スコア・ビーズ数（JSON）を返す。' +
      'パラメータを変えて何度も呼び、プレビューを見比べて調整する使い方を想定。',
    inputSchema: {
      imagePath: z.string().describe('変換する画像ファイルの絶対パス'),
      params: paramsSchema.optional(),
      spec: gridSpecSchema.optional(),
      ownedIds: ownedIdsSchema,
      outDir: z.string().optional().describe('プレビュー PNG の出力先（既定: 一時ディレクトリ）'),
    },
  },
  async ({ imagePath, params, spec, ownedIds, outDir }) => {
    const result = await convertImage({
      imagePath,
      params: params as Partial<PipelineParams> | undefined,
      spec,
      ownedIds,
    })
    const dir = outDir ?? OUT_DIR_DEFAULT
    const { image, summary } = await previewContent(result, dir, `convert-${Date.now()}`)
    return {
      content: [image, { type: 'text', text: JSON.stringify(summary, null, 2) }],
    }
  },
)

server.registerTool(
  'render_original',
  {
    description: '元画像を縮小 PNG で返す（図案プレビューと並べて比較するため）。',
    inputSchema: {
      imagePath: z.string().describe('画像ファイルの絶対パス'),
      outDir: z.string().optional(),
    },
  },
  async ({ imagePath, outDir }) => {
    const dir = outDir ?? OUT_DIR_DEFAULT
    const outPath = path.join(dir, `original-${Date.now()}.png`)
    await renderOriginalPng(imagePath, outPath)
    const { readFile } = await import('node:fs/promises')
    const png = await readFile(outPath)
    return {
      content: [
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
        { type: 'text', text: JSON.stringify({ path: outPath }) },
      ],
    }
  },
)

server.registerTool(
  'auto_adjust',
  {
    description:
      'おまかせ自動調整: 品質スコアを目的関数にパラメータを探索し、最良パラメータでの変換結果' +
      '（プレビュー PNG + before/after スコア）を返す。ここから convert で微調整するのが速い。',
    inputSchema: {
      imagePath: z.string().describe('変換する画像ファイルの絶対パス'),
      seedParams: paramsSchema.optional().describe('探索の初期値（省略時は既定値から探索）'),
      spec: gridSpecSchema.optional(),
      ownedIds: ownedIdsSchema,
      outDir: z.string().optional(),
    },
  },
  async ({ imagePath, seedParams, spec, ownedIds, outDir }) => {
    const { auto, converted } = await autoAdjustImage({
      imagePath,
      seedParams: seedParams as Partial<PipelineParams> | undefined,
      spec,
      ownedIds,
    })
    const dir = outDir ?? OUT_DIR_DEFAULT
    const { image, summary } = await previewContent(converted, dir, `auto-${Date.now()}`)
    return {
      content: [
        image,
        {
          type: 'text',
          text: JSON.stringify(
            {
              ...summary,
              autoAdjust: {
                seedScore: auto.seedScore.total,
                bestScore: auto.score.total,
                evaluated: auto.evaluated,
                bestParams: auto.params,
              },
            },
            null,
            2,
          ),
        },
      ],
    }
  },
)

server.registerTool(
  'list_palette',
  {
    description: 'アクアビーズ全55色の一覧（id / 色名 / 記号 / RGB / 種類）を返す。',
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          AQUA_PALETTE.map((c) => ({ id: c.id, name: c.name, code: c.code, type: c.type, rgb: c.rgb })),
          null,
          2,
        ),
      },
    ],
  }),
)

await server.connect(new StdioServerTransport())
