// 预览版数据层：全部走 localStorage，不调任何后端接口
// 函数名、签名、类型与 src/api.ts 完全一致，靠 vite alias（@api）在构建时切换

// ---- 类型定义（与 api.ts 一一对应） ----
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

export interface DictMeaning { pos: string; zh: string; en: string }
export interface DictResult {
  word: string; phonetic?: string; meanings: DictMeaning[];
  examples: string[]; synonyms: string[];
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

export interface Profile { id: string; name: string }

// ---- 本地数据库（单个 key 存整个库，4MB 上限） ----
const DB_KEY = 'linverse.demo.db.v1'
const MAX_BYTES = 4 * 1024 * 1024
const QUOTA_MSG = '空间不足，删一些带图内容再试'

interface VocabRow extends VocabWord { nextDue: string; level: number }
interface DB {
  profiles: Profile[]
  conversations: (ConversationMeta & { profileId: string; messages: ChatMsg[] })[]
  mistakes: Mistake[]
  notes: Note[]
  wordHistory: { profileId: string; word: string; createdAt: string }[]
  vocab: VocabRow[]
  checkins: { profileId: string; date: string }[]
  settings: Record<string, Settings>
}

const blankDb = (): DB => ({
  profiles: [], conversations: [], mistakes: [], notes: [],
  wordHistory: [], vocab: [], checkins: [], settings: {},
})

function load(): DB {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) return { ...blankDb(), ...JSON.parse(raw) }
  } catch {
    // 读失败就用空库
  }
  return blankDb()
}

// 写前估算体积，超 4MB 或浏览器配额报错都给友好提示
function save(db: DB) {
  const text = JSON.stringify(db)
  if (new Blob([text]).size > MAX_BYTES) throw new Error(QUOTA_MSG)
  try {
    localStorage.setItem(DB_KEY, text)
  } catch {
    throw new Error(QUOTA_MSG)
  }
}

const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 图片地址：dataURL 原样返回
export function imgSrc(url?: string): string {
  if (!url) return ''
  return url
}

// ---- 图片压缩：canvas 等比缩放 + JPEG 质量循环，单张压到 200KB 以内 ----
async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  let scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
  for (let round = 0; round < 8; round++) {
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    canvas.width = w
    canvas.height = h
    ctx.fillStyle = '#ffffff' // JPEG 不支持透明，先铺白底
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    let q = 0.85
    for (let i = 0; i < 6; i++) {
      const url = canvas.toDataURL('image/jpeg', q)
      if (new Blob([url]).size <= 200 * 1024) {
        bitmap.close()
        return url
      }
      q -= 0.15
    }
    scale *= 0.7 // 质量压到最低还超，就缩小尺寸再试
  }
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.5)
}

// ---- 文件上传（预览版）：压缩后转 dataURL 存本地 ----
export async function uploadImage(file: File): Promise<string> {
  return compressImage(file)
}

// ---- AI 问答 ----
export interface AskParams {
  profileId: string; conversationId?: string; question: string;
  imageUrl?: string; model: string; deepThink: boolean; aiKey?: string;
}

const SYS_PROMPT = '你是 Linverse 学习助手，专为中国高中生讲题。要求：按考试阅卷的得分规矩组织答案，分步骤讲清思路，不只给结果；重要的结论和易错点用 **加粗** 标出；回答末尾另起一行写"相关知识点："并列出 2-4 个相关知识点。不要用句号结尾的客套话'

function demoAnswer(q: string, hasImage: boolean): string {
  const short = q.length > 24 ? q.slice(0, 24) + '…' : q
  const imgLine = hasImage ? '\n\n（演示模式看不到图片细节，填 Key 后真实 AI 会看图讲题）' : ''
  return (
    `这是预览版的演示回答：去设置页 AI 接口里填上 Key，就会换成真实 AI 的分步骤讲解${imgLine}\n\n` +
    `针对「${short}」，你可以这样思考：\n` +
    `1. **先审题**：圈出题目里的关键词和已知条件\n` +
    `2. **想知识**：回忆相关的公式、定理和题型套路\n` +
    `3. **列步骤**：按考试的得分点一步步写，不要跳步\n` +
    `4. **再检查**：把答案代回去验算一遍\n\n` +
    `相关知识点：审题方法、答题规范`
  )
}

