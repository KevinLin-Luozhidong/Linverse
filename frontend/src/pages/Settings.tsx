import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { I, Toast, useSwipeBack, useToast} from '../components'
import {
  listProfiles, createProfile, renameProfile, deleteProfile,
  getSettings, saveSettings, getAiKey, setAiKey, getAiKeyMap, getAiModel, effectiveModelName, setAiModel as saveAiModel, getCustomName, setCustomName as saveCustomName, deriveCustomName, seedCustomModel, setCustomModelOrigin, customModelOriginKey, listModels, getCachedProfiles, type Profile as P,
  siteStatus, siteSetPassword, siteReset,
  dangerStatus, setDangerPassword,
  signupStatus, setSignupAllow, clearPid, setPid, getProfileToken, setProfileToken, clearProfileAuth,
  verifyOwnerPassword, clearOwnerToken,
} from '@api'

// 设置页：八个多彩圆角入口，点进二级页用横向推入转场（苹果味）
// AI 的 Key 只存前端 localStorage，不经过后端

type View = 'menu' | 'profile' | 'accounts' | 'ai' | 'appearance' | 'font' | 'storage' | 'about' | 'sitepw'
const TITLES: Record<View, string> = {
  menu: '设置', profile: '个人资料', accounts: '多账号', ai: 'AI 接口',
  appearance: '外观', font: '字体大小', storage: '存储空间', about: '关于',
  sitepw: '访问密码',
}

const PROVIDERS = [
  { v: 'deepseek', label: 'DeepSeek' },
  { v: 'gemini', label: 'Gemini' },
  { v: 'openai', label: 'OpenAI' },
  { v: 'custom', label: '智谱' },
]

// 各供应商的模型名占位提示（只是提示，真正的名字存在各供应商自己的表里，用户随便改）
const MODEL_PLACEHOLDER: Record<string, string> = {
  deepseek: '比如 deepseek-flash',
  gemini: '比如 gemini-2.0-flash',
  openai: '比如 gpt-4o-mini',
  custom: '比如 glm-4v-flash',
}

