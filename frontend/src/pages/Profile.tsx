import { useEffect, useRef, useState } from 'react'
import { I, Toast, Spin, useToast} from '../components'
import Cropper from '../Cropper'
import { getStats, getBadges, listMistakes, listProfiles, setAvatar, uploadImage, imgSrc, type Stats, type Badge } from '@api'

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

export default function Profile({ profileId, onOpenSettings, onOpenReport }: {
  profileId: string | null
  onOpenSettings: () => void
  onOpenReport: () => void
}) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [badges, setBadges] = useState<Badge[]>([])
  const [name, setName] = useState('')
  const [avatar, setAvatarUrl] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)
  const [mastered, setMastered] = useState(0)
  const [totalMistakes, setTotalMistakes] = useState(0)
  const [toastMsg, toastKey, setToast] = useToast()
  const [cropSrc, setCropSrc] = useState('')

  useEffect(() => {
    if (!profileId) return
    // 秒开：先从本地缓存恢复上次的数据立刻渲染，后台再静默刷新
    // （Vercel 无服务器冷启动时要几秒，不能让用户干等）
    const ck = (k: string) => `linverse.cache.${profileId}.${k}`
    try {
      const cs = localStorage.getItem(ck('stats'))
      if (cs) setStats(JSON.parse(cs))
      const cb = localStorage.getItem(ck('badges'))
      if (cb) setBadges(JSON.parse(cb))
      const cn = localStorage.getItem(ck('name'))
      if (cn) setName(cn)
      const ca = localStorage.getItem(ck('avatar'))
      if (ca) setAvatarUrl(ca)
      const cm = localStorage.getItem(ck('mistakes'))
      if (cm) {
        const ms = JSON.parse(cm) as { mastered?: boolean }[]
        setTotalMistakes(ms.length)
        setMastered(ms.filter((m) => m.mastered).length)
      }
    } catch { /* 缓存坏了就忽略，走网络 */ }
    // 后台刷新：拿到新数据后更新界面 + 覆盖缓存
    getStats(profileId).then((s) => {
      setStats(s)
      try { localStorage.setItem(ck('stats'), JSON.stringify(s)) } catch {}
    }).catch((e) => setToast(e instanceof Error ? e.message : '加载失败'))
    getBadges(profileId).then((b) => {
      setBadges(b)
      try { localStorage.setItem(ck('badges'), JSON.stringify(b)) } catch {}
    }).catch(() => {})
    listProfiles().then((ps) => {
      // 同 App.tsx：数据库 id 可能是数字，比较前统一转字符串
      const me = ps.find((p) => String(p.id) === String(profileId))
      if (me) {
        setName(me.name)
        try { localStorage.setItem(ck('name'), me.name) } catch {}
        if (me.avatar_url) {
          setAvatarUrl(me.avatar_url)
          try { localStorage.setItem(ck('avatar'), me.avatar_url) } catch {}
        }
      }
    }).catch(() => {})
    // 已掌握 x/y：从错题列表里数 mastered
    listMistakes(profileId).then((ms) => {
      setTotalMistakes(ms.length)
      setMastered(ms.filter((m) => m.mastered).length)
      try { localStorage.setItem(ck('mistakes'), JSON.stringify(ms.map((m) => ({ mastered: m.mastered })))) } catch {}
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

  // 换头像：选图 → 裁剪（可直接用原图）→ 上传到 Supabase → 存到账号上
  const changeAvatar = async (f: File | undefined) => {
    if (!f || !profileId) return
    setCropSrc(URL.createObjectURL(f))
  }
  const onCropDone = async (blob: Blob) => {
    const url = cropSrc
    setCropSrc('')
    if (url) URL.revokeObjectURL(url)
    if (!profileId) return
    setUploadingAvatar(true)
    try {
      const upUrl = await uploadImage(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
      await setAvatar(profileId, upUrl)
      setAvatarUrl(upUrl)
      try { localStorage.setItem(`linverse.cache.${profileId}.avatar`, upUrl) } catch {}
      setToast('头像已更换')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploadingAvatar(false)
    }
  }
  const onCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc('')
  }
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
      {/* 顶部：圆形头像（点一下换头像） + 个人中心/昵称 */}
      <div className="me-top">
        <button className="me-avatar" onClick={() => avatarInput.current?.click()}
          aria-label="更换头像" style={{ padding: 0, overflow: 'hidden', border: 0, cursor: 'pointer' }}>
          {avatar
            ? <img src={imgSrc(avatar)} alt="头像" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : uploadingAvatar ? <Spin /> : avatarChar}
        </button>
        <input ref={avatarInput} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => { changeAvatar(e.target.files?.[0]); e.target.value = '' }} />
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
            <div className="sk" style={{ flex: '0 0 108px', height: 132, borderRadius: 18 }} />
            <div className="sk" style={{ flex: '0 0 108px', height: 132, borderRadius: 18 }} />
            <div className="sk" style={{ flex: '0 0 108px', height: 132, borderRadius: 18 }} />
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
                  <I n={b.icon} size={20} />
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

      {/* 更多区：设置 / 学习报告（我的收藏已挪到 AI 助手左上角抽屉） */}
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
      </div>
      <Toast msg={toastMsg} tkey={toastKey} />
      {cropSrc && (
        <Cropper src={cropSrc} onDone={onCropDone} onCancel={onCropCancel} />
      )}
    </div>
  )
}
