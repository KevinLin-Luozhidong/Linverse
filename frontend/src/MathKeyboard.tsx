import { useState } from 'react'

// 数学符号键盘第二轮：计算器式符号盘，点一下插到输入框光标处。
// 给 AI 助手 / 错题本 / 笔记本的输入框共用，调用方只负责：
//   1. 给目标 textarea 配一个 ref；
//   2. 用 insertIntoTextarea / deleteBackward 操作（两者都不调 focus，
//      因为符号键的 pointerdown 已经阻止了焦点转移，焦点本来就没丢）。
// 分数两种形式都有：斜杠式（/，先打分子、点一下、再打分母）和标准式
// （\frac{}{} 模板，光标落在分子花括号里，AI 能直接读懂）。
// 出稿：GPT-5.6 Luna（替补，Claude 不可用，见 README）；主助手复核修正：
// “关系微积分”组 18 键超 16 键上限，已拆为“关系”组与“微积分逻辑”组。

export interface MathKey {
  label: string // 盘面上显示的字
  snippet: string // 实际插入的文本
  caret?: number // 插入后光标落在 snippet 起始后的第几位，默认 snippet 末尾
  action?: 'insert' | 'backspace' // 默认 insert；backspace 走 onBackspace
}

const GROUPS: { name: string; keys: MathKey[] }[] = [
  {
    name: '数字',
    keys: [
      { label: '1', snippet: '1' },
      { label: '2', snippet: '2' },
      { label: '3', snippet: '3' },
      { label: '4', snippet: '4' },
      { label: '5', snippet: '5' },
      { label: '6', snippet: '6' },
      { label: '7', snippet: '7' },
      { label: '8', snippet: '8' },
      { label: '9', snippet: '9' },
      { label: '0', snippet: '0' },
      { label: '.', snippet: '.' },
      { label: '⌫', snippet: '', action: 'backspace' },
    ],
  },
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
      { label: '[', snippet: '[' },
      { label: ']', snippet: ']' },
      { label: '!', snippet: '!' },
      { label: '∠', snippet: '∠' },
      { label: '，', snippet: '，' },
    ],
  },
  {
    name: '分数根号',
    keys: [
      // \frac{ 分子 }{ 分母 }：snippet 共 8 字符，"\\frac{" 占 6 位，光标落在分子处
      { label: '分数', snippet: '\\frac{}{}', caret: 6 },
      { label: '/', snippet: '/' },
      { label: '√', snippet: '\\sqrt{}', caret: 6 },
      { label: 'x²', snippet: '²' },
      { label: 'x³', snippet: '³' },
      { label: 'xⁿ', snippet: 'x^{}', caret: 3 },
      { label: 'xₙ', snippet: 'x_{}', caret: 3 },
      { label: '绝对值', snippet: '||', caret: 1 },
      { label: '^', snippet: '^' },
      { label: '_', snippet: '_' },
    ],
  },
  {
    name: '函数',
    keys: [
      // 注意：f(x) 的 x 已是占位符，光标默认落末尾，接着打 = 就是 f(x)=，不写 caret: 2
      //（caret: 2 会让光标落在 ( 和 x 之间，接着打 = 会变成 f(=x)。
      { label: 'f(x)', snippet: 'f(x)' },
      { label: 'sin(', snippet: 'sin()', caret: 4 },
      { label: 'cos(', snippet: 'cos()', caret: 4 },
      { label: 'tan(', snippet: 'tan()', caret: 4 },
      { label: 'log(', snippet: 'log()', caret: 4 },
      { label: 'ln(', snippet: 'ln()', caret: 3 },
      { label: 'lg(', snippet: 'lg()', caret: 3 },
      // \log_{ 底数 }( 真数 )："\\log_{" 占 6 位，光标落在底数花括号里
      { label: 'log 底数', snippet: '\\log_{}()', caret: 6 },
      { label: 'e', snippet: 'e' },
      { label: 'e^x', snippet: 'e^{}', caret: 3 },
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
    name: '集合',
    keys: [
      { label: '∈', snippet: '∈' },
      { label: '∉', snippet: '∉' },
      { label: '∪', snippet: '∪' },
      { label: '∩', snippet: '∩' },
      { label: '⊂', snippet: '⊂' },
      { label: '⊃', snippet: '⊃' },
      { label: '⊆', snippet: '⊆' },
      { label: '⊇', snippet: '⊇' },
      { label: '∅', snippet: '∅' },
      { label: '∁', snippet: '∁' },
      { label: 'ℕ', snippet: 'ℕ' },
      { label: 'ℤ', snippet: 'ℤ' },
      { label: 'ℚ', snippet: 'ℚ' },
      { label: 'ℝ', snippet: 'ℝ' },
      { label: 'ℂ', snippet: 'ℂ' },
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
    name: '微积分逻辑',
    keys: [
      { label: '→', snippet: '→' },
      { label: '∑', snippet: '∑' },
      { label: '∫', snippet: '∫' },
      { label: '∂', snippet: '∂' },
      { label: '∇', snippet: '∇' },
      { label: '∀', snippet: '∀' },
      { label: '∃', snippet: '∃' },
      { label: '∴', snippet: '∴' },
      { label: '∵', snippet: '∵' },
      // \vec{ 向量 }："\\vec{" 占 5 位，光标落在花括号里
      { label: '向量', snippet: '\\vec{}', caret: 5 },
      // 常用逻辑用语（必修一第一章：充分条件 ⇒、必要条件 ⇔、且 ∧、或 ∨、非 ¬）
      { label: '⇒', snippet: '⇒' },
      { label: '⇔', snippet: '⇔' },
      { label: '∧', snippet: '∧' },
      { label: '∨', snippet: '∨' },
      { label: '¬', snippet: '¬' },
    ],
  },
]

// 把 snippet 插到 textarea 光标处（有选区则替换选区），插完只恢复光标，
// 不调 focus：符号键的 pointerdown 已经阻止了焦点转移，焦点本来就没丢；
// 重新 focus 会让移动端系统键盘重新弹起，正是卡顿的来源之一。
// 没聚焦时的兜底仍是追加到末尾（selectionStart 取不到时用 value.length）。
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
    try { el.setSelectionRange(pos, pos) } catch { /* 极少数机型不支持，忽略 */ }
  }, 0)
}

