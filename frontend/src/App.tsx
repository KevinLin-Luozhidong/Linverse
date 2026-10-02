import { useEffect, useState } from 'react'
import Assistant from './pages/Assistant'
import Tools from './pages/Tools'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import Report from './pages/Report'
import SiteGate from './SiteGate'
import { I, Toast } from './components'
import { listProfiles, createProfile, getSettings, siteStatus, getSiteToken } from '@api'

// App：底部三栏导航（AI助手 / 学习工具 / 个人中心）
// 个人中心内嵌设置 / 学习报告 / 我的收藏三个二级页；负责账号初始化与外观偏好应用
type Tab = 'assistant' | 'tools' | 'me'
type MeView = 'profile' | 'settings' | 'report'

export default function App() {
  // 截图调试用：?tab=tools&view=settings 可直接定位页面，日常使用无影响
  const qp = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
  const initTab = (qp?.get('tab') as Tab) || 'assistant'
  const initView = (qp?.get('view') as MeView) || 'profile'
  const [tab, setTab] = useState<Tab>(['assistant', 'tools', 'me'].includes(initTab) ? initTab : 'assistant')
  const [meView, setMeView] = useState<MeView>(initView) // 个人中心内当前视图
  const [profileId, setProfileId] = useState<string | null>(() => localStorage.getItem('linverse.profileId'))
  const [toast, setToast] = useState('')
  // 新账号被站长关掉时：新设备显示"未开放注册"，不进 App
  const [signupBlocked, setSignupBlocked] = useState(false)
  // 访问过的 tab：首次进入时挂载，之后常驻不卸载。
  // 切 tab 只切换 display 显隐——AI 的对话、输入框、请求中的回答都保留，
  // 也避免每次切 tab 重新拉数据（serverless 冷启动慢）
  const [visitedTabs, setVisitedTabs] = useState<Tab[]>([initTab])
  // 个人中心二级页同理：首次进入挂载，之后常驻
  const [visitedMe, setVisitedMe] = useState<MeView[]>([initView])

  // 访问密码门：启动时先问后端有没有设密码。
  // loading=查状态中，open=要输密码，pass=通过（没设密码也算通过）
  // 密码是主人自己在"设置 → 访问密码"里定的；token 过期被后端 401 时也会弹回门
  const [gate, setGate] = useState<'loading' | 'open' | 'pass'>('loading')
  useEffect(() => {
    let alive = true
    // 开屏加速：本地记得"没设密码"（linverse.sitePwSet=0）或有旧 token，直接放行不等后端；
    // 后台再找后端确认，万一其实设了密码但本地没 token，再弹密码门。
    // （Vercel 无服务器冷启动要几秒，开屏不能干等它）
    const cachedNoPw = localStorage.getItem('linverse.sitePwSet') === '0'
    const hasToken = !!getSiteToken()
    if (cachedNoPw || hasToken) setGate('pass')
    // 开屏兜底：2.5 秒后端还没回话，先放行进 App（后台继续等，确认要密码再弹门）
    // 避免国内网络 hang 住时卡在 Linverse 启动屏"等得崩溃"
    let gateDone = false
    const gateTimer = setTimeout(() => {
      if (!gateDone && alive) setGate('pass')
    }, 2500)
    siteStatus()
      .then((s) => {
        gateDone = true
        clearTimeout(gateTimer)
        try { localStorage.setItem('linverse.sitePwSet', s.passwordSet ? '1' : '0') } catch {}
        if (!alive) return
        if (s.passwordSet && !getSiteToken()) setGate('open')
        else setGate('pass')
      })
      .catch(() => {
        gateDone = true
        clearTimeout(gateTimer)
        if (alive && !cachedNoPw && !hasToken) setGate('pass')
      }) // 后端连不上：先放行，页面内再提示
    const onLock = () => setGate('open')
    window.addEventListener('linverse:site-locked', onLock)
    return () => { alive = false; window.removeEventListener('linverse:site-locked', onLock) }
  }, [])

  // 启动时确定账号（只在过门后执行，避免没密码时乱建账号）
  // 隐私原则：只认本浏览器 localStorage 里存的账号 ID。
  // 新浏览器（没存过）永远新建账号，绝不自动认领库里已有的账号——
  // 否则陌生人打开网址会直接看到第一个人的错题本和笔记。
  // 换设备找回：个人中心顶部展示"账号 ID"，在设置-多账号里输入旧 ID 即可找回
  useEffect(() => {
    if (gate !== 'pass') return // 没过密码门不初始化，避免陌生人触发建账号
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
        // 如果站长关了注册总闸，后端会 403，前端显示"未开放"不进 App
        try {
          const p = await createProfile('我')
          if (!alive) return
          const newId = String(p.id) // 统一存成字符串，后面所有比较都不再踩类型坑
          localStorage.setItem('linverse.profileId', newId)
          setProfileId(newId)
        } catch (e) {
          if (!alive) return
          if (e instanceof Error && e.message.includes('未开放')) {
            setSignupBlocked(true)
          } else {
            setToast('后端未连接，部分功能不可用')
          }
        }
      } catch {
        if (alive) setToast('后端未连接，部分功能不可用')
      }
    })()
    return () => { alive = false }
  }, [gate])

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
    if (t === 'me' && tab === 'me') goMeView('profile') // 重复点个人中心：回到主页（初级菜单）
    setTab(t)
    if (t !== 'me') goMeView('profile')
    // 外层滚动归零：个人中心页很长（要下滑找设置），外层 .main 的滚动位置会带到设置页，
    // 导致设置菜单一打开就是"被划过"的样子。切 tab/切二级页时一律回顶，保证"摆正位置"。
    document.querySelector('.main')?.scrollTo({ top: 0 })
  }
  // 个人中心二级页切换：同样首次挂载、之后常驻
  // 点"设置"永远回到设置初级菜单：Settings 内部 view 状态会记住子菜单，用 key 强制重挂载清掉
  const [settingsKey, setSettingsKey] = useState(0)
  const goMeView = (v: MeView) => {
    setVisitedMe((s) => (s.includes(v) ? s : [...s, v]))
    if (v === 'settings') setSettingsKey((k) => k + 1)
    setMeView(v)
    document.querySelector('.main')?.scrollTo({ top: 0 })
  }

  // 密码门：查状态中显示空白闪屏，要输密码显示密码页，通过后进主界面
  if (gate === 'loading') return <div className="app"><div className="gate"><div className="gate-title">Linverse</div></div></div>
  if (gate === 'open') return <div className="app"><SiteGate onPass={() => setGate('pass')} /></div>
  // 注册总闸关了：新设备不让进，只显示一句话
  if (signupBlocked) return (
    <div className="app"><div className="gate">
      <div className="gate-title">Linverse</div>
      <div style={{ color: 'var(--ink2)', fontSize: 'calc(14px * var(--fss))', marginTop: 12 }}>
        站长暂未开放新账号注册
      </div>
    </div></div>
  )

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
                  onOpenReport={() => goMeView('report')} />
              </div>
            )}
            {visitedMe.includes('settings') && (
              <div style={{ display: meView === 'settings' ? 'block' : 'none' }}>
                <Settings key={settingsKey} profileId={profileId} onBack={() => goMeView('profile')} onProfileChange={switchProfile} />
              </div>
            )}
            {visitedMe.includes('report') && (
              <div style={{ display: meView === 'report' ? 'block' : 'none' }}>
                <Report profileId={profileId} onBack={() => goMeView('profile')} />
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
