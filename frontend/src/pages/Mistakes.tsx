import { useEffect, useRef, useState } from 'react'
import { I, Toast, Spin, Empty, Sheet } from '../components'
import Cropper from '../Cropper'
import {
  listMistakes, createMistake, updateMistake, deleteMistake,
  uploadImage, ocr, imgSrc, getAiKey, type Mistake,
} from '@api'

// 错题本：默认按科目排列，可切换排序
// 题目保留原图展示，不强制转文字；OCR 只是可选的辅助填入

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治']
type Sort = 'subject' | 'time' | 'timeAsc' | 'unmastered'
// 排序选项（收进一个下拉按钮，不平铺）

// 空表单默认值
const blank = (profileId: string): Omit<Mistake, 'id'> => ({
  profileId, subject: '数学', questionText: '', questionImageUrl: '',
  answerText: '', answerImageUrl: '', reason: '', mastered: false,
})

export default function Mistakes({ profileId }: { profileId: string | null }) {
  const [list, setList] = useState<Mistake[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<Sort>('subject')
  const [sortOpen, setSortOpen] = useState(false) // 排序下拉菜单
  const SORTS: { v: Sort; label: string }[] = [
    { v: 'subject', label: '按科目' },
    { v: 'time', label: '最新录入' },
    { v: 'timeAsc', label: '最早录入' },
    { v: 'unmastered', label: '未掌握优先' },
  ]
  const [editing, setEditing] = useState<Omit<Mistake, 'id'> & { id?: string } | null>(null)
  const [toast, setToast] = useState('')
  const [ocrBusy, setOcrBusy] = useState(false)
  const [uploading, setUploading] = useState<'q' | 'a' | ''>('') // 正在上传哪张图
  const [delId, setDelId] = useState('') // 二次确认删除
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileTarget, setFileTarget] = useState<'q' | 'a'>('q')
  const [cropSrc, setCropSrc] = useState('') // 裁剪中的图片本地地址，有值就弹出裁剪器

  const reload = () => {
    if (!profileId) { setLoading(false); return }
    setLoading(true)
    listMistakes(profileId)
      .then(setList)
      .catch((e) => setToast(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { reload() }, [profileId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 排序：科目分组 / 最新录入（后端默认倒序）/ 最早录入 / 未掌握优先
  const sorted = [...list].sort((a, b) => {
    if (sort === 'time' || sort === 'timeAsc') return 0 // 后端默认即时间倒序
    if (sort === 'unmastered') return Number(a.mastered) - Number(b.mastered)
    return a.subject.localeCompare(b.subject, 'zh')
  })
  if (sort === 'timeAsc') sorted.reverse() // 最早录入：把后端的倒序翻过来

  // 分组渲染（按科目排序时加分组标题）
  const groups: { title: string; items: Mistake[] }[] = []
  if (sort === 'subject') {
    for (const m of sorted) {
      const g = groups.find((x) => x.title === m.subject)
      if (g) g.items.push(m)
      else groups.push({ title: m.subject, items: [m] })
    }
  } else {
    groups.push({ title: '', items: sorted })
  }

  // 保存（新建或编辑）
  const save = async () => {
    if (!editing || !profileId) return
    if (!editing.questionText.trim() && !editing.questionImageUrl) {
      setToast('题目文字和图片至少填一项')
      return
    }
    try {
      if (editing.id) {
        const { id, ...rest } = editing
        await updateMistake(id, rest)
      } else {
        await createMistake({ ...editing, profileId })
      }
      setEditing(null)
      reload()
      setToast('已保存')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '保存失败')
    }
  }

  // 上传图片：题目图 / 答案图
  const pickImage = (target: 'q' | 'a') => {
    setFileTarget(target)
    fileRef.current?.click()
  }
  // 选图后先裁剪：不直接上传，弹出裁剪器让用户框出题目区域
  const onFile = (f: File | undefined) => {
    if (!f || !editing) return
    if (fileRef.current) fileRef.current.value = ''
    const url = URL.createObjectURL(f)
    setCropSrc(url)
  }
  // 裁剪完成（或直接使用原图）：走原来的上传流程
  const onCropDone = async (blob: Blob) => {
    const url = cropSrc
    setCropSrc('')
    if (url) URL.revokeObjectURL(url)
    if (!editing) return
    setUploading(fileTarget)
    try {
      const upUrl = await uploadImage(new File([blob], 'crop.jpg', { type: 'image/jpeg' }))
      setEditing((e) => e ? {
        ...e,
        ...(fileTarget === 'q' ? { questionImageUrl: upUrl } : { answerImageUrl: upUrl }),
      } : e)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '上传失败')
    } finally {
      setUploading('')
    }
  }
  const onCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc('')
  }

  // OCR 识别题目图文字，自动填入题目输入框
  const doOcr = async () => {
    if (!editing?.questionImageUrl) return
    // 没配 Key 直接明说，不调接口也不装作"识别完成"
    if (!getAiKey()) { setToast('先去个人中心-设置里填写 AI Key'); return }
    setOcrBusy(true)
    try {
      const r = await ocr(editing.questionImageUrl)
      // 后端无 Key 或识别失败会带 error 字段；以前没检查，空文本也报"识别完成"，这就是"读不出来"的根因
      if (r.error || !r.text.trim()) {
        setToast(r.error || '没识别出文字，换张更清晰的图试试')
        return
      }
      setEditing((e) => e ? { ...e, questionText: e.questionText ? e.questionText + '\n' + r.text : r.text } : e)
      setToast('识别完成')
    } catch (e) {
      setToast(e instanceof Error ? e.message : '识别失败')
    } finally {
      setOcrBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (delId !== id) { setDelId(id); return }
    try {
      await deleteMistake(id)
      setDelId('')
      reload()
    } catch (e) {
      setToast(e instanceof Error ? e.message : '删除失败')
    }
  }

  const toggleMastered = async (m: Mistake) => {
    try {
      await updateMistake(m.id, { mastered: !m.mastered })
      setList((v) => v.map((x) => x.id === m.id ? { ...x, mastered: !x.mastered } : x))
    } catch (e) {
      setToast(e instanceof Error ? e.message : '更新失败')
    }
  }

  const ed = editing // 表单编辑中的数据

  return (
    <div className="mistake-sec">
      <div className="work-head">
        <div className="work-kicker">学习工具</div>
        <div className="work-title">错题本</div>
        <div className="work-desc">每次弄清一个错误，就离真正掌握更近一步</div>
      </div>
      <div className="toolbar-row" style={{ padding: '10px 0 0' }}>
        {/* 排序收进一个下拉按钮：点一下展开选，不平铺占地方 */}
        <div style={{ position: 'relative' }}>
          <button className="btn btn-ghost" onClick={() => setSortOpen(!sortOpen)} aria-label="排序方式">
            {SORTS.find((s) => s.v === sort)?.label}
            <I n="chev" size={14} />
          </button>
          {sortOpen && (
            <>
              <div className="drop-mask" onClick={() => setSortOpen(false)} />
              <div className="drop-menu">
                {SORTS.map((o) => (
                  <button key={o.v} className={sort === o.v ? 'on' : ''}
                    onClick={() => { setSort(o.v); setSortOpen(false) }}>
                    {sort === o.v ? <I n="check" size={16} /> : <span style={{ width: 16 }} />}
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {loading ? <Spin /> : list.length === 0 ? (
        <Empty text="还没有错题，点右下角开始收录" />
      ) : groups.map((g) => (
        <div key={g.title || 'all'}>
          {g.title && <div className="sec-title">{g.title}</div>}
          {g.items.map((m) => (
            <div key={m.id} className="m-card">
              <span className="m-subject">{m.subject}</span>
              {!!m.mastered && <span className="mastered-tag" style={{ marginLeft: 8 }}><I n="check" size={14} />已掌握</span>}
              {m.questionImageUrl && <img className="m-img" src={imgSrc(m.questionImageUrl)} alt="题目原图" />}
              {m.questionText && <div className="m-q">{m.questionText}</div>}
              {m.answerImageUrl && <img className="m-img" src={imgSrc(m.answerImageUrl)} alt="答案图" />}
              {m.answerText && <div className="m-a">答案：{m.answerText}</div>}
              {m.reason && <div className="m-reason">错因：{m.reason}</div>}
              <div className="m-foot">
                <button className="mini-btn" onClick={() => toggleMastered(m)}>
                  {m.mastered ? '标为未掌握' : '标为已掌握'}
                </button>
                <button className="mini-btn" onClick={() => setEditing({ ...m })}>编辑</button>
                {delId === m.id
                  ? <button className="mini-btn" style={{ color: 'var(--red)' }} onClick={() => remove(m.id)}>确认删除</button>
                  : <button className="mini-btn" style={{ color: 'var(--ink3)' }} onClick={() => remove(m.id)}>删除</button>}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* 新建按钮 */}
      <button className="fab" aria-label="新建错题"
        onClick={() => profileId && setEditing(blank(profileId))}>
        <I n="plus" size={26} />
      </button>

      {/* 新建 / 编辑表单 */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
      <Sheet open={!!ed} onClose={() => setEditing(null)} title={ed?.id ? '编辑错题' : '新建错题'}>
        {ed && (
          <>
            <div className="field">
              <div className="field-label">科目</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {SUBJECTS.map((s) => (
                  <button key={s} className={'mini-chip' + (ed.subject === s ? ' active' : '')}
                    onClick={() => setEditing({ ...ed, subject: s })}>{s}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <div className="field-label">题目原图（保留原图展示）</div>
              <div className="img-row">
                {ed.questionImageUrl && (
                  <div className="img-thumb">
                    <img src={imgSrc(ed.questionImageUrl)} alt="题目图" />
                    <button onClick={() => setEditing({ ...ed, questionImageUrl: '' })}>×</button>
                  </div>
                )}
                <button className="upload-btn" onClick={() => pickImage('q')} disabled={uploading === 'q'}>
                  {uploading === 'q' ? <Spin /> : <><I n="camera" size={22} />拍照/上传</>}
                </button>
              </div>
              {ed.questionImageUrl && (
                <button className="mini-btn" onClick={doOcr} disabled={ocrBusy}>
                  {ocrBusy ? '识别中…' : '识别文字填入下方'}
                </button>
              )}
            </div>
            <div className="field">
              <div className="field-label">题目（可选）</div>
              <textarea className="textarea" value={ed.questionText}
                placeholder="手打或点上方识别文字自动填入"
                onChange={(e) => setEditing({ ...ed, questionText: e.target.value })} />
            </div>
            <div className="field">
              <div className="field-label">答案图（可选）</div>
              <div className="img-row">
                {ed.answerImageUrl && (
                  <div className="img-thumb">
                    <img src={imgSrc(ed.answerImageUrl)} alt="答案图" />
                    <button onClick={() => setEditing({ ...ed, answerImageUrl: '' })}>×</button>
                  </div>
                )}
                <button className="upload-btn" onClick={() => pickImage('a')} disabled={uploading === 'a'}>
                  {uploading === 'a' ? <Spin /> : <><I n="image" size={22} />配图</>}
                </button>
              </div>
            </div>
            <div className="field">
              <div className="field-label">正确答案（可选）</div>
              <textarea className="textarea" style={{ minHeight: 64 }} value={ed.answerText || ''}
                onChange={(e) => setEditing({ ...ed, answerText: e.target.value })} />
            </div>
            <div className="field">
              <div className="field-label">错因（可选）</div>
              <input className="input" value={ed.reason || ''}
                placeholder="比如概念混淆、审题失误"
                onChange={(e) => setEditing({ ...ed, reason: e.target.value })} />
            </div>
            <div className="set-row">
              <span className="sr-label">已掌握</span>
              <button className={'mini-chip' + (ed.mastered ? ' active' : '')}
                onClick={() => setEditing({ ...ed, mastered: !ed.mastered })}>
                {ed.mastered ? '✓ 已掌握' : '未掌握'}
              </button>
            </div>
            <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={save}>保存</button>
          </>
        )}
      </Sheet>
      {/* 图片裁剪器：选图后先裁再上传 */}
      {cropSrc && (
        <Cropper src={cropSrc} onDone={onCropDone} onCancel={onCropCancel} />
      )}
      <Toast msg={toast} />
    </div>
  )
}
