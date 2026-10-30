import { useEffect, useRef, useState, type ReactNode } from 'react'
import { I, Toast, Spin, Empty, useToast} from '../components'
import Cropper from '../Cropper'
import Briefing from './Briefing'
import Shantou from './Shantou'
import { cleanLatex } from '../latex'
import { listFavs, removeFav, type Fav } from '../favs'
import {
  ask, listConversations, createConversation, getConversation, deleteConversation,
  toggleConversationFavorite, batchDeleteConversations,
  getSettings, getAiKey, uploadImage, imgSrc, createMistake,
  getLatestBriefing, getLatestShantouBoard,
  type ConversationMeta, type ChatMsg, type DailyBriefing, type ShantouBoard,
} from '@api'
import { toggleFav, isFav } from '../favs'
import MathKeyboard, { insertIntoTextarea, deleteBackward } from '../MathKeyboard'

// AI 助手页：聊天 + 打字机输出 + 拍照问图 + 会话抽屉
// 视觉对齐演示版：顶部汉堡 + 模型胶囊 + 状态胶囊，回答无边框、重点蓝高亮

const MODELS = [
  { v: 'demo', label: '演示' },
  { v: 'deepseek', label: 'DeepSeek' },
  { v: 'gemini', label: 'Gemini' },
  { v: 'openai', label: 'OpenAI' },
  { v: 'custom', label: '自定义' },
]

// 'YYYY-MM-DD' → 「10月22日」：纯字符串拆拼，不用 Date，避免时区差一天（早报入口横条用）
function briefDay(d: string) {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return d
  return `${Number(m[2])}月${Number(m[3])}日`
}

// 从 source[start] 起读一个 {…} 组：按花括号深度配对，支持嵌套。
// 失败（不配对、到文末未闭合、起首不是 {）返回 null，调用方负责回退。
function readFractionGroup(source: string, start: number): { content: string; end: number } | null {
  if (source[start] !== '{') return null
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return { content: source.slice(start + 1, i), end: i + 1 }
      if (depth < 0) return null
    }
  }
  return null
}

// 从 source[start] 起读 \frac{分子}{分母}；分子或分母为空也返回 null（走回退）。
function readFraction(source: string, start: number): { numerator: string; denominator: string; end: number } | null {
  if (!source.startsWith('\\frac', start)) return null
  const num = readFractionGroup(source, start + 5)
  if (!num) return null
  const den = readFractionGroup(source, num.end)
  if (!den) return null
  if (!num.content || !den.content) return null
  return { numerator: num.content, denominator: den.content, end: den.end }
}