// 退格：删光标前一个字符（有选区则删选区），光标在开头时不动；
// 同样不调 focus；输入框不存在时不执行，避免误改内容。
export function deleteBackward(
  el: HTMLTextAreaElement | null,
  value: string,
  setValue: (v: string) => void,
) {
  if (!el) return
  const start = el.selectionStart ?? value.length
  const end = el.selectionEnd ?? value.length
  let next = value
  let pos = start
  if (start !== end) {
    next = value.slice(0, start) + value.slice(end)
    pos = start
  } else if (start > 0) {
    next = value.slice(0, start - 1) + value.slice(end)
    pos = start - 1
  }
  setValue(next)
  setTimeout(() => {
    try { el.setSelectionRange(pos, pos) } catch { /* 极少数机型不支持，忽略 */ }
  }, 0)
}

export default function MathKeyboard({
  onInsert,
  onBackspace,
  onClose,
}: {
  onInsert: (snippet: string, caret?: number) => void
  onBackspace?: () => void
  onClose?: () => void
}) {
  const [tab, setTab] = useState(0)

  const handleKey = (key: MathKey) => {
    if (key.action === 'backspace') {
      onBackspace?.()
      return
    }
    onInsert(key.snippet, key.caret)
  }

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
            // pointerdown 阶段阻止输入框失焦，直接执行插入或退格，不走 onClick：
            // onClick 在 blur 之后才触发，是卡顿的另一半成因。
            onPointerDown={(e) => { e.preventDefault(); handleKey(k) }}
            // 键盘可访问性：Tab 聚焦后回车/空格仍可触发；本组件没有 onClick，
            // 因此键盘触发不会与 pointerdown 重复插入。
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleKey(k) }
            }}>
            {k.label}
          </button>
        ))}
      </div>
    </div>
  )
}