// 最近一次出现过的账号 id：给查词历史记录用（lookupWord 签名里没有 profileId）
let lastProfileId = ''

// 浏览器直连供应商（不经过后端）
async function callProvider(o: {
  provider: string; key: string; model: string; endpoint: string;
  question: string; imageUrl?: string;
}): Promise<string> {
  if (o.provider === 'gemini') {
    // Gemini generateContent 接口
    const model = o.model || 'gemini-2.0-flash'
    const parts: unknown[] = [{ text: SYS_PROMPT + '\n\n问题：' + o.question }]
    if (o.imageUrl && o.imageUrl.startsWith('data:')) {
      const m = o.imageUrl.match(/^data:(.+?);base64,(.+)$/)
      if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } })
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(o.key)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    })
    if (!res.ok) throw new Error('AI 请求失败，检查 Key 和网络后重试')
    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('')
    if (!text) throw new Error('AI 返回为空，换个问法重试')
    return text
  }
  // DeepSeek / OpenAI / 自定义（OpenAI 兼容的 chat completions）
  const endpoint = o.endpoint || (o.provider === 'deepseek'
    ? 'https://api.deepseek.com/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions')
  const model = o.model || (o.provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini')
  const content: unknown = o.imageUrl && o.imageUrl.startsWith('data:') && o.provider !== 'deepseek'
    ? [
        { type: 'text', text: o.question },
        { type: 'image_url', image_url: { url: o.imageUrl } },
      ]
    : o.question + (o.imageUrl ? '\n（用户附了一张图片，但当前模型不支持看图，请按文字描述作答）' : '')
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content },
      ],
    }),
  })
  if (!res.ok) throw new Error('AI 请求失败，检查 Key、地址和网络后重试')
  const data = await res.json()
  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error('AI 返回为空，换个问法重试')
  return text as string
}

export async function ask(p: AskParams): Promise<AskResult> {
  const t0 = Date.now()
  const db = load()
  const st = db.settings[p.profileId]
  const provider = p.model === 'custom' ? 'custom' : p.model
  const key = p.aiKey || getAiKey()
  let answer: string
  try {
    if (p.model === 'demo' || !key) {
      await sleep(700) // 演示模式模拟思考
      answer = demoAnswer(p.question, !!p.imageUrl)
    } else {
      answer = await callProvider({
        provider,
        key,
        model: st?.aiModel || '',
        endpoint: st?.aiEndpoint || '',
        question: p.question,
        imageUrl: p.imageUrl,
      })
    }
  } catch (e) {
    throw e instanceof Error ? e : new Error('AI 请求失败')
  }
  const thinkSeconds = p.deepThink ? Math.max(1, Math.round((Date.now() - t0) / 1000)) : 0
  // 存会话：复用 conversationId 或新建
  let conv = p.conversationId
    ? db.conversations.find((c) => c.id === p.conversationId && c.profileId === p.profileId)
    : undefined
  if (!conv) {
    conv = {
      id: nid(), profileId: p.profileId,
      title: p.question.slice(0, 14) || '新会话',
      createdAt: new Date().toISOString(), messages: [],
    }
    db.conversations.unshift(conv)
  }
  conv.messages.push(
    { role: 'user', content: p.question, imageUrl: p.imageUrl, createdAt: new Date().toISOString() },
    { role: 'assistant', content: answer, createdAt: new Date().toISOString() },
  )
  save(db)
  return { answer, thinkSeconds, conversationId: conv.id, model: p.model }
}

// ---- 会话 ----
export const listConversations = async (profileId: string) =>
  load().conversations
    .filter((c) => c.profileId === profileId)
    .map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt }))
