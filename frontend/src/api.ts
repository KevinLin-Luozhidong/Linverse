// 后端 API 封装：请求地址 = VITE_API_URL + /api/...
// 本地开发不设 VITE_API_URL 时走相对路径 /api/...，由 Vite 代理转发到 http://localhost:3001
// 生产环境 VITE_API_URL 为空，走同源相对路径 /api/...，由 vercel.json rewrite 转发到 serverless API（前后端同一 Vercel 项目）
// 字段名与后端契约保持一致，不做改动

import { DEFAULT_REGION_ID } from './regions'

const BASE = import.meta.env.VITE_API_URL || ''

// 通用请求：自动拼 JSON 头并解析返回，失败时抛出中文错误信息
// 访问密码凭证是 httpOnly cookie（浏览器自动带，JS 读不到）；
// localStorage 里只剩老会话的旧 token，请求时顺带发在 x-site-token 头里做兼容
async function req<T>(path: string, init?: RequestInit, timeoutMs = 20000, authProfileId?: string): Promise<T> {
  let res: Response
  const token = getSiteToken()
  const requestProfileId = authProfileId || getPid()
  const profileToken = getProfileToken(requestProfileId)
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-site-token': token } : {}),
        ...(requestProfileId && profileToken ? { 'x-profile-id': requestProfileId, 'x-profile-token': profileToken } : {}),
        ...(getOwnerToken() ? { 'x-owner-token': getOwnerToken() } : {}),
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
      if (body && typeof body.error === 'string') {
        msg = typeof body.message === 'string' ? body.message : body.error
        code = body.error
      }
    } catch {
      // 解析失败就用默认文案
    }
    // 访问密码不对/过期：清掉本地 token，通知 App 弹密码门
    if (res.status === 401 && code === 'need_site_password') {
      throw needSitePasswordError()
    }
    // 把后端给的错误 code 一起带上，调用方能按 code 分流（如看板的 unknown_region）
    const err = new Error(msg) as Error & { code?: string }
    err.code = code
    throw err
  }
  // 凭证迁移：服务端在每次鉴权成功的响应里都会种下 httpOnly cookie，
  // 本地 localStorage 里的旧 token 用完这次就可以清掉（以后只靠 cookie）。
  // 只在非 /site 路由清：/site/* 不走鉴权中间件，不会种 cookie。
  if (!path.startsWith('/site/') && getSiteToken()) clearSiteToken()
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
const patch = <T>(p: string, body: unknown) =>
  req<T>(p, { method: 'PATCH', body: JSON.stringify(body) })
const putAsProfile = <T>(id: string, p: string, body: unknown) =>
  req<T>(p, { method: 'PUT', body: JSON.stringify(body) }, 20000, id)
const delAsProfile = <T>(id: string, p: string) =>
  req<T>(p, { method: 'DELETE' }, 20000, id)

// ---- 类型定义（与契约字段一一对应） ----
export interface ConversationMeta { id: string; title: string; createdAt: string; favorite?: boolean }
export interface ChatMsg { role: 'user' | 'assistant'; content: string; imageUrl?: string; createdAt: string; webSearched?: boolean; kbUsed?: boolean; thinkSeconds?: number; deepThink?: boolean }
export interface Conversation extends ConversationMeta { messages: ChatMsg[] }

export interface AskResult { answer: string; thinkSeconds: number; conversationId: string; model: string; webSearched?: boolean; kbUsed?: boolean; kbRefs?: KbRef[] }

export interface Mistake {
  id: string; profileId: string; subject: string; questionText: string;
  questionImageUrl?: string; answerText?: string; answerImageUrl?: string;
  reason?: string; mastered: boolean;
  createdAt?: string; created_at?: string;
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
  word: string; phonetic?: string; audioUrl?: string; meanings: DictMeaning[];
  examples: string[]; synonyms: string[];
  wordForms?: { form: string; label: string }[];
  antonyms?: string[];
  phrases?: { phrase: string; zh: string }[];
}

export interface VocabWord {
  id: string; profileId: string; word: string; phonetic?: string; meaning: string;
}

export interface Stats { streakDays: number; checkinDays: number; mistakeCount: number; masteredMistakeCount?: number; noteCount: number; wordCount: number; recentCheckins?: string[] }
export interface Badge { id: string; name: string; desc: string; unlocked: boolean }

