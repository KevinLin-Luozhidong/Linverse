import { useEffect, useState } from 'react'
import { I, Toast, Spin, Empty, useToast } from '../components'
import { kbBooks, kbDeleteBook, kbBookChunks, type KbBook, type KbChunk } from '@api'

// 原书 PDF：随前端静态资源发布（/kb-pdfs/ 下），点书名展开后可在线查阅或下载。
// 书名 → 文件名映射：新书入库后把 PDF 放进 frontend/public/kb-pdfs/ 并在这里加一行。
const KB_PDF: Record<string, { file: string; size: string }> = {
  '人教A版高中数学必修第一册': { file: 'math-b1.pdf', size: '24.9MB' },
  '人教版高中生物学必修1 分子与细胞': { file: 'bio-b1.pdf', size: '18.9MB' },
  '人教版高中生物学必修2 遗传与进化': { file: 'bio-b2.pdf', size: '27.5MB' },
}

// 知识库管理页：查课本的数据来源一览
// 每本书一行：书名 / 知识块数（文字+图片）/ 入库时间 / 状态；删除需点两次确认
// 点书名展开详情：原书 PDF（在线查阅/下载）+ 按页码排序的知识块列表（加载更多分页）
// active prop：面板可见时为 true，隐藏时为 false；隐藏时清除 confirmDel 状态（B2）
export default function Kb({ active }: { active?: boolean }) {
  const [books, setBooks] = useState<KbBook[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmDel, setConfirmDel] = useState('') // 正在二次确认的书名
  const [deleting, setDeleting] = useState(false)
  const [toastMsg, toastKey, setToast] = useToast()
  // 展开的书详情：书名 / 已拉到的块 / 总数 / 拉取中 / 拉取失败 / 已展开全文的块 id
  const [expanded, setExpanded] = useState('')
  const [chunks, setChunks] = useState<KbChunk[]>([])
  const [chunksTotal, setChunksTotal] = useState(0)
  const [chunksLoading, setChunksLoading] = useState(false)
  const [chunksError, setChunksError] = useState('')
  const [fullTextIds, setFullTextIds] = useState<Set<number>>(new Set())

  const loadChunks = (book: string, offset: number) => {
    setChunksLoading(true); setChunksError('')
    kbBookChunks(book, 20, offset)
      .then((r) => {
        setChunksTotal(r.total)
        setChunks((v) => offset === 0 ? r.chunks : [...v, ...r.chunks])
      })
      .catch((e) => setChunksError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setChunksLoading(false))
  }
  const toggleExpand = (book: string) => {
    if (expanded === book) { setExpanded(''); return }
    setExpanded(book); setChunks([]); setChunksTotal(0); setFullTextIds(new Set())
    loadChunks(book, 0)
  }

  const reload = () => {
    setLoading(true)
    kbBooks()
      .then((r) => setBooks(r.books))
      .catch((e) => setToast(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  // B2: 面板隐藏时清除 confirmDel，防止切 tab 再回来时静默触发删除
  useEffect(() => {
    if (active === false) setConfirmDel('')
  }, [active])

  // I4: 点页面空白处取消二次确认态
  useEffect(() => {
    if (!confirmDel) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Element
      // 点删除按钮本身不取消（交给 onDelete 处理）
      if (target.closest('.kb-del-btn')) return
      setConfirmDel('')
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [confirmDel])

  const onDelete = async (book: string) => {
    if (confirmDel !== book) { setConfirmDel(book); return } // 第一次点：进入确认态
    setDeleting(true)
    try {
      const r = await kbDeleteBook(book)
      setToast(`已删除《${r.book}》，共 ${r.deleted} 个知识块`)
      setConfirmDel('')
      reload()
    } catch (e) {
      setToast(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  // 日期按用户本地时区显示：之前强制用 UTC，半夜入库的书会差一天
  const fmtDate = (s: string | null) => {
    if (!s) return '—'
    const d = new Date(s)
    const y = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const da = String(d.getDate()).padStart(2, '0')
    return `${y}-${mo}-${da}`
  }

  if (loading) return <Spin />
  return (
    <div className="kb-page">
      {/* 页面头部 */}
      <div className="kb-header">
        <div className="kb-header-icon">
          <I n="db" size={22} />
        </div>
        <div>
          <h2 className="kb-header-title">知识库</h2>
          <p className="kb-header-sub">AI「查课本」的数据来源</p>
        </div>
        <div className="kb-header-count">
          <span className="kb-count-num">{books.length}</span>
          <span className="kb-count-label">本书</span>
        </div>
      </div>

      {/* 统计条 */}
      {books.length > 0 && (
        <div className="kb-stats-bar">
          <div className="kb-stat">
            <span className="kb-stat-num">
              {books.reduce((s, b) => s + b.chunks, 0).toLocaleString()}
            </span>
            <span className="kb-stat-label">知识块</span>
          </div>
          <div className="kb-stat-divider" />
          <div className="kb-stat">
            <span className="kb-stat-num">
              {books.reduce((s, b) => s + b.text_chunks, 0).toLocaleString()}
            </span>
            <span className="kb-stat-label">文字块</span>
          </div>
          <div className="kb-stat-divider" />
          <div className="kb-stat">
            <span className="kb-stat-num">
              {books.reduce((s, b) => s + b.fig_chunks, 0).toLocaleString()}
            </span>
            <span className="kb-stat-label">图片块</span>
          </div>
        </div>
      )}

      {/* 书目列表 */}
      {books.length === 0
        ? <Empty text="还没有入库的书，把 PDF 发给助手即可入库" />
        : (
          <div className="kb-list">
            {books.map((b, i) => (
              <div key={b.book}>
              <div className="kb-item" style={{ animationDelay: `${i * 40}ms`, cursor: 'pointer' }}
                onClick={() => toggleExpand(b.book)}>
                {/* 左侧序号 */}
                <div className="kb-item-idx">{i + 1}</div>

                {/* 图书图标 */}
                <div className="kb-item-icon">
                  <I n="book" size={20} />
                </div>

                {/* 书名与元信息 */}
                <div className="kb-item-info">
                  <div className="kb-item-title">《{b.book}》{expanded === b.book ? ' ▾' : ' ▸'}</div>
                  <div className="kb-item-meta">
                    <span className="kb-badge kb-badge-blue">{b.text_chunks} 文字</span>
                    <span className="kb-badge kb-badge-purple">{b.fig_chunks} 图片</span>
                    <span className="kb-item-date">{fmtDate(b.first_ingest)}</span>
                  </div>
                </div>

                {/* 删除按钮（点它不触发展开） */}
                <button
                  className={'kb-del-btn' + (confirmDel === b.book ? ' confirm' : '')}
                  disabled={deleting}
                  onClick={(e) => { e.stopPropagation(); onDelete(b.book) }}
                  aria-label={confirmDel === b.book ? '再次点击确认删除' : `删除《${b.book}》`}
                >
                  {deleting && confirmDel === b.book
                    ? <span className="kb-del-spin" />
                    : confirmDel === b.book
                    ? <><I n="trash" size={14} /><span>确认删除</span></>
                    : <I n="trash" size={16} />}
                </button>
              </div>

              {/* 展开详情：原书 PDF + 按页码排序的知识块 */}
              {expanded === b.book && (
                <div className="kb-detail">
                  {KB_PDF[b.book] ? (
                    <div className="kb-pdf-row">
                      <span className="kb-pdf-name">原书 PDF · {KB_PDF[b.book].size}</span>
                      <a className="mini-btn" href={`/kb-pdfs/${KB_PDF[b.book].file}`} target="_blank" rel="noreferrer">
                        在线查阅
                      </a>
                      <a className="mini-btn" href={`/kb-pdfs/${KB_PDF[b.book].file}`} download={KB_PDF[b.book].file}>
                        下载
                      </a>
                    </div>
                  ) : (
                    <div className="kb-pdf-row" style={{ color: 'var(--ink3)' }}>该书暂无原书 PDF</div>
                  )}
                  {chunksLoading && chunks.length === 0 && <Spin />}
                  {chunksError && <div style={{ color: 'var(--red)', fontSize: 13 }}>{chunksError}</div>}
                  {chunks.map((c) => {
                    const isFig = c.text.startsWith('【教材插图】')
                    const full = fullTextIds.has(c.id)
                    const shown = full || c.text.length <= 160 ? c.text : c.text.slice(0, 160) + '…'
                    return (
                      <div key={c.id} className="kb-chunk">
                        <div className="kb-chunk-head">
                          <span className="kb-badge kb-badge-blue">{c.section || c.chapter || '未分节'}</span>
                          <span className="kb-item-date">第 {c.page_start}–{c.page_end} 页</span>
                          {isFig && <span className="kb-badge kb-badge-purple">插图</span>}
                        </div>
                        <div className="kb-chunk-text">{shown}</div>
                        {c.text.length > 160 && (
                          <button className="mini-btn" onClick={() => setFullTextIds((v) => {
                            const n = new Set(v)
                            if (n.has(c.id)) n.delete(c.id); else n.add(c.id)
                            return n
                          })}>
                            {full ? '收起' : '展开全文'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {chunks.length > 0 && chunks.length < chunksTotal && (
                    <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }}
                      disabled={chunksLoading} onClick={() => loadChunks(b.book, chunks.length)}>
                      {chunksLoading ? '加载中…' : `加载更多（已显示 ${chunks.length}/${chunksTotal}）`}
                    </button>
                  )}
                  {!chunksLoading && chunks.length === 0 && !chunksError && (
                    <Empty text="这本书还没有知识块" />
                  )}
                </div>
              )}
              </div>
            ))}
          </div>
        )
      }

      {/* 底部提示 */}
      <div className="kb-footer-tip">
        <I n="info" size={14} />
        <span>想加新书？把教辅 PDF 发给助手，入库后这里自动更新</span>
      </div>

      <Toast msg={toastMsg} tkey={toastKey} />
    </div>
  )
}