export const getConversation = async (id: string, profileId: string) => {
  const c = load().conversations.find((x) => x.id === id && x.profileId === profileId)
  if (!c) throw new Error('对话不存在')
  return { id: c.id, title: c.title, createdAt: c.createdAt, messages: c.messages }
}
export const deleteConversation = async (id: string, profileId: string) => {
  const db = load()
  db.conversations = db.conversations.filter((x) => !(x.id === id && x.profileId === profileId))
  save(db)
}

// ---- 错题 ----
export const listMistakes = async (profileId: string) =>
  load().mistakes.filter((m) => m.profileId === profileId)
export const createMistake = async (m: Omit<Mistake, 'id'>) => {
  const db = load()
  const row = { ...m, id: nid() }
  db.mistakes.unshift(row)
  save(db)
  return row
}
export const updateMistake = async (id: string, m: Partial<Mistake>) => {
  const db = load()
  const row = db.mistakes.find((x) => x.id === id)
  if (!row) throw new Error('错题不存在')
  Object.assign(row, m)
  save(db)
  return row
}
export const deleteMistake = async (id: string) => {
  const db = load()
  db.mistakes = db.mistakes.filter((x) => x.id !== id)
  save(db)
}

// ---- OCR（预览版无后端，直接提示） ----
export const ocr = async (_imageUrl: string) => {
  throw new Error('预览版暂不支持 OCR，用 AI 看图讲题请先填 Key')
}

// ---- 笔记 ----
export const listNotes = async (profileId: string, q = '', tag = '', archived = '') => {
  const all = load().notes.filter((n) => n.profileId === profileId)
  return all.filter((n) => {
    if (archived ? !n.archived : n.archived) return false
    if (tag && !(n.tags || []).includes(tag)) return false
    if (q && !((n.title || '') + (n.content || '')).includes(q)) return false
    return true
  }).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
}
export const createNote = async (n: Omit<Note, 'id'>) => {
  const db = load()
  const row = { ...n, id: nid() }
  db.notes.unshift(row)
  save(db)
  return row
}
export const updateNote = async (id: string, n: Partial<Note>) => {
  const db = load()
  const row = db.notes.find((x) => x.id === id)
  if (!row) throw new Error('笔记不存在')
  Object.assign(row, n)
  save(db)
  return row
}
export const deleteNote = async (id: string) => {
  const db = load()
  db.notes = db.notes.filter((x) => x.id !== id)
  save(db)
}

