// Colour helpers for checking the role indicator's colours.

export interface Rgb {
  readonly r: number // 0..1
  readonly g: number
  readonly b: number
}

export function toHex({ r, g, b }: Rgb) {
  return `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`
}

export function fromHex(hex: string): Rgb {
  const value = hex.replace(/^#/, "")
  return {
    r: Number.parseInt(value.slice(0, 2), 16) / 255,
    g: Number.parseInt(value.slice(2, 4), 16) / 255,
    b: Number.parseInt(value.slice(4, 6), 16) / 255,
  }
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: Rgb, b: Rgb) {
  const lum = ({ r, g, b }: Rgb) => {
    const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05)
}
