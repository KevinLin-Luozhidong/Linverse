import { useEffect, useRef, useState } from 'react'
import { I, Toast, Spin, Empty, useToast} from '../components'
import {
  lookupWord, getWordHistory, clearWordHistory, listVocab, addVocab, reviewVocab, deleteVocab,
  dueVocab, checkin, checkinDateKey, isCheckedInToday, type DictResult, type DictSource, type VocabWord,
} from '@api'

// 词典页：查词 / 生词本两个子板块
// 生词本支持到期复习（遮住释义自测，懂/不懂反馈）和每日打卡

type Sub = 'dict' | 'vocab'

// ---- 离线词典包（ECDICT 英汉，IndexedDB 存储） ----
// 词典数据 5.9 万词（ECDICT v2），下载一次后断网也能查
// 离线词库 v2：e 由字符串改为英文释义数组（与 t 的中文释义按下标对齐），
// x 为 ECDICT exchange 词形变化串（d:过去分词/p:过去式/...），词形变化展示靠它；
// version 门：旧包无 version，读到旧包一律视为无效、提示重新下载
type EcdictEntry = { w: string; p: string; t: string; e: string[]; x?: string }
const DICT_PACKAGE_VERSION = 2

// 模块级缓存：只开一次 IndexedDB 连接，后续复用
let _dictDB: IDBDatabase | null = null

function openDictDB(): Promise<IDBDatabase> {
  if (_dictDB) return Promise.resolve(_dictDB)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('linverse-dict', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('words', { keyPath: 'w' })
      req.result.createObjectStore('meta', { keyPath: 'k' })
    }
    req.onsuccess = () => { _dictDB = req.result; resolve(req.result) }
    req.onerror = () => reject(req.error)
  })
}

async function getDictMeta(db: IDBDatabase): Promise<{ count: number; version?: number } | null> {
  return new Promise((resolve) => {
    const tx = db.transaction('meta', 'readonly')
    const req = tx.objectStore('meta').get('ecdict')
    req.onsuccess = () => resolve(req.result?.v || null)
    req.onerror = () => resolve(null)
  })
}

async function queryOfflineDict(word: string): Promise<DictResult | null> {
  const db = await openDictDB()
  const meta = await getDictMeta(db)
  if (!meta) return null
  return new Promise((resolve) => {
    const tx = db.transaction('words', 'readonly')
    const req = tx.objectStore('words').get(word.toLowerCase())
    req.onsuccess = () => {
      const e = req.result as EcdictEntry | undefined
      if (!e) { resolve(null); return }
      // 词形变化解析：v2 包的 x 字段就是 exchange 串（d:abandoned/p:abandoned/...），
      // 沿用旧解析逻辑，只把数据源从 e 字符串换成 x 字符串
      const wordForms: { form: string; label: string }[] = []
      const labelMap: Record<string, string> = {
        p: '过去式', d: '过去分词', i: '现在分词', '3': '第三人称单数',
        r: '比较级', t: '最高级', s: '复数',
      }
      for (const part of (e.x || '').split('/')) {
        const [k, v] = part.split(':')
        if (k && v && labelMap[k]) wordForms.push({ form: v, label: labelMap[k] })
      }
      // 中英文释义分开展示：t（中文综合行）和 e（英文义项数组）并不按下标对应
      // （比如 abandon：中文先动词后名词，英文先名词后动词），按下标硬配会把
      // 不对应的词义拼成一条。中文在前、英文在后，各自展示。
      const meanings = [
        ...(e.t || '').split('\n').filter(Boolean).slice(0, 5).map((zh) => ({
          pos: '', zh: zh.trim(), en: '', examples: [],
        })),
        ...(e.e || []).slice(0, 5).map((en) => ({
          pos: '', zh: '', en: String(en).trim(), examples: [],
        })),
      ]
      resolve({
        word: e.w,
        phonetic: e.p || undefined,
        meanings: meanings.length ? meanings : [{ pos: '', zh: '(暂无释义)', en: '', examples: [] }],
        examples: [],
        synonyms: [],
        wordForms: wordForms.slice(0, 8),
      })
    }
    req.onerror = () => resolve(null)
  })
}

