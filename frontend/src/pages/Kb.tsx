import { useEffect, useRef, useState } from 'react'
import { I, Toast, Spin, Empty, useToast } from '../components'
import { kbBooks, kbDeleteBook, type KbBook } from '@api'

// 知识库管理页：查课本的数据来源一览
// 每本书一行：书名 / 知识块数（文字+图片）/ 入库时间 / 状态；删除需点两次确认
// active prop：面板可见时为 true，隐藏时为 false；隐藏时清除 confirmDel 状态（B2）
export default function Kb({ active }: { active?: boolean }) {
  const [books, setBooks] = useState<KbBook[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmDel, setConfirmDel] = useState('') // 正在二次确认的书名
  const [deleting, setDeleting] = useState(false)
  const [toastMsg, toastKey, setToast] = useToast()
  const pageRef = useRef<HTMLDivElement>(null)

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

  // B9: 使用 UTC 时间避免本地时区导致日期偏差
  const fmtDate = (s: string | null) => {
    if (!s) return '—'
    return new Date(s).toISOString().slice(0, 10)
  }

  if (loading) return <Spin />
  return (
    <div className="kb-page" ref={pageRef}>
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
              <div key={b.book} className="kb-item" style={{ animationDelay: `${i * 40}ms` }}>
                {/* 左侧序号 */}
                <div className="kb-item-idx">{i + 1}</div>

                {/* 图书图标 */}
                <div className="kb-item-icon">
                  <I n="book" size={20} />
                </div>

                {/* 书名与元信息 */}
                <div className="kb-item-info">
                  <div className="kb-item-title">《{b.book}》</div>
                  <div className="kb-item-meta">
                    <span className="kb-badge kb-badge-blue">{b.text_chunks} 文字</span>
                    <span className="kb-badge kb-badge-purple">{b.fig_chunks} 图片</span>
                    <span className="kb-item-date">{fmtDate(b.first_ingest)}</span>
                  </div>
                </div>

                {/* 删除按钮 */}
                <button
                  className={'kb-del-btn' + (confirmDel === b.book ? ' confirm' : '')}
                  disabled={deleting}
                  onClick={() => onDelete(b.book)}
                  aria-label={confirmDel === b.book ? '再次点击确认删除' : `删除《${b.book}》`}
                >
                  {deleting && confirmDel === b.book
                    ? <span className="kb-del-spin" />
                    : confirmDel === b.book
                    ? <><I n="trash" size={14} /><span>确认删除</span></>
                    : <I n="trash" size={16} />}
                </button>
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
