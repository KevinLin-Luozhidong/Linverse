import { useEffect, useState } from 'react'
import { I, Toast, Spin, Empty, useToast } from '../components'
import { kbBooks, kbDeleteBook, type KbBook } from '@api'

// 知识库管理页：查课本的数据来源一览
// 每本书一行：书名 / 知识块数（文字+图片）/ 入库时间 / 状态；删除需点两次确认
export default function Kb() {
  const [books, setBooks] = useState<KbBook[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmDel, setConfirmDel] = useState('') // 正在二次确认的书名
  const [deleting, setDeleting] = useState(false)
  const [toastMsg, toastKey, setToast] = useToast()

  const reload = () => {
    setLoading(true)
    kbBooks()
      .then((r) => setBooks(r.books))
      .catch((e) => setToast(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

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

  const fmtDate = (s: string | null) => {
    if (!s) return '—'
    const d = new Date(s)
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  }

  if (loading) return <Spin />
  return (
    <div className="kb-page">
      <div className="kb-head">
        <h3>知识库</h3>
        <p>AI「查课本」的数据来源，一本书就是一行</p>
      </div>
      {books.length === 0 && <Empty text="还没有入库的书，把 PDF 发给助手即可入库" />}
      {books.map((b) => (
        <div key={b.book} className="kb-card">
          <span className="sq-icon purple"><I n="book" size={26} /></span>
          <div className="kb-info">
            <h4>《{b.book}》</h4>
            <p>{b.chunks} 个知识块（文字 {b.text_chunks} · 图片 {b.fig_chunks}）</p>
            <p className="dim">入库于 {fmtDate(b.first_ingest)} · 状态正常</p>
          </div>
          <button
            className={'btn ' + (confirmDel === b.book ? 'btn-danger' : 'btn-ghost')}
            disabled={deleting}
            onClick={() => onDelete(b.book)}>
            {deleting && confirmDel === b.book ? '删除中…'
              : confirmDel === b.book ? '再点一次确认删除'
              : '删除'}
          </button>
        </div>
      ))}
      <p className="kb-tip">想加新书？把教辅 PDF 发给助手，入库后这里会出现新的一行</p>
      <Toast msg={toastMsg} tkey={toastKey} />
    </div>
  )
}
