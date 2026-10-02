import { useEffect, useState } from 'react'
import { I, Toast, Spin } from '../components'
import { getStats, getBadges, listProfiles, type Stats, type Badge } from '@api'

// 个人中心：顶部四统计卡 + 6 成就徽章 + "更多"区
// 徽章定义按演示版（上色 / 灰掉未解锁），解锁状态以后端为准

const BADGE_DEFS = [
  { key: 'first', icon: '✦', color: '#3b82f6', ids: ['first-mistake'], name: '初露锋芒', desc: '完成第 1 道题' },
  { key: 'streak7', icon: '🔥', color: '#f59e0b', ids: ['streak-7'], name: '七日连击', desc: '连续打卡 7 天' },
  { key: 'hundred', icon: '🎯', color: '#22c55e', ids: ['mistake-50'], name: '百题斩', desc: '累计刷题 100 道' },
  { key: 'hunter', icon: '📋', color: '#3b82f6', ids: [] as string[], name: '错题猎手', desc: '收集错题 20 道' },
  { key: 'night', icon: '🌙', color: '#94a3b8', ids: [] as string[], name: '夜之学者', desc: '夜间学习 10 次' },
  { key: 'peak', icon: '👑', color: '#94a3b8', ids: [] as string[], name: '登峰造极', desc: '累计刷题 1000 道' },
]

export default function Profile({ profileId, onOpenSettings, onOpenReport, onOpenFavorites }: {
  profileId: string | null
  onOpenSettings: () => void
  onOpenReport: () => void
  onOpenFavorites: () => void
}) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [badges, setBadges] = useState<Badge[]>([])
  const [name, setName] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!profileId) return
    getStats(profileId).then(setStats).catch((e) => setToast(e instanceof Error ? e.message : '加载失败'))
    getBadges(profileId).then(setBadges).catch(() => {})
    listProfiles().then((ps) => {
      const me = ps.find((p) => p.id === profileId)
      if (me) setName(me.name)
    }).catch(() => {})
  }, [profileId])

  // 后端徽章的解锁状态映射到 6 枚展示徽章上
  const unlockedOf = (ids: string[]) =>
    ids.some((id) => badges.find((b) => b.id === id)?.unlocked)

  return (
    <div className="me-sec">
      <div className="me-head">
        <div className="me-name">{name || '我'}</div>
      </div>

      {!stats ? <Spin /> : (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-num amber">{stats.streakDays}</div>
            <div className="stat-label">连续打卡天</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">{stats.mistakeCount}</div>
            <div className="stat-label">刷题量</div>
          </div>
          <div className="stat-card">
            <div className="stat-num green">{stats.noteCount}</div>
            <div className="stat-label">笔记数</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">{stats.wordCount}</div>
            <div className="stat-label">生词数</div>
          </div>
        </div>
      )}

      <div className="sec-h">成就徽章<span className="hint">示例展示</span></div>
      <div className="badge-grid">
        {BADGE_DEFS.map((b) => {
          const unlocked = unlockedOf(b.ids)
          return (
            <div key={b.key} className={'badge' + (unlocked ? '' : ' locked')}>
              <div className="badge-icon" style={{ background: `${b.color}26`, color: b.color }}>
                {b.icon}
              </div>
              <div className="badge-name">{b.name}</div>
              <div className="badge-desc">{b.desc}</div>
            </div>
          )
        })}
      </div>

      <div className="sec-h">更多</div>
      <div className="more-card">
        <button className="more-row" onClick={onOpenSettings}>
          <span className="sq gray" style={{ width: 36, height: 36, borderRadius: 11 }}><I n="gear" size={20} /></span>
          设置
          <span className="chev"><I n="chev" size={16} /></span>
        </button>
        <button className="more-row" onClick={onOpenReport}>
          <span className="sq blue" style={{ width: 36, height: 36, borderRadius: 11 }}><I n="chart" size={20} /></span>
          学习报告
          <span className="chev"><I n="chev" size={16} /></span>
        </button>
        <button className="more-row" onClick={onOpenFavorites}>
          <span className="sq orange" style={{ width: 36, height: 36, borderRadius: 11 }}><I n="heart" size={20} /></span>
          我的收藏
          <span className="chev"><I n="chev" size={16} /></span>
        </button>
      </div>
      <Toast msg={toast} />
    </div>
  )
}
