import { useEffect, useRef, useState } from 'react'
import Mistakes from './Mistakes'
import Notes from './Notes'
import Dictionary from './Dictionary'
import { I, Toast } from '../components'
import { getStats, type Stats } from '../api'

// 学习工具页：三张大卡片横向滑动选择 + 底部指示点
// 选中一张进入工作区后：左上角返回重选，其余两张缩成迷你切换器
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
            <button key={t.id} className="tool-slide" onClick={() => setActive(t.id)}>
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

  // 工作区：返回重选 + 左上角迷你切换器 + 常驻挂载的三个板块
  return (
    <div className="tools-work">
      <div className="tools-bar">
        <button className="icon-btn" onClick={() => setActive(null)} aria-label="返回选择工具">
          <I n="back" size={20} />
        </button>
        {TOOLS.map((t) => (
          <button key={t.id}
            className={'mini-chip' + (t.id === active ? ' active' : '')}
            onClick={() => setActive(t.id)}>
            <I n={t.icon} size={14} />
            {t.name}
          </button>
        ))}
      </div>
      <div className="tools-body">
        <div style={{ display: active === 'mistakes' ? 'block' : 'none', height: '100%', overflowY: 'auto' }}>
          <Mistakes profileId={profileId} />
        </div>
        <div style={{ display: active === 'notes' ? 'block' : 'none', height: '100%', overflowY: 'auto' }}>
          <Notes profileId={profileId} />
        </div>
        <div style={{ display: active === 'dict' ? 'block' : 'none', height: '100%', overflowY: 'auto' }}>
          <Dictionary profileId={profileId} />
        </div>
      </div>
    </div>
  )
}
