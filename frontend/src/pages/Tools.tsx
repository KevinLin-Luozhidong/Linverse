import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Mistakes from './Mistakes'
import Notes from './Notes'
import Dictionary from './Dictionary'
import { I, Toast } from '../components'
import { getStats, type Stats } from '@api'

// 学习工具页：三张大卡片横向滑动选择 + 底部指示点
// 选中一张进入工作区：被点的卡片缩小飞入左上角变成迷你切换器（FLIP 动画）
// 三个工作区常驻挂载（display 切换），切换时保留各自状态
type Tool = 'mistakes' | 'notes' | 'dict'

const TOOLS: { id: Tool; name: string; desc: string; icon: 'notebook' | 'edit' | 'dict'; cls: 'blue' | 'green' | 'orange' }[] = [
  { id: 'mistakes', name: '错题本', desc: '拍照收录错题，错因和正确答案可留白，按科目整理', icon: 'notebook', cls: 'blue' },
  { id: 'notes', name: '笔记本', desc: '课堂重点随手记，支持插图、标签和置顶', icon: 'edit', cls: 'green' },
  { id: 'dict', name: '词典', desc: '查词背词一条龙，生词本按记忆曲线复习', icon: 'dict', cls: 'orange' },
]

export default function Tools({ profileId }: { profileId: string | null }) {
  // 截图调试用：?tool=mistakes 直接进入某工具
  const qp = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
  const initTool = (qp?.get('tool') as Tool) || null
  const [active, setActive] = useState<Tool | null>(
    initTool === 'mistakes' || initTool === 'notes' || initTool === 'dict' ? initTool : null)
  const [dotIdx, setDotIdx] = useState(0) // 当前居中的卡片
  const [stats, setStats] = useState<Stats | null>(null)
  const [toast, setToast] = useState('')
  const streamRef = useRef<HTMLDivElement>(null)

  // ---- 卡片缩小飞入左上角（FLIP 动画） ----
  // First：点卡片时记下卡片的位置大小；Last：工作区挂载后量出目标 mini-chip 的位置；
  // Invert：把克隆卡片先摆在卡片原位置；Play：过渡到 chip 位置（位移+缩放），像卡片缩小飞进左上角
  const [fly, setFly] = useState<{ tool: Tool; left: number; top: number; width: number; height: number } | null>(null)
  const [flyTo, setFlyTo] = useState<string>('') // 目标 transform，下一帧设置以触发过渡
  const chipRefs = useRef<Partial<Record<Tool, HTMLButtonElement | null>>>({})
  // 工作区面板：切换工具时重播滑入动画，但不卸载（状态保留）。
  // 做法：active 变化后，把可见面板的动画类先摘掉、强制回流、再加回去，纯 CSS 重播
  const panelRefs = useRef<Partial<Record<Tool, HTMLDivElement | null>>>({})
  const goTool = (t: Tool) => setActive(t)
  useEffect(() => {
    if (!active) return
    const el = panelRefs.current[active]
    if (!el) return
    el.classList.remove('tool-panel-in')
    void el.offsetWidth // 强制回流，让浏览器"忘记"上一次动画
    el.classList.add('tool-panel-in')
  }, [active])

  // 点卡片：记录位置（First），然后进工作区
  const pick = (t: Tool) => (e: { currentTarget: HTMLButtonElement }) => {
    const r = e.currentTarget.getBoundingClientRect()
    setFlyTo('')
    setFly({ tool: t, left: r.left, top: r.top, width: r.width, height: r.height })
    setActive(t)
  }

  // 工作区挂载后：量 chip 位置（Last），下一帧开始飞（Play）
  useLayoutEffect(() => {
    if (!fly) return
    const chip = chipRefs.current[fly.tool]
    if (!chip) { setFly(null); return }
    const c = chip.getBoundingClientRect()
    const dx = c.left - fly.left
    const dy = c.top - fly.top
    const sx = c.width / fly.width
    const sy = c.height / fly.height
    // 兜底清理：如果 transitionend 没触发（比如用户开了系统的"减弱动态效果"，
    // CSS 里 transition 被关掉），220ms 后强制移除克隆卡片，避免残留（动画已缩短到 0.15s）
    const timer = setTimeout(() => { setFly(null); setFlyTo('') }, 220)
    const raf = requestAnimationFrame(() => {
      setFlyTo(`translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`)
    })
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [fly])

  useEffect(() => {
    if (!profileId) return
    getStats(profileId).then(setStats).catch((e) => setToast(e instanceof Error ? e.message : '加载失败'))
  }, [profileId])

  // 滑动时更新指示点：看哪张卡最接近中心
  const onScroll = () => {
    const el = streamRef.current
    if (!el || el.children.length === 0) return
    const cardW = (el.children[0] as HTMLElement).offsetWidth + 14
    setDotIdx(Math.min(TOOLS.length - 1, Math.max(0, Math.round(el.scrollLeft / cardW))))
  }

  const countText = (id: Tool) => {
    if (!stats) return '点开开始'
    if (id === 'mistakes') return `${stats.mistakeCount} 道错题`
    if (id === 'notes') return `${stats.noteCount} 篇笔记`
    return `${stats.wordCount} 个生词`
  }

  // 未选中：卡片流首页
  if (!active) {
    return (
      <div className="tools-home">
        <div className="tools-title-row">
          <div className="tools-title">学习工具</div>
        </div>
        <div className="tools-sub">左右滑动选一个工具，点开直接进</div>
        <div className="tool-stream" ref={streamRef} onScroll={onScroll}>
          {TOOLS.map((t) => (
            <button key={t.id} className="tool-slide" onClick={pick(t.id)}>
              <span className={'sq-icon ' + t.cls}><I n={t.icon} size={30} /></span>
              <h3>{t.name}</h3>
              <p>{t.desc}</p>
              <span className="go">{countText(t.id)}<I n="chev" size={16} /></span>
            </button>
          ))}
        </div>
        <div className="dots">
          {TOOLS.map((t, i) => <span key={t.id} className={'dot' + (i === dotIdx ? ' on' : '')} />)}
        </div>
        <Toast msg={toast} />
      </div>
    )
  }

  // 飞行动画的克隆卡片：固定定位在原卡片位置，缩小飞入左上角的 chip 后移除
  const flyTool = fly ? TOOLS.find((x) => x.id === fly.tool) : null

  // 工作区：返回重选 + 左上角迷你切换器 + 常驻挂载的三个板块
  return (
    <div className="tools-work">
      <div className="tools-bar">
        <button className="icon-btn" onClick={() => setActive(null)} aria-label="返回选择工具">
          <I n="back" size={20} />
        </button>
        {TOOLS.map((t) => (
          <button key={t.id}
            ref={(el) => { chipRefs.current[t.id] = el }}
            className={'mini-chip' + (t.id === active ? ' active' : '')}
            onClick={() => goTool(t.id)}>
            <I n={t.icon} size={14} />
            {t.name}
          </button>
        ))}
      </div>
      <div className="tools-body">
        <div ref={(el) => { panelRefs.current['mistakes'] = el }}
          style={{ display: active === 'mistakes' ? 'block' : 'none', height: '100%', overflowY: 'auto' }}>
          <Mistakes profileId={profileId} />
        </div>
        <div ref={(el) => { panelRefs.current['notes'] = el }}
          style={{ display: active === 'notes' ? 'block' : 'none', height: '100%', overflowY: 'auto' }}>
          <Notes profileId={profileId} />
        </div>
        <div ref={(el) => { panelRefs.current['dict'] = el }}
          style={{ display: active === 'dict' ? 'block' : 'none', height: '100%', overflowY: 'auto' }}>
          <Dictionary profileId={profileId} />
        </div>
      </div>
      {fly && flyTool && (
        <div
          className="fly-card"
          aria-hidden
          style={{
            left: fly.left, top: fly.top, width: fly.width, height: fly.height,
            transform: flyTo || undefined,
          }}
          onTransitionEnd={() => { setFly(null); setFlyTo('') }}
        >
          <span className={'sq-icon ' + flyTool.cls}><I n={flyTool.icon} size={30} /></span>
          <h3>{flyTool.name}</h3>
          <p>{flyTool.desc}</p>
          <span className="go">{countText(flyTool.id)}<I n="chev" size={16} /></span>
        </div>
      )}
    </div>
  )
}
