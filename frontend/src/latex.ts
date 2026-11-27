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
  sqrt: '√',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π',
  sigma: 'σ', phi: 'φ', omega: 'ω',
}

export function cleanLatex(text: string): string {
  let out = text
    .replace(/\\\(/g, '').replace(/\\\)/g, '')
    .replace(/\\\[/g, '').replace(/\\\]/g, '')
    // 转义大括号先占位：\{ \} 是字面花括号（集合 {a, b, c} 就靠它），
    // 不能被最后的去括号规则吃掉——以前 \{a, b, c\} 会被洗成 \a, b, c\。
    .replace(/\\\{/g, '\u0001').replace(/\\\}/g, '\u0002')
  // 分数替换循环跑：单遍正则只能换最内层，嵌套分数第一遍只换内层、再跑才换干净；上限 10 次防死循环
  for (let i = 0; i < 10; i++) {
    const next = out.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
    if (next === out) break
    out = next
  }
  return out
    .replace(/\\text\{([^{}]*)\}/g, '$1')
    .replace(/\\(quad|qquad)\b/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, (_m, w) => SYMS[w] || w)
    .replace(/\\[,;:!]/g, '')
    .replace(/([a-zA-Z])_\{(\d+)\}/g, (_m, ch, ds) =>
      ch + ds.split('').map((d: string) => SUBS[d] || d).join(''))
    .replace(/([a-zA-Z])_(\d+)/g, (_m, ch, ds) =>
      ch + ds.split('').map((d: string) => SUBS[d] || d).join(''))
    .replace(/\{([^{}]*)\}/g, (_m, inner: string) =>
      // 字面花括号要留着：集合 {9，8，7}、{x∈R | x<10} 里有逗号/空格/竖线，
      // 不是 LaTeX 分组括号；只有「紧凑」分组（{2}、{x}、\sqrt{9} 剩下的 {9}）才剥掉。
      /[\s，,|∈]/.test(inner) ? `{${inner}}` : inner)
    // 占位的大括号还原成字面花括号
    .replace(/\u0001/g, '{').replace(/\u0002/g, '}')
}
