import { useEffect, useState } from 'react'
import { I, Toast } from '../components'
import {
  listProfiles, createProfile, renameProfile, deleteProfile,
  getSettings, saveSettings, getAiKey, setAiKey, type Profile as P,
  siteStatus, siteSetPassword, setSiteToken, siteReset,
} from '@api'

// 设置页：八个多彩圆角入口，点进二级页用横向推入转场（苹果味）
// AI 的 Key 只存前端 localStorage，不经过后端

type View = 'menu' | 'profile' | 'accounts' | 'ai' | 'appearance' | 'font' | 'storage' | 'about' | 'sitepw'
const ORDER: View[] = ['menu', 'profile', 'accounts', 'ai', 'appearance', 'font', 'storage', 'about', 'sitepw']
const TITLES: Record<View, string> = {
  menu: '设置', profile: '个人资料', accounts: '多账号', ai: 'AI 接口',
  appearance: '外观', font: '字体大小', storage: '存储空间', about: '关于',
  sitepw: '访问密码',
}

const PROVIDERS = [
  { v: 'demo', label: '演示' },
  { v: 'deepseek', label: 'DeepSeek' },
  { v: 'gemini', label: 'Gemini' },
  { v: 'openai', label: 'OpenAI' },
  { v: 'custom', label: '自定义' },
]

