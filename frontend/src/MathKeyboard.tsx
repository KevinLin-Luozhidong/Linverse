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
  aria?: string // 读屏播报：不填就读 label；⌫ 这类图形键要填人话
}

// 退格键：只有数字组原来有，其他组想改错得先切回来——
// 每组末尾都放一个，走到哪都能删。
const BACKSPACE_KEY: MathKey = { label: '⌫', snippet: '', action: 'backspace', aria: '退格' }

// 字形光学微调（em，正数往下、负数往上）：flex 居中摆的是行框，不是字墨；
// 基线字（，。_）墨在框底会显得沉底，上标字（° ^）墨在框顶会显得飘顶，
// ∪∩∨∧∇∂∀⊥ 这类上下不对称的字形视觉中心也不在框心，各补一点才看着齐。
// 只调偏差明显的单字形；文字键（sin(、绝对值）和整组统一的字形（希腊小写）不动。
// 标定口径：行框居中后基线在框心下方约 0.3em，墨心与框心的差就是要补的量
// （，. 的墨心约在基线上方 0.05em → 提 0.28em；下划线墨在基线下方 → 提 0.32em；
// 度数圈墨心约在基线上方 0.6em → 压 0.3em）。2026-11-28 复验第一轮数值偏小，
// ，. _ ° 仍偏，已按复验结果加码；∩ 第一轮压反了（略偏下），已撤回。
// 第三轮（复验第二轮，放大 3–4 倍逐键量）：· ° ! ∠ ^ ∪ 已居中不动；
// ，. 仍在 60% 高度处（残差约 0.22em）、_ ∩ ∨ ∧ 仍低 2–3 像素（残差约 0.15em），
// 按残差的七成再补——全量补容易像第一轮的 · 那样提过头。
// 第四轮（复验第三轮，像素实测，对照数字 0/7 偏差仅 0.5px，方法可信）：
// 第三轮补过头了——，。∨∧ 由偏低翻成偏高 2–4px，_ 仍低 1–2px，∩ 高约 1px。
// 按像素残差反推零点：，。-0.28、_ -0.51、∩ -0.04、∨ +0.08、∧ +0.08。
// 注意第二轮的目测（，。“60% 高度”）与第三轮像素实测对不上，
// ，. 的零点与第二轮数值重合——以像素实测为准；若第四轮再翻，
// 说明云端浏览器字体不稳定，这几个字就以用户 iPhone 实看为准，不再追像素。
// 第五轮（2026-11-28，用户 iPhone 截图像素实测，常用组）：
// 以 +−×÷=()[] 的墨心（+0.08em）为基准线，逐键量残差——
// 云端浏览器字体与 iPhone PingFang 度量确实不同：· % ! 在云端要往上提，
// 在 iPhone 上反而偏高、要往下压（· -0.03→+0.07、% 新增 +0.07、! -0.08→+0.07）；
// ° 0.3→0.22（压过头了）、， -0.28→-0.31、∠ -0.08→-0.11；
// ♀♂ 新测：圆圈+竖杆的字形在 PingFang 里整整沉底约 8px（0.48em），新补 -0.40/-0.43。
// . 只在数字组，第五轮没量到，不动，仍是 -0.28。
const NUDGE_EM: Record<string, number> = {
  '，': -0.31, '.': -0.28, '_': -0.51,
  '·': 0.07, '%': 0.07, '!': 0.07, '∠': -0.11,
  '°': 0.22, '^': 0.1,
  '∪': -0.06, '∩': -0.04, '∨': 0.08, '∧': 0.08,
  '∇': 0.06, '∂': -0.06, '∀': 0.05, '⊥': -0.05,
  '♀': -0.40, '♂': -0.43,
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
      BACKSPACE_KEY,
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
      // 括号统一用半角：跟 [ ] 一致，LaTeX 里也能直接用；全角 （） 打中文时走系统键盘
      { label: '(', snippet: '(' },
      { label: ')', snippet: ')' },
      { label: '[', snippet: '[' },
      { label: ']', snippet: ']' },
      { label: '!', snippet: '!' },
      { label: '∠', snippet: '∠' },
      { label: '，', snippet: '，' },
      // 生物遗传题常用：♀♂（P: ♀Aa × ♂Aa 这类杂交组合）
      { label: '♀', snippet: '♀' },
      { label: '♂', snippet: '♂' },
      BACKSPACE_KEY,
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
      BACKSPACE_KEY,
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
      { label: 'log底', snippet: '\\log_{}()', caret: 6 },
      { label: 'e', snippet: 'e' },
      { label: 'e^x', snippet: 'e^{}', caret: 3 },
      BACKSPACE_KEY,
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
      BACKSPACE_KEY,
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
      // 描述法写集合全靠这三个：{x ∈ ℝ | x > 0}，以前盘上打不出来
      { label: '{', snippet: '{' },
      { label: '}', snippet: '}' },
      { label: '|', snippet: '|' },
      { label: 'ℕ', snippet: 'ℕ' },
      { label: 'ℤ', snippet: 'ℤ' },
      { label: 'ℚ', snippet: 'ℚ' },
      { label: 'ℝ', snippet: 'ℝ' },
      { label: 'ℂ', snippet: 'ℂ' },
      BACKSPACE_KEY,
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
      { label: '⊥', snippet: '⊥' },
      { label: '∥', snippet: '∥' },
      BACKSPACE_KEY,
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
      BACKSPACE_KEY,
    ],
  },
]

// 取光标位置：输入框没聚焦过时 selectionStart 是 0（不是 null），
// 注释里说的"取不到追加到末尾"兜底实际走不到——
// 没点过输入框就先点符号，符号会插到开头。没聚焦且光标在开头时，
// 按"追加到末尾"处理；已经聚焦、光标就是在开头时，照原样插在开头。
function caretRange(el: HTMLTextAreaElement, value: string): [number, number] {
  const start = el.selectionStart ?? value.length
  const end = el.selectionEnd ?? value.length
  if (document.activeElement !== el && start === 0 && end === 0) {
    return [value.length, value.length]
  }
  return [start, end]
}

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
  const [start, end] = caretRange(el, value)
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
  const [start, end] = caretRange(el, value)
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
      <div className="math-head">
        <div className="math-tabs">
          {GROUPS.map((g, i) => (
            <button key={g.name} type="button" className={tab === i ? 'on' : ''}
              onClick={() => setTab(i)}>
              {g.name}
            </button>
          ))}
        </div>
        {onClose && (
          <button type="button" className="math-close" onClick={onClose} aria-label="收起符号盘">×</button>
        )}
      </div>
      <div className="math-grid">
        {GROUPS[tab].keys.map((k) => (
          <button key={k.label} type="button"
            // 超过 2 个字的键（绝对值、log底）字号收一档，不然在 390px 屏上会换行顶高整行
            className={k.label.length > 2 ? 'math-key math-key--sm' : 'math-key'}
            aria-label={k.aria || undefined}
            // pointerdown 阶段阻止输入框失焦，直接执行插入或退格，不走 onClick：
            // onClick 在 blur 之后才触发，是卡顿的另一半成因。
            onPointerDown={(e) => { e.preventDefault(); handleKey(k) }}
            // 键盘可访问性：Tab 聚焦后回车/空格仍可触发；本组件没有 onClick，
            // 因此键盘触发不会与 pointerdown 重复插入。
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleKey(k) }
            }}>
            <span style={NUDGE_EM[k.label] !== undefined ? { transform: `translateY(${NUDGE_EM[k.label]}em)` } : undefined}>{k.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
