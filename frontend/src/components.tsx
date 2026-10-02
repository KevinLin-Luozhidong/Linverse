import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react'

// 共享小组件：线条图标、开关、弹窗、提示条等

// 简约线条图标库：统一 24 视图、描边风格
const PATHS: Record<string, ReactNode> = {
  chat: <><path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" /><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  camera: <><path d="M4 8h3l2-2.5h6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13" r="3.2" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.8-3.8" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.5h4l.4-2.5a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z" /></>,
  trash: <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7" /><path d="M10 11v6M14 11v6" /></>,
  pin: <><path d="M9 4h6l-1 7 3 3v2H7v-2l3-3-1-7Z" /><path d="M12 16v5" /></>,
  image: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m5 18 5-5 3 3 3-3 3 3" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  x: <><path d="M6 6l12 12M18 6 6 18" /></>,
  back: <><path d="M14.5 5.5 8 12l6.5 6.5" /></>,
  book: <><path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v15H6.5A1.5 1.5 0 0 0 5 20.5V5.5Z" /><path d="M5 18.5A1.5 1.5 0 0 1 6.5 17H19" /></>,
  card: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10.5h18" /></>,
  edit: <><path d="M4 20h4l11-11a1.4 1.4 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  flame: <><path d="M12 3s5 4.2 5 9a5 5 0 0 1-10 0c0-2 1-3.8 1-3.8s.3 1.2 1.5 1.8C9 7.5 10 5 12 3Z" /></>,
  send: <><path d="M21 3 10.5 13.5" /><path d="M21 3 14 21l-3.5-7.5L3 10 21 3Z" /></>,
  sparkle: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="m6 6 2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" /><path d="M10 13h4" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  chev: <><path d="m9 6 6 6-6 6" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" /></>,
  heart: <><path d="M12 20.5S3.5 15.5 3.5 9.5A4.5 4.5 0 0 1 8 5c1.7 0 3.2.9 4 2.3A4.5 4.5 0 0 1 16 5a4.5 4.5 0 0 1 4.5 4.5c0 6-8.5 11-8.5 11Z" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11.2 11.8 8.3-8.3M16 6l2.5 2.5M13.5 8.5l2.5 2.5" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  users: <><circle cx="9" cy="8" r="3.4" /><path d="M2.8 19c1.2-2.9 3.4-4.4 6.2-4.4s5 1.5 6.2 4.4" /><circle cx="17.2" cy="9" r="2.6" /><path d="M16.4 14.6c2.4.3 4.2 1.6 5 4.4" /></>,
  moon: <><path d="M20 13.6A8 8 0 1 1 10.4 4 6.6 6.6 0 0 0 20 13.6Z" /></>,
  db: <><ellipse cx="12" cy="5.6" rx="7.5" ry="2.8" /><path d="M4.5 5.6v12.8c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8V5.6" /><path d="M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.8h.01" /></>,
  chart: <><path d="M4 20h16" /><path d="M7 20v-6M12.5 20V7M18 20v-9" /></>,
  textsize: <><path d="M5 6V4h14v2M12 4v15M9.5 19h5" /></>,
  notebook: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="m9.6 12.4 1.9 1.9 3.4-3.9" /></>,
  dict: <><path d="M12 6.5C10 5 7 4.5 4 4.5v14c3 0 6 .5 8 2 2-1.5 5-2 8-2v-14c-3 0-6 .5-8 2Z" /><path d="M12 6.5v14" /></>,
  star4: <><path d="M12 2.5c.9 5.8 4.2 9.1 10 10-5.8.9-9.1 4.2-10 10-.9-5.8-4.2-9.1-10-10 5.8-.9 9.1-4.2 10-10Z" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /></>,
  crown: <><path d="M3.5 8.5 7 12l5-6.8L17 12l3.5-3.5L19 18.5H5L3.5 8.5Z" /><path d="M5 21h14" /></>,
}

// 图标组件：size 控制大小，描边继承文字颜色
export function I({ n, size = 22 }: { n: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden>
      {PATHS[n]}
    </svg>
  )
}

// 开关：深度思考等布尔选项用
export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on}
      className={'sw' + (on ? ' on' : '')}
      onClick={() => onChange(!on)}>
      <span className="sw-dot" />
    </button>
  )
}

// 顶部提示条：轻量反馈，2 秒自动消失
export function Toast({ msg }: { msg: string }) {
  const [show, setShow] = useState(false)
  const [tick, setTick] = useState(0) // 每次 msg 变化都+1，保证同样文字连点两次也能重新弹出
  useEffect(() => {
    if (!msg) return
    setTick((t) => t + 1)
    setShow(true)
    const t = setTimeout(() => setShow(false), 2000)
    return () => clearTimeout(t)
  }, [msg])
  // 用 tick 做 key：同样文字再次触发时强制重新挂载，动画重播
  if (!show) return null
  return <div className="toast" key={tick}>{msg}</div>
}

