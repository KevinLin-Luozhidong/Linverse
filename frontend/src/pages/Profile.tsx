import { useEffect, useState } from 'react'
import { I, Toast, Spin, Empty } from '../components'
import { getStats, getBadges, listProfiles, type Stats, type Badge } from '../api'

// 个人中心：连续打卡天数 / 刷题量大数字展示 + 成就徽章墙 + 设置入口

export default function Profile({ profileId, onOpenSettings }: {
  profileId: string | null; onOpenSettings: () => void
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

  return (
    <div className="me-sec">
      <div className="me-head">
        <div className="me-name">{name || '我'}</div>
        <button className="icon-btn" onClick={onOpenSettings} aria-label="设置">
          <I n="gear" />
        </button>
      </div>

      {!stats ? <Spin /> : (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-num amber">{stats.streakDays}</div>
            <div className="stat-label">连续打卡（天）</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">{stats.mistakeCount}</div>
            <div className="stat-label">刷题量（错题数）</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">{stats.noteCount}</div>
            <div className="stat-label">笔记数</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">{stats.wordCount}</div>
            <div className="stat-label">生词数</div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-title">成就徽章</div>
        {badges.length === 0 ? (
          <Empty text="徽章加载中" />
        ) : (
          <div className="badge-wall">
            {badges.map((b) => (
              <div key={b.id} className={'badge' + (b.unlocked ? '' : ' locked')}>
                <div className="badge-icon"><I n={b.unlocked ? 'check' : 'clock'} size={22} /></div>
                <div className="badge-name">{b.name}</div>
                <div className="badge-desc">{b.desc}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Toast msg={toast} />
    </div>
  )
}
