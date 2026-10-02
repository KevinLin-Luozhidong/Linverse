import { useEffect, useState } from 'react'
import { I, Toast, Spin, Empty, useToast} from '../components'
import {
  lookupWord, getWordHistory, listVocab, addVocab, reviewVocab,
  dueVocab, checkin, getAiKey, type DictResult, type DictSource, type VocabWord,
} from '@api'

// 词典页：查词 / 生词本两个子板块
// 生词本支持到期复习（遮住释义自测，懂/不懂反馈）和每日打卡

type Sub = 'dict' | 'vocab'

// ---- 离线词典包（ECDICT 英汉，IndexedDB 存储） ----
// 词典数据约 1.4 万词，下载一次后断网也能查
type EcdictEntry = { w: string; p: string; t: string; e: string }

function openDictDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('linverse-dict', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('words', { keyPath: 'w' })
      req.result.createObjectStore('meta', { keyPath: 'k' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getDictMeta(db: IDBDatabase): Promise<{ count: number } | null> {
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
      // 词形变化解析：d:perceived/p:perceived → [{form, label}]
      const wordForms: { form: string; label: string }[] = []
      const labelMap: Record<string, string> = {
        p: '过去式', d: '过去分词', i: '现在分词', '3': '第三人称单数',
        r: '比较级', t: '最高级', s: '复数',
      }
      for (const part of (e.e || '').split('/')) {
        const [k, v] = part.split(':')
        if (k && v && labelMap[k]) wordForms.push({ form: v, label: labelMap[k] })
      }
      // 中文释义按行拆成多条
      const meanings = (e.t || '').split('\n').filter(Boolean).slice(0, 5).map((zh) => ({
        pos: '', zh: zh.trim(), en: '', examples: [],
      }))
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
  // 词典接口：dict = 在线词典（默认），offline = 离线词典包（断网备胎），ai = AI 详解（联网、更详细）
  const [dictSource, setDictSource] = useState<DictSource>(() => {
    const s = localStorage.getItem('linverse.dictSource') as DictSource
    return (s === 'ai' || s === 'offline' || s === 'dict') ? s : 'dict'
  })
  const [history, setHistory] = useState<{ word: string; createdAt: string }[]>([])
  const [toastMsg, toastKey, setToast] = useToast()

  // 生词本状态
  const [due, setDue] = useState<VocabWord[]>([])
  const [all, setAll] = useState<VocabWord[]>([])
  const [revealed, setRevealed] = useState<Record<string, boolean>>({}) // 已展开释义的卡片
  const [checkinDone, setCheckinDone] = useState(false)

  const loadHistory = () => {
    if (!profileId) return
    getWordHistory(profileId).then(setHistory).catch(() => {})
  }
  const loadVocab = () => {
    if (!profileId) return
    listVocab(profileId).then(setAll).catch(() => {})
    dueVocab(profileId).then(setDue).catch(() => {})
  }
  useEffect(() => { loadHistory(); loadVocab() }, [profileId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 查词
  const search = async (w?: string) => {
    const target = (w ?? word).trim().toLowerCase()
    if (!target) return
    setSearching(true)
    // 离线缓存：查过的词存本地，没网时也能看（真正的"离线词典包"基础）
    const cacheKey = `linverse.dictCache.${profileId || 'anon'}`
    const readCache = (): Record<string, DictResult> => {
      try { return JSON.parse(localStorage.getItem(cacheKey) || '{}') } catch { return {} }
    }
    // 离线词典：直接查已下载的包，断网也能用
    if (dictSource === 'offline') {
      if (!dictPkg) {
        setToast('先下载离线词典包才能用')
        setSearching(false)
        return
      }
      try {
        const hit = await queryOfflineDict(target)
        if (hit) {
          setResult(hit)
          setOfflineHit(false)
          setOfflinePkgHit(true)
        } else {
          // 离线包里没有，回落到在线默认词典
          const r = await lookupWord(target, 'dict', { profileId: profileId || undefined })
          setResult(r)
          setOfflineHit(false)
          setOfflinePkgHit(false)
          setToast('离线包里没有这个词，已用在线词典')
        }
      } catch (e) {
        setToast(e instanceof Error ? e.message : '查词失败')
      } finally {
        setSearching(false)
      }
      return
    }
    try {
      const r = await lookupWord(target, dictSource, dictSource === 'ai' ? {
        aiKey: getAiKey() || undefined,
        model: localStorage.getItem('linverse.model') || 'demo',
        profileId: profileId || undefined,
      } : { profileId: profileId || undefined })
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
      // 没网：试试离线缓存
      const hit = readCache()[target]
      if (hit) {
        setResult(hit)
        setOfflineHit(true)
        setOfflinePkgHit(false)
        setToast('')
      } else {
        setToast(e instanceof Error ? e.message : '查词失败')
      }
    } finally {
      setSearching(false)
    }
  }
  const [offlineHit, setOfflineHit] = useState(false) // 当前结果来自离线缓存
  const [offlinePkgHit, setOfflinePkgHit] = useState(false) // 当前结果来自离线词典包
  const [cachedCount, setCachedCount] = useState(0)
  // 离线词典包状态
  const [dictPkg, setDictPkg] = useState<{ count: number } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [dlProgress, setDlProgress] = useState('')
  useEffect(() => {
    openDictDB().then(getDictMeta).then(setDictPkg).catch(() => {})
  }, [])

  // 下载离线词典包
  const downloadDictPkg = async () => {
    setDownloading(true)
    setDlProgress('下载中…')
    try {
      const res = await fetch('ecdict.mini.json')
      if (!res.ok) throw new Error('下载失败')
      setDlProgress('解析中…')
      const words = await res.json() as EcdictEntry[]
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
        tx.objectStore('meta').put({ k: 'ecdict', v: { count: words.length } })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      setDictPkg({ count: words.length })
      setToast(`离线词典下载完成，共 ${words.length} 词`)
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
    setDictSource(s)
    localStorage.setItem('linverse.dictSource', s)
  }

  // 加入生词本：取第一条中文释义
  const joinVocab = async () => {
    if (!result || !profileId) return
    if (all.some((v) => v.word.toLowerCase() === result.word.toLowerCase())) {
      setToast('已经在生词本里了')
      return
    }
    try {
      await addVocab({
        profileId,
        word: result.word,
        phonetic: result.phonetic,
        meaning: result.meanings[0]?.zh || '',
      })
      setToast('已加入生词本')
      loadVocab()
    } catch (e) {
      setToast(e instanceof Error ? e.message : '加入失败')
    }
  }

  // 复习反馈：懂 / 不懂
  const review = async (v: VocabWord, known: boolean) => {
    try {
      await reviewVocab(v.id, known)
      setDue((list) => list.filter((x) => x.id !== v.id))
      setRevealed((r) => ({ ...r, [v.id]: true }))
      if (due.length <= 1) setToast('今日复习完成')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '提交失败')
    }
  }

  // 每日打卡
  const doCheckin = async () => {
    if (!profileId) return
    try {
      await checkin(profileId)
      setCheckinDone(true)
      setToast('打卡成功')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '打卡失败')
    }
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
                onChange={(e) => setWord(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') search() }} />
            </div>
            <button className="btn" onClick={() => search()} disabled={searching}>查词</button>
          </div>
          {/* 词典三选一：在线词典（默认）/ 离线词典（断网备胎）/ AI 详解（联网、更详细） */}
          <div className="seg" style={{ marginTop: 10 }}>
            <button className={dictSource === 'dict' ? 'on' : ''} onClick={() => pickSource('dict')}>在线词典</button>
            <button className={dictSource === 'offline' ? 'on' : ''} onClick={() => pickSource('offline')}>离线词典</button>
            <button className={dictSource === 'ai' ? 'on' : ''} onClick={() => pickSource('ai')}>AI 详解</button>
          </div>
          {/* 离线词典包：下载一次，断网也能查 1.4 万常用词 */}
          {dictSource === 'offline' && (
            <div style={{ marginTop: 10 }}>
              {dictPkg ? (
                <div style={{ fontSize: 13, color: 'var(--ink2)' }}>
                  ✓ 离线词典包已下载（{dictPkg.count} 词，断网可用）
                </div>
              ) : (
                <button className="btn btn-ghost" style={{ width: '100%' }}
                  onClick={downloadDictPkg} disabled={downloading}>
                  {downloading ? (dlProgress || '下载中…') : '下载离线词典包（约 600K，一次下载断网可用）'}
                </button>
              )}
            </div>
          )}

          {searching && <Spin />}
          {result && !searching && (
            <div className="dict-card">
              <div className="dict-word">{result.word}
                {offlineHit && <span className="tag" style={{ marginLeft: 10, verticalAlign: 'middle' }}>离线缓存</span>}
                {offlinePkgHit && <span className="tag" style={{ marginLeft: 10, verticalAlign: 'middle' }}>离线词典</span>}
              </div>
              {result.phonetic && <div className="dict-phonetic">/{result.phonetic}/</div>}
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
                  <span>{m.zh}{m.en ? <span style={{ color: 'var(--ink3)', fontSize: 13 }}> · {m.en}</span> : null}</span>
                  {/* 每条释义下的例句（带中文翻译） */}
                  {m.examples && m.examples.map((e, j) => (
                    <div key={j} className="dict-ex" style={{ marginTop: 4 }}>
                      <div>{e.en}</div>
                      {e.zh && <div style={{ color: 'var(--ink2)', fontSize: 13 }}>{e.zh}</div>}
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
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 14 }} onClick={joinVocab}>
                加入生词本
              </button>
            </div>
          )}

          {history.length > 0 && (
            <>
              <div className="sec-title"><I n="clock" size={14} />查词历史</div>
              {history.slice(0, 20).map((h, i) => (
                <div key={i} className="hist-item" onClick={() => { setWord(h.word); search(h.word) }}>
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
              { n: '日汉词典', d: '日语 → 简体中文' },
              { n: '西汉词典', d: '西班牙语 → 简体中文' },
            ].map((p) => (
              <div key={p.n} className="dict-pack-row">
                <div>
                  <div className="dict-pack-name">{p.n}</div>
                  <div className="dict-pack-sub">{p.d}</div>
                </div>
                <span className="dict-pack-wait">词库待接入</span>
              </div>
            ))}
          </div>
        </>
      )}

      {sub === 'vocab' && (
        <>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" style={{ flex: 1 }} onClick={doCheckin} disabled={checkinDone}>
              {checkinDone ? '✓ 今日已打卡' : '每日打卡'}
            </button>
          </div>

          <div className="sec-title">到期复习（{due.length}）</div>
          {due.length === 0 ? (
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
                <button className="btn btn-line" onClick={() => review(v, false)}>不懂</button>
                <button className="btn" onClick={() => review(v, true)}>懂了</button>
              </div>
            </div>
          ))}

          {all.length > 0 && (
            <>
              <div className="sec-title">全部生词（{all.length}）</div>
              {all.map((v) => (
                <div key={v.id} className="hist-item">
                  <span><b>{v.word}</b> <span style={{ color: 'var(--ink2)', fontSize: 13 }}>{v.meaning}</span></span>
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
