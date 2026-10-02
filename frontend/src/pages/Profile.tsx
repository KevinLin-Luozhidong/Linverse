import { useEffect, useState } from 'react'
import { I, Toast } from '../components'
import { getStats, getBadges, listMistakes, listProfiles, type Stats, type Badge } from '@api'

// 个人中心：按正式版深色稿重做——头像区 + 双栏统计卡 + 7 天打卡 + 横向徽章 + 更多区
// 徽章解锁以后端为准，阈值兜底保证演示/离线也能亮

// 徽章定义：图标、配色、后端 id 映射、数值阈值兜底、未解锁时的进度文案
const BADGE_DEFS = [
  {
    key: 'first', icon: 'star4' as const, color: '#3b82f6', ids: ['first-mistake'],
    name: '初露锋芒', desc: '完成第 1 道题',
    statUnlock: (s: Stats) => s.mistakeCount >= 1,
    progress: (_s: Stats) => null as string | null,
  },
  {
    key: 'streak7', icon: 'flame' as const, color: '#f59e0b', ids: ['streak-7'],
    name: '七日连击', desc: '连续打卡 7 天',
    statUnlock: (s: Stats) => s.streakDays >= 7,
    progress: (s: Stats) => `${Math.min(s.streakDays, 7)}/7`,
  },
  {
    key: 'hundred', icon: 'target' as const, color: '#22c55e', ids: ['mistake-50'],
    name: '百题斩', desc: '累计刷题 100 道',
    statUnlock: (s: Stats) => s.mistakeCount >= 100,
    progress: (s: Stats) => `${Math.min(s.mistakeCount, 100)}/100`,
  },
  {
    key: 'hunter', icon: 'notebook' as const, color: '#3b82f6', ids: [] as string[],
    name: '错题猎手', desc: '收集错题 20 道',
    statUnlock: (s: Stats) => s.mistakeCount >= 20,
    progress: (s: Stats) => `${Math.min(s.mistakeCount, 20)}/20`,
  },
  {
    key: 'night', icon: 'moon' as const, color: '#94a3b8', ids: [] as string[],
    name: '夜之学者', desc: '夜间学习 10 次',
    statUnlock: (_s: Stats) => false,
    progress: (_s: Stats) => null as string | null,
  },
  {
    key: 'peak', icon: 'crown' as const, color: '#94a3b8', ids: [] as string[],
    name: '登峰造极', desc: '累计刷题 1000 道',
    statUnlock: (s: Stats) => s.mistakeCount >= 1000,
    progress: (s: Stats) => `${Math.min(s.mistakeCount, 1000)}/1000`,
  },
]

// 星期中文：0=周日
const DOW = ['日', '一', '二', '三', '四', '五', '六']

