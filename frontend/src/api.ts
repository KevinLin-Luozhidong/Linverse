// 后端 API 封装：请求地址 = VITE_API_URL + /api/...
// 本地开发不设 VITE_API_URL 时走相对路径 /api/...，由 Vite 代理转发到 http://localhost:3001
// 部署到 Vercel 后在环境变量里填 VITE_API_URL=https://<Railway 后端网址>，前端直连云端后端
// 字段名与后端契约保持一致，不做改动

const BASE = import.meta.env.VITE_API_URL || ''

// 通用请求：自动拼 JSON 头并解析返回，失败时抛出中文错误信息
// 访问密码 token 存在 localStorage，每次请求自动带在 x-site-token 头里
async function req<T>(path: string, init?: RequestInit, timeoutMs = 20000): Promise<T> {
  let res: Response
  const token = getSiteToken()
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-site-token': token } : {}),
      },
      // 20 秒还没回来就放弃，别让界面一直转圈（国内连 Vercel 有时会 hang 住）
      signal: init?.signal || AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    // 超时（AbortError）和断网分开提示，别让用户以为后端挂了
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('请求超时了，网络有点慢，重试一次试试')
    }
    // 网络层失败（后端没跑）：抛可展示的错误
    throw new Error('连不上后端服务，确认后端已启动')
  }
  if (!res.ok) {
    let msg = '请求失败'
    let code = ''
    try {
      const body = await res.json()
      if (body && typeof body.error === 'string') { msg = body.error; code = body.error }
    } catch {
      // 解析失败就用默认文案
    }
    // 访问密码不对/过期：清掉本地 token，通知 App 弹密码门
    if (res.status === 401 && code === 'need_site_password') {
      clearSiteToken()
      window.dispatchEvent(new Event('linverse:site-locked'))
      const e = new Error('请输入访问密码') as Error & { needSitePassword: boolean }
      e.needSitePassword = true
      throw e
    }
    throw new Error(msg)
  }
  // 204 无内容直接返回空对象
  if (res.status === 204) return {} as T
  return (await res.json()) as T
}

const get = <T>(p: string) => req<T>(p)
const post = <T>(p: string, body?: unknown, timeoutMs?: number) =>
  req<T>(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }, timeoutMs)
const put = <T>(p: string, body: unknown) =>
  req<T>(p, { method: 'PUT', body: JSON.stringify(body) })
const del = <T>(p: string) => req<T>(p, { method: 'DELETE' })

// ---- 类型定义（与契约字段一一对应） ----
export interface ConversationMeta { id: string; title: string; createdAt: string }
export interface ChatMsg { role: 'user' | 'assistant'; content: string; imageUrl?: string; createdAt: string }
export interface Conversation extends ConversationMeta { messages: ChatMsg[] }

export interface AskResult { answer: string; thinkSeconds: number; conversationId: string; model: string }

export interface Mistake {
  id: string; profileId: string; subject: string; questionText: string;
  questionImageUrl?: string; answerText?: string; answerImageUrl?: string;
  reason?: string; mastered: boolean;
}

export interface Note {
  id: string; profileId: string; title: string; content: string;
  images: string[]; tags: string[]; color?: string; pinned: boolean; archived?: boolean;
}

export interface DictMeaning {
  pos: string; zh: string; en: string;
  examples?: { en: string; zh: string }[];
}
export interface DictResult {
  word: string; phonetic?: string; meanings: DictMeaning[];
  examples: string[]; synonyms: string[];
  wordForms?: { form: string; label: string }[];
  antonyms?: string[];
  phrases?: { phrase: string; zh: string }[];
}

export interface VocabWord {
  id: string; profileId: string; word: string; phonetic?: string; meaning: string;
}

export interface Stats { streakDays: number; checkinDays: number; mistakeCount: number; noteCount: number; wordCount: number }
export interface Badge { id: string; name: string; desc: string; unlocked: boolean }

