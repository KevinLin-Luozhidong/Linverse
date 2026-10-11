import { useEffect, useState } from 'react'
import { I, Toast, Spin, useSwipeBack, useToast} from '../components'
import { getStats, getBadges, type Stats, type Badge } from '@api'

// 学习报告：学习数据一览（统计展示 + 徽章进度），不是空壳

// 个性化学习建议：按优先级从高到低取最多 3 条（初稿由 DeepSeek 生成，已人工审查）
export function getSuggestions(s: Stats): string[] {
  const result: string[] = []
  if (s.streakDays === 0) {
    result.push('今天还没打卡，去词典页点一次每日打卡，开始攒连续天数')
  }
  if (s.mistakeCount >= 10) {
    result.push(`攒了 ${s.mistakeCount} 道错题，花 10 分钟过一遍，比刷 50 道新题管用`)
  }
  if (s.wordCount >= 20) {
    result.push(`生词 ${s.wordCount} 个，词典页按记忆曲线复习一轮`)
  }
  if (s.noteCount >= 5) {
    result.push(`笔记 ${s.noteCount} 篇，周末花半小时整理成知识卡`)
  }
  if (s.streakDays >= 7) {
    result.push(`已经连续打卡 ${s.streakDays} 天，继续保持，7 天解锁七日连击徽章`)
  }
  if (result.length === 0) {
    return ['数据还不够多，先去用一用，报告会越来越准']
  }
  return result.slice(0, 3)
}

export default function Report({ profileId, onBack }: {
  profileId: string | null; onBack: () => void
}) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [badges, setBadges] = useState<Badge[]>([])
  const [toastMsg, toastKey, setToast] = useToast()

  useEffect(() => {
    if (!profileId) return
    getStats(profileId).then(setStats).catch((e) => setToast(e instanceof Error ? e.message : '加载失败'))
    getBadges(profileId).then(setBadges).catch(() => {})
  }, [profileId])

  const unlocked = badges.filter((b) => b.unlocked).length
  const swipe = useSwipeBack(onBack)

  return (
    <div className="settings" style={{
      height: '100%',
      // 跟手：右滑时整页跟随手指，松手后平滑归位/返回
      transform: swipe.dragging ? `translateX(${swipe.dragX}px)` : undefined,
      transition: swipe.dragging ? 'none' : undefined,
    }} {...swipe.handlers}>
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
              {getSuggestions(stats).map((sug, i) => (
                <div key={i} style={i > 0 ? { marginTop: 8 } : undefined}>{sug}</div>
              ))}
            </div>
          </>
        )}
      </div>
      <Toast msg={toastMsg} tkey={toastKey} />
    </div>
  )
}