export interface Settings {
  profileId: string; displayName?: string; fontSize?: string; theme?: string;
  aiProvider?: string; aiModel?: string; aiEndpoint?: string;
}

export interface Profile { id: string; name: string; avatar_url?: string }
export interface AuthenticatedProfile extends Profile { authToken: string }

// 图片地址归一化：/uploads/... 拼上后端地址（本地 BASE 为空走 Vite 代理，部署后走 VITE_API_URL），http 开头原样返回
export function imgSrc(url?: string): string {
  if (!url) return ''
  if (url.startsWith('/uploads/')) return `${BASE}${url}`
  return url
}

// 访问密码失效时的统一错误：清本地 token、通知 App 弹密码门，调用方凭 needSitePassword 识别
function needSitePasswordError(): Error & { needSitePassword: boolean } {
  clearSiteToken()
  window.dispatchEvent(new Event('linverse:site-locked'))
  const e = new Error('请输入访问密码') as Error & { needSitePassword: boolean }
  e.needSitePassword = true
  return e
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
      // 上传以前没有超时：弱网下能无限挂住；5MB 图片 120 秒很宽松，超时即报错走正常失败提示
      signal: AbortSignal.timeout(120000),
      headers: {
        ...(token ? { 'x-site-token': token } : {}),
        ...(getPid() && getProfileToken() ? { 'x-profile-id': getPid()!, 'x-profile-token': getProfileToken() } : {}),
      },
    })
  } catch {
    throw new Error('连不上后端服务，确认后端已启动')
  }
  if (res.status === 401) {
    let body: { error?: string; message?: string } = {}
    try { body = await res.json() } catch {}
    if (body.error === 'need_site_password') {
      throw needSitePasswordError()
    }
    throw new Error(body.message || '账号验证失败，请检查账号恢复密钥')
  }
  if (!res.ok) throw new Error('图片上传失败')
  const data = await res.json()
  return data.url as string
}

// ---- AI 问答 ----
export interface AskParams {
  profileId: string; conversationId?: string; question: string;
  imageUrl?: string; model: string; deepThink: boolean; aiKey?: string; modelName?: string;
  webSearch?: boolean; // 联网搜索开关：用"自定义"那栏的智谱 Key 去搜，跟当前聊的模型没关系
  searchKey?: string; // 联网搜索用的智谱 Key（"自定义"那栏的 Key）
  useKb?: boolean; // 查课本开关：RAG 检索知识库，把教材内容喂给 AI
  historyMsgs?: { role: string; content: string }[]; // 多轮对话：最近 N 条历史消息
}

export interface KbRef { book: string; chapter: string; section: string; page_start: number; page_end: number }

// 模型列表：问供应商的 /models 要实时列表（用该供应商存的 Key），设置页做成点选
export const listModels = async (model: string, profileId?: string): Promise<string[]> => {
  const data = await post<{ models: string[] }>('/models', { model, profileId, aiKey: getAiKey(model) || undefined });
  return data.models || [];
}

export async function ask(p: AskParams): Promise<AskResult> {
  // AI 回答（尤其深度思考+看图）经常超过 20 秒，单独给 120 秒超时，别误杀
  // 演示模式已删：后端连不上就直接报连不上，不再给本地假答案
  return await post<AskResult>('/ask', p, 120000)
}

