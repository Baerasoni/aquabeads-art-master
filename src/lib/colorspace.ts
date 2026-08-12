// sRGB → CIELAB 変換と色距離（ΔE）
//
// パレット最近傍マッピングは RGB のユークリッド距離ではなく、
// 人間の知覚に近い CIELAB 空間で行う（暗部・肌色での色化けを防ぐ）。
// ΔE は cie76（軽量）と ciede2000（高精度）を選択できる。

export type RGB = [number, number, number]

export interface Lab {
  L: number
  a: number
  b: number
}

export type DeltaEMethod = 'cie76' | 'ciede2000'

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** sRGB (0-255) → CIELAB（D65 白色点） */
export function srgbToLab(rgb: RGB): Lab {
  const r = srgbToLinear(rgb[0])
  const g = srgbToLinear(rgb[1])
  const b = srgbToLinear(rgb[2])

  // sRGB → XYZ (D65)
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b

  // XYZ → Lab
  const xn = 0.95047
  const yn = 1.0
  const zn = 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
  const fx = f(x / xn)
  const fy = f(y / yn)
  const fz = f(z / zn)

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

/** ΔE76: Lab 空間の単純なユークリッド距離 */
export function deltaE76(c1: Lab, c2: Lab): number {
  return Math.hypot(c1.L - c2.L, c1.a - c2.a, c1.b - c2.b)
}

const DEG = Math.PI / 180
const POW25_7 = 25 ** 7

/** ΔE2000 (CIEDE2000)。Sharma et al. (2005) の定義に従う */
export function deltaE2000(c1: Lab, c2: Lab): number {
  const C1 = Math.hypot(c1.a, c1.b)
  const C2 = Math.hypot(c2.a, c2.b)
  const Cbar = (C1 + C2) / 2
  const Cbar7 = Cbar ** 7
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)))

  const a1p = (1 + G) * c1.a
  const a2p = (1 + G) * c2.a
  const C1p = Math.hypot(a1p, c1.b)
  const C2p = Math.hypot(a2p, c2.b)

  const h1p = C1p === 0 ? 0 : (Math.atan2(c1.b, a1p) / DEG + 360) % 360
  const h2p = C2p === 0 ? 0 : (Math.atan2(c2.b, a2p) / DEG + 360) % 360

  const dLp = c2.L - c1.L
  const dCp = C2p - C1p

  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * DEG)

  const Lbp = (c1.L + c2.L) / 2
  const Cbp = (C1p + C2p) / 2

  let hbp: number
  if (C1p * C2p === 0) {
    hbp = h1p + h2p
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbp = (h1p + h2p) / 2
  } else if (h1p + h2p < 360) {
    hbp = (h1p + h2p + 360) / 2
  } else {
    hbp = (h1p + h2p - 360) / 2
  }

  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * DEG) +
    0.24 * Math.cos(2 * hbp * DEG) +
    0.32 * Math.cos((3 * hbp + 6) * DEG) -
    0.2 * Math.cos((4 * hbp - 63) * DEG)

  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2))
  const Cbp7 = Cbp ** 7
  const RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + POW25_7))
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2)
  const SC = 1 + 0.045 * Cbp
  const SH = 1 + 0.015 * Cbp * T
  const RT = -Math.sin(2 * dTheta * DEG) * RC

  const l = dLp / SL
  const c = dCp / SC
  const h = dHp / SH
  return Math.sqrt(l * l + c * c + h * h + RT * c * h)
}

/** 2色の知覚的距離。method で計算方式を選択できる */
export function deltaE(c1: Lab, c2: Lab, method: DeltaEMethod = 'ciede2000'): number {
  return method === 'cie76' ? deltaE76(c1, c2) : deltaE2000(c1, c2)
}
