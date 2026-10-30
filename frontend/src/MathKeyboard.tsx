import { useState } from 'react'

// 数学符号键盘：计算器式符号盘，点一下插到输入框光标处。
// 给 AI 助手 / 错题本 / 笔记本的输入框共用，调用方只负责：
//   1. 给目标 textarea 配一个 ref；
//   2. 用 insertIntoTextarea 把符号插进去（它会处理光标位置和重新聚焦）。
// 分数两种形式都有：斜杠式（/，先打分子、点一下、再打分母）和标准式
// （\frac{}{} 模板，光标落在分子花括号里，AI 能直接读懂）。

export interface MathKey {
  label: string // 盘面上显示的字
  snippet: string // 实际插入的文本
  caret?: number // 插入后光标落在 snippet 起始后的第几位，默认 snippet 末尾
}

const GROUPS: { name: string; keys: MathKey[] }[] = [
  {
    name: '常用',
    keys: [
      { label: '+', snippet: '+' },
      { label: '−', snippet: '−' },
      { label: '×', snippet: '×' },
      { label: '÷', snippet: '÷' },
      { label: '=', snippet: '=' },
      { label: '±', snippet: '±' },
      { label: '·', snippet: '·' },
      { label: '%', snippet: '%' },
      { label: '°', snippet: '°' },
      { label: '（', snippet: '（' },
      { label: '）', snippet: '）' },
      { label: '，', snippet: '，' },
    ],
  },
  {
    name: '分数',
    keys: [
      // \frac{ 分子 }{ 分母 }：snippet 共 8 字符，"\\frac{" 占 6 位，光标落在分子处
      { label: '分数', snippet: '\\frac{}{}', caret: 6 },
      { label: '/', snippet: '/' },
      { label: '√', snippet: '\\sqrt{}', caret: 6 },
      { label: 'x²', snippet: '²' },
      { label: 'x³', snippet: '³' },
      { label: 'xⁿ', snippet: 'x^{}', caret: 3 },
      { label: 'xₙ', snippet: 'x_{}', caret: 3 },
      { label: '^', snippet: '^' },
      { label: '_', snippet: '_' },
    ],
  },
  {
    name: '希腊',
    keys: [
      { label: 'π', snippet: 'π' },
      { label: 'α', snippet: 'α' },
      { label: 'β', snippet: 'β' },
      { label: 'γ', snippet: 'γ' },
      { label: 'δ', snippet: 'δ' },
      { label: 'ε', snippet: 'ε' },
      { label: 'θ', snippet: 'θ' },
      { label: 'λ', snippet: 'λ' },
      { label: 'μ', snippet: 'μ' },
      { label: 'φ', snippet: 'φ' },
      { label: 'ω', snippet: 'ω' },
      { label: 'Δ', snippet: 'Δ' },
    ],
  },
  {
    name: '关系',
    keys: [
      { label: '<', snippet: '<' },
      { label: '>', snippet: '>' },
      { label: '≤', snippet: '≤' },
      { label: '≥', snippet: '≥' },
      { label: '≠', snippet: '≠' },
      { label: '≈', snippet: '≈' },
      { label: '∞', snippet: '∞' },
      { label: '∝', snippet: '∝' },
    ],
  },
  {
    name: '集合微积分',
    keys: [
      { label: '∈', snippet: '∈' },
      { label: '∉', snippet: '∉' },
      { label: '∪', snippet: '∪' },
      { label: '∩', snippet: '∩' },
      { label: '⊂', snippet: '⊂' },
      { label: '⊃', snippet: '⊃' },
      { label: '∅', snippet: '∅' },
      { label: '∀', snippet: '∀' },
      { label: '∃', snippet: '∃' },
      { label: '∴', snippet: '∴' },
      { label: '∵', snippet: '∵' },
      { label: '∑', snippet: '∑' },
      { label: '∫', snippet: '∫' },
      { label: '∂', snippet: '∂' },
      { label: '∇', snippet: '∇' },
      { label: '→', snippet: '→' },
    ],
  },
]

// 把 snippet 插到 textarea 光标处（有选区则替换选区），插完把光标放到
// caret 指定的位置并让输入框重新获得焦点。setTimeout 是为了等 React
// 把新 value 渲染进 DOM 后再设光标，否则光标会被渲染冲掉。
export function insertIntoTextarea(
  el: HTMLTextAreaElement | null,
  value: string,
  setValue: (v: string) => void,
  snippet: string,
  caret?: number,
) {
  if (!el) { setValue(value + snippet); return }
  const start = el.selectionStart ?? value.length
  const end = el.selectionEnd ?? value.length
  const next = value.slice(0, start) + snippet + value.slice(end)
  setValue(next)
  const pos = start + (caret ?? snippet.length)
  setTimeout(() => {
    el.focus()
    try { el.setSelectionRange(pos, pos) } catch { /* 极少数机型不支持，忽略 */ }
  }, 0)
}

export default function MathKeyboard({
  onInsert,
  onClose,
}: {
  onInsert: (snippet: string, caret?: number) => void
  onClose?: () => void
}) {
  const [tab, setTab] = useState(0)
  return (
    <div className="math-panel">
      <div className="math-tabs">
        {GROUPS.map((g, i) => (
          <button key={g.name} className={tab === i ? 'on' : ''}
            onClick={() => setTab(i)}>
            {g.name}
          </button>
        ))}
        {onClose && (
          <button className="math-close" onClick={onClose} aria-label="收起符号盘">×</button>
        )}
      </div>
      <div className="math-grid">
        {GROUPS[tab].keys.map((k) => (
          <button key={k.label} className="math-key"
            onClick={() => onInsert(k.snippet, k.caret)}>
            {k.label}
          </button>
        ))}
      </div>
    </div>
  )
}