export default function Settings({ profileId, onBack, onProfileChange }: {
  profileId: string | null; onBack: () => void; onProfileChange: (id: string) => void
}) {
  const [view, setView] = useState<View>('menu')
  // 每次进入访问密码页面都刷新状态，避免内外显示不一致
  useEffect(() => {
    if (view === 'sitepw') {
      siteStatus().then((s) => setPwSet(s.passwordSet)).catch(() => {})
    }
  }, [view])
  const [toastMsg, toastKey, setToast] = useToast()
  // 正在退出的子页面：保留一帧做"向右滑出"动画，露出底下菜单
  const [leaving, setLeaving] = useState<Exclude<View, 'menu'> | null>(null)
  const [leaveFrom, setLeaveFrom] = useState(0) // 退出动画起点（右滑松手时的手指位置）
  const [leaveScroll, setLeaveScroll] = useState(0) // 退出时子页面的滚动位置（避免分身回到顶部造成跳变）
  const leavingRef = useRef<HTMLDivElement>(null)
  // 推入动画播完后标记 settled，避免"拖拽取消"时推入动画重播导致闪烁
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    setSettled(false)
    const t = setTimeout(() => setSettled(true), 350)
    return () => clearTimeout(t)
  }, [view])

  // 进子页：浮层 key 变化触发推入动画
  const goSub = (v: Exclude<View, 'menu'>) => { setLeaving(null); setView(v) }
  // 回菜单：先记下离开的页面做滑出动画，320ms 后卸载
  const goBack = (fromX = 0) => {
    if (view === 'menu') { onBack(); return }
    // 返回前记下当前子页面的滚动位置，让退出动画从原位置接着滑，不跳回顶部
    const scroller = viewRef.current?.querySelector('.settings-over:not(.settings-leaving)')
    setLeaveScroll(scroller ? scroller.scrollTop : 0)
    setLeaving(view as Exclude<View, 'menu'>)
    setLeaveFrom(fromX)
    setView('menu')
    setTimeout(() => { setLeaving(null); setLeaveFrom(0); setLeaveScroll(0) }, 380)
  }
  // 退出分身挂载后恢复滚动位置
  useEffect(() => {
    if (leaving && leavingRef.current) leavingRef.current.scrollTop = leaveScroll
  }, [leaving, leaveScroll])

  // 切页时把目标页滚回顶部：避免"内容被顶栏压住半行"的错位感
  // 注意排除 .settings-leaving 分身，否则返回动画会被强制滚到顶部造成跳变
  const viewRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    viewRef.current?.querySelector('.settings-over:not(.settings-leaving)')?.scrollTo({ top: 0 })
  }, [view])
  // 右滑退出二级菜单（iOS 手势习惯：从左边缘向右滑）
  const swipe = useSwipeBack(goBack, view !== 'menu')

  // 账号：列表先从本地缓存顶上（上次同步后存在手机里），一打开就是对的，后端回来再刷新
  const [profiles, setProfiles] = useState<P[]>(() =>
    getCachedProfiles().map((p) => ({ ...p, id: String(p.id) })))
  const [newName, setNewName] = useState('')
  const [findId, setFindId] = useState('') // 输入账号 ID 找回
  const [findToken, setFindToken] = useState('') // 账号恢复密钥
  const [editingId, setEditingId] = useState('')
  const [editingName, setEditingName] = useState('')
  const [delId, setDelId] = useState('')
  // 名字也先从本地缓存顶上：缓存里有当前账号就直接显示，缓存没有时才短暂显示默认名
  const [displayName, setDisplayName] = useState(() => {
    const me = getCachedProfiles().find((p) => String(p.id) === String(profileId))
    return me ? me.name : '学习者'
  })

  // 外观
  const [fontSize, setFontSize] = useState('medium')
  const [theme, setTheme] = useState('system')

  // AI 接口（演示已删，默认 DeepSeek）
  const [provider, setProvider] = useState('deepseek')
  const [providerLoaded, setProviderLoaded] = useState(false) // 设置读回来之前，菜单行先显示「加载中…」，别拿默认值 DeepSeek 闪一下
  // 拉模型列表是异步的：回包时要核对供应商/账号还是不是点按钮那会儿的，变了就丢弃旧回包（GPT 审查 M3）
  const providerRef = useRef(provider)
  providerRef.current = provider
  const profileIdRef = useRef(profileId)
  profileIdRef.current = profileId
  const [aiModel, setAiModel] = useState('')
  // "自定义"那栏的名字：用户自己定（默认按接口地址推断：现在是智谱，换供应商就改成对应的名字）
  const [customName, setCustomName] = useState(() => getCustomName())
  // 模型列表：点"选择模型"时实时从供应商拉取（用存的 Key），点选；列表里没有的仍可手填
  const [modelList, setModelList] = useState<string[] | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  // 供应商列表里的"自定义"那行：显示用户定的名字，别的名字不动
  const providers = PROVIDERS.map((p) => (p.v === 'custom' ? { ...p, label: customName } : p))
  const [endpoint, setEndpoint] = useState('')
  const [key, setKey] = useState('')
  // 深度思考开时聊天实际用的是推理模型名（o3 等），输入框里是基础模型名：
  // 生效名字不一样时提示一句，别让人以为输入框的就是实际用的（GPT 审查 M4）
  const effectiveModelHint = (() => {
    const eff = effectiveModelName(provider, localStorage.getItem('linverse.deepThink') === '1')
    return eff && eff !== aiModel.trim() ? eff : ''
  })()

  // 读账号列表 + 设置
  // 统一把账号 ID 转成字符串：数据库返回的 id 可能是数字，localStorage 里是字符串，
  // 入口处归一一次，后面所有比较/改名/删除都不用再操心类型
  const normProfiles = (ps: P[]) => ps.map((p) => ({ ...p, id: String(p.id) }))
  useEffect(() => {
    let cancelled = false // GPT 审查 M6：账号切换时旧回包作废，别把旧账号的设置盖到新账号上
    listProfiles().then((ps) => {
      if (cancelled) return
      const list = normProfiles(ps)
      setProfiles(list)
      const me = list.find((p) => p.id === profileId)
      if (me) setDisplayName(me.name)
    }).catch(() => {})
    // Key / 模型名不在挂载时先填：没读到后端设置前，"当前供应商"还是默认值
    // DeepSeek，getAiModel()/getAiKey() 不传参会读成上次聊天用的供应商的值
    // （比如智谱的 glm-4v-flash），这时点保存/切供应商就会把智谱的名字存到
    // DeepSeek 名下——设置读回来之后再填，才是各供应商自己的值。
    if (!profileId) { setKey(getAiKey('deepseek')); setAiModel(getAiModel('deepseek')); setProviderLoaded(true); return }
    getSettings(profileId).then((s) => {
      if (cancelled) return
      setFontSize(s.fontSize || 'medium')
      setTheme(s.theme || 'system')
      const pv = s.aiProvider && s.aiProvider !== 'demo' ? s.aiProvider : 'deepseek'
      setProvider(pv)
      // 旧单 Key 归位纠正：第一次读新表时旧 Key 按聊天里最后用的模型归位，
      // 但设置里存的供应商更准（他上次在设置里保存的就是那个供应商）——
      // 如果整表只有一个 Key、又不在设置存的供应商名下，就挪到设置存的供应商名下
      const keyMap = getAiKeyMap()
      const saved = Object.keys(keyMap)
      if (saved.length === 1 && saved[0] !== pv && !keyMap[pv]) {
        setAiKey(keyMap[saved[0]], pv)
        setAiKey('', saved[0])
      }
      setKey(getAiKey(pv)) // Key 跟着供应商走：读到哪个供应商，就显示哪个的 Key
      // 智谱的模型名以前存在后端设置里：按"账号+接口地址"播种——换了账号或换了地址就按后端重播，
      // 别让上一个账号的模型名串过来（GPT 审查 M4）
      seedCustomModel(profileId, s.aiModel, s.aiEndpoint)
      setAiModel(getAiModel(pv)) // 模型名也跟着供应商走
      setEndpoint(s.aiEndpoint || '')
      setCustomName(getCustomName(s.aiEndpoint || '')) // 名字跟着接口地址走：没改过名就按地址推断（智谱/本地/其他）
      applyAppearance(s.fontSize || 'medium', s.theme || 'system')
      setProviderLoaded(true)
    }).catch(() => { setProviderLoaded(true) })
    return () => { cancelled = true }
  }, [profileId])

  // 外观即时生效：写到 html 标签属性，CSS 变量自动切换
  const applyAppearance = (fs: string, th: string) => {
    document.documentElement.setAttribute('data-fontsize', fs)
    if (th === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', th)
  }
  const appearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const changeAppearance = (fs: string, th: string) => {
    setFontSize(fs); setTheme(th)
    applyAppearance(fs, th)
    if (!profileId) return
    // 防抖：300ms 内连点只发最后一次保存
    if (appearTimer.current) clearTimeout(appearTimer.current)
    appearTimer.current = setTimeout(() => {
      saveSettings({ profileId, fontSize: fs, theme: th })
        .then(() => setToast('已保存'))
        // 别吞后端原文：账号没验证时后端明说“请先验证账号”，吞成“保存失败”用户无从下手
        .catch((e) => setToast(e instanceof Error ? e.message : '保存失败'))
    }, 300)
  }

  // 账号操作
  const reloadProfiles = () => listProfiles().then((ps) => {
    const list = normProfiles(ps)
    setProfiles(list)
    const me = list.find((p) => p.id === profileId)
    if (me) setDisplayName(me.name)
  }).catch(() => {})
  const [addingProfile, setAddingProfile] = useState(false)
  const addProfile = async () => {
    const n = newName.trim()
    if (!n) { setToast('先输入名字'); return }
    if (addingProfile) return
    setAddingProfile(true)
    try {
      const p = await createProfile(n)
      setNewName('')
      reloadProfiles()
      onProfileChange(String(p.id)) // 新建后直接切换过去：转字符串，和 localStorage 口径一致
    } catch (e) { setToast(e instanceof Error ? e.message : '创建失败') }
    finally { setAddingProfile(false) }
  }
  const doRename = async (id: string) => {
    const n = editingName.trim()
    if (!n) { setEditingId(''); return }
    if (renameBusy) return
    setRenameBusy(true)
    try {
      await renameProfile(id, n)
      setEditingId('')
      reloadProfiles()
      setToast('已保存')
    } catch (e) { setToast(e instanceof Error ? e.message : '改名失败') }
    finally { setRenameBusy(false) }
  }
  // 换设备恢复必须同时提供账号 ID 和随机恢复密钥，不能只凭可猜测的 ID 认领账号。
  const doFind = async () => {
    const id = findId.trim()
    const token = findToken.trim()
    if (!id || !token) { setToast('请输入账号 ID 和恢复密钥'); return }
    if (findBusy) return
    setFindBusy(true)
    const previousId = profileId
    const previousToken = getProfileToken(previousId || undefined)
    try {
      setPid(id)
      setProfileToken(token, id)
      const ps = await listProfiles()
      if (!ps.some((p) => String(p.id) === String(id))) throw new Error('账号 ID 或恢复密钥不正确')
      setFindId('')
      setFindToken('')
      onProfileChange(id)
      setToast('账号恢复成功')
    } catch (e) {
      if (previousId) {
        setPid(previousId)
        setProfileToken(previousToken, previousId)
      } else {
        clearPid()
      }
      setToast(e instanceof Error ? e.message : '找回失败')
    } finally { setFindBusy(false) }
  }
  // 个人资料：改当前账号的显示名
  const saveDisplayName = async () => {
    if (!profileId || savingName) return
    setSavingName(true)
    const n = displayName.trim() || '学习者'
    try {
      await renameProfile(profileId, n)
      setDisplayName(n)
      setToast('已保存')
    } catch (e) { setToast(e instanceof Error ? e.message : '保存失败') }
    finally { setSavingName(false) }
  }
  const doDelete = async (id: string) => {
    if (delId !== id) { setDelId(id); return }
    if (profiles.length <= 1) { setToast('至少保留一个账号'); setDelId(''); return }
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
  // 返回是否存上：选择模型时要先调它把接口地址存到后端，存不上就别拉列表（GPT 审查 M2）
  const saveAi = async (): Promise<boolean> => {
    if (!profileId || savingAi) return false
    // 设置还没读回来时别保存：供应商还是默认值，框里的模型名/Key 可能是上次
    // 用的供应商的值，存了就是串供应商（DeepSeek 名下存进 glm-4v-flash 的根因）
    if (!providerLoaded) { setToast('设置还在加载，稍等一下再保存'); return false }
    setSavingAi(true)
    setAiKey(key.trim(), provider) // Key 按供应商分开存：这个 Key 只归当前这个供应商
    saveAiModel(aiModel.trim(), provider) // 模型名也按供应商分开存
    // 这栏的名字：只有用户改过（跟按地址推断的不一样）才存起来；
    // 没改过就把存过的名删掉，换地址时自动跟着改
    if (provider === 'custom') saveCustomName(customName !== deriveCustomName(endpoint) ? customName : '')
    try {
      // 后端设置里的 aiModel 只存智谱的模型名（老版本兼容兜底）：其他供应商的模型名只存在本地表里，不往后端写，
      // 否则下次播种会把别的供应商的模型名错当成智谱的
      await saveSettings({ profileId, aiProvider: provider, aiModel: provider === 'custom' ? aiModel.trim() : undefined, aiEndpoint: provider === 'custom' ? endpoint.trim() : undefined })
      localStorage.setItem('linverse.model', provider)
      // 自定义的模型名现在属于"这个账号 + 这个接口地址"：把身份记下来，播种就不会拿旧账号的值来盖它（GPT 审查 M4）
      if (provider === 'custom') setCustomModelOrigin(customModelOriginKey(profileId, endpoint))
      setToast('已保存')
      return true
    } catch (e) { setToast(e instanceof Error ? e.message : '保存失败'); return false }
    finally { setSavingAi(false) }
  }

  // 存储空间：统计 localStorage 占用，清理只清界面偏好缓存
  const cacheMB = useMemo(() => {
    let bytes = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || ''
      bytes += k.length + (localStorage.getItem(k) || '').length
    }
    return (bytes / 1024 / 1024).toFixed(1)
  }, [view])
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
  // 必须输入所有者密码：只有本人能操作，朋友知道访问密码也清空不了
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [wipePw, setWipePw] = useState('')
  const [wiping, setWiping] = useState(false)
  const wipeAll = async () => {
    if (!confirmWipe) { setConfirmWipe(true); return }
    const d = wipePw.trim()
    if (!d) { setToast('请输入所有者密码'); return }
    if (wiping) return
    setWiping(true)
    setConfirmWipe(false)
    try {
      await siteReset(d)
      clearPid()
      clearProfileAuth()
      clearOwnerToken()
      setWipePw('')
      setToast('已清空，重新开始')
      setTimeout(() => location.reload(), 900)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '清空失败')
    } finally { setWiping(false) }
  }

  // 访问密码：网站大门的密码锁。设好后别人打开网址要先输对密码才能用。
  // 密码只存后端的 SHA256，前端不存原文；验证通过后存 token，后续请求自动带上
  const [pwSet, setPwSet] = useState(false)
  const [pwLoaded, setPwLoaded] = useState(false) // 同上：密码状态读回来之前不显示「未设置」
  const [savingName, setSavingName] = useState(false)
  const [savingAi, setSavingAi] = useState(false)
  const [savingSitePw, setSavingSitePw] = useState(false)
  const [savingDangerPw, setSavingDangerPw] = useState(false)
  const [renameBusy, setRenameBusy] = useState(false) // 改名提交中：防连点
  const [findBusy, setFindBusy] = useState(false) // 账号恢复提交中：防连点
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  useEffect(() => {
    siteStatus().then((s) => { setPwSet(s.passwordSet); setPwLoaded(true) }).catch(() => { setPwLoaded(true) })
  }, [])
  const saveSitePw = async () => {
    const p = newPw.trim()
    if (p.length < 8) { setToast('密码至少 8 位'); return }
    if (savingSitePw) return
    setSavingSitePw(true)
    try {
      // 没设过：直接设；已设：必须带对旧密码才能改
      await siteSetPassword(p, pwSet ? oldPw.trim() : undefined) // 成功后服务端按新密码种 cookie，不用本地存 token
      setPwSet(true)
      try { localStorage.setItem('linverse.sitePwSet', '1') } catch {}
      setOldPw(''); setNewPw('')
      setToast(pwSet ? '密码已修改' : '访问密码已设置，朋友打开网址要先输这个密码')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '设置失败')
    } finally { setSavingSitePw(false) }
  }

  const verifyOwner = async () => {
    const password = ownerVerifyPw.trim()
    if (!password) { setToast('请输入所有者密码'); return }
    if (verifyingOwner) return
    setVerifyingOwner(true)
    try {
      await verifyOwnerPassword(password)
      setOwnerVerifyPw('')
      setToast('所有者验证通过，管理权限 30 分钟有效')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '所有者验证失败')
    } finally {
      setVerifyingOwner(false)
    }
  }

  // 新账号注册总闸：关掉后新设备不能自动建账号，只有所有者密码能改
  const [signupAllow, setSignupAllowUi] = useState(true)
  const [signupPw, setSignupPw] = useState('')
  useEffect(() => {
    signupStatus().then((s) => setSignupAllowUi(s.allow)).catch(() => {})
  }, [])
  const [togglingSignup, setTogglingSignup] = useState(false)
  const toggleSignup = async () => {
    const p = signupPw.trim()
    if (!p) { setToast('请输入所有者密码'); return }
    if (togglingSignup) return
    setTogglingSignup(true)
    try {
      const r = await setSignupAllow(!signupAllow, p)
      setSignupAllowUi(r.allow)
      setSignupPw('')
      setToast(r.allow ? '已允许新账号注册' : '已关闭新账号注册，新设备打不开了')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '设置失败')
    } finally { setTogglingSignup(false) }
  }

  // 所有者密码：只属于本人的密码，专管"清空所有数据"。朋友知道访问密码也动不了数据。
  const [dangerSet, setDangerSet] = useState(false)
  const [ownerVerifyPw, setOwnerVerifyPw] = useState('')
  const [verifyingOwner, setVerifyingOwner] = useState(false)
  const [oldDanger, setOldDanger] = useState('')
  const [newDanger, setNewDanger] = useState('')
  useEffect(() => {
    dangerStatus().then((s) => setDangerSet(s.dangerSet)).catch(() => {})
  }, [])
  const saveDangerPw = async () => {
    if (!pwSet) { setToast('请先设置访问密码，再设置所有者密码'); return }
    const p = newDanger.trim()
    if (p.length < 8) { setToast('密码至少 8 位'); return }
    if (savingDangerPw) return
    setSavingDangerPw(true)
    try {
      await setDangerPassword(p, dangerSet ? oldDanger.trim() : undefined)
      setDangerSet(true)
      clearOwnerToken()
      setOldDanger(''); setNewDanger('')
      setToast(dangerSet ? '所有者密码已修改' : '所有者密码已设置：清空数据时必须输对它')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '设置失败')
    } finally { setSavingDangerPw(false) }
  }

  const providerLabel = providers.find((p) => p.v === provider)?.label || 'DeepSeek'
  const themeLabel = theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'
  const fontLabel = fontSize === 'small' ? '小' : fontSize === 'large' ? '大' : '标准'

  const row = (v: View, icon: 'user' | 'key' | 'users' | 'moon' | 'textsize' | 'db' | 'info' | 'lock',
    sq: 'blue' | 'green' | 'orange' | 'gray', label: string, val?: string) => (
    <button className="set-row" onClick={() => goSub(v as Exclude<View, 'menu'>)}>
      <span className={'sq ' + sq}><I n={icon} size={21} /></span>
      <span>{label}</span>
      {val && <span className="set-val">{val}</span>}
      <span className="chev"><I n="chev" size={16} /></span>
    </button>
  )

  // 子页面内容：iOS 推入式，菜单在底层，子页从右侧盖上来
  const SUB: Record<Exclude<View, 'menu'>, ReactNode> = {
  profile: (<>
  <div className="field">
  <div className="field-label">显示名</div>
  <input className="input" value={displayName}
  onChange={(e) => setDisplayName(e.target.value)} />
  </div>
  <button className="btn" style={{ width: '100%' }} onClick={saveDisplayName} disabled={savingName}>{savingName ? '保存中…' : '保存'}</button>
  </>),

  accounts: (<>
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
  <button className="mini-btn" disabled={renameBusy} onClick={() => doRename(p.id)}>{renameBusy ? '保存中…' : '确定'}</button>
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
  <button className="btn" onClick={addProfile} disabled={addingProfile}>{addingProfile ? '添加中…' : '添加'}</button>
  </div>
  {profileId && (
  <div className="field" style={{ marginTop: 16 }}>
    <div className="field-label">本账号恢复密钥</div>
    <input className="input" readOnly value={getProfileToken(profileId)} />
    <button className="btn btn-ghost" style={{ width: '100%', marginTop: 6 }}
      onClick={async () => {
        const token = getProfileToken(profileId)
        if (!token) { setToast('当前设备没有恢复密钥'); return }
        try {
          if (!navigator.clipboard) throw new Error('clipboard unavailable')
          await navigator.clipboard.writeText(token)
          setToast('恢复密钥已复制')
        } catch {
          setToast('复制失败，请手动长按复制')
        }
      }}>复制恢复密钥</button>
    <div className="safe-note">请妥善保存。换设备时需要同时输入账号 ID 和恢复密钥；不要把密钥发给别人。</div>
  </div>
  )}
  <div className="field-label" style={{ marginTop: 18 }}>在新设备恢复账号</div>
  <div className="field">
    <input className="input" value={findId} placeholder="账号 ID"
      onChange={(e) => setFindId(e.target.value)} />
  </div>
  <div className="field">
    <input className="input" value={findToken} placeholder="恢复密钥"
      onChange={(e) => setFindToken(e.target.value)} autoComplete="off" />
  </div>
  <button className="btn" style={{ width: '100%' }} disabled={findBusy} onClick={doFind}>{findBusy ? '验证中…' : '验证并恢复'}</button>
  </>),

  ai: (<>
  <div className="field">
  <div className="field-label">供应商</div>
  <div className="seg">
  {providers.map((p) => (
  <button key={p.v} className={provider === p.v ? 'on' : ''}
  onClick={() => {
    if (p.v === provider) return
    // 设置还没读回来时别切供应商：框里的模型名/Key 还是空的，切过去会把空值
    // 存回旧供应商（setAiModel('', …) 是删除），把已存的名字清掉
    if (!providerLoaded) return
    setAiKey(key.trim(), provider) // 先把当前框里的 Key 存回旧供应商，别丢了
    saveAiModel(aiModel.trim(), provider) // 模型名也一样，先存回旧供应商
    if (provider === 'custom') saveCustomName(customName !== deriveCustomName(endpoint) ? customName : '') // 离开"自定义"那栏时，名字也存回（只在用户改过时存）
    setProvider(p.v)
    setKey(getAiKey(p.v)) // 再换成新供应商已存的 Key（没有就空着等填）
    setAiModel(getAiModel(p.v)) // 再换成新供应商的模型名（没存过就显示建议值）
    setModelList(null) // 换供应商：旧的模型列表作废
    if (p.v === 'custom') setCustomName(getCustomName(endpoint)) // 切进"自定义"：名字按接口地址推断（没改过名时）
  }}>{p.label}</button>
  ))}
  </div>
  </div>
  <div className="field">
  <div className="field-label">模型名（可改）</div>
  <input className="input" value={aiModel}
  placeholder={MODEL_PLACEHOLDER[provider] || '比如 deepseek-flash'}
  onChange={(e) => setAiModel(e.target.value)} />
  <div className="safe-note">每个供应商的模型名分开保存，聊天页切换模型时显示的就是这里填的名字</div>
  {effectiveModelHint && (<div className="safe-note">深度思考已开，聊天时实际用的是 {effectiveModelHint}</div>)}
  {((getAiKey(provider) || key.trim())) && (<>
    <button className="btn" style={{ marginTop: 8 }} disabled={loadingModels}
      onClick={async () => {
        if (modelList) { setModelList(null); return }
        if (key.trim()) setAiKey(key.trim(), provider) // 刚粘贴还没按保存的 Key：先存下来再拉列表
        // 自定义要先把接口地址存到后端再拉列表：不然新 Key 会被发到后端存的旧地址去（GPT 审查 M2）
        if (provider === 'custom') {
          if (!endpoint.trim()) { setToast('先填接口地址'); return }
          if (!(await saveAi())) { setToast('地址没存上，先检查网络再试'); return }
        }
        const p = provider // 记住点按钮那会儿的供应商/账号，回包时核对
        const pid = profileId
        setLoadingModels(true)
        try {
          const list = await listModels(p, pid || undefined)
          // 拉列表期间换了供应商/账号：旧回包作废，别把旧供应商的模型名写进新供应商（GPT 审查 M3）
          if (p !== providerRef.current || pid !== profileIdRef.current) return
          // 当前在用的模型名即使不在列表里（比如智谱的 glm-4v-flash），也放第一行，别把它选没了
          const cur = getAiModel(p)
          setModelList(cur && !list.includes(cur) ? [cur, ...list] : list)
          if (!list.length) setToast('没拉到模型列表，检查 Key 是否有效')
        } catch (e) {
          // 旧请求失败也别弹旧供应商的错：只在还是当前供应商/账号时提示（GPT 审查 M5）
          if (p === providerRef.current && pid === profileIdRef.current) setToast(e instanceof Error ? e.message : '拉取失败')
        }
        // finally 不加过期校验：同一时间只有一个列表请求在途（按钮在加载时禁用），
        // 所以 finally 一定属于最新请求，关掉加载状态是对的
        finally { setLoadingModels(false) }
      }}>{loadingModels ? '拉取中…' : (modelList ? '收起列表' : '选择模型')}</button>
    {modelList && (<div style={{ marginTop: 8 }}>
      <div className="safe-note">从供应商实时拉取的，能选的都在这（新模型上线自动出现）；列表里没有就直接在上面手填</div>
      {modelList.map((m) => (
        <button key={m} className="btn" style={{ width: '100%', marginTop: 6, textAlign: 'left', fontWeight: aiModel === m ? 700 : 400 }}
          onClick={() => {
            setAiModel(m)
            saveAiModel(m, provider) // 点选立刻存：不用等按保存，聊天页马上就能用
            setModelList(null)
          }}>{m}{aiModel === m ? ' ✓' : ''}</button>
      ))}
    </div>)}
  </>)}
  </div>
  {provider === 'custom' && (<>
  <div className="field">
  <div className="field-label">名称</div>
  <input className="input" value={customName}
  placeholder="比如 智谱"
  onChange={(e) => setCustomName(e.target.value)} />
  <div className="safe-note">这栏的名字：换成别的供应商时改成对应的名字，聊天页切换模型时显示的就是它</div>
  </div>
  <div className="field">
  <div className="field-label">接口地址</div>
  <input className="input" value={endpoint}
  placeholder="https://…/v1/chat/completions"
  onChange={(e) => {
    // 换地址时名字跟着换（前提是名字还是按旧地址推断的、用户没自己改过）
    if (customName === deriveCustomName(endpoint)) setCustomName(deriveCustomName(e.target.value))
    setEndpoint(e.target.value)
  }} />
  </div>
  </>)}
  <div className="field">
  <div className="field-label">Key</div>
  <input className="input" type="password" value={key}
  placeholder="粘贴你的 API Key"
  onChange={(e) => setKey(e.target.value)} autoComplete="off" />
  <div className="safe-note">Key 只保存在这台设备的浏览器里，不会上传到服务器，换设备需要重新填写；每个供应商的 Key 分开保存，切换供应商时 Key 跟着换</div>
  <div className="safe-note">已保存的 Key：{providers.filter((p) => getAiKey(p.v)).map((p) => p.label).join('、') || '无'}</div>
  </div>
  <button className="btn" style={{ width: '100%' }} onClick={saveAi} disabled={savingAi}>{savingAi ? '保存中…' : '保存'}</button>
  </>),

  appearance: (<>
  <div className="field">
  <div className="field-label">深浅色</div>
  <div className="seg">
  {[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([v, l]) => (
  <button key={v} className={theme === v ? 'on' : ''}
  onClick={() => changeAppearance(fontSize, v)}>{l}</button>
  ))}
  </div>
  </div>
  </>),

  font: (<>
  <div className="field">
  <div className="field-label">字体大小</div>
  <div className="seg">
  {[['small', '小'], ['medium', '标准'], ['large', '大']].map(([v, l]) => (
  <button key={v} className={fontSize === v ? 'on' : ''}
  onClick={() => changeAppearance(v, theme)}>{l}</button>
  ))}
  </div>
  </div>
  </>),

  storage: (<>
  <div className="report-row">
  <span>本地缓存</span>
  <span className="v">{cacheMB} MB</span>
  </div>
  <div className="safe-note">清理只清除界面偏好等临时缓存，账号、错题、笔记、生词和 Key 不受影响</div>
  <button className={'btn ' + (confirmClear ? 'btn-danger' : 'btn-ghost')}
  style={{ width: '100%', marginTop: 12 }} onClick={clearCache}>
  {confirmClear ? '再点一次确认清理' : '清理缓存'}
  </button>
  <div className="safe-note" style={{ marginTop: 16, color: 'var(--red)' }}>危险区</div>
  <div className="safe-note">清空所有账号、错题、笔记、生词和会话，账号 ID 从 1 重新开始，访问密码保留。必须输入所有者密码，只有本人能操作。</div>
  <div className="field" style={{ marginTop: 12 }}>
  <div className="field-label">所有者密码</div>
  <input className="input" type="password" value={wipePw}
  onChange={(e) => setWipePw(e.target.value)} placeholder="输入所有者密码" />
  </div>
  <button className={'btn ' + (confirmWipe ? 'btn-danger' : 'btn-ghost')}
  style={{ width: '100%', marginTop: 4 }} onClick={wipeAll} disabled={wiping}>
  {wiping ? '清空中…' : (confirmWipe ? '再点一次确认清空' : '清空所有数据')}
  </button>
  </>),

  sitepw: (<>
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
  <div className="field-label">{pwSet ? '新密码' : '访问密码'}（至少 8 位）</div>
  <input className="input" type="password" value={newPw}
  onChange={(e) => setNewPw(e.target.value)} placeholder={pwSet ? '输入新密码' : '定一个密码'} />
  </div>
  <button className="btn" style={{ width: '100%' }} onClick={saveSitePw} disabled={savingSitePw}>
  {savingSitePw ? '保存中…' : (pwSet ? '修改密码' : '设置密码')}
  </button>
  {/* 所有者密码：只有本人知道，清空数据时必须输对 */}
  <div className="safe-note" style={{ marginTop: 24, marginBottom: 12 }}>
  {dangerSet
  ? '已设置所有者密码：清空所有数据时必须输对它，朋友不知道这个密码就动不了数据'
  : (pwSet ? '设一个所有者密码：只属于你一个人，清空所有数据时必须输对它' : '请先设置访问密码，再设置所有者密码')}
  </div>
  {dangerSet && (
  <div className="field">
  <div className="field-label">旧的所有者密码</div>
  <input className="input" type="password" value={oldDanger}
  onChange={(e) => setOldDanger(e.target.value)} placeholder="输入旧密码" />
  </div>
  )}
  <div className="field">
  <div className="field-label">{dangerSet ? '新的所有者密码' : '所有者密码'}（至少 8 位）</div>
  <input className="input" type="password" value={newDanger}
  onChange={(e) => setNewDanger(e.target.value)} placeholder={dangerSet ? '输入新密码' : '定一个只有你知道的密码'} />
  </div>
  <button className="btn" style={{ width: '100%' }} onClick={saveDangerPw} disabled={savingDangerPw}>
  {savingDangerPw ? '保存中…' : (dangerSet ? '修改所有者密码' : '设置所有者密码')}
  </button>
  {/* 新账号注册总闸：只有所有者密码能改。关掉后，新设备打不开 App（显示"未开放注册"），已建好的账号不受影响 */}
  <div className="safe-note" style={{ marginTop: 24, marginBottom: 12 }}>
    验证所有者身份后，知识库入库、删除等管理操作会获得 30 分钟授权。
  </div>
  <div className="field">
    <div className="field-label">验证所有者密码</div>
    <input className="input" type="password" value={ownerVerifyPw}
      onChange={(e) => setOwnerVerifyPw(e.target.value)} placeholder="输入所有者密码" />
  </div>
  <button className="btn" style={{ width: '100%' }} onClick={verifyOwner} disabled={verifyingOwner}>
    {verifyingOwner ? '验证中…' : '验证所有者身份（30 分钟）'}
  </button>
  
  <div className="safe-note" style={{ marginTop: 24, marginBottom: 12 }}>
  {signupAllow
    ? '新账号注册：开着。新设备打开网址会自动建账号'
    : '新账号注册：关着。新设备打不开，只有已建好的账号能用'}
  </div>
  <div className="field">
  <div className="field-label">所有者密码（改这个开关要验证）</div>
  <input className="input" type="password" value={signupPw}
  onChange={(e) => setSignupPw(e.target.value)} placeholder="输入所有者密码" />
  </div>
  <button className="btn" style={{ width: '100%' }} onClick={toggleSignup} disabled={togglingSignup}>
  {togglingSignup ? '设置中…' : (signupAllow ? '关闭新账号注册' : '允许新账号注册')}
  </button>
  </>),

  about: (<>
  <div className="set-group">
  <div className="set-row" style={{ cursor: 'default' }}>
  <span className="sq blue"><I n="sparkle" size={21} /></span>
  <span>Linverse<span className="sr-desc" style={{ display: 'block' }}>专为中国高中生打造的 AI 学习助手</span></span>
  </div>
  <div className="set-row" style={{ cursor: 'default' }}>
  <span className="sr-label">版本</span>
  <span className="set-val">v{__APP_VERSION__}</span>
  </div>
  </div>
  </>),
  }

  return (
    <div className="settings">
      <div className="topbar">
        <button className="icon-btn" onClick={() => goBack()} aria-label="返回">
          <I n="back" />
        </button>
        <div className="topbar-title">{TITLES[view]}</div>
        <div className="topbar-spacer" />
      </div>

      <div className="settings-view" ref={viewRef}>
          {/* 一级菜单：三组多彩圆角入口 */}
          <div className="settings-page">
            <div className="set-group">
              {row('profile', 'user', 'blue', '个人资料', displayName)}
              {row('ai', 'key', 'green', 'AI 接口', providerLoaded ? providerLabel : '加载中…')}
              {row('accounts', 'users', 'orange', '多账号', `共 ${profiles.length} 个`)}
            </div>
            <div className="set-group">
              {row('appearance', 'moon', 'blue', '外观', themeLabel)}
              {row('font', 'textsize', 'green', '字体大小', fontLabel)}
              {row('sitepw', 'lock', 'gray', '访问密码', pwLoaded ? (pwSet ? '已设置' : '未设置') : '加载中…')}
              {row('storage', 'db', 'orange', '存储空间', `缓存 ${cacheMB} MB`)}
            </div>
            <div className="set-group">
              {row('about', 'info', 'gray', '关于')}
            </div>
          </div>

        {/* 子页面：iOS 推入式浮层，从右侧盖上来；右滑时跟手 */}
        {view !== 'menu' && (
          <div key={view} className="settings-page settings-over" {...swipe.handlers}
            style={{
              animation: (settled || swipe.dragging) ? 'none' : undefined,
              transition: swipe.dragging ? 'none' : 'transform 0.28s var(--ease)',
              transform: swipe.dragging ? `translateX(${swipe.dragX}px)` : undefined,
            }}>
            {SUB[view as Exclude<View, 'menu'>]}
          </div>
        )}
        {/* 正在退出的子页面：从手指位置向右滑出，露出底下菜单 */}
        {leaving && (
          <div ref={leavingRef} className="settings-page settings-over settings-leaving"
            style={{ '--leave-x': `${leaveFrom}px` } as CSSProperties}>
            {SUB[leaving]}
          </div>
        )}
      </div>
      <Toast msg={toastMsg} tkey={toastKey} />
    </div>
  )
}
