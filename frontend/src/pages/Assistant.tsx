import { useEffect, useRef, useState, type ReactNode } from 'react'
import { I, Toast, Spin, Empty, useToast} from '../components'
import { listFavs, removeFav, type Fav } from '../favs'
import {
  ask, listConversations, getConversation, deleteConversation,
  getSettings, getAiKey, uploadImage, imgSrc, createMistake,
  type ConversationMeta, type ChatMsg,
} from '@api'
import { toggleFav, isFav } from '../favs'

// AI 助手页：聊天 + 打字机输出 + 拍照问图 + 会话抽屉
// 视觉对齐演示版：顶部汉堡 + 模型胶囊 + 状态胶囊，回答无边框、重点蓝高亮

const MODELS = [
  { v: 'demo', label: '演示' },
  { v: 'deepseek', label: 'DeepSeek' },
  { v: 'gemini', label: 'Gemini' },
  { v: 'openai', label: 'OpenAI' },
  { v: 'custom', label: '自定义' },
]

// ---- 轻量富文本渲染：标题 / 列表 / **重点**（重点变蓝色） ----
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
  // 行内：**重点** 转蓝色高亮
  function inline(s: string): ReactNode {
    const parts = s.split(/(\*\*[^*]+\*\*)/g)
    return parts.map((p, i) =>
      p.startsWith('**') && p.endsWith('**') && p.length > 4
        ? <span key={i} className="hl">{p.slice(2, -2)}</span>
        : <span key={i}>{p}</span>,
    )
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
  const fav = profileId ? isFav(profileId, question, text) : false
  void favTick
  // 兜底：去掉 AI 可能输出的 LaTeX 标记（\(x\) → x，\[...\] → ...），看着清爽
  const cleanText = text.replace(/\\\(/g, '').replace(/\\\)/g, '').replace(/\\\[/g, '').replace(/\\\]/g, '')
  const { body, know } = splitKnowledge(cleanText)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      onToast('已复制')
    } catch {
      onToast('复制失败')
    }
  }
  // 存入错题本：问题进题目，答案进正确答案
  const saveToMistakes = async () => {
    if (!profileId) return
    try {
      await createMistake({
        profileId, subject: '数学',
        questionText: question || '（AI 问答）',
        questionImageUrl: '', answerText: text, answerImageUrl: '', reason: '', mastered: false,
      })
      onToast('已存入错题本')
    } catch (e) {
      onToast(e instanceof Error ? e.message : '存入失败')
    }
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
          <button className="cap-btn" onClick={saveToMistakes}><I n="notebook" size={14} />存入错题本</button>
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
  const [convId, setConvId] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [model, setModel] = useState(() => localStorage.getItem('linverse.model') || 'demo')
  const [deepThink, setDeepThink] = useState(() => localStorage.getItem('linverse.deepThink') === '1')
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
  const [uploading, setUploading] = useState(false)
  const [typing, setTyping] = useState(false) // 当前 AI 消息是否还在打字
  // 正在打字的消息下标：避免新回答还没到时，上一条 AI 消息被误当成打字机重播
  const [typingIdx, setTypingIdx] = useState(-1)
  const [thinkSec, setThinkSec] = useState(0) // 深度思考耗时
  const [deletingId, setDeletingId] = useState('') // 二次确认删除的会话
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 读设置里的默认模型 + 自定义模型名
  useEffect(() => {
    if (!profileId) return
    getSettings(profileId).then((s) => {
      if (s.aiProvider && !localStorage.getItem('linverse.model')) setModel(s.aiProvider)
      if (s.aiModel) setCustomModelName(s.aiModel)
    }).catch(() => {})
  }, [profileId])

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
    try {
      const c = await getConversation(id, profileId)
      setConvId(id)
      setMsgs(c.messages)
      setTyping(false)
      setTypingIdx(-1)
      setThinkSec(0)
      setDrawerOpen(false)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '加载失败')
    }
  }

  // 新建会话：清空当前聊天
  const newConv = () => {
    setConvId(null)
    setMsgs([])
    setThinkSec(0)
    setTyping(false)
    setTypingIdx(-1)
    setDrawerOpen(false)
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

  // 聊天区自动滚到底
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs, typing])

  // 拍照 / 选图：先上传拿到 url，再随问题一起发
  const onPickImage = async (f: File | undefined) => {
    if (!f) return
    setUploading(true)
    try {
      const url = await uploadImage(f)
      setImgUrl(url)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
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
    setImgUrl('')
    setSending(true)
    setTyping(true)
    try {
      localStorage.setItem('linverse.model', model)
      const r = await ask({
        profileId,
        conversationId: convId || undefined,
        question,
        imageUrl: userMsg.imageUrl,
        model,
        deepThink,
        aiKey: getAiKey() || undefined, // Key 只从本地读，随请求带给后端
      })
      setConvId(r.conversationId)
      setThinkSec(r.thinkSeconds || 0)
      setMsgs((v) => {
        const next: ChatMsg[] = [...v, {
          role: 'assistant' as const, content: r.answer, createdAt: new Date().toISOString(),
        }]
        // 新 AI 消息的下标就是它，其他消息不用打字机
        setTypingIdx(next.length - 1)
        return next
      })
      reloadConvs()
    } catch (e) {
      // 出错时移除刚才的用户消息，保持界面干净
      setMsgs((v) => v.slice(0, -1))
      setTyping(false)
      setTypingIdx(-1)
      setToast(e instanceof Error ? e.message : '发送失败')
    } finally {
      setSending(false)
    }
  }

  const lastAiIdx = msgs.map((m) => m.role).lastIndexOf('assistant')
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
      <div className="chat-topbar">
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
        </div>
        <div className="drawer-list">
          {drawerTab === 'conv' ? (<>
            {convs.length === 0 && <Empty text="还没有会话，开始第一次提问吧" />}
            {convs.map((c) => (
              <div key={c.id} className={'conv-item' + (c.id === convId ? ' active' : '')}
                onClick={() => openConv(c.id)}>
                <span className="conv-title">{c.title || '新会话'}</span>
                {deletingId === c.id
                  ? <button className="mini-btn" style={{ color: 'var(--red)' }}
                      onClick={(e) => { e.stopPropagation(); delConv(c.id) }}>确认删除</button>
                  : <button className="conv-del" aria-label="删除会话"
                      onClick={(e) => { e.stopPropagation(); delConv(c.id) }}><I n="trash" size={18} /></button>}
              </div>
            ))}
          </>) : (<>
            {favs.length === 0 && <Empty text="还没有收藏，在 AI 回答卡片上点收藏试试" />}
            {favs.map((f) => (
              <div key={f.id} className="fav-card">
                <div className="fav-q" onClick={() => setFavOpenId(favOpenId === f.id ? '' : f.id)}>
                  {f.q}
                </div>
                {favOpenId === f.id && <div className="fav-a" style={{ WebkitLineClamp: 'unset' }}>{f.a}</div>}
                <div className="fav-foot">
                  <button className="mini-btn" style={{ color: 'var(--red)' }}
                    onClick={() => unFav(f.id)}>取消收藏</button>
                </div>
              </div>
            ))}
          </>)}
        </div>
      </aside>

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
            ) : i === typingIdx && typing ? (
              // 只有正在打字的那条 AI 消息用打字机效果（按下标，不按"最后一条"，避免重播上一条）
              <TypeMsg
                text={m.content}
                question={i > 0 && msgs[i - 1].role === 'user' ? msgs[i - 1].content : ''}
                profileId={profileId}
                onDone={() => { setTyping(false); setTypingIdx(-1) }}
                onSkipDone={() => { setTyping(false); setTypingIdx(-1) }}
                onToast={setToast}
              />
            ) : (
              <AnswerCard
                text={m.content}
                question={i > 0 && msgs[i - 1].role === 'user' ? msgs[i - 1].content : ''}
                profileId={profileId}
                thinkText={i === lastAiIdx && deepThink && thinkSec > 0 && !typing ? `已深度思考 · ${thinkSec} 秒` : ''}
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
      <div className="composer">
        <input ref={fileRef} type="file" accept="image/*" capture="environment"
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
          <textarea className="chat-input" rows={1} value={input}
            placeholder="随时问问题"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          <button className="send-btn" onClick={send}
            disabled={sending || (!input.trim() && !imgUrl)} aria-label="发送">
            <I n="send" size={18} />
          </button>
        </div>
      </div>
      <Toast msg={toastMsg} tkey={toastKey} />
    </div>
  )
}
