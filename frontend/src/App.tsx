import { useEffect, useState } from 'react'
import Assistant from './pages/Assistant'
import Tools from './pages/Tools'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import Report from './pages/Report'
import SiteGate from './SiteGate'
import { I, Toast, Spin } from './components'
import { listProfiles, createProfile, claimProfile, getSettings, siteStatus, getSiteToken, getPid, setPid, getProfileToken, setProfileToken, clearPid } from '@api'

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
  const [profileId, setProfileId] = useState<string | null>(() => getPid())
  const [toast, setToast] = useState('')
  // 账号卡住：本地记得账号 ID 但登录凭证丢了（比如浏览器数据被清理），
  // 此时所有业务接口都会 401，不能只弹一次 toast 就把人留在残缺状态，必须给恢复入口。
  const [accountError, setAccountError] = useState<string | null>(null)
  const [accountBusy, setAccountBusy] = useState(false)
  // 新账号被站长关掉时：新设备显示"未开放注册"，不进 App
  const [signupBlocked, setSignupBlocked] = useState(false)
  const [restoreId, setRestoreId] = useState('')
  const [restoreToken, setRestoreToken] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState('')
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
        const saved = getPid()
        let profile
        if (saved) {
          // 旧版本账号首次升级：用现有站点访问权限给旧账号绑定独立随机凭证。
          // 账号已被其他设备绑定时，不尝试用账号 ID 绕过所有权校验。
          if (!getProfileToken()) {
            profile = await claimProfile(saved)
            setProfileToken(profile.authToken, String(profile.id))
          } else {
            const ps = await listProfiles()
            if (!ps.some((p) => String(p.id) === String(saved))) {
              throw new Error('账号凭证与当前账号不匹配，请检查本设备保存的账号信息')
            }
            const matched = ps.find((p) => String(p.id) === String(saved))
            if (!matched) throw new Error('找不到当前账号')
            profile = matched
          }
          setProfileId(String(profile.id))
        } else {
          // 新设备只创建新账号，不枚举或自动认领数据库里的其他账号。
          profile = await createProfile('我')
          setProfileToken(profile.authToken, String(profile.id))
          const newId = String(profile.id)
          setPid(newId)
          setProfileId(newId)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '账号验证失败，请重试'
        if (alive) {
          setToast(msg)
          // 真卡住才拦：没凭证（认领/新建失败）或凭证与账号对不上；
          // 纯网络抖动不拦（有凭证时各页自己会重试），避免小题大做吓到用户。
          const stuck = !getProfileToken() || /凭证|不匹配|找不到当前账号/.test(msg)
          if (stuck) setAccountError(msg)
        }
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

  // 注册关闭时，仍允许持有账号恢复密钥的用户恢复已有账号。
  const restoreExistingProfile = async () => {
    const id = restoreId.trim()
    const token = restoreToken.trim()
    if (!id || !token) { setRestoreError('请输入账号 ID 和恢复密钥'); return }
    if (restoring) return
    setRestoring(true)
    setRestoreError('')
    try {
      setPid(id)
      setProfileToken(token, id)
      const ps = await listProfiles()
      if (!ps.some((p) => String(p.id) === String(id))) throw new Error('账号 ID 或恢复密钥不正确')
      setProfileId(id)
      setSignupBlocked(false)
      setRestoreToken('')
    } catch (e) {
      clearPid()
      setProfileToken('', id)
      setRestoreError(e instanceof Error ? e.message : '账号恢复失败')
    } finally {
      setRestoring(false)
    }
  }

  // 账号卡住时的恢复：重新认领本账号（需要访问密码已设好，否则后端会明说先设密码）
  const retryClaim = async () => {
    const saved = getPid()
    if (!saved || accountBusy) return
    setAccountBusy(true)
    try {
      const p = await claimProfile(saved)
      setProfileId(String(p.id))
      setAccountError(null)
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : '认领失败')
    } finally { setAccountBusy(false) }
  }
  // 账号卡住时的恢复：新建一个账号（POST /profiles 不需要账号凭证，卡住时也能建；
  // 旧账号的数据不会丢，以后用恢复密钥还能找回来）
  const createNewAccount = async () => {
    if (accountBusy) return
    setAccountBusy(true)
    try {
      const p = await createProfile('我')
      setPid(String(p.id))
      setProfileId(String(p.id))
      setAccountError(null)
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : '新建账号失败')
    } finally { setAccountBusy(false) }
  }
  // 账号卡住时的恢复：用恢复密钥找回（与注册关闭屏的恢复不同：失败不清除已存的账号 ID，
  // 否则连“重新认领”这条路也没了；只清刚填错的凭证，之前存的 ID 失败时原样恢复）
  const restoreAccountFromKey = async () => {
    const id = restoreId.trim()
    const token = restoreToken.trim()
    if (!id || !token) { setRestoreError('请输入账号 ID 和恢复密钥'); return }
    if (restoring) return
    const prevPid = getPid()
    setRestoring(true)
    setRestoreError('')
    try {
      setPid(id)
      setProfileToken(token, id)
      const ps = await listProfiles()
      if (!ps.some((p) => String(p.id) === String(id))) throw new Error('账号 ID 或恢复密钥不正确')
      setProfileId(id)
      setAccountError(null)
      setSignupBlocked(false)
      setRestoreToken('')
    } catch (e) {
      if (prevPid) setPid(prevPid)
      else clearPid()
      setProfileToken('', id)
      setRestoreError(e instanceof Error ? e.message : '账号恢复失败')
    } finally { setRestoring(false) }
  }

  // 切换账号：更新本地记录并通知各页重新拉数据
  const switchProfile = (id: string) => {
    setPid(id)
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

  // 密码门：查状态中显示转圈（原来只有标题，慢网下像卡死），要输密码显示密码页，通过后进主界面
  if (gate === 'loading') return <div className="app"><div className="gate"><div className="gate-title">Linverse</div><Spin /></div></div>
  if (gate === 'open') return <div className="app"><SiteGate onPass={() => setGate('pass')} /></div>
  // 账号卡住屏：凭证丢了时不让用户进一个处处 401 的残缺 App，给三条恢复路。
  // 注意：重新认领需要访问密码已设好（后端认领接口的硬性要求）；访问密码还没设时，
  // 认领会明说“先设置访问密码”，等不及可直接新建账号或用恢复密钥找回。
  if (accountError) return (
    <div className="app"><div className="gate">
      <div className="gate-title">账号验证出了问题</div>
      <div style={{ color: 'var(--ink2)', fontSize: 'calc(14px * var(--fss))', marginTop: 12, maxWidth: 320, lineHeight: 1.6 }}>
        这台设备记得账号 ID {getPid() || '（未知）'}，但登录凭证丢了（比如浏览器数据被清理），
        现在对话、词典、设置这些需要账号的功能都用不了。选一条路恢复：
      </div>
      <div style={{ color: 'var(--red)', fontSize: 'calc(13px * var(--fss))', marginTop: 10, maxWidth: 320 }}>
        {accountError}
      </div>
      <div style={{ width: 'min(320px, 88vw)', marginTop: 20 }}>
        {getPid() && (
          <button className="btn" style={{ width: '100%' }}
            onClick={retryClaim} disabled={accountBusy}>
            {accountBusy ? '认领中…' : '重新认领本账号'}
          </button>
        )}
        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10 }}
          onClick={createNewAccount} disabled={accountBusy}>
          新建一个账号
        </button>
        <div style={{ color: 'var(--ink3)', fontSize: 'calc(13px * var(--fss))', marginTop: 20, marginBottom: 8 }}>
          或者用恢复密钥找回
        </div>
        <input className="input" value={restoreId} placeholder="已有账号 ID"
          onChange={(e) => setRestoreId(e.target.value)} />
        <input className="input" style={{ marginTop: 8 }} value={restoreToken}
          placeholder="账号恢复密钥" autoComplete="off"
          onChange={(e) => setRestoreToken(e.target.value)} />
        {restoreError && <div style={{ color: 'var(--red)', fontSize: 'calc(13px * var(--fss))', marginTop: 8 }}>{restoreError}</div>}
        <button className="btn" style={{ width: '100%', marginTop: 10 }}
          onClick={restoreAccountFromKey} disabled={restoring}>
          {restoring ? '验证中…' : '验证并恢复账号'}
        </button>
        <div style={{ color: 'var(--ink3)', fontSize: 'calc(12px * var(--fss))', marginTop: 12, lineHeight: 1.6 }}>
          旧账号的数据不会丢：新建账号后，以后拿到恢复密钥还能找回来。
        </div>
      </div>
    </div></div>
  )
  // 注册关闭时不允许新建账号，但仍提供恢复已有账号的入口。
  if (signupBlocked) return (
    <div className="app"><div className="gate">
      <div className="gate-title">Linverse</div>
      <div style={{ color: 'var(--ink2)', fontSize: 'calc(14px * var(--fss))', marginTop: 12 }}>
        站长暂未开放新账号注册
      </div>
      <div style={{ width: 'min(320px, 88vw)', marginTop: 20 }}>
        <input className="input" value={restoreId} placeholder="已有账号 ID"
          onChange={(e) => setRestoreId(e.target.value)} />
        <input className="input" style={{ marginTop: 8 }} value={restoreToken}
          placeholder="账号恢复密钥" autoComplete="off"
          onChange={(e) => setRestoreToken(e.target.value)} />
        {restoreError && <div style={{ color: 'var(--red)', fontSize: `calc(13px * var(--fss))`, marginTop: 8 }}>{restoreError}</div>}
        <button className="btn" style={{ width: '100%', marginTop: 10 }}
          onClick={restoreExistingProfile} disabled={restoring}>
          {restoring ? '验证中…' : '验证并恢复账号'}
        </button>
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
