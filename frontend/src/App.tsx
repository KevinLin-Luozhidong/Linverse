import { useEffect, useState } from 'react'
import Assistant from './pages/Assistant'
import Tools from './pages/Tools'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import { I, Toast } from './components'
import { listProfiles, createProfile, getSettings } from './api'

// App：底部三栏导航（AI助手 / 学习工具 / 个人中心）
// 个人中心内嵌设置二级页；负责账号初始化与外观偏好应用
type Tab = 'assistant' | 'tools' | 'me'

export default function App() {
  const [tab, setTab] = useState<Tab>('assistant')
  const [inSettings, setInSettings] = useState(false) // 个人中心内是否打开设置
  const [profileId, setProfileId] = useState<string | null>(() => localStorage.getItem('linverse.profileId'))
  const [toast, setToast] = useState('')

  // 启动时保证有一个账号：没有就自动建一个默认账号
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const ps = await listProfiles()
        if (!alive) return
        if (ps.length === 0) {
          const p = await createProfile('我')
          localStorage.setItem('linverse.profileId', p.id)
          setProfileId(p.id)
        } else if (!localStorage.getItem('linverse.profileId')) {
          localStorage.setItem('linverse.profileId', ps[0].id)
          setProfileId(ps[0].id)
        }
      } catch {
        if (alive) setToast('后端未连接，部分功能不可用')
      }
    })()
    return () => { alive = false }
  }, [])

  // 应用外观偏好：主题跟随系统时不写 data-theme，交给 CSS 媒体查询
  useEffect(() => {
    if (!profileId) return
    getSettings(profileId)
      .then((s) => {
        const theme = s.theme || 'system'
        if (theme === 'system') document.documentElement.removeAttribute('data-theme')
        else document.documentElement.setAttribute('data-theme', theme)
        document.documentElement.setAttribute('data-fontsize', s.fontSize || 'medium')
      })
      .catch(() => {})
  }, [profileId])

  // 切换账号：更新本地记录并通知各页重新拉数据
  const switchProfile = (id: string) => {
    localStorage.setItem('linverse.profileId', id)
    setProfileId(id)
    setInSettings(false)
  }

  const tabs: { id: Tab; label: string; icon: 'chat' | 'grid' | 'user' }[] = [
    { id: 'assistant', label: 'AI助手', icon: 'chat' },
    { id: 'tools', label: '学习工具', icon: 'grid' },
    { id: 'me', label: '个人中心', icon: 'user' },
  ]

  return (
    <div className="app">
      <div className="main">
        {tab === 'assistant' && (
          <div className="tabview" key={'a' + profileId}><Assistant profileId={profileId} /></div>
        )}
        {tab === 'tools' && (
          <div className="tabview" key={'t' + profileId}><Tools profileId={profileId} /></div>
        )}
        {tab === 'me' && (
          <div className="tabview" key={'m' + profileId}>
            {inSettings
              ? <Settings profileId={profileId} onBack={() => setInSettings(false)} onProfileChange={switchProfile} />
              : <Profile profileId={profileId} onOpenSettings={() => setInSettings(true)} />}
          </div>
        )}
      </div>
      <nav className="tabbar">
        {tabs.map((t) => (
          <button key={t.id}
            className={'tab' + (tab === t.id ? ' active' : '')}
            onClick={() => { setTab(t.id); if (t.id !== 'me') setInSettings(false) }}>
            <I n={t.icon} size={24} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <Toast msg={toast} />
    </div>
  )
}
