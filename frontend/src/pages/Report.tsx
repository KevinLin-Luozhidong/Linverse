import { useEffect, useState } from 'react'
import { I, Toast, Spin, useSwipeBack, useToast} from '../components'
import { getStats, getBadges, checkin, type Stats, type Badge } from '@api'

// 学习报告：学习数据一览（统计展示 + 徽章进度），不是空壳

// 个性化学习建议：按优先级从高到低取最多 3 条（初稿由 DeepSeek 生成，已人工审查）
export function getSuggestions(s: Stats): string[] {
  const result: string[] = []
  if (s.streakDays === 0) {
    result.push('今天还没打卡，点一次每日打卡，开始攒连续天数')
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
  // 加载失败：以前只有转圈，失败后一直转；现在原因常驻 + 重试。
  const [statsError, setStatsError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  // 打卡：与个人中心、词典生词本共用同一个本地标记，两边状态一致
  const [checkinDone, setCheckinDone] = useState(() =>
    localStorage.getItem('linverse.checkinDate') === new Date().toISOString().slice(0, 10))
  const [checkinBusy, setCheckinBusy] = useState(false)
  const doCheckin = async () => {
    if (!profileId || checkinBusy) return
    setCheckinBusy(true)
    try {
      await checkin(profileId)
      const today = new Date().toISOString().slice(0, 10)
      localStorage.setItem('linverse.checkinDate', today)
      setCheckinDone(true)
      setToast('打卡成功')
      getStats(profileId).then(setStats).catch(() => {})
    } catch (e) {
      setToast(e instanceof Error ? e.message : '打卡失败')
    } finally { setCheckinBusy(false) }
  }

  useEffect(() => {
    if (!profileId) return
    setStatsError('')
    getStats(profileId).then(setStats).catch((e) => {
      setToast(e instanceof Error ? e.message : '加载失败')
      setStatsError(e instanceof Error ? e.message : '加载失败')
    })
    getBadges(profileId).then(setBadges).catch(() => {})
  }, [profileId, reloadKey])

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
        {!stats ? (statsError ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ color: 'var(--red)', fontSize: `calc(14px * var(--fss))` }}>加载失败：{statsError}</div>
            <div style={{ color: 'var(--ink2)', fontSize: `calc(13px * var(--fss))`, marginTop: 8 }}>
              如果是账号问题，先去恢复账号再重试
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
              <button className="btn" onClick={() => setReloadKey((k) => k + 1)}>重试</button>
              <button className="btn btn-ghost" disabled={checkinDone || checkinBusy} onClick={doCheckin}>
                {checkinDone ? '✓ 今日已打卡' : checkinBusy ? '打卡中…' : '先打卡'}
              </button>
            </div>
          </div>
        ) : <Spin />) : (
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
              <span>最近打卡</span>
              <span className="v">{stats.recentCheckins && stats.recentCheckins.length > 0 ? stats.recentCheckins.join('、') : '暂无打卡记录'}</span>
            </div>
            <button className="btn" style={{ width: '100%', marginTop: 12 }}
              disabled={checkinDone || checkinBusy} onClick={doCheckin}>
              {checkinDone ? '✓ 今日已打卡' : checkinBusy ? '打卡中…' : '每日打卡'}
            </button>
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
