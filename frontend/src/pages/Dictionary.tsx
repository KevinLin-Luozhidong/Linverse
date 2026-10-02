import { useEffect, useState } from 'react'
import { I, Toast, Spin, Empty } from '../components'
import {
  lookupWord, getWordHistory, listVocab, addVocab, reviewVocab,
  dueVocab, checkin, type DictResult, type VocabWord,
} from '@api'

// 词典页：查词 / 生词本两个子板块
// 生词本支持到期复习（遮住释义自测，懂/不懂反馈）和每日打卡

type Sub = 'dict' | 'vocab'

export default function Dictionary({ profileId }: { profileId: string | null }) {
  const [sub, setSub] = useState<Sub>('dict')
  const [word, setWord] = useState('')
  const [result, setResult] = useState<DictResult | null>(null)
  const [searching, setSearching] = useState(false)
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
    try {
      const r = await lookupWord(target)
      setResult(r)
      loadHistory()
    } catch (e) {
      setToast(e instanceof Error ? e.message : '查词失败')
    } finally {
      setSearching(false)
    }
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

          {searching && <Spin />}
          {result && !searching && (
            <div className="dict-card">
              <div className="dict-word">{result.word}</div>
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