// ---- 词典：内置离线迷你词库 ----
interface MiniEntry { ph: string; pos: string; zh: string; ex: string; syn: string[] }
const MINI: Record<string, MiniEntry> = {
  apple: { ph: 'ˈæpl', pos: 'n.', zh: '苹果', ex: 'She eats an apple every day.', syn: [] },
  book: { ph: 'bʊk', pos: 'n.', zh: '书；书籍', ex: 'This book is very interesting.', syn: ['volume'] },
  study: { ph: 'ˈstʌdi', pos: 'v.', zh: '学习；研究', ex: 'He studies hard every day.', syn: ['learn'] },
  school: { ph: 'skuːl', pos: 'n.', zh: '学校', ex: 'Our school is very big.', syn: [] },
  teacher: { ph: 'ˈtiːtʃə', pos: 'n.', zh: '老师；教师', ex: 'My teacher is kind.', syn: [] },
  student: { ph: 'ˈstjuːdənt', pos: 'n.', zh: '学生', ex: 'She is a good student.', syn: ['pupil'] },
  water: { ph: 'ˈwɔːtə', pos: 'n.', zh: '水', ex: 'Drink more water.', syn: [] },
  time: { ph: 'taɪm', pos: 'n.', zh: '时间；次', ex: 'Time flies.', syn: [] },
  day: { ph: 'deɪ', pos: 'n.', zh: '天；日子', ex: 'Have a nice day.', syn: [] },
  night: { ph: 'naɪt', pos: 'n.', zh: '夜晚', ex: 'Good night.', syn: [] },
  happy: { ph: 'ˈhæpi', pos: 'adj.', zh: '高兴的；幸福的', ex: 'I am happy today.', syn: ['glad', 'joyful'] },
  sad: { ph: 'sæd', pos: 'adj.', zh: '难过的', ex: 'He looks sad.', syn: ['unhappy'] },
  big: { ph: 'bɪɡ', pos: 'adj.', zh: '大的', ex: 'It is a big house.', syn: ['large'] },
  small: { ph: 'smɔːl', pos: 'adj.', zh: '小的', ex: 'A small dog runs fast.', syn: ['little'] },
  good: { ph: 'ɡʊd', pos: 'adj.', zh: '好的', ex: 'It is a good idea.', syn: ['fine', 'great'] },
  bad: { ph: 'bæd', pos: 'adj.', zh: '坏的；差的', ex: 'It was a bad dream.', syn: ['poor'] },
  love: { ph: 'lʌv', pos: 'v.', zh: '爱；热爱', ex: 'I love reading.', syn: ['adore'] },
  like: { ph: 'laɪk', pos: 'v.', zh: '喜欢', ex: 'I like music.', syn: ['enjoy'] },
  help: { ph: 'help', pos: 'v.', zh: '帮助', ex: 'Can you help me?', syn: ['assist'] },
  work: { ph: 'wɜːk', pos: 'v.', zh: '工作；起作用', ex: 'He works in a bank.', syn: ['labor'] },
  play: { ph: 'pleɪ', pos: 'v.', zh: '玩；演奏', ex: 'They play football.', syn: [] },
  read: { ph: 'riːd', pos: 'v.', zh: '读；阅读', ex: 'I read books every night.', syn: [] },
  write: { ph: 'raɪt', pos: 'v.', zh: '写', ex: 'Write your name here.', syn: [] },
  speak: { ph: 'spiːk', pos: 'v.', zh: '说；讲', ex: 'She speaks English well.', syn: ['talk'] },
  eat: { ph: 'iːt', pos: 'v.', zh: '吃', ex: 'We eat dinner at six.', syn: [] },
  drink: { ph: 'drɪŋk', pos: 'v.', zh: '喝', ex: 'Drink some milk.', syn: [] },
  run: { ph: 'rʌn', pos: 'v.', zh: '跑', ex: 'He runs every morning.', syn: [] },
  walk: { ph: 'wɔːk', pos: 'v.', zh: '走；散步', ex: 'Let us walk home.', syn: [] },
  beautiful: { ph: 'ˈbjuːtɪfl', pos: 'adj.', zh: '美丽的', ex: 'What a beautiful flower.', syn: ['pretty', 'lovely'] },
  important: { ph: 'ɪmˈpɔːtnt', pos: 'adj.', zh: '重要的', ex: 'This is very important.', syn: ['significant'] },
  difficult: { ph: 'ˈdɪfɪkəlt', pos: 'adj.', zh: '困难的', ex: 'The test is difficult.', syn: ['hard'] },
  easy: { ph: 'ˈiːzi', pos: 'adj.', zh: '容易的', ex: 'It is easy to learn.', syn: ['simple'] },
  friend: { ph: 'frend', pos: 'n.', zh: '朋友', ex: 'He is my best friend.', syn: ['pal'] },
  family: { ph: 'ˈfæməli', pos: 'n.', zh: '家庭', ex: 'My family is happy.', syn: [] },
  house: { ph: 'haʊs', pos: 'n.', zh: '房子', ex: 'Their house is new.', syn: ['home'] },
  food: { ph: 'fuːd', pos: 'n.', zh: '食物', ex: 'Chinese food is delicious.', syn: [] },
  dog: { ph: 'dɒɡ', pos: 'n.', zh: '狗', ex: 'The dog is cute.', syn: [] },
  cat: { ph: 'kæt', pos: 'n.', zh: '猫', ex: 'The cat sleeps all day.', syn: [] },
  bird: { ph: 'bɜːd', pos: 'n.', zh: '鸟', ex: 'A bird is singing.', syn: [] },
  tree: { ph: 'triː', pos: 'n.', zh: '树', ex: 'The tree is tall.', syn: [] },
  flower: { ph: 'ˈflaʊə', pos: 'n.', zh: '花', ex: 'The flowers smell sweet.', syn: ['blossom'] },
  sun: { ph: 'sʌn', pos: 'n.', zh: '太阳', ex: 'The sun rises in the east.', syn: [] },
  moon: { ph: 'muːn', pos: 'n.', zh: '月亮', ex: 'The moon is bright tonight.', syn: [] },
  star: { ph: 'stɑː', pos: 'n.', zh: '星星', ex: 'Stars shine at night.', syn: [] },
  rain: { ph: 'reɪn', pos: 'n.', zh: '雨', ex: 'It rains a lot here.', syn: [] },
  snow: { ph: 'snəʊ', pos: 'n.', zh: '雪', ex: 'It snows in winter.', syn: [] },
  wind: { ph: 'wɪnd', pos: 'n.', zh: '风', ex: 'The wind is strong.', syn: [] },
  world: { ph: 'wɜːld', pos: 'n.', zh: '世界', ex: 'Travel around the world.', syn: [] },
  country: { ph: 'ˈkʌntri', pos: 'n.', zh: '国家；乡村', ex: 'China is a great country.', syn: ['nation'] },
  city: { ph: 'ˈsɪti', pos: 'n.', zh: '城市', ex: 'Beijing is a big city.', syn: [] },
}

