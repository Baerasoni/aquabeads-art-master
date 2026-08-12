# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

写真をアクアビーズ（エポック社）の図案に変換する Web アプリ。完全クライアントサイド（画像は外部送信しない）。
要件定義は [docs/requirements.md](docs/requirements.md) を参照。

## コマンド

- `npm run dev` — 開発サーバー起動
- `npm run build` — 型チェック（tsc -b）+ 本番ビルド
- `npm test` — Vitest 一括実行（単一ファイルは `npx vitest run src/lib/grid.test.ts`）
- `npm run lint` — oxlint
- `npm run convert -- photo.jpg [--auto] [-o out/]` — ヘッドレス変換 CLI（Node / sharp）
- `npm run mcp` — MCP サーバー起動（通常は .mcp.json 経由で Claude Code が起動する）

## アーキテクチャ

処理パイプライン（ブラウザでは完全クライアントサイド。`src/lib/` は DOM 非依存の純関数で、
メインスレッド / Web Worker / Node の3環境で共有される）:

```
File → createImageBitmap → canvas 描画（最大640px・無調整） → base ImageData
     → lib/pipeline.ts runPipeline()（段階キャッシュ PipelineCache 付き）:
        [明るさ・コントラスト・彩度 (lib/adjust.ts — CSS filter の純実装)]
        → [背景除去: AI マスク適用 or 簡易 (lib/preprocess.ts)] → alpha に反映
        → [被写体ズーム cropToSubject] → [Kuwahara 平滑化] → [k-means 減色]
        → 六角セル中心ごとに周辺画素を集約 (lib/grid.ts, lib/quantize.ts)
           - 不透明率 < emptyBelow（既定0.35）のセルは EMPTY_CELL(-1) = 空きマス
           - 輪郭オプション: エッジ密度 or 空きマス隣接セルを最暗色に
        → CIELAB 最近傍色マッピング (lib/colorspace.ts)
        → Pattern + CellStats（スコア用中間データ, lib/quantize.ts）
     → 品質スコア (lib/score.ts) / 図案表示 / ビーズ数集計 / 印刷（src/components/）
```

AI マスクの推論（src/segmentation.ts, DOM+ort 依存）だけはパイプラインの外で行い、
Float32Array を runPipeline に渡す。

### おまかせ自動調整（lib/autoAdjust.ts）

品質スコア（lib/score.ts: 近傍平均 ΔE2000 + 明度構造の保存 + L レンジ + ペナルティ）を
目的関数に、ヒストグラム由来の決定的シード + 座標降下（約40評価）でパラメータを探索する。
ブラウザでは 320px 縮小画像に対して Web Worker（src/worker/）で実行し、
確定パラメータを通常パイプラインにフル解像度で適用する。posterizeKMeans が決定的
（乱数不使用）なため探索は再現可能。

### MCP サーバー（mcp/ — 開発者ローカル専用、Vite ビルド対象外）

`mcp/server.ts`（stdio, .mcp.json に登録済み）で Claude Code から図案変換を反復操作できる:
`convert`（画像+パラメータ → プレビュー PNG + スコア + ビーズ数）/ `render_original` /
`auto_adjust` / `list_palette`。画像デコードと PNG 化だけ sharp（devDependency）を使い、
変換本体は src/lib/ をそのまま import する。AI 背景除去は Node 未対応で、
`background: 'auto'` は 'simple' に読み替えられる（警告付き）。
図案の SVG レンダリングは lib/renderSvg.ts（純関数）。

- AI 背景除去は `onnxruntime-web/wasm` エントリを使うこと（デフォルトエントリは jsep 版 wasm を
  要求し、public/ort/ に置いた非 jsep 版と一致せず失敗する）
- ort 本体（ort.wasm.bundle.min.mjs）はバンドラを通さず public/ort/ から実行時 import する
  （`ort.env.wasm.proxy = true` の Worker がバンドラ産チャンクだとアプリ本体まで実行して落ちるため）。
  public/ort/ の3ファイルと onnxruntime-web は同一バージョンで揃えて更新すること
- モデル public/models/u2netp.onnx（rembg 配布, U²-Net Apache-2.0）と wasm ランタイム public/ort/ は自前ホスト

- 状態管理は React 標準（useState/useReducer）。状態ライブラリは使わない
- テストは `lib/` の純関数と `mcp/core.ts` を対象にする。UI コンポーネントのテストは書いていない
- 設定（adjust / illust / options / spec）は localStorage `aqua.settings.v1` に永続化
  （lib/settings.ts — 読込時にフィールド単位で検証・既定値補完）

## ドメイン知識（公式サイト調査済みの確定仕様 — 変更しないこと）

- **グリッドは六角オフセット配置**。正方格子で実装してはいけない
  - 横ピッチ 5.0mm、行間 4.33mm（= 5×√3/2）、奇数行は +2.5mm オフセット
  - 標準ビーズトレイ: 偶数行22個 / 奇数行21個 × 26行 = **559マス**（テストの検証値）
  - 出典: 公式「オリジナル用ビーズトレイシート」PDF（aquabeadsart.com/ja-jp/sites/default/files/2023-01/501.pdf）の描画データ解析
- **色パレットは `src/lib/palette.ts` に集約**（公式ビーズ対応表由来の色名 + 色見本 PNG からサンプリングした RGB）
  - 公式サイトは通常の HTTP 取得（curl / WebFetch）を 403 でブロックする。再取得が必要な場合は in-app browser のページコンテキストから fetch する
  - 色見本 URL 例: `aquabeadsart.com/ja-jp/asset/img/about/beadslist/img_m_01.png`（alt 属性が色名）
- **印刷シートは原寸が必須要件**。mm 単位の CSS + `@media print` で 5.0mm ピッチを厳守（トレイの下に敷いて使うため）
- 六角配置のため「canvas 縮小で 1 セル = 1 画素」方式は使えない。セル中心座標ごとに周辺画素を集約する

## デザイン方針

- Apple 風の洗練されたミニマルデザイン（ユーザー指定）
- 余白重視・控えめな配色（図案のビーズ色が主役）・システムフォントスタック・日本語 UI
