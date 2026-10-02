import { useState } from 'react'
import Mistakes from './Mistakes'
import Notes from './Notes'
import Dictionary from './Dictionary'
import { I } from '../components'

// 学习工具页：三张卡片横向滑动选择
// 选中一张进入工作区后，其余两张缩到左上角当切换器
// 三个工作区常驻挂载（display 切换），切换时保留各自状态
type Tool = 'mistakes' | 'notes' | 'dict'

const TOOLS: { id: Tool; name: string; desc: string; icon: 'card' | 'book' | 'search'; cls: string }[] = [
  { id: 'mistakes', name: '错题本', desc: '拍照收录错题，按科目整理', icon: 'card', cls: 'tc-mistakes' },
  { id: 'notes', name: '笔记本', desc: '随手记知识点，支持插图', icon: 'book', cls: 'tc-notes' },
  { id: 'dict', name: '词典', desc: '查词背词，生词本复习', icon: 'search', cls: 'tc-dict' },
]

export default function Tools({ profileId }: { profileId: string | null }) {
  const [active, setActive] = useState<Tool | null>(null)

  // 未选中：卡片流首页
  if (!active) {
    return (
      <div className="tools-home">
        <div className="tools-title">学习工具</div>
        <div className="tools-sub">左滑看看，点一张开始用</div>
        <div className="tool-cards">
          {TOOLS.map((t) => (
            <button key={t.id} className={'tool-card ' + t.cls} onClick={() => setActive(t.id)}>
              <span className="tc-icon"><I n={t.icon} size={26} /></span>
              <h3>{t.name}</h3>
              <p>{t.desc}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // 工作区：左上角迷你切换器 + 常驻挂载的三个板块
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="mini-switcher">
        {TOOLS.map((t) => (
          <button key={t.id}
            className={'mini-chip' + (t.id === active ? ' active' : '')}
            onClick={() => setActive(t.id)}>
            <I n={t.icon} size={15} />
            {t.name}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
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