// 底部弹窗：表单编辑用，从下往上滑入
export function Sheet({ open, onClose, children, title }: {
  open: boolean; onClose: () => void; children: ReactNode; title: string
}) {
  if (!open) return null
  return (
    <div className="sheet-wrap">
      <div className="sheet-mask" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-head">
          <span className="sheet-title">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><I n="x" /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

// 空状态：列表没数据时的简约占位
export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><I n="sparkle" size={30} /></div>
      <div className="empty-text">{text}</div>
      {action}
    </div>
  )
}

// 加载中小圈
export function Spin() {
  return <div className="spin" aria-label="加载中" />
}

// 右滑返回手势（iOS 习惯：手指从屏幕左边缘向右滑，退出二级页面）
// 跟手版：手指拖动时页面实时跟随，松手后拉够 90px 就回去、不够就平滑弹回原位
// 用法：const swipe = useSwipeBack(() => setView('menu'), view !== 'menu')
//   <div {...swipe.handlers}>
//     <div style={{ transform: `translateX(calc(${-idx*100}% + ${swipe.dragX}px))`,
//                    transition: swipe.dragging ? 'none' : undefined }}>
// 只响应"从左边缘出发"的右滑，避免和页面内的纵滑/横滑冲突
export function useSwipeBack(onBack: (fromX?: number) => void, enabled = true) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState({ x: 0, active: false })
  return {
    dragX: drag.active ? drag.x : 0, // 当前跟手的偏移（px）
    dragging: drag.active,
    handlers: {
      onTouchStart: (e: TouchEvent) => {
        if (!enabled) return
        const t = e.touches[0]
        if (t.clientX < 64) start.current = { x: t.clientX, y: t.clientY }
      },
      onTouchMove: (e: TouchEvent) => {
        const s = start.current
        if (!s || !enabled) return
        const t = e.touches[0]
        const dx = t.clientX - s.x
        const dy = t.clientY - s.y
        // 纵向意图优先：交给页面滚动，不抢手势
        if (Math.abs(dy) > Math.abs(dx) * 1.2) {
          start.current = null
          setDrag({ x: 0, active: false })
          return
        }
        if (dx > 0) setDrag({ x: Math.min(dx, 320), active: true })
      },
      onTouchEnd: () => {
        const d = drag
        start.current = null
        setDrag({ x: 0, active: false })
        // enabled 可能在拖拽中途变 false（比如页面已切走），此时不触发返回，
        // 避免误触退出整个设置页
        if (enabled && d.active && d.x > 90) onBack(d.x) // 把手指位置传给调用方，退出动画从这里接着滑
      },
    },
  }
}

// 每日一句：底部励志文案，点一下换一句（用户点名要的"特别有意思"的小功能）
// 每天固定一句（按日期取），点一下随机换一句并记住选择
const QUOTES = [
  '今天多问一个为什么，明天就少一个盲点',
  '把每次出错变成下一次的得分点',
  '慢一点没关系，方向对了就好',
  '你背的每一个单词，都在为未来铺路',
  '错题本越厚，考场上越稳',
  '自律的人，连运气都更好',
  '今天的汗水，是明天的底气',
  '不要和别人比，和昨天的自己比',
  '把大目标拆成小步骤，每天完成一个',
  '复习不是重复，是升级',
  '课堂的 45 分钟，值得你 100% 的专注',
  '坚持的第 21 天，会感谢第 1 天的你',
  '难题都是纸老虎，拆开了一只一只打',
  '笔记是写给未来自己的信',
  '早起的半小时，是偷来的成长时间',
  '不懂就问，不丢人；不懂装懂，才可惜',
  '把"再学五分钟"变成习惯',
  '错一次是成长，错两次是选择',
  '你的努力，时间都看得见',
  '把手机放下，把未来拿起来',
  '每一个高手，都曾是新手',
  '学习是场马拉松，配速比冲刺重要',
  '今天搞懂的，明天就不会再错',
  '星光不问赶路人，时光不负有心人',
]
export function DailyQuote() {
  const [idx, setIdx] = useState(() => {
    try {
      const saved = localStorage.getItem('linverse.quote')
      if (saved) {
        const { date, i } = JSON.parse(saved)
        if (date === new Date().toDateString()) return i % QUOTES.length
      }
    } catch {}
    return new Date().getDate() % QUOTES.length
  })
  const refresh = () => {
    let n = Math.floor(Math.random() * QUOTES.length)
    if (n === idx) n = (n + 1) % QUOTES.length
    setIdx(n)
    try { localStorage.setItem('linverse.quote', JSON.stringify({ date: new Date().toDateString(), i: n })) } catch {}
  }
  return (
    <button className="daily-quote" onClick={refresh} aria-label="换一句">
      {QUOTES[idx]}
    </button>
  )
}