export interface Settings {
  profileId: string; displayName?: string; fontSize?: string; theme?: string;
  aiProvider?: string; aiModel?: string; aiEndpoint?: string;
}

export interface Profile { id: string; name: string; avatar_url?: string }

// 图片地址归一化：/uploads/... 拼上后端地址（本地 BASE 为空走 Vite 代理，部署后走 VITE_API_URL），http 开头原样返回
export function imgSrc(url?: string): string {
  if (!url) return ''
  if (url.startsWith('/uploads/')) return `${BASE}${url}`
  return url
}

// ---- 文件上传 ----
export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file) // 字段名固定为 file
  let res: Response
  const token = getSiteToken()
  try {
    res = await fetch(`${BASE}/api/upload`, {
      method: 'POST', body: fd,
      headers: token ? { 'x-site-token': token } : {},
    })
  } catch {
    throw new Error('连不上后端服务，确认后端已启动')
  }
  if (res.status === 401) {
    clearSiteToken()
    window.dispatchEvent(new Event('linverse:site-locked'))
    throw new Error('请输入访问密码')
  }
  if (!res.ok) throw new Error('图片上传失败')
  const data = await res.json()
  return data.url as string
}

// ---- AI 问答 ----
export interface AskParams {
  profileId: string; conversationId?: string; question: string;
  imageUrl?: string; model: string; deepThink: boolean; aiKey?: string;
}

export async function ask(p: AskParams): Promise<AskResult> {
  try {
    // AI 回答（尤其深度思考+看图）经常超过 20 秒，单独给 120 秒超时，别误杀
    return await post<AskResult>('/ask', p, 120000)
  } catch (e) {
    // 演示模型在后端连不上时用本地假数据，保证界面可体验
    if (p.model === 'demo' && e instanceof Error && e.message.includes('连不上后端')) {
      await new Promise((r) => setTimeout(r, 600))
      return {
        answer: demoAnswer(p.question),
        thinkSeconds: p.deepThink ? 2 : 0,
        conversationId: p.conversationId || 'demo',
        model: 'demo',
      }
    }
    throw e
  }
}

// 演示模型本地回答：纯前端假数据，仅用于无后端时体验流程
function demoAnswer(q: string): string {
  const short = q.length > 24 ? q.slice(0, 24) + '…' : q
  return (
    `收到你的问题「${short}」\n\n` +
    `这是演示模式的示例回答：连接真实 AI 后，这里会返回分步骤的讲解\n` +
    `1 先理解题意，圈出关键词\n` +
    `2 回忆相关知识点\n` +
    `3 按步骤作答并检查\n\n` +
    `去设置页填写 AI Key 即可切换到真实模型`
  )
}

// ---- 会话 ----
export const listConversations = (profileId: string) =>
  get<ConversationMeta[]>(`/conversations?profileId=${encodeURIComponent(profileId)}`)
// 后端详情/删除接口要求带 profileId 做数据隔离，这里按后端契约拼接（字段名不变）
export const getConversation = (id: string, profileId: string) =>
  get<Conversation>(`/conversations/${id}?profileId=${encodeURIComponent(profileId)}`)
export const deleteConversation = (id: string, profileId: string) =>
  del(`/conversations/${id}?profileId=${encodeURIComponent(profileId)}`)

// ---- 错题 ----
export const listMistakes = (profileId: string, subject?: string) =>
  get<Mistake[]>(`/mistakes?profileId=${encodeURIComponent(profileId)}${subject ? `&subject=${encodeURIComponent(subject)}` : ''}`)
export const createMistake = (m: Omit<Mistake, 'id'>) => post<Mistake>('/mistakes', m)
export const updateMistake = (id: string, m: Partial<Mistake>, profileId?: string) =>
  put<Mistake>(`/mistakes/${id}${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`, m)
export const deleteMistake = (id: string, profileId?: string) =>
  del(`/mistakes/${id}${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`)

