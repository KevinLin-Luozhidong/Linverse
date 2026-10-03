import { useEffect, useRef, useState } from 'react'
import { I, Toast, Spin, Empty, Sheet, useToast} from '../components'
import Cropper from '../Cropper'
import {
  listNotes, createNote, updateNote, deleteNote,
  uploadImage, imgSrc, type Note,
} from '@api'

// 笔记本：新建 / 编辑 / 删除（二次确认）/ 插图 / 标签 / 背景色 / 置顶 / 归档 / 搜索 / 列表网格切换

const COLORS = ['#ffffff', '#e8f1fd', '#e6f9ed', '#fff7e0', '#fde8f0', '#efe8fd']

const blank = (profileId: string): Omit<Note, 'id'> => ({
  profileId, title: '', content: '', images: [], tags: [], color: '#ffffff', pinned: false,
})

export default function Notes({ profileId }: { profileId: string | null }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [grid, setGrid] = useState(true)
  const [editing, setEditing] = useState<Omit<Note, 'id'> & { id?: string } | null>(null)
  const [cropSrc, setCropSrc] = useState('') // 裁剪中的图片
  const [tagInput, setTagInput] = useState('') // 编辑中的标签输入
  const [toastMsg, toastKey, setToast] = useToast()
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false) // 保存中：防连点重复提交
  const [delId, setDelId] = useState('') // 二次确认删除
  // 批量选择模式
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const searchTimer = useRef<number>(0)

  const reload = (qq = q, tt = tag, arch = showArchived) => {
    if (!profileId) { setLoading(false); return }
    listNotes(profileId, qq, tt, arch ? '1' : '')
      .then(setNotes)
      .catch((e) => setToast(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { reload('', '', false) }, [profileId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 搜索防抖：输入停 400ms 后再请求
  const onSearch = (v: string) => {
    setQ(v)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => reload(v, tag, showArchived), 400)
  }

  const allTags = [...new Set(notes.flatMap((n) => n.tags || []))]

  const openEdit = (n?: Note) => {
    setEditing(n ? { ...n } : profileId ? blank(profileId) : null)
    setTagInput(n ? (n.tags || []).join(' ') : '')
  }

  const save = async () => {
    if (!editing || !profileId || saving) return
    if (!editing.title.trim() && !editing.content.trim()) {
      setToast('标题和内容至少填一项')
      return
    }
    setSaving(true)
    const tags = tagInput.split(/[\s,，]+/).map((t) => t.trim()).filter(Boolean)
    try {
      if (editing.id) {
        const { id, ...rest } = editing
        await updateNote(id, { ...rest, tags }, profileId || undefined)
      } else {
        await createNote({ ...editing, profileId, tags })
      }
      setEditing(null)
      reload()
      setToast('已保存')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const onFile = async (f: File | undefined) => {
    if (!f || !editing) return
    if (fileRef.current) fileRef.current.value = ''
    setCropSrc(URL.createObjectURL(f))
  }
  const onCropDone = async (blob: Blob) => {
    const url = cropSrc
    setCropSrc('')
    if (url) URL.revokeObjectURL(url)
    if (!editing) return
    setUploading(true)
    try {
      const upUrl = await uploadImage(new File([blob], 'crop.jpg', { type: 'image/jpeg' }))
      setEditing((e) => e ? { ...e, images: [...(e.images || []), upUrl] } : e)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }
  const onCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc('')
  }

  const [deleting, setDeleting] = useState(false)
  const remove = async (id: string) => {
    if (deleting) return
    setDeleting(true)
    try {
      await deleteNote(id, profileId || undefined)
      setDelId('')
      setEditing(null)
      reload()
      setToast('已删除')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '删除失败')
    } finally { setDeleting(false) }
  }

  // 批量删除选中：逐个删，成功的从选中集合剔除，失败的留下可重试
  const batchRemove = async () => {
    if (selected.size === 0 || batchDeleting) return
    setBatchDeleting(true)
    const ids = [...selected]
    const failed: string[] = []
    for (const id of ids) {
      try {
        await deleteNote(id, profileId || undefined)
      } catch {
        failed.push(id)
      }
    }
    const okCount = ids.length - failed.length
    setSelected(new Set(failed))
    if (failed.length === 0) {
      setSelectMode(false)
      setToast(`已删除 ${okCount} 条`)
    } else {
      setToast(`删除 ${okCount} 条，${failed.length} 条失败可重试`)
    }
    reload()
    setBatchDeleting(false)
  }

  // 批量归档选中
  const batchArchive = async () => {
    if (selected.size === 0 || batchDeleting) return
    setBatchDeleting(true)
    try {
      for (const id of selected) {
        const n = notes.find((x) => x.id === id)
        if (n) await updateNote(id, { archived: true }, profileId || undefined)
      }
      setToast(`已归档 ${selected.size} 条`)
      setSelected(new Set())
      setSelectMode(false)
      reload()
    } catch (e) {
      setToast(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBatchDeleting(false)
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const togglePin = async (n: Note) => {
    try {
      await updateNote(n.id, { pinned: !n.pinned }, profileId || undefined)
      reload()
    } catch (e) {
      setToast(e instanceof Error ? e.message : '更新失败')
    }
  }

  const toggleArchive = async (n: Note) => {
    try {
      await updateNote(n.id, { archived: !n.archived }, profileId || undefined)
      reload()
    } catch (e) {
      setToast(e instanceof Error ? e.message : '更新失败')
    }
  }

  // 置顶排前面
  const shown = [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned))
  const ed = editing

  return (
    <div className="notes-sec">
      <div className="work-head">
        <div className="work-kicker">学习工具</div>
        <div className="work-title">笔记本</div>
        <div className="work-desc">把课堂重点留下来，复习时一目了然</div>
      </div>
      <div className="toolbar-row" style={{ padding: '10px 0 0' }}>
        <div className="search-box">
          <I n="search" size={18} />
          <input className="input" value={q} placeholder="搜索笔记"
            onChange={(e) => onSearch(e.target.value)} />
        </div>
        <button className="icon-btn" onClick={() => setGrid(!grid)} aria-label="切换视图">
          <I n={grid ? 'card' : 'grid'} />
        </button>
        <button className={'mini-chip' + (showArchived ? ' active' : '')}
          onClick={() => { const v = !showArchived; setShowArchived(v); reload(q, tag, v) }}>
          <I n="archive" size={15} />归档
        </button>
        <button className={'mini-chip' + (selectMode ? ' active' : '')}
          onClick={() => { setSelectMode(!selectMode); setSelected(new Set()) }}>
          {selectMode ? '取消选择' : '批量选择'}
        </button>
      </div>

      {allTags.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 0 0' }}>
          <button className={'mini-chip' + (!tag ? ' active' : '')}
            onClick={() => { setTag(''); reload(q, '', showArchived) }}>全部</button>
          {allTags.map((t) => (
            <button key={t} className={'mini-chip' + (tag === t ? ' active' : '')}
              onClick={() => { const v = tag === t ? '' : t; setTag(v); reload(q, v, showArchived) }}>
              {t}
            </button>
          ))}
        </div>
      )}

      {loading ? <Spin /> : shown.length === 0 ? (
        <Empty text={showArchived ? '归档箱是空的' : '还没有笔记，点右下角写一条'} />
      ) : (
        <div className={grid ? 'notes-grid' : ''} style={{ marginTop: 12, display: grid ? undefined : 'grid', gap: 10 }}>
          {shown.map((n) => (
            <div key={n.id} className={'note-card' + (grid ? '' : ' list') + (selected.has(n.id!) ? ' selected' : '')}
              style={{ background: n.color || undefined }}
              onClick={() => selectMode ? toggleSelect(n.id!) : openEdit(n)}>
              {selectMode && (
                <div className="note-check" style={{
                  position: 'absolute', top: 8, right: 8, width: 24, height: 24,
                  borderRadius: '50%', border: '2px solid var(--blue)',
                  background: selected.has(n.id!) ? 'var(--blue)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 14, fontWeight: 700,
                }}>
                  {selected.has(n.id!) ? '✓' : ''}
                </div>
              )}
              <div className="note-title">
                {!!n.pinned && <span className="pin-flag"><I n="pin" size={14} /></span>}
                {n.title || '无标题'}
              </div>
              <div className="note-content">{n.content}</div>
              {(n.tags || []).map((t) => <span key={t} className="tag">{t}</span>)}
            </div>
          ))}
        </div>
      )}

      {/* 批量操作栏 */}
      {selectMode && (
        <div style={{
          position: 'fixed', bottom: 'calc(76px + env(safe-area-inset-bottom))',
          left: 16, right: 16, zIndex: 40,
          background: 'var(--card)', border: '1px solid var(--line)',
          borderRadius: 16, padding: '10px 12px',
          display: 'flex', gap: 8, alignItems: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        }}>
          <span style={{ fontSize: 13, color: 'var(--ink2)', flex: 1 }}>
            已选 {selected.size} 条
          </span>
          <button className="mini-chip" onClick={() => {
            if (selected.size === shown.length) setSelected(new Set())
            else setSelected(new Set(shown.map((n) => n.id!)))
          }}>
            {selected.size === shown.length ? '全不选' : '全选'}
          </button>
          <button className="mini-chip" onClick={batchArchive} disabled={selected.size === 0 || batchDeleting}>
            归档
          </button>
          <button className="mini-btn" style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
            onClick={batchRemove} disabled={selected.size === 0 || batchDeleting}>
            {batchDeleting ? '删除中…' : `删除(${selected.size})`}
          </button>
        </div>
      )}

      {!selectMode && (
        <button className="fab" aria-label="新建笔记" onClick={() => openEdit()}>
          <I n="plus" size={26} />
        </button>
      )}

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => onFile(e.target.files?.[0])} />
      <Sheet open={!!ed} onClose={() => setEditing(null)} title={ed?.id ? '编辑笔记' : '新建笔记'}>
        {ed && (
          <>
            <div className="field">
              <input className="input" value={ed.title} placeholder="标题"
                onChange={(e) => setEditing({ ...ed, title: e.target.value })} />
            </div>
            <div className="field">
              <textarea className="textarea" style={{ minHeight: 140 }} value={ed.content}
                placeholder="写下知识点…"
                onChange={(e) => setEditing({ ...ed, content: e.target.value })} />
            </div>
            <div className="field">
              <div className="field-label">插图</div>
              <div className="img-row">
                {(ed.images || []).map((u, i) => (
                  <div key={i} className="img-thumb">
                    <img src={imgSrc(u)} alt="笔记插图" />
                    <button onClick={() => setEditing({ ...ed, images: ed.images.filter((_, j) => j !== i) })}>×</button>
                  </div>
                ))}
                <button className="upload-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Spin /> : <><I n="image" size={22} />添加</>}
                </button>
              </div>
            </div>
            <div className="field">
              <div className="field-label">标签（空格分隔）</div>
              <input className="input" value={tagInput} placeholder="比如 物理 力学"
                onChange={(e) => setTagInput(e.target.value)} />
            </div>
            <div className="field">
              <div className="field-label">背景颜色</div>
              <div className="color-dots">
                {COLORS.map((c) => (
                  <button key={c} className={'color-dot' + (ed.color === c ? ' on' : '')}
                    style={{ background: c }} aria-label="选择颜色"
                    onClick={() => setEditing({ ...ed, color: c })} />
                ))}
              </div>
            </div>
            <div className="set-row">
              <span className="sr-label">置顶</span>
              <button className={'mini-chip' + (ed.pinned ? ' active' : '')}
                onClick={() => setEditing({ ...ed, pinned: !ed.pinned })}>
                {ed.pinned ? '✓ 已置顶' : '未置顶'}
              </button>
            </div>
            {ed.id && (
              <div className="btn-row" style={{ marginBottom: 10 }}>
                <button className="btn btn-ghost" style={{ flex: 1 }}
                  onClick={() => { togglePin({ ...ed, id: ed.id! } as Note); setEditing(null) }}>
                  {ed.pinned ? '取消置顶' : '置顶'}
                </button>
                <button className="btn btn-ghost" style={{ flex: 1 }}
                  onClick={() => { toggleArchive({ ...ed, id: ed.id! } as Note); setEditing(null) }}>
                  {ed.archived ? '移出归档' : '归档'}
                </button>
                {delId === ed.id
                  ? <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => remove(ed.id!)}>确认删除</button>
                  : <button className="btn btn-line" style={{ flex: 1, borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => setDelId(ed.id!)}>删除</button>}
              </div>
            )}
            <button className="btn" style={{ width: '100%' }} onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
          </>
        )}
      </Sheet>
      <Toast msg={toastMsg} tkey={toastKey} />
      {cropSrc && (
        <Cropper src={cropSrc} onDone={onCropDone} onCancel={onCropCancel} />
      )}
    </div>
  )
}