// ---- 轻量富文本渲染：标题 / 列表 / **重点**（重点变蓝色）+ 分数叠排 ----
function renderRich(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const lines = text.split('\n')
  let listBuf: { ordered: boolean; items: string[] } | null = null
  const flushList = () => {
    if (!listBuf) return
    const L = listBuf.ordered ? 'ol' : 'ul'
    out.push(<L key={'l' + out.length}>{listBuf.items.map((t, i) => <li key={i}>{inline(t)}</li>)}</L>)
    listBuf = null
  }
  // 行内：**重点** 转蓝色高亮；\frac{分子}{分母} 转叠排分数（分子在上、分母在下）。
  // 分数段不经过 cleanLatex（它会把分数压成 a/b）；普通文本段在下面单独跑 cleanLatex。
  function inline(s: string): ReactNode[] {
    const out: ReactNode[] = []
    let cursor = 0
    let key = 0
    const renderPlain = (plain: string) => {
      if (!plain) return
      const cleaned = cleanLatex(plain)
      cleaned.split(/(\*\*[^*]+\*\*)/g).forEach((p) => {
        if (!p) return
        if (p.startsWith('**') && p.endsWith('**') && p.length > 4) {
          out.push(<span key={key} className="hl">{p.slice(2, -2)}</span>)
        } else {
          out.push(<span key={key}>{p}</span>)
        }
        key += 1
      })
    }
    while (cursor < s.length) {
      const at = s.indexOf('\\frac', cursor)
      if (at < 0) { renderPlain(s.slice(cursor)); break }
      renderPlain(s.slice(cursor, at))
      const f = readFraction(s, at)
      if (f) {
        // 分子/分母递归走同一套 inline：嵌套分数、分子里的 \sqrt、上下标都生效。
        out.push(
          <span className="frac" key={key}>
            <span className="frac-num">{inline(f.numerator)}</span>
            <span className="frac-den">{inline(f.denominator)}</span>
          </span>,
        )
        key += 1
        cursor = f.end
        continue
      }
      // 解析失败回退，绝不抛异常：能拆出分子/分母就拼成 a/b 纯文本；
      // 只拆出分子就拼成分子/；连分子都没有就原样保留 \frac，继续往后扫。
      const num = readFractionGroup(s, at + 5)
      if (num) {
        const den = readFractionGroup(s, num.end)
        if (den) { renderPlain(`${num.content}/${den.content}`); cursor = den.end }
        else { renderPlain(`${num.content}/`); cursor = num.end }
      } else {
        renderPlain('\\frac')
        cursor = at + 5
      }
    }
    return out
  }
  lines.forEach((raw, i) => {
    const line = raw.trim()
    const ol = line.match(/^\d+[.、]\s*(.*)/)
    const ul = line.match(/^[-*•]\s+(.*)/)
    if (line.startsWith('##')) {
      flushList()
      out.push(<h4 key={i}>{inline(line.replace(/^#+\s*/, ''))}</h4>)
    } else if (ol || ul) {
      const ordered = !!ol
      const item = (ol ? ol[1] : ul![1])
      if (!listBuf || listBuf.ordered !== ordered) { flushList(); listBuf = { ordered, items: [] } }
      listBuf.items.push(item)
    } else if (!line) {
      flushList()
    } else {
      flushList()
      out.push(<p key={i}>{inline(line)}</p>)
    }
  })
  flushList()
  return out
}

// 拆出"相关知识点"行：单独渲染成演示版样式的知识点行
function splitKnowledge(text: string): { body: string; know: string[] } {
  const lines = text.split('\n')
  const know: string[] = []
  const rest = lines.filter((l) => {
    const m = l.trim().match(/^相关知识点[:：]\s*(.*)/)
    if (m && m[1]) {
      know.push(...m[1].split(/[、，,]/).map((s) => s.trim()).filter(Boolean))
      return false
    }
    return true
  })
  return { body: rest.join('\n'), know }
}

// AI 回答卡片：富文本 + 相关知识点 + 胶囊按钮（复制 / 存入错题本 / 收藏）
function AnswerCard({ text, question, profileId, thinkText, typing, onSkip, onToast }: {
  text: string; question: string; profileId: string | null;
  thinkText: string; typing: boolean; onSkip: () => void; onToast: (m: string) => void;
}) {
  const [favTick, setFavTick] = useState(0)
  const [mistakeSubject, setMistakeSubject] = useState('数学')
  const SUBJECTS = ['数学', '物理', '化学', '英语', '生物', '历史', '地理', '政治']
  const fav = profileId ? isFav(profileId, question, text) : false
  void favTick
  // 注意：这里不能先跑 cleanLatex——它会把 \frac{a}{b} 压成 a/b，
  // renderRich 就再也认不出分数了。分数由 renderRich 的 inline 先配对解析，
  // 普通文本段在 inline 里再单独跑 cleanLatex；cleanLatex 本身不动（OCR 也在用）。
  // 知识点名仍单独过一遍 cleanLatex，保持以前的显示（如下标 x_1 → x₁）。
  const cleanText = text
  const { body, know: knowRaw } = splitKnowledge(cleanText)
  const know = knowRaw.map((k) => cleanLatex(k))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      onToast('已复制')
    } catch {
      onToast('复制失败')
    }
  }
  // 存入错题本：问题进题目，答案进正确答案
  const [savingMistake, setSavingMistake] = useState(false)
  const saveToMistakes = async () => {
    if (!profileId || savingMistake) return
    setSavingMistake(true)
    try {
      await createMistake({
        profileId, subject: mistakeSubject,
        questionText: question || '（AI 问答）',
        questionImageUrl: '', answerText: text, answerImageUrl: '', reason: '', mastered: false,
      })
      onToast('已存入错题本')
    } catch (e) {
      onToast(e instanceof Error ? e.message : '存入失败')
    } finally { setSavingMistake(false) }
  }
  const favToggle = () => {
    if (!profileId) return
    const liked = toggleFav(profileId, question, text)
    setFavTick((t) => t + 1)
    onToast(liked ? '已收藏' : '已取消收藏')
  }

  return (
    <div className="answer">
      <div className="rich">{renderRich(body)}{typing && <span className="caret" />}</div>
      {know.length > 0 && (
        <div className="ans-know">
          <b>相关知识点：</b>
          {know.map((k, i) => <span key={i} className="k">{k}{i < know.length - 1 ? '、' : ''}</span>)}
        </div>
      )}
      {thinkText && <div className="ans-think">{thinkText}</div>}
      {!typing && (
        <div className="ans-actions">
          <button className="cap-btn" onClick={copy}><I n="copy" size={14} />复制</button>
          <button className="cap-btn" onClick={saveToMistakes} disabled={savingMistake}
            title={`科目：${mistakeSubject}`}>
            <I n="notebook" size={14} />{savingMistake ? '存入中…' : '存入错题本'}
          </button>
          <select value={mistakeSubject} onChange={(e) => setMistakeSubject(e.target.value)}
            style={{ fontSize: `calc(12px * var(--fss))`, border: '1px solid var(--bd)', borderRadius: 6, padding: '2px 4px', background: 'var(--bg)', color: 'var(--ink)' }}>
            {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className={'cap-btn' + (fav ? ' liked' : '')} onClick={favToggle}>
            <I n="heart" size={14} />{fav ? '已收藏' : '收藏'}
          </button>
        </div>
      )}
      {typing && (
        <div className="type-tools">
          <button className="cap-btn" onClick={onSkip}>直接回答</button>
        </div>
      )}
    </div>
  )
}

// 打字机：逐块显示文本
function TypeMsg(props: Omit<Parameters<typeof AnswerCard>[0], 'typing' | 'onSkip' | 'thinkText'> & {
  onDone: () => void; onSkipDone: () => void; text: string;
}) {
  const { text, onDone, onSkipDone, ...rest } = props
  const [n, setN] = useState(0)
  const done = n >= text.length
  useEffect(() => {
    if (done) { onDone(); return }
    const t = setInterval(() => {
      setN((v) => Math.min(v + 6, text.length)) // 每次多显示 6 个字符
    }, 28)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, text])
  return <AnswerCard {...rest} text={text.slice(0, n)} typing={!done} thinkText="" onSkip={() => { setN(text.length); onSkipDone() }} />
}

export default function Assistant({ profileId }: { profileId: string | null }) {
  const [convs, setConvs] = useState<ConversationMeta[]>([])
  // 每日早报 / 汕头看板共用一条入口横幅：挂载时各拉最新一期，哪个拉到就显示哪个，
  // 失败/暂无数据都静默（不弹错、不挡聊天）。覆盖层首次打开后常驻挂载，display 显隐
  // （同 App 其它面板惯例）
  const [briefPeek, setBriefPeek] = useState<DailyBriefing | null>(null)
  const [shantouPeek, setShantouPeek] = useState<ShantouBoard | null>(null)
  const [briefOpen, setBriefOpen] = useState(false)
  const [briefVisited, setBriefVisited] = useState(false)
  // 覆盖层当前分段：默认早报；横幅点进来时由 openPanel 指定要落在哪一段
  const [overlayTab, setOverlayTab] = useState<'brief' | 'shantou'>('brief')
  const openPanel = (tab: 'brief' | 'shantou') => {
    setBriefVisited(true)
    setOverlayTab(tab)
    setBriefOpen(true)
  }
  useEffect(() => {
    getLatestBriefing().then(setBriefPeek).catch(() => {})
    getLatestShantouBoard().then(setShantouPeek).catch(() => {})
  }, [])
  // 截图调试用：?brief=1 直接打开早报子页（保持原行为，落在早报 tab）
  useEffect(() => {
    if (new URLSearchParams(location.search).get('brief') === '1') openPanel('brief')
  }, [])
  const [convId, setConvId] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const sendReqIdRef = useRef<string>('') // 发送请求时的唯一ID，防止切会话后消息串台
  const openSeqRef = useRef(0) // 打开会话的序号，只让最后一次点击的响应写状态，防止后发先至
  const [model, setModel] = useState(() => localStorage.getItem('linverse.model') || 'demo')
  const [deepThink, setDeepThink] = useState(() => localStorage.getItem('linverse.deepThink') === '1')
  // 联网搜索开关：默认关，用户手动打开；只在智谱线路可用（isZhipu）
  const [webSearch, setWebSearch] = useState(() => localStorage.getItem('linverse.webSearch') === '1')
  const [isZhipu, setIsZhipu] = useState(false)
  const webSearchAvailable = model === 'custom' && isZhipu
  // 查课本开关：RAG 检索知识库，默认开；后端知识库为空时自动降级，不影响问答
  const [useKb, setUseKb] = useState(() => localStorage.getItem('linverse.useKb') !== '0')
  // 自定义模型的真实名字（比如 glm-4v-flash），显示在模型选择器上，替代干巴巴的"自定义"
  const [customModelName, setCustomModelName] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false) // 抽屉默认关闭，不闪现
  const [menuOpen, setMenuOpen] = useState(false) // 模型下拉
  // 抽屉标签：会话列表 / 我的收藏（原来在个人中心"更多"里，现挪到这里和历史会话放一起）
  const [drawerTab, setDrawerTab] = useState<'conv' | 'fav'>('conv')
  const [favs, setFavs] = useState<Fav[]>([])
  const [favOpenId, setFavOpenId] = useState('')
  // 打开抽屉或切到收藏时刷新收藏列表（收藏是在回答卡片上点的，抽屉里要实时）
  useEffect(() => {
    if (drawerOpen && drawerTab === 'fav' && profileId) setFavs(listFavs(profileId))
  }, [drawerOpen, drawerTab, profileId])
  const unFav = (id: string) => {
    if (!profileId) return
    removeFav(profileId, id)
    setFavs((v) => v.filter((f) => f.id !== id))
  }
  const [toastMsg, toastKey, setToast] = useToast()
  const [imgUrl, setImgUrl] = useState('') // 待发送的图片
  const [cropSrc, setCropSrc] = useState('') // 裁剪中的图片，有值就弹裁剪器
  const [uploading, setUploading] = useState(false)
  // typingFor：正在打字的消息下标（-1 = 无），合并了 typing + typingIdx 两个状态，避免不同步
  const [typingFor, setTypingFor] = useState(-1)
  const typing = typingFor >= 0
  const [deletingId, setDeletingId] = useState('') // 二次确认删除的会话
  // 会话管理模式：勾选 + 全选 + 批量删除 + 星标收藏（关抽屉自动退出）
  const [manage, setManage] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchConfirm, setBatchConfirm] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false) // 批量删除中：防连点
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const activeConvRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [mathOpen, setMathOpen] = useState(false) // 数学符号盘开关

  // 读设置里的默认模型 + 自定义模型名
  useEffect(() => {
    if (!profileId) return
    getSettings(profileId).then((s) => {
      if (s.aiProvider && !localStorage.getItem('linverse.model')) setModel(s.aiProvider)
      if (s.aiModel) setCustomModelName(s.aiModel)
    }).catch(() => {})
  }, [profileId])

  // 联网搜索只支持智谱：custom 且 endpoint 含 bigmodel.cn 时开关才可用
  // （设置页改了地址后切回来会自动重查，不用刷新页面）
  useEffect(() => {
    if (model !== 'custom' || !profileId) { setIsZhipu(false); return }
    getSettings(profileId).then((s) => {
      setIsZhipu(!!s.aiEndpoint && s.aiEndpoint.includes('bigmodel.cn'))
    }).catch(() => setIsZhipu(false))
  }, [model, profileId])

  // 拉会话列表
  const reloadConvs = () => {
    if (!profileId) return
    listConversations(profileId).then(setConvs).catch(() => {})
  }
  useEffect(() => {
    reloadConvs()
    // 截图调试用：?conv=会话id 自动打开该会话
    const cid = new URLSearchParams(location.search).get('conv')
    if (cid) openConv(cid)
  }, [profileId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 打开会话：加载历史消息
  const openConv = async (id: string) => {
    if (!profileId) return
    // 切会话先作废在途的旧提问回包（旧序号对不上就丢弃，不再追加进新会话），
    // 再记一次打开序号：连点两个会话时，只有最后一次的响应能写状态。
    sendReqIdRef.current = ''
    const seq = ++openSeqRef.current
    try {
      const c = await getConversation(id, profileId)
      if (seq !== openSeqRef.current) return // 已被更新的点击超车，丢弃过期响应
      setConvId(id)
      setMsgs(c.messages)
      setTypingFor(-1)
      setDrawerOpen(false)
    } catch (e) {
      if (seq !== openSeqRef.current) return
      setToast(e instanceof Error ? e.message : '加载失败')
    }
  }

  // 新建会话：立刻在服务端建一条并切过去，列表马上能看到（以前只清本地，列表里不出新会话，
  // 用户会以为“点了没反应”）；已在空白会话上时只关抽屉，不重复建空行。
  const newConv = async () => {
    sendReqIdRef.current = '' // 同 openConv：作废在途的旧提问回包
    setDrawerOpen(false)
    if (msgs.length === 0) { setTypingFor(-1); return }
    if (!profileId) { setConvId(null); setMsgs([]); setTypingFor(-1); return }
    try {
      const c = await createConversation(profileId)
      setConvId(String(c.id))
      setMsgs([])
      setTypingFor(-1)
      setConvs((v) => [c, ...v.filter((x) => String(x.id) !== String(c.id))])
    } catch (e) {
      // 建失败也不卡住：先本地切到空白会话，失败原因弹出来，不静默
      setConvId(null); setMsgs([]); setTypingFor(-1)
      setToast(e instanceof Error ? e.message : '新建会话失败')
    }
  }

  // 删除会话：点两次确认
  const delConv = async (id: string) => {
    if (!profileId) return
    if (deletingId !== id) { setDeletingId(id); return }
    try {
      await deleteConversation(id, profileId)
      setDeletingId('')
      setConvs((v) => v.filter((c) => c.id !== id))
      if (convId === id) newConv()
    } catch (e) {
      setToast(e instanceof Error ? e.message : '删除失败')
    }
  }

  // 抽屉打开时，滚动到已选中的会话；关抽屉时退出管理模式、清空勾选
  useEffect(() => {
    if (drawerOpen && activeConvRef.current) {
      activeConvRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    if (!drawerOpen) { setManage(false); setSelected(new Set()); setBatchConfirm(false) }
  }, [drawerOpen])

  // 星标收藏 / 取消收藏：乐观更新列表，失败回滚并提示
  const toggleFavConv = async (id: string, favorite: boolean) => {
    if (!profileId) return
    setConvs((v) => v.map((c) => c.id === id ? { ...c, favorite } : c))
    try {
      await toggleConversationFavorite(id, profileId, favorite)
      // 收藏置顶是后端排序规则，刷新一次让顺序立刻生效
      reloadConvs()
    } catch (e) {
      setConvs((v) => v.map((c) => c.id === id ? { ...c, favorite: !favorite } : c))
      setToast(e instanceof Error ? e.message : '收藏失败')
    }
  }

  // 批量删除：管理栏点两次确认，删完退出管理模式；删除中禁用按钮防连点
  const batchDel = async () => {
    if (!profileId || selected.size === 0 || batchBusy) return
    if (!batchConfirm) { setBatchConfirm(true); return }
    setBatchBusy(true)
    try {
      const ids = [...selected]
      await batchDeleteConversations(profileId, ids)
      setConvs((v) => v.filter((c) => !selected.has(c.id)))
      if (convId && selected.has(convId)) newConv()
      setSelected(new Set()); setBatchConfirm(false); setManage(false)
      setToast(`已删除 ${ids.length} 个会话`)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '批量删除失败')
    } finally { setBatchBusy(false) }
  }

  // 聊天区自动滚到底
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs, typing])

  // 拍照 / 选图：先裁剪（可直接用原图），再上传拿到 url，随问题一起发
  const onPickImage = async (f: File | undefined) => {
    if (!f) return
    if (fileRef.current) fileRef.current.value = ''
    const url = URL.createObjectURL(f)
    setCropSrc(url)
  }
  // 裁剪完成（或直接用原图）：上传
  const onCropDone = async (blob: Blob) => {
    const url = cropSrc
    setCropSrc('')
    if (url) URL.revokeObjectURL(url)
    setUploading(true)
    try {
      const upUrl = await uploadImage(new File([blob], 'crop.jpg', { type: 'image/jpeg' }))
      setImgUrl(upUrl)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }
  const onCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc('')
  }

  // 发送问题
  const send = async () => {
    const q = input.trim()
    if ((!q && !imgUrl) || sending || !profileId) return
    const question = q || '请讲讲这张图里的题目'
    const userMsg: ChatMsg = {
      role: 'user', content: question,
      imageUrl: imgUrl || undefined,
      createdAt: new Date().toISOString(),
    }
    setMsgs((v) => [...v, userMsg])
    setInput('')
    setSending(true)
    // typingFor 先设为一个临时占位，实际 index 在收到回答后再设
    const reqId = crypto.randomUUID()
    sendReqIdRef.current = reqId // 唯一请求ID，防止多次请求串台
    const savedImgUrl = userMsg.imageUrl // 失败时恢复图片用
    setImgUrl('')
    try {
      localStorage.setItem('linverse.model', model)
      // 构造历史消息（不含刚追加的用户消息，最多取最近 8 条）
      const historyMsgs = msgs.slice(-8).map((m) => ({ role: m.role, content: m.content }))
      const r = await ask({
        profileId,
        conversationId: convId || undefined,
        question,
        imageUrl: userMsg.imageUrl,
        model,
        deepThink,
        aiKey: getAiKey() || undefined, // Key 只从本地读，随请求带给后端
        webSearch: webSearch && webSearchAvailable, // 开关开且是智谱线路才传 true
        useKb, // 查课本：RAG 检索知识库
        historyMsgs,
      })
      // 只有还在同一个会话里，才把回答追加到当前消息列表（防止切会话后串台）
      if (sendReqIdRef.current === reqId) {
        setConvId(r.conversationId)
        setMsgs((v) => {
          const next: ChatMsg[] = [...v, {
            role: 'assistant' as const, content: r.answer, createdAt: new Date().toISOString(),
            webSearched: !!r.webSearched, kbUsed: !!r.kbUsed,
            thinkSeconds: r.thinkSeconds || 0,
          }]
          setTypingFor(next.length - 1)
          return next
        })
      }
      reloadConvs()
    } catch (e) {
      // 出错时：如果还在同一会话，移除用户消息并恢复图片、弹失败提示；已切走就不动也不弹（别在新会话里报旧会话的错）
      if (sendReqIdRef.current === reqId) {
        setMsgs((v) => v.slice(0, -1))
        // 只在用户没有在等待期间主动清除图片时才恢复（避免违背用户意图）
        setImgUrl((cur) => cur === '' && savedImgUrl ? savedImgUrl : cur)
        setToast(e instanceof Error ? e.message : '发送失败')
      }
      setTypingFor(-1)
    } finally {
      setSending(false)
    }
  }

  // 模型名显示：选了"自定义"且填了模型名，就显示真实名字（比如 glm-4v-flash），一眼知道接的是谁
  const modelLabel = model === 'custom' && customModelName
    ? customModelName
    : (MODELS.find((m) => m.v === model)?.label || '演示')
  // 右上状态胶囊：演示模式 / 已填 Key 接入 / 非演示但没填 Key
  const statusCap = model === 'demo'
    ? { t: '演示版', cls: 'demo' }
    : getAiKey()
      ? { t: '已接入', cls: 'live' }
      : { t: '未填 Key', cls: 'demo' }

  return (
    <div className="chat-wrap">
      {/* 顶栏：汉堡 / 模型胶囊 / 状态胶囊 */}
      <div className="chat-topbar" style={{ flexWrap: 'wrap', gap: 4 }}>
        <button className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="会话列表">
          <I n="menu" />
        </button>
        <div className="model-wrap">
          <button className="model-pill" onClick={() => setMenuOpen((v) => !v)} aria-label="选择模型">
            {modelLabel}<I n="chev" size={14} />
          </button>
          {menuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setMenuOpen(false)} />
              <div className="model-menu" style={{ zIndex: 50 }}>
                {MODELS.map((m) => (
                  <button key={m.v} className={m.v === model ? 'on' : ''}
                    onClick={() => {
                      setModel(m.v)
                      localStorage.setItem('linverse.model', m.v)
                      setMenuOpen(false)
                    }}>
                    {m.v === model && <I n="check" size={15} />}{m.v === 'custom' && customModelName ? customModelName : m.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* 深度思考：按需求文档放在左上角、和模型选择一起（原来在输入框上方） */}
        <button className={'think-pill' + (deepThink ? ' on' : '')}
          onClick={() => { const v = !deepThink; setDeepThink(v); localStorage.setItem('linverse.deepThink', v ? '1' : '0') }}
          aria-label="深度思考开关" aria-pressed={deepThink}>
          <I n="sparkle" size={14} />深度思考
        </button>
        {/* 联网搜索：手动开关，默认关；非智谱线路置灰，点按提示原因 */}
        <button className={'think-pill' + (webSearch && webSearchAvailable ? ' on' : '') + (!webSearchAvailable ? ' disabled' : '')}
          disabled={!webSearchAvailable}
          title={!webSearchAvailable ? '联网搜索仅支持智谱线路' : undefined}
          onClick={() => {
            const v = !webSearch; setWebSearch(v); localStorage.setItem('linverse.webSearch', v ? '1' : '0')
          }}
          aria-label="联网搜索开关" aria-pressed={webSearch && webSearchAvailable}>
          <I n="search" size={14} />联网搜索
        </button>
        {/* 查课本：RAG 检索知识库，默认开；知识库为空时后端自动降级 */}
        <button className={'think-pill' + (useKb ? ' on' : '')}
          onClick={() => { const v = !useKb; setUseKb(v); localStorage.setItem('linverse.useKb', v ? '1' : '0') }}
          aria-label="查课本开关" aria-pressed={useKb}>
          <I n="book" size={14} />查课本
        </button>
        <span className={'status-cap ' + statusCap.cls}>{statusCap.t}</span>
      </div>

      {/* 左侧抽屉：新建会话 + 会话/收藏双标签，默认关闭不闪现 */}
      <div className={'drawer-mask' + (drawerOpen ? ' open' : '')} onClick={() => setDrawerOpen(false)} />
      <aside className={'drawer' + (drawerOpen ? ' open' : '')} aria-hidden={!drawerOpen}>
        <div className="drawer-head">
          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={newConv}>
            ＋ 新会话
          </button>
          <div className="seg" style={{ marginTop: 10 }}>
            <button className={drawerTab === 'conv' ? 'on' : ''} onClick={() => setDrawerTab('conv')}>会话</button>
            <button className={drawerTab === 'fav' ? 'on' : ''} onClick={() => setDrawerTab('fav')}>
              我的收藏{favs.length > 0 ? ` · ${favs.length}` : ''}
            </button>
          </div>
          {drawerTab === 'conv' && convs.length > 0 && (
            <div style={{ marginTop: 10, textAlign: 'right' }}>
              <button className="mini-btn" onClick={() => { setManage(!manage); setSelected(new Set()); setBatchConfirm(false) }}>
                {manage ? '完成' : '管理'}
              </button>
            </div>
          )}
        </div>
        <div className="drawer-list">
          {drawerTab === 'conv' ? (<>
            {manage && (
              <div className="drawer-manage-bar">
                <button className="mini-btn" onClick={() => {
                  setBatchConfirm(false)
                  setSelected(selected.size === convs.length ? new Set() : new Set(convs.map((c) => c.id)))
                }}>
                  {selected.size === convs.length ? '取消全选' : '全选'}
                </button>
                <span style={{ color: 'var(--ink3)', fontSize: 13 }}>已选 {selected.size} 个</span>
                <button className="mini-btn" style={{ color: 'var(--red)' }} disabled={selected.size === 0 || batchBusy} onClick={batchDel}>
                  {batchBusy ? '删除中…' : batchConfirm ? `确认删除 ${selected.size} 个` : '删除所选'}
                </button>
              </div>
            )}
            {convs.length === 0 && <Empty text="还没有会话，开始第一次提问吧" />}
            {convs.map((c) => (
              <div key={c.id} ref={c.id === convId ? activeConvRef : undefined}
                className={'conv-item' + (c.id === convId ? ' active' : '') + (manage && selected.has(c.id) ? ' selected' : '')}
                onClick={() => {
                  if (manage) {
                    setBatchConfirm(false)
                    setSelected((v) => { const n = new Set(v); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })
                  } else openConv(c.id)
                }}>
                {manage && (
                  <input className="conv-check" type="checkbox" checked={selected.has(c.id)} readOnly
                    aria-label={`选择会话 ${c.title || '新会话'}`} />
                )}
                <span className="conv-title">{c.title || '新会话'}</span>
                <button className={'conv-star' + (c.favorite ? ' on' : '')} aria-label={c.favorite ? '取消收藏会话' : '收藏会话'}
                  onClick={(e) => { e.stopPropagation(); toggleFavConv(c.id, !c.favorite) }}>
                  {c.favorite ? '★' : '☆'}
                </button>
                {!manage && (deletingId === c.id
                  ? <button className="mini-btn" style={{ color: 'var(--red)' }}
                      onClick={(e) => { e.stopPropagation(); delConv(c.id) }}>确认删除</button>
                  : <button className="conv-del" aria-label="删除会话"
                      onClick={(e) => { e.stopPropagation(); delConv(c.id) }}><I n="trash" size={18} /></button>)}
              </div>
            ))}
          </>) : (<>
            {favs.length === 0 && <Empty text="还没有收藏，在 AI 回答卡片上点收藏试试" />}
            {favs.map((f) => (
              <div key={f.id} className="fav-card">
                <div className="fav-q" onClick={() => setFavOpenId(favOpenId === f.id ? '' : f.id)}>
                  {f.q}
                </div>
                {favOpenId === f.id && <div className="fav-a" style={{ WebkitLineClamp: 'unset' }}>{renderRich(f.a)}</div>}
                <div className="fav-foot">
                  <button className="mini-btn" style={{ color: 'var(--red)' }}
                    onClick={() => unFav(f.id)}>取消收藏</button>
                </div>
              </div>
            ))}
          </>)}
        </div>
      </aside>

      {/* 早报 / 汕头看板共用入口横条：两者任一有数据才出现；早报优先，没有早报才显示看板 */}
      {(briefPeek || shantouPeek) && !briefOpen && (
        <button className="brief-strip" onClick={() => (briefPeek ? openPanel('brief') : openPanel('shantou'))}>
          {briefPeek ? (
            <>
              <span className="brief-strip-ic"><I n="flame" size={16} /></span>
              <span className="brief-strip-t">每日早报 · {briefDay(briefPeek.date)}</span>
              <span className="brief-strip-h">
                {briefPeek.sections.find((s) => s.items.length > 0)?.items[0]?.title || ''}
              </span>
            </>
          ) : shantouPeek ? (
            <>
              <span className="brief-strip-ic"><I n="chart" size={16} /></span>
              <span className="brief-strip-t">汕头看板 · {briefDay(shantouPeek.date)}</span>
              {/* payload 可能缺失（后端老数据），缺了就只显示标题，不拼出 undefined */}
              <span className="brief-strip-h">
                {shantouPeek.payload?.hero
                  ? `${shantouPeek.payload.hero.condition} ${shantouPeek.payload.hero.temp_c}°C`
                  : ''}
              </span>
            </>
          ) : null}
          <I n="chev" size={16} />
        </button>
      )}

      {/* 聊天区 */}
      <div className="chat-list" ref={listRef}>
        {msgs.length === 0 && (
          <div className="chat-welcome">
            <div className="w-title">随时问问题</div>
            <div className="w-sub">打字问或拍照问，我会按考试的规矩一步步讲</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={'msg ' + (m.role === 'user' ? 'user' : '')}>
            {m.role === 'user' ? (
              <div className="user-bubble">
                {m.imageUrl && <img src={imgSrc(m.imageUrl)} alt="题目图片" />}
                {m.content}
              </div>
            ) : i === typingFor && typingFor >= 0 ? (
              // 只有正在打字的那条 AI 消息用打字机效果（按下标，不按"最后一条"，避免重播上一条）
              <TypeMsg
                text={m.content}
                question={i > 0 && msgs[i - 1].role === 'user' ? msgs[i - 1].content : ''}
                profileId={profileId}
                onDone={() => setTypingFor(-1)}
                onSkipDone={() => setTypingFor(-1)}
                onToast={setToast}
              />
            ) : (
              <AnswerCard
                text={m.content}
                question={i > 0 && msgs[i - 1].role === 'user' ? msgs[i - 1].content : ''}
                profileId={profileId}
                thinkText={!typing ? [
                  (m as ChatMsg & { webSearched?: boolean }).webSearched ? '已联网搜索' : '',
                  (m as ChatMsg & { kbUsed?: boolean }).kbUsed ? '已查课本' : '',
                  (m as ChatMsg & { thinkSeconds?: number }).thinkSeconds ? `已深度思考 · ${(m as ChatMsg & { thinkSeconds?: number }).thinkSeconds} 秒` : '',
                ].filter(Boolean).join(' · ') : ''}
                typing={false}
                onSkip={() => {}}
                onToast={setToast}
              />
            )}
          </div>
        ))}
        {sending && <Spin />}
      </div>

      {/* 底部输入区：蓝色圆形拍照键 + 输入框 + 蓝色圆形发送键 */}
      <div style={{ display: mathOpen ? 'block' : 'none', padding: '0 14px 8px' }}>
        <MathKeyboard
          onInsert={(s, c) => insertIntoTextarea(inputRef.current, input, setInput, s, c)}
          onBackspace={() => deleteBackward(inputRef.current, input, setInput)}
          onClose={() => setMathOpen(false)} />
      </div>
      <div className="composer">
        <input ref={fileRef} type="file" accept="image/*"
          style={{ display: 'none' }} onChange={(e) => onPickImage(e.target.files?.[0])} />
        <button className="cam-btn" onClick={() => fileRef.current?.click()} aria-label="拍照提问">
          {uploading ? <Spin /> : <I n="camera" size={24} />}
        </button>
        {imgUrl && (
          <div className="photo-preview">
            <img src={imgSrc(imgUrl)} alt="待发送" />
            <button onClick={() => setImgUrl('')} aria-label="移除图片">×</button>
          </div>
        )}
        <div className="composer-box">
          <button className={'math-toggle' + (mathOpen ? ' on' : '')}
            onClick={() => setMathOpen(!mathOpen)} aria-label="数学符号盘" aria-pressed={mathOpen}>
            ∑
          </button>
          <textarea ref={inputRef} className="chat-input" rows={1} value={input}
            placeholder="随时问问题"
            readOnly={sending}
            style={sending ? { opacity: 0.6 } : undefined}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          <button className="send-btn" onClick={send}
            disabled={sending || (!input.trim() && !imgUrl)} aria-label="发送">
            <I n="send" size={18} />
          </button>
        </div>
      </div>
      {/* 早报 / 汕头看板子页：覆盖层盖住聊天区，返回回到对话（聊天状态不卸载） */}
      {briefVisited && (
        <div className="brief-overlay" style={{ display: briefOpen ? 'flex' : 'none' }}>
          <div className="brief-nav">
            <button className="icon-btn" onClick={() => setBriefOpen(false)} aria-label="返回">
              <I n="back" size={20} />
            </button>
            {/* 分段切换：复用抽屉的 .seg 样式；对应数据为 null 就不显示那一段 */}
            <div className="seg" style={{ flex: 1, justifyContent: 'center' }}>
              {briefPeek && (
                <button className={overlayTab === 'brief' ? 'on' : ''} onClick={() => setOverlayTab('brief')}>早报</button>
              )}
              {shantouPeek && (
                <button className={overlayTab === 'shantou' ? 'on' : ''} onClick={() => setOverlayTab('shantou')}>汕头看板</button>
              )}
            </div>
            <span className="brief-nav-sp" />
          </div>
          {/* 两个页同时挂载、用 display 显隐，不条件卸载，保持各自滚动/展开状态 */}
          <div className="brief-scroll">
            <div style={{ display: overlayTab === 'brief' ? 'block' : 'none' }}>
              <Briefing active={briefOpen && overlayTab === 'brief'} />
            </div>
            <div style={{ display: overlayTab === 'shantou' ? 'block' : 'none' }}>
              <Shantou active={briefOpen && overlayTab === 'shantou'} />
            </div>
          </div>
        </div>
      )}
      <Toast msg={toastMsg} tkey={toastKey} />
      {cropSrc && (
        <Cropper src={cropSrc} onDone={onCropDone} onCancel={onCropCancel} />
      )}
    </div>
  )
}
