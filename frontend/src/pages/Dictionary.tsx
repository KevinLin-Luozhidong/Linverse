import { useEffect, useState } from 'react'
import { I, Toast, Spin, Empty } from '../components'
import {
  lookupWord, getWordHistory, listVocab, addVocab, reviewVocab,
  dueVocab, checkin, getAiKey, type DictResult, type DictSource, type VocabWord,
} from '@api'

// 词典页：查词 / 生词本两个子板块
// 生词本支持到期复习（遮住释义自测，懂/不懂反馈）和每日打卡

type Sub = 'dict' | 'vocab'

export default function Dictionary({ profileId }: { profileId: string | null }) {
  const [sub, setSub] = useState<Sub>('dict')
  const [word, setWord] = useState('')
  const [result, setResult] = useState<DictResult | null>(null)
  const [searching, setSearching] = useState(false)
  // 词典接口：dict = 免费默认词典（快、不用 Key），ai = AI 详解（用你配的 AI，中英文都行）
  const [dictSource, setDictSource] = useState<DictSource>(() =>
    (localStorage.getItem('linverse.dictSource') as DictSource) || 'dict')
  const [history, setHistory] = useState<{ word: string; createdAt: string }[]>([])
  const [toast, setToast] = useState('')

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
    try {
      const r = await lookupWord(target, dictSource, dictSource === 'ai' ? {
        aiKey: getAiKey() || undefined,
        model: localStorage.getItem('linverse.model') || 'demo',
        profileId: profileId || undefined,
      } : { profileId: profileId || undefined })
      setResult(r)
      setOfflineHit(false)
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
        setToast('')
      } else {
        setToast(e instanceof Error ? e.message : '查词失败')
      }
    } finally {
      setSearching(false)
    }
  }
  const [offlineHit, setOfflineHit] = useState(false) // 当前结果来自离线缓存
  const [cachedCount, setCachedCount] = useState(0)
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
          {/* 词典接口切换：默认词典（快、免费）/ AI 详解（用你配的 AI，中英文、成语都能讲） */}
          <div className="seg" style={{ marginTop: 10 }}>
            <button className={dictSource === 'dict' ? 'on' : ''} onClick={() => pickSource('dict')}>默认词典</button>
            <button className={dictSource === 'ai' ? 'on' : ''} onClick={() => pickSource('ai')}>AI 详解</button>
          </div>

          {searching && <Spin />}
          {result && !searching && (
            <div className="dict-card">
              <div className="dict-word">{result.word}
                {offlineHit && <span className="tag" style={{ marginLeft: 10, verticalAlign: 'middle' }}>离线缓存</span>}
              </div>
              {result.phonetic && <div className="dict-phonetic">/{result.phonetic}/</div>}
              {result.meanings.map((m, i) => (
                <div key={i} className="dict-meaning">
                  <span className="dict-pos">{m.pos}</span>
                  <span>{m.zh}{m.en ? <span style={{ color: 'var(--ink3)', fontSize: 13 }}> · {m.en}</span> : null}</span>
                </div>
              ))}
              {result.examples.length > 0 && (
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
      <Toast msg={toast} />
    </div>
  )
}