export default function Profile({ profileId, onOpenSettings, onOpenReport, onOpenFavorites }: {
  profileId: string | null
  onOpenSettings: () => void
  onOpenReport: () => void
  onOpenFavorites: () => void
}) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [badges, setBadges] = useState<Badge[]>([])
  const [name, setName] = useState('')
  const [mastered, setMastered] = useState(0)
  const [totalMistakes, setTotalMistakes] = useState(0)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!profileId) return
    getStats(profileId).then(setStats).catch((e) => setToast(e instanceof Error ? e.message : '加载失败'))
    getBadges(profileId).then(setBadges).catch(() => {})
    listProfiles().then((ps) => {
      // 同 App.tsx：数据库 id 可能是数字，比较前统一转字符串
      const me = ps.find((p) => String(p.id) === String(profileId))
      if (me) setName(me.name)
    }).catch(() => {})
    // 已掌握 x/y：从错题列表里数 mastered
    listMistakes(profileId).then((ms) => {
      setTotalMistakes(ms.length)
      setMastered(ms.filter((m) => m.mastered).length)
    }).catch(() => {})
  }, [profileId])

  // 徽章是否解锁：后端状态优先，数值阈值兜底
  const unlockedOf = (b: (typeof BADGE_DEFS)[number], s: Stats) =>
    b.ids.some((id) => badges.find((x) => x.id === id)?.unlocked) || b.statUnlock(s)

  // 最近 7 天（含今天）：按连续打卡天数点亮最近的几天
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d
  })
  const litCount = stats ? Math.min(stats.streakDays, 7) : 0

  const unlockedCount = stats ? BADGE_DEFS.filter((b) => unlockedOf(b, stats)).length : 0
  const avatarChar = (name || '我').slice(0, 1)

  // 复制账号 ID：换设备时凭它在设置-多账号里找回数据
  const copyId = async () => {
    if (!profileId) return
    try {
      await navigator.clipboard.writeText(profileId)
      setToast('账号 ID 已复制，换设备时凭它找回')
    } catch {
      setToast('复制失败，长按手动复制')
    }
  }

  return (
    <div className="me-sec">
      {/* 顶部：圆形头像 + 个人中心/昵称 */}
      <div className="me-top">
        <div className="me-avatar">{avatarChar}</div>
        <div className="me-id">
          <div className="me-kicker">个人中心</div>
          <div className="me-nick">{name || '我'}</div>
        </div>
      </div>

      {/* 账号 ID：本浏览器认的就是它，换设备时输入它找回 */}
      {profileId && (
        <button className="me-idrow" onClick={copyId} aria-label="复制账号 ID">
          <span className="me-idtext">账号 ID {profileId}</span>
          <span className="me-idcopy"><I n="copy" size={13} />复制</span>
        </button>
      )}

      {!stats ? (
        // 骨架屏：占位块尺寸位置与最终布局一致，数据回来只填文字，布局不跳变
        <div className="me-skel" aria-hidden>
          <div className="me-stat-card"><div className="sk" style={{ height: 84 }} /></div>
          <div className="me-week-card"><div className="sk" style={{ height: 118 }} /></div>
          <div className="me-sec-kicker">成长记录</div>
          <div className="me-sec-title">成就徽章</div>
          <div className="me-badge-row">
            <div className="sk" style={{ flex: '0 0 150px', height: 168, borderRadius: 22 }} />
            <div className="sk" style={{ flex: '0 0 150px', height: 168, borderRadius: 22 }} />
            <div className="sk" style={{ flex: '0 0 150px', height: 168, borderRadius: 22 }} />
          </div>
        </div>
      ) : (<>
        {/* 双栏统计卡：连续打卡 / 累计刷题 */}
        <div className="me-stat-card">
          <div className="me-stat">
            <div className="me-stat-num">{stats.streakDays}</div>
            <div className="me-stat-label">连续打卡</div>
          </div>
          <div className="me-stat-div" />
          <div className="me-stat">
            <div className="me-stat-num">{stats.mistakeCount}</div>
            <div className="me-stat-label">累计刷题</div>
          </div>
        </div>

        {/* 最近 7 天学习打卡 */}
        <div className="me-week-card">
          <div className="me-week-head">
            <div>
              <div className="me-week-kicker">最近 7 天</div>
              <div className="me-week-title">学习打卡</div>
            </div>
            <div className="me-mastered">已掌握 {mastered}/{totalMistakes}</div>
          </div>
          <div className="me-dots">
            {weekDays.map((d, i) => (
              <div className="me-day" key={i}>
                <span className={'me-dot' + (i >= 7 - litCount ? ' on' : '')} />
                <span className="me-dow">{DOW[d.getDay()]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 成长记录 / 成就徽章：横向滚动大卡片 */}
        <div className="me-sec-kicker">成长记录</div>
        <div className="me-sec-title">
          成就徽章
          <span className="me-count">{unlockedCount}/6</span>
        </div>
        <div className="me-badge-row">
          {BADGE_DEFS.map((b) => {
            const unlocked = unlockedOf(b, stats)
            const prog = unlocked ? null : b.progress(stats)
            return (
              <div key={b.key} className={'me-badge' + (unlocked ? '' : ' locked')}>
                <div
                  className="me-badge-icon"
                  style={unlocked
                    ? { background: `${b.color}26`, color: b.color }
                    : { background: 'var(--blue-soft)', color: 'var(--ink3)' }}
                >
                  <I n={b.icon} size={24} />
                </div>
                <div className="me-badge-name">{b.name}</div>
                <div className="me-badge-desc">{b.desc}</div>
                <div className={'me-badge-status' + (unlocked ? ' got' : '')}>
                  {unlocked ? '已获得' : prog}
                </div>
              </div>
            )
          })}
        </div>
      </>)}

      {/* 更多区：设置 / 学习报告 / 我的收藏 */}
      <div className="me-sec-title">更多</div>
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
