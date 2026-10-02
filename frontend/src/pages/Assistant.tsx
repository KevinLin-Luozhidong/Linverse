import { useEffect, useRef, useState } from 'react'
import { I, Switch, Toast, Spin, Empty } from '../components'
import {
  ask, listConversations, getConversation, deleteConversation,
  getSettings, getAiKey, uploadImage, imgSrc,
  type ConversationMeta, type ChatMsg,
} from '../api'

// AI 助手页：聊天 + 打字机输出 + 拍照问图 + 会话抽屉

const MODELS = [
  { v: 'demo', label: '演示' },
  { v: 'deepseek', label: 'DeepSeek' },
  { v: 'gemini', label: 'Gemini' },
  { v: 'openai', label: 'OpenAI' },
  { v: 'custom', label: '自定义' },
]

// 打字机消息：逐块显示文本，"直接回答"一键显示全文
function TypeMsg({ text, onDone }: { text: string; onDone: () => void }) {
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
  return (
    <div className="bubble">
      {text.slice(0, n)}
      {!done && <span className="caret" />}
      {!done && (
        <div className="msg-tools">
          <button className="mini-btn" onClick={() => setN(text.length)}>直接回答</button>
        </div>
      )}
    </div>
  )
}

export default function Assistant({ profileId }: { profileId: string | null }) {
  const [convs, setConvs] = useState<ConversationMeta[]>([])
  const [convId, setConvId] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [model, setModel] = useState(() => localStorage.getItem('linverse.model') || 'demo')
  const [deepThink, setDeepThink] = useState(() => localStorage.getItem('linverse.deepThink') === '1')
  const [drawerOpen, setDrawerOpen] = useState(false) // 抽屉默认关闭
  const [toast, setToast] = useState('')
  const [imgUrl, setImgUrl] = useState('') // 待发送的图片
  const [uploading, setUploading] = useState(false)
  const [typing, setTyping] = useState(true) // 当前 AI 消息是否还在打字
  const [thinkSec, setThinkSec] = useState(0) // 深度思考耗时
  const [deletingId, setDeletingId] = useState('') // 二次确认删除的会话
  const fileRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 读设置里的默认模型
  useEffect(() => {
    if (!profileId) return
    getSettings(profileId).then((s) => {
      if (s.aiProvider && !localStorage.getItem('linverse.model')) setModel(s.aiProvider)
    }).catch(() => {})
  }, [profileId])

  // 拉会话列表
  const reloadConvs = () => {
    if (!profileId) return
    listConversations(profileId).then(setConvs).catch(() => {})
  }
  useEffect(() => { reloadConvs() }, [profileId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 打开会话：加载历史消息
  const openConv = async (id: string) => {
    try {
      const c = await getConversation(id)
      setConvId(id)
      setMsgs(c.messages)
      setTyping(false)
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
    setDrawerOpen(false)
  }

  // 删除会话：点两次确认
  const delConv = async (id: string) => {
    if (deletingId !== id) { setDeletingId(id); return }
    try {
      await deleteConversation(id)
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
      setMsgs((v) => [...v, {
        role: 'assistant', content: r.answer, createdAt: new Date().toISOString(),
      }])
      reloadConvs()
    } catch (e) {
      setMsgs((v) => [...v, {
        role: 'assistant', content: '', createdAt: new Date().toISOString(),
      }])
      setToast(e instanceof Error ? e.message : '发送失败')
      // 出错时移除刚才的空消息，保持界面干净
      setMsgs((v) => v.slice(0, -1))
      setTyping(false)
    } finally {
      setSending(false)
    }
  }

  const lastAiIdx = msgs.map((m) => m.role).lastIndexOf('assistant')

  return (
    <div className="chat-wrap">
      {/* 顶栏：汉堡 / 模型选择 / 深度思考开关 */}
      <div className="topbar">
        <button className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="会话列表">
          <I n="menu" />
        </button>
        <div className="topbar-spacer" style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <select className="model-select" value={model}
            onChange={(e) => { setModel(e.target.value); localStorage.setItem('linverse.model', e.target.value) }}
            aria-label="选择模型">
            {MODELS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
        </div>
        <span className="deep-label">深度思考</span>
        <Switch on={deepThink} onChange={(v) => { setDeepThink(v); localStorage.setItem('linverse.deepThink', v ? '1' : '0') }} />
      </div>

      {/* 左侧抽屉：新建会话 + 历史列表，默认关闭不闪现 */}
      <div className={'drawer-mask' + (drawerOpen ? ' open' : '')} onClick={() => setDrawerOpen(false)} />
      <aside className={'drawer' + (drawerOpen ? ' open' : '')} aria-hidden={!drawerOpen}>
        <div className="drawer-head">
          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={newConv}>
            ＋ 新会话
          </button>
        </div>
        <div className="drawer-list">
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
        </div>
      </aside>

      {/* 聊天区 */}
      <div className="chat-list" ref={listRef}>
        {msgs.length === 0 && (
          <Empty text="随时问我问题，拍照也能问" />
        )}
        {msgs.map((m, i) => (
          <div key={i} className={'msg ' + (m.role === 'user' ? 'user' : 'msg-ai')}>
            {m.role === 'user' ? (
              <div className="bubble">
                {m.imageUrl && <img src={imgSrc(m.imageUrl)} alt="题目图片" />}
                {m.content}
              </div>
            ) : i === lastAiIdx && typing ? (
              // 只有最新一条 AI 消息用打字机效果
              <TypeMsg text={m.content} onDone={() => setTyping(false)} />
            ) : (
              <div className="bubble">{m.content}</div>
            )}
          </div>
        ))}
        {sending && <Spin />}
        {/* 深度思考完成后显示耗时 */}
        {deepThink && !typing && thinkSec > 0 && msgs.length > 0 && (
          <div className="msg msg-ai">
            <span className="think-tag">已深度思考 · {thinkSec} 秒</span>
          </div>
        )}
      </div>

      {/* 底部输入区：独立拍照按钮 + 输入框 + 发送 */}
      <div className="chat-input-bar">
        <input ref={fileRef} type="file" accept="image/*" capture="environment"
          style={{ display: 'none' }} onChange={(e) => onPickImage(e.target.files?.[0])} />
        <button className="icon-btn" onClick={() => fileRef.current?.click()}
          aria-label="拍照提问" style={{ color: 'var(--blue)' }}>
          {uploading ? <Spin /> : <I n="camera" size={26} />}
        </button>
        {imgUrl && (
          <div className="photo-preview">
            <img src={imgSrc(imgUrl)} alt="待发送" />
            <button onClick={() => setImgUrl('')} aria-label="移除图片">×</button>
          </div>
        )}
        <textarea className="chat-input" rows={1} value={input}
          placeholder="输入问题…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <button className="send-btn" onClick={send}
          disabled={sending || (!input.trim() && !imgUrl)} aria-label="发送">
          <I n="send" size={20} />
        </button>
      </div>
      <Toast msg={toast} />
    </div>
  )
}