export default function Dictionary({ profileId }: { profileId: string | null }) {
  const [sub, setSub] = useState<Sub>('dict')
  const [word, setWord] = useState('')
  const [result, setResult] = useState<DictResult | null>(null)
  const [searching, setSearching] = useState(false)
  // 输入防抖自动查词：停 500ms 没再打字就自动查，不用每次点"查词"；Enter/点按钮照常立即查
  const searchTimer = useRef<number>(0)
  const lastSearched = useRef('')
  // 查词请求序号：只接受最新一次请求的结果，旧请求晚回来也不覆盖（弱网乱序修掉）
  const searchSeq = useRef(0)
  const isLatestSearch = (seq: number) => seq === searchSeq.current
  // 离线包状态的同步镜像：下载完成当刻 setDictPkg 还没生效，紧接着的自动查词
  // 闭包里仍看到旧的 null；读 ref 就不会误报"先下载离线词典包"
  const dictPkgRef = useRef<{ count: number; version?: number } | null>(null)
  // 组件卸载时清掉待触发的定时器，避免切页后还发请求
  useEffect(() => () => window.clearTimeout(searchTimer.current), [])
  // 查词失败的行内提示：只靠 2 秒 toast 时，用户一晃神就只剩空白结果区，以为“静默失败”；
  // 失败原因常驻在结果区，直到下次查词成功或重查。
  const [dictError, setDictError] = useState('')
  // 词典接口：dict = 在线词典（默认），offline = 离线词典包（断网备胎）——AI 详解已移除，只剩两档
  const [dictSource, setDictSource] = useState<DictSource>(() => {
    const s = localStorage.getItem('linverse.dictSource') as DictSource
    return (s === 'offline' || s === 'dict') ? s : 'dict'
  })
  const [history, setHistory] = useState<{ word: string; createdAt: string }[]>([])
  const [toastMsg, toastKey, setToast] = useToast()

  // 生词本状态
  const [due, setDue] = useState<VocabWord[]>([])
  const [all, setAll] = useState<VocabWord[]>([])
  const [revealed, setRevealed] = useState<Record<string, boolean>>({}) // 已展开释义的卡片
  const [checkinDone, setCheckinDone] = useState(() => isCheckedInToday(profileId))
  // 打卡状态按账号读：切换账号、切回生词本、页面重新可见、跨日后都重算
  // （页面常驻挂载，useState 只初始化一次不够；以前还和个人中心共用一个全局标记，A 打卡后 B 也显示已打卡）
  const refreshCheckin = () => setCheckinDone(isCheckedInToday(profileId))
  useEffect(() => { refreshCheckin() }, [profileId, sub]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onShow = () => { if (!document.hidden) refreshCheckin() }
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', onShow)
    return () => { document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow) }
  }, [profileId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [checkinBusy, setCheckinBusy] = useState(false) // 打卡中：防连点（与个人中心页同款）
  const [reviewBusy, setReviewBusy] = useState(false) // 复习提交中：防连点
  const [clearBusy, setClearBusy] = useState(false) // 清除历史中：防连点
  const [delVocabId, setDelVocabId] = useState<string | null>(null) // 生词删除二次确认
  const [delVocabBusy, setDelVocabBusy] = useState(false) // 生词删除提交中：防连点

  // 列表请求版本号：清除、删除、复习等写操作后，之前发出的旧 GET 晚回来也不
  // 能覆盖界面（幽灵条目）；只有最新一轮的响应才能写状态
  const listEpoch = useRef(0)
  const [historyError, setHistoryError] = useState('')
  const [vocabError, setVocabError] = useState('')
  const loadHistory = () => {
    if (!profileId) return
    const v = listEpoch.current
    setHistoryError('')
    getWordHistory(profileId).then((h) => { if (listEpoch.current === v) setHistory(h) }).catch(() => { if (listEpoch.current === v) setHistoryError('历史加载失败') })
  }
  const loadVocab = () => {
    if (!profileId) return
    const v = listEpoch.current
    setVocabError('')
    listVocab(profileId).then((w) => { if (listEpoch.current === v) setAll(w) }).catch(() => { if (listEpoch.current === v) setVocabError('生词加载失败') })
    // 新一轮到期队列进来，展开标记全部清掉（下次到期重新遮住自测）
    dueVocab(profileId).then((d) => { if (listEpoch.current === v) { setDue(d); setRevealed({}) } }).catch(() => { if (listEpoch.current === v) setVocabError('生词加载失败') })
  }
  useEffect(() => { loadHistory(); loadVocab() }, [profileId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 查词
  const search = async (w?: string, src?: DictSource) => {
    const target = (w ?? word).trim().toLowerCase()
    if (!target) return
    lastSearched.current = target
    const source = src || dictSource
    const seq = ++searchSeq.current
    setSearching(true)
    setDictError('')
    // 新查词开始就清掉旧结果：失败后旧词卡片不能还留在下面（否则报错和旧结果同时出现）
    setResult(null)
    // 离线缓存：查过的词存本地，没网时也能看（真正的"离线词典包"基础）
    const cacheKey = `linverse.dictCache.${profileId || 'anon'}`
    const readCache = (): Record<string, DictResult> => {
      try { return JSON.parse(localStorage.getItem(cacheKey) || '{}') } catch { return {} }
    }
    // 离线词典：直接查已下载的包，断网也能用
    if (source === 'offline') {
      if (!dictPkgRef.current) {
        setToast('先下载离线词典包才能用')
        setDictError('先下载离线词典包才能用')
        setSearching(false)
        return
      }
      try {
        const hit = await queryOfflineDict(target)
        if (!isLatestSearch(seq)) return
        if (hit) {
          setResult(hit)
          setOfflineHit(false)
          setOfflinePkgHit(true)
        } else {
          // 离线包里没有，回落到在线默认词典
          const r = await lookupWord(target, 'dict', { profileId: profileId || undefined })
          if (!isLatestSearch(seq)) return
          setResult(r)
          setOfflineHit(false)
          setOfflinePkgHit(false)
          setToast('离线包里没有这个词，已用在线词典')
          loadHistory()
        }
      } catch (e) {
        if (!isLatestSearch(seq)) return
        setToast(e instanceof Error ? e.message : '查词失败')
        setDictError(e instanceof Error ? e.message : '查词失败')
      } finally {
        if (isLatestSearch(seq)) setSearching(false)
      }
      return
    }
    try {
      const r = await lookupWord(target, source, { profileId: profileId || undefined })
      if (!isLatestSearch(seq)) return
      setResult(r)
      setOfflineHit(false)
      setOfflinePkgHit(false)
      // 存入离线缓存（最多 200 个，新的在前）
      try {
        const c = readCache()
        delete c[target]
        const entries = Object.entries(c).slice(0, 199)
        localStorage.setItem(cacheKey, JSON.stringify({ [target]: r, ...Object.fromEntries(entries) }))
      } catch {}
      loadHistory()
    } catch (e) {
      // 在线失败三级回落：已下载的离线词库 → 本地旧缓存 → 报错。
      // 在线 404/超时/其他异常都走这里，不再要求用户手动切到离线词典
      if (!isLatestSearch(seq)) return
      if (dictPkgRef.current) {
        const pkgHit = await queryOfflineDict(target)
        if (!isLatestSearch(seq)) return
        if (pkgHit) {
          setResult(pkgHit)
          setOfflineHit(false)
          setOfflinePkgHit(true)
          setToast('在线词典不可用，已用离线词库')
          return
        }
      }
      // 没网：试试离线缓存
      const hit = readCache()[target]
      if (hit) {
        setResult(hit)
        setOfflineHit(true)
        setOfflinePkgHit(false)
        setToast('')
      } else {
        setToast(e instanceof Error ? e.message : '查词失败')
        setDictError(e instanceof Error ? e.message : '查词失败')
      }
    } finally {
      if (isLatestSearch(seq)) setSearching(false)
    }
  }
  const [offlineHit, setOfflineHit] = useState(false) // 当前结果来自离线缓存
  const [offlinePkgHit, setOfflinePkgHit] = useState(false) // 当前结果来自离线词典包
  const [cachedCount, setCachedCount] = useState(0)
  // 离线词典包状态
  const [dictPkg, setDictPkg] = useState<{ count: number; version?: number } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [dlProgress, setDlProgress] = useState('')
  // 版本门：只认 version 2 的包；旧包（无 version）视为无效，提示重新下载，
  // 避免新旧格式混读导致查词异常
  useEffect(() => {
    openDictDB().then(getDictMeta).then((m) => {
      if (m && m.version === DICT_PACKAGE_VERSION) {
        setDictPkg(m)
        dictPkgRef.current = m
      } else {
        setDictPkg(null)
        dictPkgRef.current = null
        if (m) setToast('离线词库已升级，请重新下载')
      }
    }).catch(() => {})
  }, [])

  // 下载离线词典包
  const downloadDictPkg = async () => {
    setDownloading(true)
    setDlProgress('下载中…')
    try {
      const res = await fetch('ecdict.v2.json')
      if (!res.ok) throw new Error('下载失败')
      // 流式读响应体，显示真实下载进度（以前 fetch 一回响应头就显示"解析中…"，
      // 10.6MB 的 body 还在路上，进度条长时间不动）
      let words: EcdictEntry[]
      if (res.body) {
        const total = Number(res.headers.get('content-length') || 0)
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let received = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          received += value.length
          const mb = (received / 1048576).toFixed(1)
          setDlProgress(total ? `下载中… ${mb}MB / ${(total / 1048576).toFixed(1)}MB` : `下载中… ${mb}MB`)
        }
        const buf = new Uint8Array(received)
        let off = 0
        for (const c of chunks) { buf.set(c, off); off += c.length }
        setDlProgress('解析中…')
        words = JSON.parse(new TextDecoder().decode(buf)) as EcdictEntry[]
      } else {
        setDlProgress('解析中…')
        words = await res.json() as EcdictEntry[]
      }
      setDlProgress(`存入中… (0/${words.length})`)
      const db = await openDictDB()
      // 清空旧数据
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['words', 'meta'], 'readwrite')
        tx.objectStore('words').clear()
        tx.objectStore('meta').clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      // 分批写入，避免阻塞
      const BATCH = 500
      for (let i = 0; i < words.length; i += BATCH) {
        const batch = words.slice(i, i + BATCH)
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('words', 'readwrite')
          const store = tx.objectStore('words')
          // key 用小写，查询时统一小写
          for (const w of batch) store.put({ ...w, w: w.w.toLowerCase() })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
        setDlProgress(`存入中… (${Math.min(i + BATCH, words.length)}/${words.length})`)
      }
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite')
        tx.objectStore('meta').put({ k: 'ecdict', v: { count: words.length, version: DICT_PACKAGE_VERSION } })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      setDictPkg({ count: words.length, version: DICT_PACKAGE_VERSION })
      dictPkgRef.current = { count: words.length, version: DICT_PACKAGE_VERSION }
      setToast(`离线词典下载完成，共 ${words.length} 词`)
      // 下载完成后，如果已有输入单词，自动重新查词
      if (word.trim()) { search(word.trim(), 'offline') }
    } catch (e) {
      setToast(e instanceof Error ? e.message : '下载失败')
    } finally {
      setDownloading(false)
      setDlProgress('')
    }
  }
  useEffect(() => {
    try {
      const c = JSON.parse(localStorage.getItem(`linverse.dictCache.${profileId || 'anon'}`) || '{}')
      setCachedCount(Object.keys(c).length)
    } catch {}
  }, [profileId, result])
  const pickSource = (s: DictSource) => {
    // 切来源后，待触发的旧来源防抖查询不再发出（否则旧来源请求晚回来会覆盖新来源的结果）
    window.clearTimeout(searchTimer.current)
    setDictSource(s)
    localStorage.setItem('linverse.dictSource', s)
    // 切换离线词典时，先检查词典包是否已下载
    if (s === 'offline' && !dictPkg) {
      setToast('请先下载离线词典包')
      return
    }
    // 切换来源后，如果当前有查词结果，用新来源重新查一遍
    if (result && word.trim()) {
      search(word.trim(), s)
    }
  }

  // 加入生词本：释义优先取中文，没有中文取英文，两者都没有就不加入
  const [joining, setJoining] = useState(false)
  const joinVocab = async () => {
    if (!result || !profileId || joining) return
    if (all.some((v) => v.word.toLowerCase() === result.word.toLowerCase())) {
      setToast('已经在生词本里了')
      return
    }
    const meaning = result.meanings.find((m) => m.zh)?.zh
      || result.meanings.find((m) => m.en)?.en || ''
    if (!meaning) { setToast('暂无可保存释义'); return }
    setJoining(true)
    try {
      const saved = await addVocab({
        profileId,
        word: result.word,
        phonetic: result.phonetic,
        meaning,
      })
      setToast('已加入生词本')
      // 成功后立刻更新本地列表，不等异步刷新回来（否则 joining 一松手再点一次就重复插入）
      if (saved && saved.id) setAll((list) => [saved, ...list.filter((x) => x.word.toLowerCase() !== result.word.toLowerCase())])
      loadVocab()
    } catch (e) {
      setToast(e instanceof Error ? e.message : '加入失败')
    } finally { setJoining(false) }
  }

  // 复习反馈：懂 / 不懂（提交中禁用按钮，防连点重复提交）
  const review = async (v: VocabWord, known: boolean) => {
    if (reviewBusy) return
    setReviewBusy(true)
    try {
      await reviewVocab(v.id, known, profileId || undefined)
      // 写操作后旧的列表 GET 作废（晚回来会把刚复习掉的词恢复出来）
      listEpoch.current++
      setDue((list) => {
        const next = list.filter((x) => x.id !== v.id)
        // 过滤后判断，避免闭包旧値问题
        if (next.length === 0) setToast('今日复习完成！太棒了🎉')
        return next
      })
      // 复习完清掉该词的展开标记：下次再到期时重新遮住自测，而不是直接露释义
      setRevealed((r) => { const { [v.id]: _, ...rest } = r; return rest })
    } catch (e) {
      setToast(e instanceof Error ? e.message : '提交失败')
    } finally { setReviewBusy(false) }
  }

  // 删除生词：点一次进确认态，再点一次真正删除（与错题本单条删除同款）
  const delVocab = async (v: VocabWord) => {
    if (delVocabId !== v.id) { setDelVocabId(v.id); return }
    if (delVocabBusy) return
    setDelVocabBusy(true)
    try {
      await deleteVocab(v.id, profileId || undefined)
      // 写操作后旧的列表 GET 作废（晚回来会把刚删的词恢复出来）
      listEpoch.current++
      setAll((list) => list.filter((x) => x.id !== v.id))
      setDue((list) => list.filter((x) => x.id !== v.id))
      setDelVocabId(null)
      setToast('已删除')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '删除失败')
    } finally { setDelVocabBusy(false) }
  }

  // 每日打卡（与个人中心页同款：打卡中禁用 + 进行中文案，防连点）
  const doCheckin = async () => {
    if (!profileId || checkinBusy) return
    setCheckinBusy(true)
    try {
      await checkin(profileId)
      const today = new Date().toISOString().slice(0, 10)
      localStorage.setItem(checkinDateKey(profileId), today)
      setCheckinDone(true)
      setToast('打卡成功')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '打卡失败')
    } finally { setCheckinBusy(false) }
  }

  return (
    <div className="dict-sec">
      <div className="work-head">
        <div className="work-kicker">学习工具</div>
        <div className="work-title">词典</div>
        <div className="work-desc">每天多查一个词，英语更进一步</div>
      </div>
      <div className="seg" style={{ marginTop: 10 }}>
        <button className={sub === 'dict' ? 'on' : ''} onClick={() => setSub('dict')}>查词</button>
        <button className={sub === 'vocab' ? 'on' : ''} onClick={() => { setSub('vocab'); loadVocab() }}>
          生词本{due.length > 0 ? ` · ${due.length}` : ''}
        </button>
      </div>

      {sub === 'dict' && (
        <>
          <div className="toolbar-row" style={{ padding: '12px 0 0' }}>
            <div className="search-box">
              <I n="search" size={18} />
              <input className="input" value={word} placeholder="输入英文单词"
                onChange={(e) => {
                  const v = e.target.value
                  setWord(v)
                  window.clearTimeout(searchTimer.current)
                  const t = v.trim().toLowerCase()
                  if (!t || t === lastSearched.current) return
                  // 离线档没下载包时不自动查，避免反复弹"先下载"提示；在线档随时可查
                  if (dictSource === 'offline' && !dictPkg) return
                  searchTimer.current = window.setTimeout(() => { search(v) }, 500)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') { window.clearTimeout(searchTimer.current); search() } }} />
            </div>
            <button className="btn" onClick={() => { window.clearTimeout(searchTimer.current); search() }} disabled={searching}>查词</button>
          </div>
          {/* 词典二选一：在线词典（默认）/ 离线词典（断网备胎）——AI 详解已移除 */}
          <div className="seg" style={{ marginTop: 10 }}>
            <button className={dictSource === 'dict' ? 'on' : ''} onClick={() => pickSource('dict')}>在线词典</button>
            <button className={dictSource === 'offline' ? 'on' : ''} onClick={() => pickSource('offline')}>离线词典</button>
          </div>
          {/* 离线词典包：下载一次，断网也能查 5.9 万常用词 */}
          {dictSource === 'offline' && (
            <div style={{ marginTop: 10 }}>
              {dictPkg ? (
                <div style={{ fontSize: `calc(13px * var(--fss))`, color: 'var(--ink2)' }}>
                  ✓ 离线词典包已下载（{dictPkg.count} 词，断网可用）
                  <div style={{ fontSize: `calc(11px * var(--fss))`, color: 'var(--ink3)', marginTop: 4 }}>
                    词库数据来源：ECDICT（MIT 开源词库）
                  </div>
                </div>
              ) : (
                <button className="btn btn-ghost" style={{ width: '100%' }}
                  onClick={downloadDictPkg} disabled={downloading}>
                  {downloading ? (dlProgress || '下载中…') : '下载离线词典包（约 10.6MB，一次下载断网可用）'}
                </button>
              )}
            </div>
          )}

          {searching && <Spin />}
          {!searching && dictError && (
            <div className="safe-note" style={{ color: 'var(--red)' }}>
              查词失败：{dictError}
              <div style={{ marginTop: 8 }}>
                <button className="mini-btn" onClick={() => search()}>重试</button>
              </div>
            </div>
          )}
          {result && !searching && (
            <div className="dict-card">
              <div className="dict-word">{result.word}
                {offlineHit && <span className="tag" style={{ marginLeft: 10, verticalAlign: 'middle' }}>离线缓存</span>}
                {offlinePkgHit && <span className="tag" style={{ marginLeft: 10, verticalAlign: 'middle' }}>离线词库</span>}
              </div>
              {result.phonetic && <div className="dict-phonetic" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {result.phonetic.startsWith('/') ? result.phonetic : `/${result.phonetic}/`}
                {result.audioUrl && (
                  <button className="mini-btn" style={{ fontSize: `calc(13px * var(--fss))` }}
                    onClick={() => { const a = new Audio(result!.audioUrl!); a.play() }}
                    aria-label="播放发音">▶</button>
                )}
                {!result.audioUrl && typeof window !== 'undefined' && window.speechSynthesis && (
                  <button className="mini-btn" style={{ fontSize: `calc(13px * var(--fss))` }}
                    onClick={() => {
                      const u = new SpeechSynthesisUtterance(result!.word)
                      u.lang = 'en-US'
                      window.speechSynthesis.speak(u)
                    }}
                    aria-label="播放发音">▶</button>
                )}
              </div>}
              {/* 词形变化：复数/过去式/比较级等 */}
              {result.wordForms && result.wordForms.length > 0 && (
                <div style={{ margin: '8px 0' }}>
                  {result.wordForms.map((w, i) => (
                    <span key={i} className="tag" style={{ marginRight: 6, marginBottom: 6 }}>
                      {w.form}{w.label ? <span style={{ opacity: 0.7 }}> {w.label}</span> : null}
                    </span>
                  ))}
                </div>
              )}
              {result.meanings.map((m, i) => (
                <div key={i} className="dict-meaning">
                  <span className="dict-pos">{m.pos}</span>
                  {/* 只有英文释义的条目只显示英文（中文行为空时不留" · "）；中英文都有的正常拼 */}
                  <span>{m.zh ? <>{m.zh}{m.en ? <span style={{ color: 'var(--ink3)', fontSize: `calc(13px * var(--fss))` }}> · {m.en}</span> : null}</> : m.en}</span>
                  {/* 每条释义下的例句（带中文翻译） */}
                  {m.examples && m.examples.map((e, j) => (
                    <div key={j} className="dict-ex" style={{ marginTop: 4 }}>
                      <div>{e.en}</div>
                      {e.zh && <div style={{ color: 'var(--ink2)', fontSize: `calc(13px * var(--fss))` }}>{e.zh}</div>}
                    </div>
                  ))}
                </div>
              ))}
              {/* 旧格式兼容：如果 meanings 里没例句，显示顶层 examples */}
              {result.examples.length > 0 && !result.meanings.some((m) => m.examples && m.examples.length) && (
                <>
                  <div className="dict-sec-h">例句</div>
                  {result.examples.map((e, i) => <div key={i} className="dict-ex">{e}</div>)}
                </>
              )}
              {result.synonyms.length > 0 && (
                <>
                  <div className="dict-sec-h">同义词</div>
                  <div>{result.synonyms.map((s) => <span key={s} className="tag">{s}</span>)}</div>
                </>
              )}
              {result.antonyms && result.antonyms.length > 0 && (
                <>
                  <div className="dict-sec-h">反义词</div>
                  <div>{result.antonyms.map((s) => <span key={s} className="tag">{s}</span>)}</div>
                </>
              )}
              {result.phrases && result.phrases.length > 0 && (
                <>
                  <div className="dict-sec-h">常用搭配</div>
                  {result.phrases.map((p, i) => (
                    <div key={i} className="dict-meaning">
                      <span style={{ fontWeight: 600 }}>{p.phrase}</span>
                      {p.zh && <span style={{ color: 'var(--ink2)', marginLeft: 8 }}>{p.zh}</span>}
                    </div>
                  ))}
                </>
              )}
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 14 }} onClick={joinVocab} disabled={joining}>
                {joining ? '加入中…' : '加入生词本'}
              </button>
            </div>
          )}

          {historyError && (
            <div className="safe-note" style={{ color: 'var(--red)' }}>
              {historyError}，<button className="mini-btn" onClick={loadHistory}>重试</button>
            </div>
          )}
          {history.length > 0 && (
            <>
              <div className="sec-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span><I n="clock" size={14} />查词历史</span>
                <button className="mini-btn" style={{ color: 'var(--red)', fontSize: `calc(12px * var(--fss))` }}
                  disabled={clearBusy}
                  onClick={async () => {
                    if (!profileId || clearBusy) return
                    setClearBusy(true)
                    try {
                      await clearWordHistory(profileId)
                      // 写操作后旧的历史 GET 作废（晚回来会把刚清掉的历史恢复出来）
                      listEpoch.current++
                      setHistory([])
                      setToast('历史已清除')
                    } catch (e) {
                      setToast(e instanceof Error ? e.message : '清除失败')
                    } finally { setClearBusy(false) }
                  }}>{clearBusy ? '清除中…' : '清除历史'}</button>
              </div>
              {history.slice(0, 20).map((h, i) => (
                <div key={i} className="hist-item" onClick={() => { window.clearTimeout(searchTimer.current); setWord(h.word); search(h.word) }}>
                  <span>{h.word}</span>
                  <span className="hist-time">{new Date(h.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </>
          )}

          {/* 离线词典包：查过的词自动存本地，没网也能看；多语言词库待接入 */}
          <div className="dict-pack">
            <div className="dict-pack-head">
              <div>
                <div className="dict-pack-title">离线词典包</div>
                <div className="dict-pack-sub">
                  {cachedCount > 0 ? `已缓存 ${cachedCount} 个查过的词，没网也能看` : '查过的词会自动存下来，没网也能看'}
                </div>
              </div>
              <span className="tag">接口就绪</span>
            </div>
            {[
              { n: '英汉词典', d: '英语 → 简体中文' },
            ].map((p) => (
              <div key={p.n} className="dict-pack-row">
                <div>
                  <div className="dict-pack-name">{p.n}</div>
                  <div className="dict-pack-sub">{p.d}</div>
                </div>
                {/* 状态跟真实包走：已下载就显示已下载，别再写死"词库待接入" */}
                <span className="dict-pack-wait">
                  {dictPkg ? `已下载（${dictPkg.count} 词）` : downloading ? (dlProgress || '下载中…') : '词库待接入'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {sub === 'vocab' && (
        <>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" style={{ flex: 1 }} onClick={doCheckin} disabled={checkinDone || checkinBusy}>
              {checkinDone ? '✓ 今日已打卡' : checkinBusy ? '打卡中…' : '每日打卡'}
            </button>
          </div>

          <div className="sec-title">到期复习（{due.length}）</div>
          {vocabError ? (
            <div className="safe-note" style={{ color: 'var(--red)' }}>
              {vocabError}，不是没有单词，是没加载出来——<button className="mini-btn" onClick={loadVocab}>重试</button>
            </div>
          ) : due.length === 0 ? (
            <Empty text="太棒了，没有需要复习的单词" />
          ) : due.map((v) => (
            <div key={v.id} className="review-card">
              <div className="dict-word">{v.word}</div>
              {v.phonetic && <div className="dict-phonetic">/{v.phonetic}/</div>}
              {revealed[v.id]
                ? <div className="review-meaning">{v.meaning}</div>
                : <div className="review-mask" onClick={() => setRevealed((r) => ({ ...r, [v.id]: true }))}>
                  释义已遮住，先自己想想，点我查看
                </div>}
              <div className="btn-row" style={{ justifyContent: 'center' }}>
                <button className="btn btn-line" disabled={reviewBusy} onClick={() => review(v, false)}>不懂</button>
                <button className="btn btn-ghost" onClick={() => {
                  // 跳过：移到队列末尾
                  setDue((list) => {
                    const rest = list.filter((x) => x.id !== v.id)
                    return [...rest, v]
                  })
                }}>跳过</button>
                <button className="btn" disabled={reviewBusy} onClick={() => review(v, true)}>懂了</button>
              </div>
            </div>
          ))}

          {all.length > 0 && (
            <>
              <div className="sec-title">全部生词（{all.length}）</div>
              {all.map((v) => (
                <div key={v.id} className="hist-item" style={{ cursor: 'pointer' }}
                  onClick={() => {
                    // 点击单词跳转到查词 tab 并自动搜索，用当前选中的来源
                    // （以前写死在线查词，离线档下点了生词却偷偷走网络，按钮还显示离线）
                    window.clearTimeout(searchTimer.current)
                    setSub('dict')
                    setWord(v.word)
                    search(v.word)
                  }}>
                  <span><b>{v.word}</b> <span style={{ color: 'var(--ink2)', fontSize: `calc(13px * var(--fss))` }}>{v.meaning}</span></span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button className="mini-btn" style={{ color: 'var(--red)' }} disabled={delVocabBusy}
                      onClick={(e) => { e.stopPropagation(); delVocab(v) }}>
                      {delVocabBusy && delVocabId === v.id ? '删除中…' : delVocabId === v.id ? '确认删除' : '删除'}
                    </button>
                    <span style={{ color: 'var(--ink3)', fontSize: `calc(12px * var(--fss))` }}>查词 →</span>
                  </span>
                </div>
              ))}
            </>
          )}
        </>
      )}
      <Toast msg={toastMsg} tkey={toastKey} />
    </div>
  )
}
