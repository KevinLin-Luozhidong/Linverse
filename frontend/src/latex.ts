// LaTeX 转 plain text：把 AI/OCR 可能输出的 LaTeX 标记转成能直接看的文本
// \(x\) → x，\frac{1}{x} → 1/x，x_1 → x₁，\cdot → ·，\neq → ≠

const SUBS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
}
const SYMS: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', pm: '±', neq: '≠',
  leq: '≤', geq: '≥', approx: '≈', infty: '∞',
  perp: '⊥', parallel: '∥', angle: '∠', triangle: '△',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π',
  sigma: 'σ', phi: 'φ', omega: 'ω',
}

export function cleanLatex(text: string): string {
  return text
    .replace(/\\\(/g, '').replace(/\\\)/g, '')
    .replace(/\\\[/g, '').replace(/\\\]/g, '')
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
    .replace(/\\text\{([^{}]*)\}/g, '$1')
    .replace(/\\(quad|qquad)\b/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, (_m, w) => SYMS[w] || w)
    .replace(/\\[,;:!]/g, '')
    .replace(/([a-zA-Z])_\{(\d+)\}/g, (_m, ch, ds) =>
      ch + ds.split('').map((d: string) => SUBS[d] || d).join(''))
    .replace(/([a-zA-Z])_(\d+)/g, (_m, ch, ds) =>
      ch + ds.split('').map((d: string) => SUBS[d] || d).join(''))
    .replace(/\{([^{}]*)\}/g, '$1')
}
