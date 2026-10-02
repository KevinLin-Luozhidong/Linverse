import { useEffect, useState } from 'react'
import { I, Toast } from '../components'
import {
  listProfiles, createProfile, renameProfile, deleteProfile,
  getSettings, saveSettings, getAiKey, setAiKey, type Profile as P,
} from '../api'

// 设置页：二级菜单，点进 / 退出用横向推入转场（苹果味）
// AI 的 Key 只存前端 localStorage，不经过后端

type View = 'menu' | 'account' | 'appearance' | 'ai' | 'cache'
const ORDER: View[] = ['menu', 'account', 'appearance', 'ai', 'cache']
const TITLES: Record<View, string> = {
  menu: '设置', account: '账号', appearance: '外观', ai: 'AI 接口', cache: '清缓存',
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
  const [editingId, setEditingId] = useState('')
  const [editingName, setEditingName] = useState('')
  const [delId, setDelId] = useState('')

  // 外观
  const [fontSize, setFontSize] = useState('medium')
  const [theme, setTheme] = useState('system')
  const [uiStyle, setUiStyle] = useState('simple')

  // AI 接口
  const [provider, setProvider] = useState('demo')
  const [aiModel, setAiModel] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [key, setKey] = useState('')

  // 读账号列表 + 设置
  useEffect(() => {
    listProfiles().then(setProfiles).catch(() => {})
    setKey(getAiKey()) // Key 只从本地读
    if (!profileId) return
    getSettings(profileId).then((s) => {
      setFontSize(s.fontSize || 'medium')
      setTheme(s.theme || 'system')
      setProvider(s.aiProvider || 'demo')
      setAiModel(s.aiModel || '')
      setEndpoint(s.aiEndpoint || '')
      const us = localStorage.getItem('linverse.uistyle') || 'simple'
      setUiStyle(us)
      applyAppearance(s.fontSize || 'medium', s.theme || 'system', us)
    }).catch(() => {})
  }, [profileId])

  // 外观即时生效：写到 html 标签属性，CSS 变量自动切换
  const applyAppearance = (fs: string, th: string, us: string) => {
    document.documentElement.setAttribute('data-fontsize', fs)
    if (th === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', th)
    document.documentElement.setAttribute('data-uistyle', us)
    localStorage.setItem('linverse.uistyle', us)
  }
  const changeAppearance = (fs: string, th: string, us: string) => {
    setFontSize(fs); setTheme(th); setUiStyle(us)
    applyAppearance(fs, th, us)
    if (profileId) saveSettings({ profileId, fontSize: fs, theme: th }).catch(() => {})
  }

  // 账号操作
  const reloadProfiles = () => listProfiles().then(setProfiles).catch(() => {})
  const addProfile = async () => {
    const n = newName.trim()
    if (!n) { setToast('先输入名字'); return }
    try {
      const p = await createProfile(n)
      setNewName('')
      reloadProfiles()
      onProfileChange(p.id) // 新建后直接切换过去
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

  // 清缓存：只清本地缓存，不动账号和 Key
  const [confirmClear, setConfirmClear] = useState(false)
  const clearCache = () => {
    if (!confirmClear) { setConfirmClear(true); return }
    localStorage.removeItem('linverse.deepThink')
    localStorage.removeItem('linverse.model')
    setConfirmClear(false)
    setToast('已清理')
  }

  const idx = ORDER.indexOf(view)

  const menuItem = (v: View, icon: 'user' | 'sparkle' | 'chat' | 'trash', label: string, desc: string) => (
    <button className="menu-item" onClick={() => setView(v)}>
      <span className="mi-icon"><I n={icon} size={20} /></span>
      <span><div>{label}</div><div style={{ fontSize: 12, color: 'var(--ink2)', fontWeight: 400 }}>{desc}</div></span>
      <span className="mi-chev"><I n="back" size={18} /></span>
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
          {/* 一级菜单 */}
          <div className="settings-page">
            <div style={{ marginTop: 10 }}>
              {menuItem('account', 'user', '账号', '多账号切换 / 改名')}
              {menuItem('appearance', 'sparkle', '外观', '字体大小 / 深浅色 / UI 风格')}
              {menuItem('ai', 'chat', 'AI 接口', '供应商 / 模型 / Key')}
              {menuItem('cache', 'trash', '清缓存', '清理本地缓存数据')}
            </div>
          </div>

          {/* 账号 */}
          <div className="settings-page">
            <div style={{ marginTop: 10 }}>
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
            </div>
          </div>

          {/* 外观 */}
          <div className="settings-page">
            <div style={{ marginTop: 10 }}>
              <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <span className="sr-label">字体大小</span>
                <div className="seg">
                  {[['small', '小'], ['medium', '标准'], ['large', '大']].map(([v, l]) => (
                    <button key={v} className={fontSize === v ? 'on' : ''}
                      onClick={() => changeAppearance(v, theme, uiStyle)}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <span className="sr-label">深浅色</span>
                <div className="seg">
                  {[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([v, l]) => (
                    <button key={v} className={theme === v ? 'on' : ''}
                      onClick={() => changeAppearance(fontSize, v, uiStyle)}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <span className="sr-label">UI 风格</span>
                <div className="seg">
                  {[['simple', '简约'], ['soft', '柔和']].map(([v, l]) => (
                    <button key={v} className={uiStyle === v ? 'on' : ''}
                      onClick={() => changeAppearance(fontSize, theme, v)}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* AI 接口 */}
          <div className="settings-page">
            <div style={{ marginTop: 10 }}>
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
          </div>

          {/* 清缓存 */}
          <div className="settings-page">
            <div style={{ marginTop: 10 }}>
              <div className="set-row">
                <span>
                  <div className="sr-label">清理本地缓存</div>
                  <div className="sr-desc">清除临时的界面偏好缓存，账号、错题、笔记不受影响</div>
                </span>
              </div>
              <button className={'btn ' + (confirmClear ? 'btn-danger' : 'btn-ghost')}
                style={{ width: '100%', marginTop: 6 }} onClick={clearCache}>
                {confirmClear ? '再点一次确认清理' : '开始清理'}
              </button>
            </div>
          </div>
        </div>
      </div>
      <Toast msg={toast} />
    </div>
  )
}
