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

## アーキテクチャ

処理パイプライン（すべてブラウザ内、`src/lib/` は UI 非依存の純関数）:

```
File → createImageBitmap → canvas 描画 → ImageData
     → 六角セル中心ごとに周辺画素を集約 (lib/grid.ts)
     → CIELAB 最近傍色マッピング (lib/colorspace.ts, lib/quantize.ts)
     → Pattern（行ごとに長さの異なる配列の配列, lib/pattern.ts）
     → 図案表示 / ビーズ数集計 / 印刷（src/components/）
```

- 状態管理は React 標準（useState/useReducer）。状態ライブラリは使わない
- テストは `lib/` の純関数を対象にする。UI コンポーネントのテストは書いていない

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
