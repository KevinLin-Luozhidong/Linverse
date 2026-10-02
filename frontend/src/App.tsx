import { useEffect, useState } from 'react'
import Assistant from './pages/Assistant'
import Tools from './pages/Tools'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import Report from './pages/Report'
import Favorites from './pages/Favorites'
import { I, Toast } from './components'
import { listProfiles, createProfile, getSettings } from '@api'

// App：底部三栏导航（AI助手 / 学习工具 / 个人中心）
// 个人中心内嵌设置 / 学习报告 / 我的收藏三个二级页；负责账号初始化与外观偏好应用
type Tab = 'assistant' | 'tools' | 'me'
type MeView = 'profile' | 'settings' | 'report' | 'favorites'

export default function App() {
  // 截图调试用：?tab=tools&view=settings 可直接定位页面，日常使用无影响
  const qp = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
  const initTab = (qp?.get('tab') as Tab) || 'assistant'
  const initView = (qp?.get('view') as MeView) || 'profile'
  const [tab, setTab] = useState<Tab>(['assistant', 'tools', 'me'].includes(initTab) ? initTab : 'assistant')
  const [meView, setMeView] = useState<MeView>(initView) // 个人中心内当前视图
  const [profileId, setProfileId] = useState<string | null>(() => localStorage.getItem('linverse.profileId'))
  const [toast, setToast] = useState('')
  // 访问过的 tab：首次进入时挂载，之后常驻不卸载。
  // 切 tab 只切换 display 显隐——AI 的对话、输入框、请求中的回答都保留，
  // 也避免每次切 tab 重新拉数据（serverless 冷启动慢）
  const [visitedTabs, setVisitedTabs] = useState<Tab[]>([initTab])
  // 个人中心二级页同理：首次进入挂载，之后常驻
  const [visitedMe, setVisitedMe] = useState<MeView[]>([initView])

  // 启动时确定账号
  // 隐私原则：只认本浏览器 localStorage 里存的账号 ID。
  // 新浏览器（没存过）永远新建账号，绝不自动认领库里已有的账号——
  // 否则陌生人打开网址会直接看到第一个人的错题本和笔记。
  // 换设备找回：个人中心顶部展示"账号 ID"，在设置-多账号里输入旧 ID 即可找回
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const saved = localStorage.getItem('linverse.profileId')
        const ps = await listProfiles()
        if (!alive) return
        // 注意：数据库返回的 id 可能是数字（如 1），localStorage 里永远是字符串（如 "1")。
        // 直接用 === 比较会判成不相等，导致每次刷新都误判"账号不存在"然后不断新建账号。
        // 所以比较前两边都转成字符串再比，这是全站账号 ID 比较的统一做法
        if (saved && ps.some((p) => String(p.id) === String(saved))) {
          setProfileId(saved)
          return
        }
        // 新浏览器，或存的账号已被删除：建新账号
        const p = await createProfile('我')
        if (!alive) return
        const newId = String(p.id) // 统一存成字符串，后面所有比较都不再踩类型坑
        localStorage.setItem('linverse.profileId', newId)
        setProfileId(newId)
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
        // 截图调试用：?forceTheme=dark 强制深浅色
        const ft = qp?.get('forceTheme')
        if (ft) document.documentElement.setAttribute('data-theme', ft)
      })
      .catch(() => {})
  }, [profileId])

  // 切换账号：更新本地记录并通知各页重新拉数据
  const switchProfile = (id: string) => {
    localStorage.setItem('linverse.profileId', id)
    setProfileId(id)
    setMeView('profile')
  }

  const tabs: { id: Tab; label: string; icon: 'chat' | 'grid' | 'user' }[] = [
    { id: 'assistant', label: 'AI助手', icon: 'chat' },
    { id: 'tools', label: '学习工具', icon: 'grid' },
    { id: 'me', label: '个人中心', icon: 'user' },
  ]

  // 切 tab：标记访问过（首次挂载），之后只显隐不卸载
  const goTab = (t: Tab) => {
    setVisitedTabs((v) => (v.includes(t) ? v : [...v, t]))
    setTab(t)
    if (t !== 'me') goMeView('profile')
  }
  // 个人中心二级页切换：同样首次挂载、之后常驻
  const goMeView = (v: MeView) => {
    setVisitedMe((s) => (s.includes(v) ? s : [...s, v]))
    setMeView(v)
  }

  return (
    <div className="app">
      <div className="main">
        {visitedTabs.includes('assistant') && (
          <div className="tabview" key={'a' + profileId}
            style={{ display: tab === 'assistant' ? 'block' : 'none' }}>
            <Assistant profileId={profileId} />
          </div>
        )}
        {visitedTabs.includes('tools') && (
          <div className="tabview" key={'t' + profileId}
            style={{ display: tab === 'tools' ? 'block' : 'none' }}>
            <Tools profileId={profileId} />
          </div>
        )}
        {visitedTabs.includes('me') && (
          <div className="tabview" key={'m' + profileId}
            style={{ display: tab === 'me' ? 'block' : 'none' }}>
            {visitedMe.includes('profile') && (
              <div style={{ display: meView === 'profile' ? 'block' : 'none' }}>
                <Profile profileId={profileId}
                  onOpenSettings={() => goMeView('settings')}
                  onOpenReport={() => goMeView('report')}
                  onOpenFavorites={() => goMeView('favorites')} />
              </div>
            )}
            {visitedMe.includes('settings') && (
              <div style={{ display: meView === 'settings' ? 'block' : 'none' }}>
                <Settings profileId={profileId} onBack={() => goMeView('profile')} onProfileChange={switchProfile} />
              </div>
            )}
            {visitedMe.includes('report') && (
              <div style={{ display: meView === 'report' ? 'block' : 'none' }}>
                <Report profileId={profileId} onBack={() => goMeView('profile')} />
              </div>
            )}
            {visitedMe.includes('favorites') && (
              <div style={{ display: meView === 'favorites' ? 'block' : 'none' }}>
                <Favorites profileId={profileId} onBack={() => goMeView('profile')} />
              </div>
            )}
          </div>
        )}
      </div>
      <nav className="tabbar">
        {tabs.map((t) => (
          <button key={t.id}
            className={'tab' + (tab === t.id ? ' active' : '')}
            onClick={() => goTab(t.id)}>
            <I n={t.icon} size={24} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <Toast msg={toast} />
    </div>
  )
}
