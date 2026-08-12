// アクアビーズ公式色パレット
//
// 色名・種類は公式ビーズ対応表（aquabeadsart.com/ja-jp/about/beadslist）に準拠。
// RGB は公式色見本 PNG（/ja-jp/asset/img/about/beadslist/img_m_XX.png 等）を
// ピクセルサンプリングして取得（ベタ塗り色は最頻色、グラデーション系は中央値）。
// 公式注記のとおりロットにより実物の色味は多少異なるため、必要ならここの値だけ直せばよい。
//
// 例外: しろ / パールホワイト / とうめい はサンプリングが陰影・光沢を拾うため手動補正値。

export type BeadType = 'round' | 'sparkle'

export interface BeadColor {
  /** 公式画像ファイル由来の安定 ID（例: m01） */
  id: string
  /** 公式色名 */
  name: string
  type: BeadType
  /** 図案・印刷シートに印字する記号（白黒でも判別できるように） */
  code: string
  rgb: [number, number, number]
}

export const AQUA_PALETTE: BeadColor[] = [
  // まるビーズ — 基本色
  { id: 'm01', name: 'あか', type: 'round', code: '1', rgb: [231, 0, 18] },
  { id: 'm02', name: 'オレンジ', type: 'round', code: '2', rgb: [244, 152, 0] },
  { id: 'm03', name: 'きいろ', type: 'round', code: '3', rgb: [255, 228, 0] },
  { id: 'm04', name: 'ピンク', type: 'round', code: '4', rgb: [238, 135, 180] },
  { id: 'm05', name: 'むらさき', type: 'round', code: '5', rgb: [125, 70, 152] },
  { id: 'm06', name: 'あお', type: 'round', code: '6', rgb: [0, 122, 196] },
  { id: 'm07', name: 'みずいろ', type: 'round', code: '7', rgb: [56, 181, 228] },
  { id: 'm08', name: 'きみどり', type: 'round', code: '8', rgb: [165, 193, 51] },
  { id: 'm09', name: 'みどり', type: 'round', code: '9', rgb: [0, 169, 69] },
  { id: 'm10', name: 'ちゃいろ', type: 'round', code: '10', rgb: [133, 76, 18] },
  { id: 'm11', name: 'キャラメルブラウン', type: 'round', code: '11', rgb: [177, 129, 51] },
  { id: 'm12', name: 'ペールオレンジ', type: 'round', code: '12', rgb: [251, 218, 200] },
  { id: 'm13', name: 'アイボリー', type: 'round', code: '13', rgb: [255, 252, 199] },
  { id: 'm14', name: 'しろ', type: 'round', code: '14', rgb: [244, 244, 244] }, // 手動補正
  { id: 'm15', name: 'はいいろ', type: 'round', code: '15', rgb: [157, 157, 158] },
  { id: 'm16', name: 'くろ', type: 'round', code: '16', rgb: [75, 72, 71] },
  // まるビーズ — パステル
  { id: 'm17', name: 'ライトピンク', type: 'round', code: '17', rgb: [224, 173, 187] },
  { id: 'm18', name: 'ライトパープル', type: 'round', code: '18', rgb: [173, 184, 204] },
  { id: 'm19', name: 'スカイブルー', type: 'round', code: '19', rgb: [167, 194, 194] },
  { id: 'm20', name: 'ライムグリーン', type: 'round', code: '20', rgb: [188, 197, 45] },
  // まるビーズ — メタル / パール
  { id: 'm21', name: 'メタルレッド', type: 'round', code: '21', rgb: [220, 90, 67] },
  { id: 'm22', name: 'シャンパンゴールド', type: 'round', code: '22', rgb: [214, 206, 110] },
  { id: 'm23', name: 'メタルパープル', type: 'round', code: '23', rgb: [134, 96, 154] },
  { id: 'm24', name: 'メタルブルー', type: 'round', code: '24', rgb: [73, 123, 161] },
  { id: 'm25', name: 'メタルライトブルー', type: 'round', code: '25', rgb: [116, 190, 233] },
  { id: 'm26', name: 'メタルグリーン', type: 'round', code: '26', rgb: [98, 170, 100] },
  { id: 'm27', name: 'メタルブラウン', type: 'round', code: '27', rgb: [140, 101, 71] },
  { id: 'm28', name: 'パールホワイト', type: 'round', code: '28', rgb: [238, 236, 230] }, // 手動補正
  { id: 'm29', name: 'メタルブラック', type: 'round', code: '29', rgb: [110, 106, 105] },
  { id: 'm30', name: 'ゴールド', type: 'round', code: '30', rgb: [211, 153, 81] },
  { id: 'm31', name: 'シルバー', type: 'round', code: '31', rgb: [199, 199, 200] },
  { id: 'm32', name: 'ブロンズ', type: 'round', code: '32', rgb: [219, 116, 90] },
  // まるビーズ — マーブル（2色混合。RGB は混合の代表値）
  { id: 'm39', name: 'ダークレッド×パープル', type: 'round', code: '33', rgb: [165, 72, 94] },
  { id: 'm33', name: 'イエロー×ブラウン', type: 'round', code: '34', rgb: [197, 143, 81] },
  { id: 'm34', name: 'ライトピンク×オレンジ', type: 'round', code: '35', rgb: [184, 152, 113] },
  { id: 'm38', name: 'ライトブルー×ピンク', type: 'round', code: '36', rgb: [177, 139, 180] },
  { id: 'm35', name: 'スカイブルー×ホワイト', type: 'round', code: '37', rgb: [117, 170, 194] },
  { id: 'm36', name: 'ミントグリーン×イエロー', type: 'round', code: '38', rgb: [175, 190, 151] },
  { id: 'm37', name: 'エメラルド×イエロー', type: 'round', code: '39', rgb: [90, 177, 143] },
  // まるビーズ — ネオン
  { id: 'm40', name: 'ネオンレッド', type: 'round', code: '40', rgb: [230, 0, 68] },
  { id: 'm41', name: 'ネオンオレンジ', type: 'round', code: '41', rgb: [237, 108, 0] },
  { id: 'm42', name: 'ネオンイエロー', type: 'round', code: '42', rgb: [230, 228, 0] },
  { id: 'm43', name: 'ネオンピンク', type: 'round', code: '43', rgb: [230, 46, 139] },
  { id: 'm44', name: 'ネオンパープル', type: 'round', code: '44', rgb: [121, 85, 161] },
  { id: 'm45', name: 'ネオンブルー', type: 'round', code: '45', rgb: [0, 157, 225] },
  { id: 'm46', name: 'ネオングリーン', type: 'round', code: '46', rgb: [0, 169, 67] },
  // まるビーズ — その他
  { id: 'm47', name: 'とうめい', type: 'round', code: '47', rgb: [220, 237, 245] }, // 手動補正（図案用の近似値）
  // キラキラビーズ
  { id: 'k01', name: 'あか', type: 'sparkle', code: 'K1', rgb: [230, 100, 48] },
  { id: 'k02', name: 'オレンジ', type: 'sparkle', code: 'K2', rgb: [232, 141, 49] },
  { id: 'k03', name: 'きいろ', type: 'sparkle', code: 'K3', rgb: [246, 203, 53] },
  { id: 'k04', name: 'ピンク', type: 'sparkle', code: 'K4', rgb: [238, 151, 187] },
  { id: 'k05', name: 'むらさき', type: 'sparkle', code: 'K5', rgb: [106, 91, 158] },
  { id: 'k06', name: 'あお', type: 'sparkle', code: 'K6', rgb: [19, 171, 229] },
  { id: 'k07', name: 'みどり', type: 'sparkle', code: 'K7', rgb: [127, 189, 70] },
  { id: 'k08', name: 'ちゃいろ', type: 'sparkle', code: 'K8', rgb: [155, 98, 42] },
]

/** 手持ち色の初期選択: 基本16色（入門セット相当） */
export const DEFAULT_OWNED_IDS: string[] = AQUA_PALETTE.slice(0, 16).map((c) => c.id)

export function beadColorById(id: string): BeadColor | undefined {
  return AQUA_PALETTE.find((c) => c.id === id)
}