// ---- OCR ----
// 自动带上本地 AI Key 和当前供应商：以前只传 imageUrl，后端拿不到 Key 静默返回空文本
export const ocr = (imageUrl: string, profileId?: string) => {
  const model = localStorage.getItem('linverse.model') || 'deepseek'
  return post<{ text: string; error?: string }>('/ocr', {
    imageUrl,
    model: model === 'demo' ? 'deepseek' : model, // 演示模式没有真 Key，默认走 deepseek
    aiKey: getAiKey() || undefined,
    profileId: profileId || undefined, // custom 模型时后端用它取 endpoint
  })
}

// ---- 笔记 ----
// 后端把 tags/images 存成 JSON 字符串，前端按数组用，这里归一化（字段名不变）
function normNote(n: Note): Note {
  const t = (n as unknown as { tags: unknown }).tags
  const im = (n as unknown as { images: unknown }).images
  const arr = (v: unknown): string[] => {
    if (Array.isArray(v)) return v as string[]
    if (typeof v === 'string') {
      try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] }
    }
    return []
  }
  return { ...n, tags: arr(t), images: arr(im) }
}
export const listNotes = async (profileId: string, q = '', tag = '', archived = '') => {
  const ns = await get<Note[]>(`/notes?profileId=${encodeURIComponent(profileId)}&q=${encodeURIComponent(q)}&tag=${encodeURIComponent(tag)}&archived=${archived}`)
  return ns.map(normNote)
}
export const createNote = async (n: Omit<Note, 'id'>) => normNote(await post<Note>('/notes', n))
export const updateNote = async (id: string, n: Partial<Note>, profileId?: string) =>
  normNote(await put<Note>(`/notes/${id}${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`, n))
export const deleteNote = (id: string, profileId?: string) =>
  del(`/notes/${id}${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`)

// ---- 词典 ----
export type DictSource = 'dict' | 'ai' | 'offline'
export const lookupWord = (word: string, source: DictSource = 'dict', opts?: {
  aiKey?: string; model?: string; profileId?: string
}) => {
  const q = new URLSearchParams({ word, source })
  if (opts?.aiKey) q.set('aiKey', opts.aiKey)
  if (opts?.model) q.set('model', opts.model)
  if (opts?.profileId) q.set('profileId', opts.profileId)
  return get<DictResult>(`/dictionary?${q.toString()}`)
}
export const getWordHistory = (profileId: string) =>
  get<{ word: string; createdAt: string }[]>(`/word-history?profileId=${encodeURIComponent(profileId)}`)

// ---- 生词本 ----
export const listVocab = (profileId: string) =>
  get<VocabWord[]>(`/vocabulary?profileId=${encodeURIComponent(profileId)}`)
export const addVocab = (v: { profileId: string; word: string; phonetic?: string; meaning: string }) =>
  post<VocabWord>('/vocabulary', v)
export const updateVocab = (id: string, v: Partial<VocabWord>, profileId?: string) =>
  put<VocabWord>(`/vocabulary/${id}${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`, v)
export const reviewVocab = (id: string, known: boolean) =>
  post(`/vocabulary/${id}/review`, { known })
export const dueVocab = (profileId: string) =>
  get<VocabWord[]>(`/vocabulary/due?profileId=${encodeURIComponent(profileId)}`)

// ---- 打卡 / 统计 / 徽章 ----
export const checkin = (profileId: string) => post<{ streakDays: number }>('/checkin', { profileId })
export const getStats = (profileId: string) =>
  get<Stats>(`/stats?profileId=${encodeURIComponent(profileId)}`)
export const getBadges = (profileId: string) =>
  get<Badge[]>(`/badges?profileId=${encodeURIComponent(profileId)}`)

// ---- 设置（AI Key 不走这里，只存前端 localStorage） ----
export const getSettings = (profileId: string) =>
  get<Settings>(`/settings?profileId=${encodeURIComponent(profileId)}`)
export const saveSettings = (s: Settings) => put<Settings>('/settings', s)

