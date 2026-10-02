import { useRef, useState } from 'react'

// 图片裁剪器：拍照/选图后先裁再上传
// 人话：手指在图上拖一下框出要留的部分，框可以拖动移位置，确认后只保留框里的内容
// 术语：Pointer Events（鼠标触屏统一的按压事件）+ Canvas 裁剪

interface Sel { x: number; y: number; w: number; h: number }

export default function Cropper({ src, onDone, onCancel }: {
  src: string // 待裁剪图片的本地地址（URL.createObjectURL 生成）
  onDone: (blob: Blob) => void // 确认裁剪/直接使用：返回最终图片数据
  onCancel: () => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null) // 包图片的盒子：选框坐标都相对它算
  const imgRef = useRef<HTMLImageElement>(null)
  const [sel, setSel] = useState<Sel | null>(null) // 当前选框，没有就是没选
  const [ready, setReady] = useState(false) // 图片加载完才能裁
  const drag = useRef<null | {
    mode: 'draw' | 'move' // 画新框 / 拖动已有框
    sx: number; sy: number // 按下时的起点（相对盒子）
    ox: number; oy: number // 移动模式：手指在框内的偏移
    base: Sel | null // 移动模式：框的原始位置
  }>(null)

  // 把按压点换算成"相对图片盒子"的坐标
  const pos = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  // 点是否落在已有选框里
  const inSel = (p: { x: number; y: number }, s: Sel) =>
    p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h

  const down = (e: React.PointerEvent) => {
    if (!ready) return
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    const p = pos(e)
    if (sel && inSel(p, sel)) {
      // 按在框里：进入移动模式
      drag.current = { mode: 'move', sx: p.x, sy: p.y, ox: p.x - sel.x, oy: p.y - sel.y, base: sel }
    } else {
      // 按在框外：画新框
      drag.current = { mode: 'draw', sx: p.x, sy: p.y, ox: 0, oy: 0, base: null }
      setSel({ x: p.x, y: p.y, w: 0, h: 0 })
    }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !wrapRef.current) return
    const p = pos(e)
    const box = wrapRef.current.getBoundingClientRect()
    if (d.mode === 'draw') {
      // 画框：起点到当前点围成的矩形，限制在图片范围内
      const x = Math.max(0, Math.min(d.sx, p.x))
      const y = Math.max(0, Math.min(d.sy, p.y))
      const w = Math.min(Math.abs(p.x - d.sx), box.width - x)
      const h = Math.min(Math.abs(p.y - d.sy), box.height - y)
      setSel({ x, y, w, h })
    } else if (d.base) {
      // 移动框：框跟着手指走，不出图片边界
      const x = Math.max(0, Math.min(p.x - d.ox, box.width - d.base.w))
      const y = Math.max(0, Math.min(p.y - d.oy, box.height - d.base.h))
      setSel({ ...d.base, x, y })
    }
  }
  const up = () => {
    // 框太小算误触，直接清除
    if (drag.current?.mode === 'draw' && sel && (sel.w < 30 || sel.h < 30)) setSel(null)
    drag.current = null
  }

  // 确认裁剪：按原图分辨率切出选框区域
  const confirm = () => {
    const img = imgRef.current
    const box = wrapRef.current?.getBoundingClientRect()
    if (!img || !box || !sel || sel.w < 30 || sel.h < 30) return
    // 显示尺寸 → 原图尺寸的换算比
    const kx = img.naturalWidth / box.width
    const ky = img.naturalHeight / box.height
    const c = document.createElement('canvas')
    c.width = Math.round(sel.w * kx)
    c.height = Math.round(sel.h * ky)
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, sel.x * kx, sel.y * ky, sel.w * kx, sel.h * ky, 0, 0, c.width, c.height)
    c.toBlob((b) => { if (b) onDone(b) }, 'image/jpeg', 0.92)
  }

  return (
    <div className="crop-wrap" role="dialog" aria-label="裁剪图片">
      <div className="crop-head">
        <span className="crop-title">裁剪图片</span>
        <span className="crop-hint">{sel ? '拖动框可移动，在空白处重画' : '在图上拖一下，框出要保留的部分'}</span>
      </div>
      <div className="crop-stage">
        <div ref={wrapRef} className="crop-box"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ touchAction: 'none' }}>
          <img ref={imgRef} src={src} alt="待裁剪" draggable={false}
            onLoad={() => setReady(true)} className="crop-img" />
          {/* 选框外的区域压暗，突出选中部分 */}
          {sel && sel.w > 0 && (
            <>
              <div className="crop-mask" style={{ left: 0, top: 0, width: '100%', height: sel.y }} />
              <div className="crop-mask" style={{ left: 0, top: sel.y + sel.h, width: '100%', bottom: 0 }} />
              <div className="crop-mask" style={{ left: 0, top: sel.y, width: sel.x, height: sel.h }} />
              <div className="crop-mask" style={{ left: sel.x + sel.w, top: sel.y, right: 0, height: sel.h }} />
              <div className="crop-sel" style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }} />
            </>
          )}
        </div>
      </div>
      <div className="crop-foot">
        <button className="mini-btn" onClick={onCancel}>取消</button>
        <button className="mini-btn" onClick={() => {
          // 直接使用原图：把显示的图片转成 blob 交给上传流程
          const img = imgRef.current
          if (!img) return
          const c = document.createElement('canvas')
          c.width = img.naturalWidth
          c.height = img.naturalHeight
          c.getContext('2d')!.drawImage(img, 0, 0)
          c.toBlob((b) => { if (b) onDone(b) }, 'image/jpeg', 0.92)
        }}>直接使用原图</button>
        <button className="btn" disabled={!sel || sel.w < 30} onClick={confirm}>确认裁剪</button>
      </div>
    </div>
  )
}