export default function Settings({ profileId, onBack, onProfileChange }: {
  profileId: string | null; onBack: () => void; onProfileChange: (id: string) => void
}) {
  const [view, setView] = useState<View>('menu')
  const [toast, setToast] = useState('')

  // 账号
  const [profiles, setProfiles] = useState<P[]>([])
  const [newName, setNewName] = useState('')
  const [findId, setFindId] = useState('') // 输入账号 ID 找回
  const [editingId, setEditingId] = useState('')
  const [editingName, setEditingName] = useState('')
  const [delId, setDelId] = useState('')
  const [displayName, setDisplayName] = useState('学习者')

  // 外观
  const [fontSize, setFontSize] = useState('medium')
  const [theme, setTheme] = useState('system')

  // AI 接口
  const [provider, setProvider] = useState('demo')
  const [aiModel, setAiModel] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [key, setKey] = useState('')

  // 读账号列表 + 设置
  // 统一把账号 ID 转成字符串：数据库返回的 id 可能是数字，localStorage 里是字符串，
  // 入口处归一一次，后面所有比较/改名/删除都不用再操心类型
  const normProfiles = (ps: P[]) => ps.map((p) => ({ ...p, id: String(p.id) }))
  useEffect(() => {
    listProfiles().then((ps) => {
      const list = normProfiles(ps)
      setProfiles(list)
      const me = list.find((p) => p.id === profileId)
      if (me) setDisplayName(me.name)
    }).catch(() => {})
    setKey(getAiKey()) // Key 只从本地读
    if (!profileId) return
    getSettings(profileId).then((s) => {
      setFontSize(s.fontSize || 'medium')
      setTheme(s.theme || 'system')
      setProvider(s.aiProvider || 'demo')
      setAiModel(s.aiModel || '')
      setEndpoint(s.aiEndpoint || '')
      applyAppearance(s.fontSize || 'medium', s.theme || 'system')
    }).catch(() => {})
  }, [profileId])

  // 外观即时生效：写到 html 标签属性，CSS 变量自动切换
  const applyAppearance = (fs: string, th: string) => {
    document.documentElement.setAttribute('data-fontsize', fs)
    if (th === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', th)
  }
  const changeAppearance = (fs: string, th: string) => {
    setFontSize(fs); setTheme(th)
    applyAppearance(fs, th)
    if (profileId) saveSettings({ profileId, fontSize: fs, theme: th }).catch(() => {})
  }

  // 账号操作
  const reloadProfiles = () => listProfiles().then((ps) => {
    const list = normProfiles(ps)
    setProfiles(list)
    const me = list.find((p) => p.id === profileId)
    if (me) setDisplayName(me.name)
  }).catch(() => {})
  const addProfile = async () => {
    const n = newName.trim()
    if (!n) { setToast('先输入名字'); return }
    try {
      const p = await createProfile(n)
      setNewName('')
      reloadProfiles()
      onProfileChange(String(p.id)) // 新建后直接切换过去：转字符串，和 localStorage 口径一致
    } catch (e) { setToast(e instanceof Error ? e.message : '创建失败') }
  }
  const doRename = async (id: string) => {
    const n = editingName.trim()
    if (!n) { setEditingId(''); return }
    try {
      await renameProfile(id, n)
      setEditingId('')
      reloadProfiles()
    } catch (e) { setToast(e instanceof Error ? e.message : '改名失败') }
  }
  // 输入账号 ID 找回：换设备/清数据后，凭个人中心复制的 ID 找回原账号
  const doFind = async () => {
    const id = findId.trim()
    if (!id) { setToast('先输入账号 ID'); return }
    try {
      const ps = await listProfiles()
      // 用户手输的是字符串，数据库 id 可能是数字：两边转字符串再比
      if (!ps.some((p) => String(p.id) === String(id))) { setToast('没找到这个账号 ID'); return }
      setFindId('')
      onProfileChange(id) // 切过去，App 会记入本浏览器
    } catch (e) { setToast(e instanceof Error ? e.message : '找回失败') }
  }
  // 个人资料：改当前账号的显示名
  const saveDisplayName = async () => {
    if (!profileId) return
    const n = displayName.trim() || '学习者'
    try {
      await renameProfile(profileId, n)
      setDisplayName(n)
      setToast('已保存')
    } catch (e) { setToast(e instanceof Error ? e.message : '保存失败') }
  }
  const doDelete = async (id: string) => {
    if (delId !== id) { setDelId(id); return }
    if (profiles.length <= 1) { setToast('至少保留一个账号'); return }
    try {
      await deleteProfile(id)
      setDelId('')
      if (id === profileId) {
        const rest = profiles.filter((p) => p.id !== id)
        onProfileChange(rest[0].id) // 删的是当前账号就切到第一个
      } else reloadProfiles()
    } catch (e) { setToast(e instanceof Error ? e.message : '删除失败') }
  }

  // 保存 AI 设置：Key 写 localStorage，其余写后端
  const saveAi = async () => {
    if (!profileId) return
    setAiKey(key.trim())
    try {
      await saveSettings({ profileId, aiProvider: provider, aiModel: aiModel.trim(), aiEndpoint: endpoint.trim() })
      localStorage.setItem('linverse.model', provider)
      setToast('已保存')
    } catch (e) { setToast(e instanceof Error ? e.message : '保存失败') }
  }

  // 存储空间：统计 localStorage 占用，清理只清界面偏好缓存
  const cacheMB = () => {
    let bytes = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || ''
      bytes += k.length + (localStorage.getItem(k) || '').length
    }
    return (bytes / 1024 / 1024).toFixed(1)
  }
  const [confirmClear, setConfirmClear] = useState(false)
  const clearCache = () => {
    if (!confirmClear) { setConfirmClear(true); return }
    localStorage.removeItem('linverse.deepThink')
    localStorage.removeItem('linverse.model')
    setConfirmClear(false)
    setToast('已清理')
  }

  // 清空所有数据（恢复出厂设置）：删掉全部账号、错题、笔记、生词、会话，ID 从 1 重来。
  // 访问密码保留；本地存的账号 ID 也清掉，App 重启后会自动建新账号
  const [confirmWipe, setConfirmWipe] = useState(false)
  const wipeAll = async () => {
    if (!confirmWipe) { setConfirmWipe(true); return }
    setConfirmWipe(false)
    try {
      await siteReset()
      localStorage.removeItem('linverse.profileId')
      setToast('已清空，重新开始')
      setTimeout(() => location.reload(), 900)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '清空失败')
    }
  }

  // 访问密码：网站大门的密码锁。设好后别人打开网址要先输对密码才能用。
  // 密码只存后端的 SHA256，前端不存原文；验证通过后存 token，后续请求自动带上
  const [pwSet, setPwSet] = useState(false)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  useEffect(() => {
    siteStatus().then((s) => setPwSet(s.passwordSet)).catch(() => {})
  }, [])
  const saveSitePw = async () => {
    const p = newPw.trim()
    if (p.length < 4) { setToast('密码至少 4 位'); return }
    try {
      // 没设过：直接设；已设：必须带对旧密码才能改
      const r = await siteSetPassword(p, pwSet ? oldPw.trim() : undefined)
      setSiteToken(r.token)
      setPwSet(true)
      setOldPw(''); setNewPw('')
      setToast(pwSet ? '密码已修改' : '访问密码已设置，朋友打开网址要先输这个密码')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '设置失败')
    }
  }

  const idx = ORDER.indexOf(view)
  const providerLabel = PROVIDERS.find((p) => p.v === provider)?.label || '演示'
  const themeLabel = theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'
  const fontLabel = fontSize === 'small' ? '小' : fontSize === 'large' ? '大' : '标准'

  const row = (v: View, icon: 'user' | 'key' | 'users' | 'moon' | 'textsize' | 'db' | 'info' | 'lock',
    sq: 'blue' | 'green' | 'orange' | 'gray', label: string, val?: string) => (
    <button className="set-row" onClick={() => setView(v)}>
      <span className={'sq ' + sq}><I n={icon} size={21} /></span>
      <span>{label}</span>
      {val && <span className="set-val">{val}</span>}
      <span className="chev"><I n="chev" size={16} /></span>
    </button>
  )

  return (
    <div className="settings">
      <div className="topbar">
        <button className="icon-btn" onClick={() => (view === 'menu' ? onBack() : setView('menu'))} aria-label="返回">
          <I n="back" />
        </button>
        <div className="topbar-title">{TITLES[view]}</div>
        <div className="topbar-spacer" />
      </div>

      <div className="settings-view">
        <div className="settings-track" style={{ transform: `translateX(-${idx * 100}%)` }}>
          {/* 一级菜单：三组多彩圆角入口 */}
          <div className="settings-page">
            <div className="set-group">
              {row('profile', 'user', 'blue', '个人资料', displayName)}
              {row('ai', 'key', 'green', 'AI 接口', providerLabel)}
              {row('accounts', 'users', 'orange', '多账号', displayName)}
            </div>
            <div className="set-group">
              {row('appearance', 'moon', 'blue', '外观', themeLabel)}
              {row('font', 'textsize', 'green', '字体大小', fontLabel)}
              {row('sitepw', 'lock', 'gray', '访问密码', pwSet ? '已设置' : '未设置')}
              {row('storage', 'db', 'orange', '存储空间', `缓存 ${cacheMB()} MB`)}
            </div>
            <div className="set-group">
              {row('about', 'info', 'gray', '关于')}
            </div>
          </div>

          {/* 个人资料 */}
          <div className="settings-page">
            <div className="field">
              <div className="field-label">显示名</div>
              <input className="input" value={displayName}
                onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <button className="btn" style={{ width: '100%' }} onClick={saveDisplayName}>保存</button>
          </div>

          {/* 多账号 */}
          <div className="settings-page">
            {profiles.map((p) => (
              <div key={p.id} className={'profile-item' + (p.id === profileId ? ' current' : '')}>
                {editingId === p.id ? (
                  <input className="input" value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') doRename(p.id) }} autoFocus />
                ) : (
                  <span className="profile-name" onClick={() => p.id !== profileId && onProfileChange(p.id)}>
                    {p.name}{p.id === profileId ? '（当前）' : ''}
                  </span>
                )}
                {editingId === p.id ? (
                  <button className="mini-btn" onClick={() => doRename(p.id)}>确定</button>
                ) : (
                  <button className="mini-btn" onClick={() => { setEditingId(p.id); setEditingName(p.name) }}>改名</button>
                )}
                {delId === p.id
                  ? <button className="mini-btn" style={{ color: 'var(--red)' }} onClick={() => doDelete(p.id)}>确认删除</button>
                  : <button className="mini-btn" style={{ color: 'var(--ink3)' }} onClick={() => doDelete(p.id)}>删除</button>}
              </div>
            ))}
            <div className="btn-row" style={{ marginTop: 6 }}>
              <input className="input" value={newName} placeholder="新账号名字"
                onChange={(e) => setNewName(e.target.value)} />
              <button className="btn" onClick={addProfile}>添加</button>
            </div>
            {/* 换设备找回：输入旧账号 ID */}
            <div className="field-label" style={{ marginTop: 14 }}>换设备时输入旧账号 ID 找回</div>
            <div className="btn-row" style={{ marginTop: 6 }}>
              <input className="input" value={findId} placeholder="账号 ID"
                onChange={(e) => setFindId(e.target.value)} />
              <button className="btn" onClick={doFind}>找回</button>
            </div>
          </div>

          {/* AI 接口 */}
          <div className="settings-page">
            <div className="field">
              <div className="field-label">供应商</div>
              <div className="seg">
                {PROVIDERS.map((p) => (
                  <button key={p.v} className={provider === p.v ? 'on' : ''}
                    onClick={() => setProvider(p.v)}>{p.label}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <div className="field-label">模型名（可改）</div>
              <input className="input" value={aiModel}
                placeholder={provider === 'deepseek' ? '比如 deepseek-chat' : '比如 gpt-4o-mini'}
                onChange={(e) => setAiModel(e.target.value)} />
            </div>
            <div className="field">
              <div className="field-label">接口地址（自定义供应商填写）</div>
              <input className="input" value={endpoint}
                placeholder="https://…/v1/chat/completions"
                onChange={(e) => setEndpoint(e.target.value)} />
            </div>
            <div className="field">
              <div className="field-label">Key</div>
              <input className="input" type="password" value={key}
                placeholder="粘贴你的 API Key"
                onChange={(e) => setKey(e.target.value)} autoComplete="off" />
              <div className="safe-note">Key 只保存在这台设备的浏览器里，不会上传到服务器，换设备需要重新填写</div>
            </div>
            <button className="btn" style={{ width: '100%' }} onClick={saveAi}>保存</button>
          </div>

          {/* 外观 */}
          <div className="settings-page">
            <div className="field">
              <div className="field-label">深浅色</div>
              <div className="seg">
                {[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([v, l]) => (
                  <button key={v} className={theme === v ? 'on' : ''}
                    onClick={() => changeAppearance(fontSize, v)}>{l}</button>
                ))}
              </div>
            </div>
          </div>

          {/* 字体大小 */}
          <div className="settings-page">
            <div className="field">
              <div className="field-label">字体大小</div>
              <div className="seg">
                {[['small', '小'], ['medium', '标准'], ['large', '大']].map(([v, l]) => (
                  <button key={v} className={fontSize === v ? 'on' : ''}
                    onClick={() => changeAppearance(v, theme)}>{l}</button>
                ))}
              </div>
            </div>
          </div>

          {/* 存储空间 */}
          <div className="settings-page">
            <div className="report-row">
              <span>本地缓存</span>
              <span className="v">{cacheMB()} MB</span>
            </div>
            <div className="safe-note">清理只清除界面偏好等临时缓存，账号、错题、笔记、生词和 Key 不受影响</div>
            <button className={'btn ' + (confirmClear ? 'btn-danger' : 'btn-ghost')}
              style={{ width: '100%', marginTop: 12 }} onClick={clearCache}>
              {confirmClear ? '再点一次确认清理' : '清理缓存'}
            </button>
            <div className="safe-note" style={{ marginTop: 16, color: 'var(--red)' }}>危险区</div>
            <div className="safe-note">清空所有账号、错题、笔记、生词和会话，账号 ID 从 1 重新开始，访问密码保留</div>
            <button className={'btn ' + (confirmWipe ? 'btn-danger' : 'btn-ghost')}
              style={{ width: '100%', marginTop: 12 }} onClick={wipeAll}>
              {confirmWipe ? '再点一次确认清空' : '清空所有数据'}
            </button>
          </div>

          {/* 访问密码 */}
          <div className="settings-page">
            <div className="safe-note" style={{ marginBottom: 12 }}>
              {pwSet
                ? '已设置访问密码：别人打开网址要先输对密码才能用'
                : '设一个访问密码：之后朋友打开网址要先输这个密码，把密码告诉他们就行'}
            </div>
            {pwSet && (
              <div className="field">
                <div className="field-label">旧密码</div>
                <input className="input" type="password" value={oldPw}
                  onChange={(e) => setOldPw(e.target.value)} placeholder="输入旧密码" />
              </div>
            )}
            <div className="field">
              <div className="field-label">{pwSet ? '新密码' : '访问密码'}（至少 4 位）</div>
              <input className="input" type="password" value={newPw}
                onChange={(e) => setNewPw(e.target.value)} placeholder={pwSet ? '输入新密码' : '定一个密码'} />
            </div>
            <button className="btn" style={{ width: '100%' }} onClick={saveSitePw}>
              {pwSet ? '修改密码' : '设置密码'}
            </button>
          </div>

          {/* 关于 */}
          <div className="settings-page">
            <div className="set-group">
              <div className="set-row" style={{ cursor: 'default' }}>
                <span className="sq blue"><I n="sparkle" size={21} /></span>
                <span>Linverse<span className="sr-desc" style={{ display: 'block' }}>专为中国高中生打造的 AI 学习助手</span></span>
              </div>
              <div className="set-row" style={{ cursor: 'default' }}>
                <span className="sr-label">版本</span>
                <span className="set-val">v0.1.0</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Toast msg={toast} />
    </div>
  )
}