export const lookupWord = async (word: string): Promise<DictResult> => {
  const w = word.trim().toLowerCase()
  const e = MINI[w]
  if (!e) throw new Error('词库里没有这个词，换个常见词试试')
  if (lastProfileId) recordHistory(lastProfileId, w).catch(() => {})
  return {
    word: w, phonetic: e.ph,
    meanings: [{ pos: e.pos, zh: e.zh, en: '' }],
    examples: [e.ex], synonyms: e.syn,
  }
}

export const getWordHistory = async (profileId: string) => {
  lastProfileId = profileId // 记住当前账号，供查词历史用
  const db = load()
  return db.wordHistory
    .filter((h) => h.profileId === profileId)
    .map((h) => ({ word: h.word, createdAt: h.createdAt }))
}

// 查词时顺手记一条历史
async function recordHistory(profileId: string, word: string) {
  const db = load()
  db.wordHistory = db.wordHistory.filter((h) => !(h.profileId === profileId && h.word === word))
  db.wordHistory.unshift({ profileId, word, createdAt: new Date().toISOString() })
  db.wordHistory = db.wordHistory.slice(0, 100)
  save(db)
}

// ---- 生词本 ----
export const listVocab = async (profileId: string) =>
  load().vocab.filter((v) => v.profileId === profileId)
export const addVocab = async (v: { profileId: string; word: string; phonetic?: string; meaning: string }) => {
  const db = load()
  const row: VocabRow = { ...v, id: nid(), nextDue: today(), level: 0 }
  db.vocab.unshift(row)
  save(db)
  return row
}
export const updateVocab = async (id: string, v: Partial<VocabWord>) => {
  const db = load()
  const row = db.vocab.find((x) => x.id === id)
  if (!row) throw new Error('单词不存在')
  Object.assign(row, v)
  save(db)
  return row
}
// 复习反馈：懂了就拉长间隔（1/3/7/15/30 天），不懂就明天再见
export const reviewVocab = async (id: string, known: boolean) => {
  const db = load()
  const row = db.vocab.find((x) => x.id === id)
  if (!row) throw new Error('单词不存在')
  const gaps = [1, 3, 7, 15, 30]
  row.level = known ? Math.min(row.level + 1, gaps.length - 1) : 0
  const d = new Date()
  d.setDate(d.getDate() + gaps[row.level])
  row.nextDue = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  save(db)
}
export const dueVocab = async (profileId: string) =>
  load().vocab.filter((v) => v.profileId === profileId && v.nextDue <= today())

