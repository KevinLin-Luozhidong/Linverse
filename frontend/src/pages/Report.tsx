import { useEffect, useState } from 'react'
import { I, Toast, Spin } from '../components'
import { getStats, getBadges, type Stats, type Badge } from '../api'

// 学习报告：学习数据一览（统计展示 + 徽章进度），不是空壳

export default function Report({ profileId, onBack }: {
  profileId: string | null; onBack: () => void
}) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [badges, setBadges] = useState<Badge[]>([])
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!profileId) return
    getStats(profileId).then(setStats).catch((e) => setToast(e instanceof Error ? e.message : '加载失败'))
    getBadges(profileId).then(setBadges).catch(() => {})
  }, [profileId])

  const unlocked = badges.filter((b) => b.unlocked).length

  return (
    <div className="settings" style={{ height: '100%' }}>
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="返回"><I n="back" /></button>
        <div className="topbar-title">学习报告</div>
        <div className="topbar-spacer" />
      </div>
      <div className="report-sec" style={{ flex: 1, overflowY: 'auto' }}>
        {!stats ? <Spin /> : (
          <>
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
            <div className="report-row">
              <span>累计打卡</span>
              <span className="v">{stats.checkinDays} 天</span>
            </div>
            <div className="report-row">
              <span>徽章进度</span>
              <span className="v">{unlocked} / {badges.length}</span>
            </div>
            <div className="report-row">
              <span>学习建议</span>
            </div>
            <div className="safe-note" style={{ marginTop: 0 }}>
              {stats.streakDays === 0
                ? '今天还没打卡，去词典页点一次每日打卡，开始攒连续天数'
                : `已经连续打卡 ${stats.streakDays} 天，继续保持，7 天解锁七日连击徽章`}
            </div>
          </>
        )}
      </div>
      <Toast msg={toast} />
    </div>
  )
}