// ---- AI 问答（流式） ----
// 流式：POST /api/ask 带 stream:true，后端按 SSE 推词；
// onToken 每来一个词调一次，onStatus 收状态事件（正在查课本/正在回答）；
// 结束时 done 事件里带完整结果（conversationId、thinkSeconds 等）。
// 失败时抛错的方式与 req() 一致（401 密码失效同样弹密码门）。
export async function askStream(
  p: AskParams,
  onToken: (t: string) => void,
  onStatus?: (text: string) => void,
): Promise<AskResult> {
  const token = getSiteToken()
  const requestProfileId = getPid()
  const profileToken = getProfileToken(requestProfileId)
  let res: Response
  try {
    res = await fetch(`${BASE}/api/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-site-token': token } : {}),
        ...(requestProfileId && profileToken ? { 'x-profile-id': requestProfileId, 'x-profile-token': profileToken } : {}),
        ...(getOwnerToken() ? { 'x-owner-token': getOwnerToken() } : {}),
      },
      body: JSON.stringify({ ...p, stream: true }),
      signal: AbortSignal.timeout(120000),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('请求超时了，网络有点慢，重试一次试试')
    }
    throw new Error('连不上后端服务，确认后端已启动')
  }
  if (!res.ok) {
    let msg = '请求失败'
    let code = ''
    try {
      const body = await res.json()
      if (body && typeof body.error === 'string') {
        msg = typeof body.message === 'string' ? body.message : body.error
        code = body.error
      }
    } catch {}
    if (res.status === 401 && code === 'need_site_password') {
      throw needSitePasswordError()
    }
    const err = new Error(msg) as Error & { code?: string }
    err.code = code
    throw err
  }
  if (!res.body) throw new Error('流式回答失败，后端没返回数据流')
  // 读 SSE：事件按 `event: X\ndata: {...}\n\n` 分隔，data 行可能跨包，用 buf 拼
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let result: AskResult | null = null
  const handleEvent = (event: string, data: string) => {
    let d: { text?: string; message?: string } & Partial<AskResult>
    try { d = JSON.parse(data) } catch { return }
    if (event === 'token' && typeof d.text === 'string') onToken(d.text)
    else if (event === 'status' && typeof d.text === 'string') onStatus?.(d.text)
    else if (event === 'done') result = d as AskResult
    else if (event === 'error') throw new Error(typeof d.message === 'string' ? d.message : '流式回答失败')
  }
  const parseBlock = (block: string) => {
    let event = 'message'
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (data) handleEvent(event, data)
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        parseBlock(buf.slice(0, sep))
        buf = buf.slice(sep + 2)
      }
    }
    const tail = (buf + decoder.decode()).trim()
    if (tail) parseBlock(tail)
  } finally {
    try { reader.releaseLock() } catch {}
  }
  if (!result) throw new Error('流式回答中断了，没收到完整结果')
  return result
}

// ---- 会话 ----
export const listConversations = (profileId: string) =>
  get<ConversationMeta[]>(`/conversations?profileId=${encodeURIComponent(profileId)}`)
// 新建会话：点“＋新会话”立刻在服务端建一条，列表马上能看到（以前只清本地，列表里不出新会话）
export const createConversation = (profileId: string) =>
  post<ConversationMeta>('/conversations', { profileId })
// 后端详情/删除接口要求带 profileId 做数据隔离，这里按后端契约拼接（字段名不变）
export const getConversation = (id: string, profileId: string) =>
  get<Conversation>(`/conversations/${id}?profileId=${encodeURIComponent(profileId)}`)
export const deleteConversation = (id: string, profileId: string) =>
  del(`/conversations/${id}?profileId=${encodeURIComponent(profileId)}`)
// 会话收藏：星标置顶（后端按 favorite DESC 排序）
export const toggleConversationFavorite = (id: string, profileId: string, favorite: boolean) =>
  patch<{ id: string; favorite: boolean }>(`/conversations/${encodeURIComponent(id)}/favorite`, { profileId, favorite })
// 批量删除会话：ids 上限 200（后端约束）
export const batchDeleteConversations = (profileId: string, ids: string[]) =>
  post<{ deleted: number }>(`/conversations/batch-delete`, { profileId, ids })

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
    model,
    modelName: effectiveModelName(model, false) || undefined,
    aiKey: getAiKey(model) || undefined,
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
export type DictSource = 'dict' | 'offline'
export const lookupWord = (word: string, source: DictSource = 'dict', opts?: {
  model?: string; profileId?: string
}) => {
  const q = new URLSearchParams({ word, source })
  if (opts?.model) q.set('model', opts.model)
  if (opts?.profileId) q.set('profileId', opts.profileId)
  return get<DictResult>(`/dictionary?${q.toString()}`)
}
export const getWordHistory = (profileId: string) =>
  get<{ word: string; createdAt: string }[]>(`/word-history?profileId=${encodeURIComponent(profileId)}`)
export const clearWordHistory = (profileId: string) =>
  req<{ ok: boolean }>(`/word-history?profileId=${encodeURIComponent(profileId)}`, { method: 'DELETE' })

// ---- 生词本 ----
export const listVocab = (profileId: string) =>
  get<VocabWord[]>(`/vocabulary?profileId=${encodeURIComponent(profileId)}`)
export const addVocab = (v: { profileId: string; word: string; phonetic?: string; meaning: string }) =>
  post<VocabWord>('/vocabulary', v)
export const updateVocab = (id: string, v: Partial<VocabWord>, profileId?: string) =>
  put<VocabWord>(`/vocabulary/${id}${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`, v)
export const reviewVocab = (id: string, known: boolean, profileId?: string) =>
  post(`/vocabulary/${id}/review${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`, { known })
export const dueVocab = (profileId: string) =>
  get<VocabWord[]>(`/vocabulary/due?profileId=${encodeURIComponent(profileId)}`)
export const deleteVocab = (id: string, profileId?: string) =>
  req<{ ok: boolean }>(`/vocabulary/${id}${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`, { method: 'DELETE' })

// ---- 打卡 / 统计 / 徽章 ----
export const checkin = (profileId: string) => post<{ streakDays: number }>('/checkin', { profileId })
// 每日打卡本地标记：按账号隔离（A 打卡后 B 不会被误判为已打卡）；词典生词本与个人中心共用
export const checkinDateKey = (profileId: string | null) => `linverse.checkinDate.${profileId || 'anon'}`
export const isCheckedInToday = (profileId: string | null) =>
  localStorage.getItem(checkinDateKey(profileId)) === new Date().toISOString().slice(0, 10)
export const getStats = (profileId: string) =>
  get<Stats>(`/stats?profileId=${encodeURIComponent(profileId)}`)
export const getBadges = (profileId: string) =>
  get<Badge[]>(`/badges?profileId=${encodeURIComponent(profileId)}`)

// ---- 设置（AI Key 不走这里，只存前端 localStorage） ----
export const getSettings = (profileId: string) =>
  get<Settings>(`/settings?profileId=${encodeURIComponent(profileId)}`)
export const saveSettings = (s: Settings) => put<Settings>('/settings', s)

// ---- 账号 ----
const PROFILE_INDEX = 'linverse.profileIndex'
function readProfileIndex(): Profile[] {
  try {
    const value = JSON.parse(localStorage.getItem(PROFILE_INDEX) || '[]')
    return Array.isArray(value) ? value
      .filter((p) => p && p.id != null && typeof p.name === 'string')
      .map((p) => ({ id: String(p.id), name: p.name, avatar_url: p.avatar_url })) : []
  } catch { return [] }
}
// 本地已缓存的账号列表（上次从后端同步后存在 localStorage）：同步读，不发请求，
// 给设置页这类"一打开就要显示名字"的地方先顶上，后端回来再刷新
export const getCachedProfiles = () => readProfileIndex()
function rememberProfiles(profiles: Profile[]) {
  const known = new Map(readProfileIndex().map((p) => [String(p.id), p]))
  profiles.forEach((p) => known.set(String(p.id), {
    id: String(p.id), name: p.name, avatar_url: p.avatar_url,
  }))
  localStorage.setItem(PROFILE_INDEX, JSON.stringify([...known.values()]))
}
export const listProfiles = async () => {
  const current = await get<Profile[]>('/profiles')
  rememberProfiles(current)
  return [...new Map(readProfileIndex().map((p) => [String(p.id), p])).values()]
}
export const createProfile = async (name: string) => {
  const p = await post<AuthenticatedProfile>('/profiles', { name })
  setProfileToken(p.authToken, String(p.id))
  rememberProfiles([p])
  return p
}
export const claimProfile = async (id: string) => {
  const p = await post<AuthenticatedProfile>(`/profiles/${encodeURIComponent(id)}/claim`)
  setProfileToken(p.authToken, String(p.id))
  rememberProfiles([p])
  return p
}
export const renameProfile = async (id: string, name: string) => {
  const p = await putAsProfile<Profile>(id, `/profiles/${id}`, { name })
  rememberProfiles([p])
  return p
}
export const deleteProfile = async (id: string) => {
  const result = await delAsProfile(id, `/profiles/${id}`)
  const known = readProfileIndex().filter((p) => String(p.id) !== String(id))
  localStorage.setItem(PROFILE_INDEX, JSON.stringify(known))
  setProfileToken('', id)
  return result
}
export const setAvatar = async (id: string, avatarUrl: string) => {
  const p = await putAsProfile<Profile>(id, `/profiles/${id}/avatar`, { avatarUrl })
  rememberProfiles([p])
  return p
}

// AI Key 存取：只放 localStorage，不经过后端
// 多 Key：每个供应商各存各的 Key（linverse.aiKeys = { deepseek:'…', custom:'…' }），
// 切换模型不用重填 Key，前端按当前模型取对应的 Key 随请求带给后端。
const AI_KEYS = 'linverse.aiKeys'
const AI_KEY = 'linverse.aiKey' // 旧版单 Key，第一次读新表时迁移后删除
function readAiKeys(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(AI_KEYS) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}
// 旧版迁移：以前只有一个 Key，第一次读新表时按当时选的模型归位
//（比如一直在用智谱自定义，旧 Key 就归到 custom 名下），之后各供应商各存各的
function migrateLegacyKey(): Record<string, string> {
  const map = readAiKeys()
  if (Object.keys(map).length > 0) return map
  const legacy = localStorage.getItem(AI_KEY)
  if (!legacy) return map
  const model = localStorage.getItem('linverse.model') || 'custom'
  map[model] = legacy
  localStorage.setItem(AI_KEYS, JSON.stringify(map))
  localStorage.removeItem(AI_KEY)
  return map
}
// 取 Key：传模型就取该供应商的；不传取当前选中模型的（老调用方兼容）
export const getAiKey = (model?: string) => {
  const map = migrateLegacyKey()
  if (model) return map[model] || ''
  const current = localStorage.getItem('linverse.model') || 'deepseek'
  return map[current] || ''
}
// 读整张 Key 表（副本）：设置页用它显示"哪些供应商已保存 Key"、纠正旧 Key 归位
export const getAiKeyMap = (): Record<string, string> => ({ ...migrateLegacyKey() })

// ---- "自定义"那栏的名字：用户自己定，存在本地；没定过就按接口地址猜 ----
// 不能全写死叫"智谱"：这栏换成别的供应商时，名字得跟着换（用户 2026-11-14 纠正）
// 接口地址含 bigmodel.cn → 智谱；本地地址 → 本地；其他常见地址照名字认；都认不出 → "自定义"
const CUSTOM_NAME_KEY = 'linverse.customName'
// 纯按接口地址推断名字（不读本地存的）：智谱的地址 → 智谱，本地地址 → 本地，其他常见地址照名字认，都认不出 → "自定义"
export const deriveCustomName = (endpoint = '') => {
  if (endpoint.includes('bigmodel.cn')) return '智谱'
  if (/localhost|127\.0\.0\.1/.test(endpoint)) return '本地'
  if (endpoint.includes('siliconflow')) return '硅基流动'
  if (endpoint.includes('deepseek')) return 'DeepSeek'
  if (endpoint.includes('openai')) return 'OpenAI'
  if (endpoint.includes('googleapis')) return 'Gemini'
  return '自定义'
}
export const getCustomName = (endpoint = '') => {
  const stored = localStorage.getItem(CUSTOM_NAME_KEY) || ''
  return stored || deriveCustomName(endpoint)
}
export const setCustomName = (name: string) => {
  if (name.trim()) localStorage.setItem(CUSTOM_NAME_KEY, name.trim())
  else localStorage.removeItem(CUSTOM_NAME_KEY) // 清空 = 恢复按接口地址推断
}

// 各供应商的模型名：用户自己选、各存各的（linverse.aiModels），
// 不写死——设置页里每个供应商都能改，聊天页顶栏和模型菜单显示的就是这里存的名字。
const AI_MODELS = 'linverse.aiModels'
// 初次使用的建议值（用户改了就按他的来，这只是第一次打开时填好的起点）
const AI_MODEL_PREFILLS: Record<string, string> = {
  deepseek: 'deepseek-flash',
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  custom: '',
}
function readAiModels(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(AI_MODELS) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}
export const getAiModelMap = (): Record<string, string> => ({ ...readAiModels() })
// 取模型名：传供应商就取他的；不传取当前选中供应商的；没存过就返回建议值
export const getAiModel = (model?: string) => {
  const m = model || localStorage.getItem('linverse.model') || 'deepseek'
  const map = readAiModels()
  if (map[m]) return map[m]
  return AI_MODEL_PREFILLS[m] || ''
}
export const setAiModel = (name: string, model?: string) => {
  const m = model || localStorage.getItem('linverse.model') || 'deepseek'
  const map = readAiModels()
  if (name) map[m] = name
  else delete map[m]
  localStorage.setItem(AI_MODELS, JSON.stringify(map))
}
// 自定义模型名只属于"某个账号 + 某个接口地址"：GPT 审查 M4——以前只按 custom 存，
// 账号 B 会沿用账号 A 播种的 glm-4v-flash，盖掉自己后端正确的 llama3。
// 所以播种时按"账号|接口地址"核对身份：身份变了就按当前账号的后端设置重播（后端没填就清空旧值），
// 身份没变就不动——用户在设置里自己改的名字不会被播种盖掉。
const CUSTOM_MODEL_ORIGIN = 'linverse.aiModels.customOrigin'
export const customModelOriginKey = (profileId?: string | null, endpoint?: string) =>
  `${profileId || ''}|${(endpoint || '').trim().replace(/\/+$/, '')}`
export const getCustomModelOrigin = () => localStorage.getItem(CUSTOM_MODEL_ORIGIN) || ''
export const setCustomModelOrigin = (v: string) => {
  if (v) localStorage.setItem(CUSTOM_MODEL_ORIGIN, v)
  else localStorage.removeItem(CUSTOM_MODEL_ORIGIN)
}
export const seedCustomModel = (profileId: string | null, aiModel?: string, aiEndpoint?: string) => {
  const key = customModelOriginKey(profileId, aiEndpoint)
  if (getCustomModelOrigin() === key) return // 身份没变：本地的就是这个账号这个地址的，别动
  setAiModel(aiModel || '', 'custom') // 身份变了：按后端设置重播，后端没填就把旧账号的值清掉
  setCustomModelOrigin(key)
}
// 有效模型名：真正拿去问的名字，顶栏显示和发请求都用它，保证显示的和实际用的一致。
// 深度思考开时，OpenAI 切 o3、Gemini 切 gemini-2.5-flash（推理模型）；
// 用户填的已经是推理模型（o1/o3/o4、gemini-2.5/3 系）就不切，尊重他的选择；
// DeepSeek/智谱不用换名（思考是请求参数，名字不变）。
export const effectiveModelName = (model: string, deepThink?: boolean) => {
  const base = getAiModel(model)
  if (!deepThink || !base) return base
  if (model === 'openai' && !/^(o1|o3|o4)(-|$)/.test(base)) return 'o3'
  if (model === 'gemini' && !/gemini-(2\.5|3)/.test(base)) return 'gemini-2.5-flash'
  return base
}
export const setAiKey = (k: string, model?: string) => {
  const map = migrateLegacyKey()
  const m = model || localStorage.getItem('linverse.model') || 'deepseek'
  if (k) map[m] = k
  else delete map[m]
  localStorage.setItem(AI_KEYS, JSON.stringify(map))
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

// ---- 账号级凭证 ----
const PROFILE_TOKEN = 'linverse.profileToken'
const profileTokenKey = (id: string) => `${PROFILE_TOKEN}.${id}`
export const getProfileToken = (id = getPid()) => {
  if (id) return localStorage.getItem(profileTokenKey(String(id))) || ''
  return localStorage.getItem(PROFILE_TOKEN) || ''
}
export const setProfileToken = (t: string, id = getPid()) => {
  if (id) {
    if (t) localStorage.setItem(profileTokenKey(String(id)), t)
    else localStorage.removeItem(profileTokenKey(String(id)))
  } else if (t) {
    localStorage.setItem(PROFILE_TOKEN, t)
  } else {
    localStorage.removeItem(PROFILE_TOKEN)
  }
}
export const clearProfileAuth = () => {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && (key === PROFILE_TOKEN || key.startsWith(`${PROFILE_TOKEN}.`) || key === PROFILE_INDEX)) keys.push(key)
  }
  keys.forEach((key) => localStorage.removeItem(key))
}

// ---- 全站访问密码 ----
// token 就是密码哈希本身：验证通过后存本地，每次请求自动带上；改密码后旧 token 自动失效
const SITE_TOKEN = 'linverse.siteToken'
// getSiteToken/clearSiteToken 只服务老会话迁移：新登录不再往 localStorage 写 token，
// 凭证唯一来源是服务端种的 httpOnly cookie（浏览器自动带，JS 读不到）
export const getSiteToken = () => localStorage.getItem(SITE_TOKEN) || ''
export const clearSiteToken = () => localStorage.removeItem(SITE_TOKEN)
export const siteStatus = () => get<{ passwordSet: boolean; authed: boolean }>('/site/status')
export const siteVerify = (password: string) =>
  post<{ ok: boolean }>('/site/verify', { password })
export const siteSetPassword = (password: string, oldPassword?: string) =>
  post<{ ok: boolean }>('/site/password', { password, oldPassword })
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

// ---- 所有者管理会话 ----
const OWNER_TOKEN = 'linverse.ownerToken'
export const getOwnerToken = () => localStorage.getItem(OWNER_TOKEN) || ''
export const setOwnerToken = (token: string) => {
  if (token) localStorage.setItem(OWNER_TOKEN, token)
  else localStorage.removeItem(OWNER_TOKEN)
}
export const clearOwnerToken = () => setOwnerToken('')
export const verifyOwnerPassword = async (password: string) => {
  const result = await post<{ ok: boolean; token: string; expiresAt: number }>('/site/owner-verify', { password })
  setOwnerToken(result.token)
  return result
}

// ---- 知识库管理 ----
export interface KbBook {
  book: string; chunks: number; fig_chunks: number; text_chunks: number;
  first_ingest: string | null; last_ingest: string | null;
}
export const kbBooks = () => get<{ books: KbBook[] }>('/kb/books')
export const kbDeleteBook = (book: string) =>
  del<{ deleted: number; book: string }>(`/kb/books?book=${encodeURIComponent(book)}`)
// 按书分页列块：点书名展开详情用（不含 embedding 向量）
export interface KbChunk {
  id: number; chapter: string; section: string;
  page_start: number; page_end: number; text: string;
}
export const kbBookChunks = (book: string, limit = 20, offset = 0) =>
  get<{ book: string; total: number; chunks: KbChunk[] }>(
    `/kb/books/${encodeURIComponent(book)}/chunks?limit=${limit}&offset=${offset}`)

// ---- 每日早报（全站公共只读，不分账号） ----
export interface BriefingItem {
  title: string; body: string; source_name: string; source_url: string;
}
export interface BriefingSection { name: string; items: BriefingItem[] }
export interface DailyBriefing { date: string; title: string; sections: BriefingSection[] }
// 最新一期；还没有任何早报时后端返回 null
export const getLatestBriefing = () => get<DailyBriefing | null>('/briefings')
export const getBriefingByDate = (date: string) =>
  get<DailyBriefing | null>(`/briefings/${encodeURIComponent(date)}`)

// ---- 汕头看板（全站公共只读，不分账号） ----
export interface ShantouHero {
  sub: string; place: string; credit: string; temp_c: number; condition: string;
}
export interface ShantouSun {
  sunset: string; sunrise: string; daylight: string; night_low_c: number;
}
export interface ShantouTile {
  key: 'humidity' | 'wind' | 'uv' | 'aqi';
  label: string; value: string; unit: string; note: string; badge: string;
  bar?: number; compass_deg?: number; marker_pct?: number;
}
export interface ShantouLifeItem {
  name: string; level: string; text: string; hot: boolean; bar?: number;
}
export interface ShantouLife { sub: string; items: ShantouLifeItem[] }
export interface ShantouForecast {
  date_label: string; weekday: string; today: boolean; icon: 'sun' | 'cloud' | 'mix';
  condition: string; hi_c: number; lo_c: number; uv: string; uv_label: string;
  wind_dir: string; wind_kmh: number; note: string;
}
export interface ShantouTrip {
  day_label: string; title: string; theme: string; body: string; stops: string[];
}
export interface ShantouTrips { sub: string; items: ShantouTrip[] }
export interface ShantouAdvice { title: string; text: string }
export interface ShantouEventMeta { k: string; v: string; countdown_to?: string }
export interface ShantouEvent {
  date_label: string; week_label: string; title: string; badge: string;
  next: boolean; meta: ShantouEventMeta[];
}
export interface ShantouEvents { sub: string; note: string; items: ShantouEvent[] }
export interface ShantouBoardPayload {
  date: string; weekday: string; foot: string;
  hero: ShantouHero; sun: ShantouSun; tiles: ShantouTile[]; life: ShantouLife;
  forecast: ShantouForecast[]; trips: ShantouTrips; advice: ShantouAdvice[];
  events: ShantouEvents;
}
export interface ShantouBoard { date: string; payload: ShantouBoardPayload }
// 最新一期；还没有任何看板时后端返回 null
export const getLatestShantouBoard = (region: string = DEFAULT_REGION_ID) =>
  get<ShantouBoard | null>(`/shantou?region=${encodeURIComponent(region)}`)
export const getShantouBoardByDate = (date: string, region: string = DEFAULT_REGION_ID) =>
  get<ShantouBoard | null>(`/shantou/${encodeURIComponent(date)}?region=${encodeURIComponent(region)}`)