// ---- 账号 ----
export const listProfiles = () => get<Profile[]>('/profiles')
export const createProfile = (name: string) => post<Profile>('/profiles', { name })
export const renameProfile = (id: string, name: string) => put<Profile>(`/profiles/${id}`, { name })
export const deleteProfile = (id: string) => del(`/profiles/${id}`)
export const setAvatar = (id: string, avatarUrl: string) =>
  put<Profile>(`/profiles/${id}/avatar`, { avatarUrl })

// AI Key 存取：只放 localStorage，不经过后端
const AI_KEY = 'linverse.aiKey'
export const getAiKey = () => localStorage.getItem(AI_KEY) || ''
export const setAiKey = (k: string) => {
  if (k) localStorage.setItem(AI_KEY, k)
  else localStorage.removeItem(AI_KEY)
}

// 账号 ID 双存储：localStorage 为主，cookie 为备。
// iOS 桌面端 PWA 在版本更新时可能被当成新应用重装、清空 localStorage，
// cookie 是另一套存储机制，互为备份，提高找回概率。
const PID_KEY = 'linverse.profileId'
const PID_COOKIE = 'linverse_pid'
export function getPid(): string | null {
  try {
    const ls = localStorage.getItem(PID_KEY)
    if (ls) return ls
    // localStorage 没了，试试 cookie
    const m = document.cookie.match(new RegExp('(?:^|; )' + PID_COOKIE + '=([^;]*)'))
    if (m) {
      const id = decodeURIComponent(m[1])
      // 从 cookie 找回，顺手恢复到 localStorage
      try { localStorage.setItem(PID_KEY, id) } catch {}
      return id
    }
  } catch {}
  return null
}
export function setPid(id: string) {
  try { localStorage.setItem(PID_KEY, id) } catch {}
  try {
    // cookie 备份：10 年有效期
    document.cookie = `${PID_COOKIE}=${encodeURIComponent(id)}; max-age=315360000; path=/; SameSite=Lax`
  } catch {}
}
export function clearPid() {
  try { localStorage.removeItem(PID_KEY) } catch {}
  try { document.cookie = `${PID_COOKIE}=; max-age=0; path=/` } catch {}
}

// ---- 全站访问密码 ----
// token 就是密码哈希本身：验证通过后存本地，每次请求自动带上；改密码后旧 token 自动失效
const SITE_TOKEN = 'linverse.siteToken'
export const getSiteToken = () => localStorage.getItem(SITE_TOKEN) || ''
export const setSiteToken = (t: string) => {
  if (t) localStorage.setItem(SITE_TOKEN, t)
  else localStorage.removeItem(SITE_TOKEN)
}
export const clearSiteToken = () => localStorage.removeItem(SITE_TOKEN)
export const siteStatus = () => get<{ passwordSet: boolean }>('/site/status')
export const siteVerify = (password: string) =>
  post<{ ok: boolean; token: string }>('/site/verify', { password })
export const siteSetPassword = (password: string, oldPassword?: string) =>
  post<{ ok: boolean; token: string }>('/site/password', { password, oldPassword })
// 清空所有数据：后端要求 token + 二次确认，成功后账号 ID 从 1 重来
export const siteReset = (danger: string) => post<{ ok: boolean }>('/site/reset', { confirm: 'RESET', danger })
// 所有者密码：只属于本人的密码，清空数据时必须输对
export const dangerStatus = () => get<{ dangerSet: boolean }>('/site/danger-status')
export const setDangerPassword = (password: string, oldPassword?: string) =>
  post<{ ok: boolean }>('/site/danger-password', { password, oldPassword })
// 新账号注册总闸：关掉后新设备不能自动建账号（已建好的不受影响）
// 只有所有者密码能改这个开关
export const signupStatus = () => get<{ allow: boolean }>('/site/signup-status')
export const setSignupAllow = (allow: boolean, dangerPassword: string) =>
  post<{ ok: boolean; allow: boolean }>('/site/signup-allow', { allow, dangerPassword })