// ---- 打卡 / 统计 / 徽章 ----
export const checkin = async (profileId: string) => {
  const db = load()
  const t = today()
  if (!db.checkins.some((c) => c.profileId === profileId && c.date === t)) {
    db.checkins.push({ profileId, date: t })
    save(db)
  }
  return { streakDays: calcStreak(db, profileId) }
}

function calcStreak(db: DB, profileId: string): number {
  const set = new Set(db.checkins.filter((c) => c.profileId === profileId).map((c) => c.date))
  let n = 0
  const d = new Date()
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  if (!set.has(fmt(d))) d.setDate(d.getDate() - 1) // 今天没打卡就从昨天开始数
  while (set.has(fmt(d))) { n++; d.setDate(d.getDate() - 1) }
  return n
}

export const getStats = async (profileId: string): Promise<Stats> => {
  const db = load()
  const my = (arr: { profileId: string }[]) => arr.filter((x) => x.profileId === profileId).length
  return {
    streakDays: calcStreak(db, profileId),
    checkinDays: my(db.checkins),
    mistakeCount: my(db.mistakes),
    noteCount: my(db.notes),
    wordCount: my(db.vocab),
  }
}

export const getBadges = async (profileId: string): Promise<Badge[]> => {
  const s = await getStats(profileId)
  return [
    { id: 'first-mistake', name: '第一道错题', desc: '记录第一道错题', unlocked: s.mistakeCount >= 1 },
    { id: 'streak-3', name: '坚持三天', desc: '连续打卡 3 天', unlocked: s.streakDays >= 3 },
    { id: 'streak-7', name: '一周不辍', desc: '连续打卡 7 天', unlocked: s.streakDays >= 7 },
    { id: 'mistake-50', name: '百题斩', desc: '累计记录 50 道错题', unlocked: s.mistakeCount >= 50 },
  ]
}

// ---- 设置（AI Key 只存前端 localStorage，不进数据库） ----
const defaultSettings = (profileId: string): Settings => ({
  profileId, fontSize: 'medium', theme: 'system',
  aiProvider: 'demo', aiModel: '', aiEndpoint: '',
})
export const getSettings = async (profileId: string): Promise<Settings> => {
  const db = load()
  return db.settings[profileId] || defaultSettings(profileId)
}
export const saveSettings = async (s: Settings): Promise<Settings> => {
  const db = load()
  db.settings[s.profileId] = { ...defaultSettings(s.profileId), ...s }
  save(db)
  return db.settings[s.profileId]
}

// ---- 账号（数据按账号隔离） ----
export const listProfiles = async (): Promise<Profile[]> => {
  const db = load()
  if (db.profiles.length === 0) {
    db.profiles.push({ id: nid(), name: '我' })
    save(db)
  }
  return db.profiles
}
export const createProfile = async (name: string): Promise<Profile> => {
  const db = load()
  const p = { id: nid(), name }
  db.profiles.push(p)
  save(db)
  return p
}
export const renameProfile = async (id: string, name: string): Promise<Profile> => {
  const db = load()
  const p = db.profiles.find((x) => x.id === id)
  if (!p) throw new Error('账号不存在')
  p.name = name
  save(db)
  return p
}
export const deleteProfile = async (id: string) => {
  const db = load()
  db.profiles = db.profiles.filter((x) => x.id !== id)
  save(db)
}

// AI Key 存取：只放 localStorage
const AI_KEY = 'linverse.aiKey'
export const getAiKey = () => {
  try { return localStorage.getItem(AI_KEY) || '' } catch { return '' }
}
export const setAiKey = (k: string) => {
  try {
    if (k) localStorage.setItem(AI_KEY, k)
    else localStorage.removeItem(AI_KEY)
  } catch {
    throw new Error(QUOTA_MSG)
  }
}
