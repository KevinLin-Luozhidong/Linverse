// 原书 PDF 阅读器（应用内）：用 pdf.js 把指定页渲染成 canvas，
// 宽度贴合手机屏幕（不再走浏览器自带 PDF 阅读器——
// 它在 iframe 里不认 #page= 跳页、也不做宽度适配，
// 在新标签里又没有明显退出键）。
// 页码是 PDF 实际页码（书页码 + 每本书的偏移），由调用方算好传进来。
import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export default function PdfViewer({ url, page, title }: { url: string; page: number; title: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = useState(page)
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 打开一本书就重载一次；page 换书时回到调用方给的页
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setDoc(null); setNumPages(0)
    setPageNum(page)
    pdfjsLib.getDocument({ url }).promise.then(
      (d) => { if (!cancelled) { setDoc(d); setNumPages(d.numPages); setLoading(false) } },
      (e) => { if (!cancelled) { setError('课本打不开：' + (e?.message || '加载失败')); setLoading(false) } },
    )
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  // 当前页渲染：宽度贴合容器（手机屏），高度按比例来；页码越界就夹到有效范围。
  // 清晰度关键：必须按设备像素比渲染——iPhone 是 3 倍屏，canvas 只画 CSS 像素
  // （390px）再由屏幕放大 3 倍显示，就是用户说的“超级无敌模糊”；
  // 按 dpr 渲染（390×3=1170 设备像素），CSS 尺寸不变，字就锐了。
  useEffect(() => {
    if (!doc || !canvasRef.current || !wrapRef.current) return
    const target = Math.min(Math.max(1, pageNum), doc.numPages)
    if (target !== pageNum) { setPageNum(target); return }
    let cancelled = false
    doc.getPage(target).then((p) => {
      if (cancelled || !canvasRef.current || !wrapRef.current) return
      const base = p.getViewport({ scale: 1 })
      const cssW = wrapRef.current.clientWidth || 360
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const vp = p.getViewport({ scale: (cssW / base.width) * dpr })
      const canvas = canvasRef.current
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      canvas.style.width = Math.floor(vp.width / dpr) + 'px'
      canvas.style.height = Math.floor(vp.height / dpr) + 'px'
      // pdfjs-dist v6 的 render 要直接给 canvas 元素（不再只给 canvasContext）
      p.render({ canvas, viewport: vp })
    })
    return () => { cancelled = true }
  }, [doc, pageNum])

  return (
    <div className="pdf-body" ref={wrapRef}>
      {loading && <div className="pdf-status">正在打开课本…</div>}
      {error && (
        <div className="pdf-status">
          <div>{error}</div>
          <a className="mini-btn" href={url} target="_blank" rel="noreferrer">直接在浏览器里打开</a>
        </div>
      )}
      {!loading && !error && (
        <>
          <canvas ref={canvasRef} className="pdf-canvas" />
          <div className="pdf-pager">
            <button className="mini-btn" disabled={pageNum <= 1} onClick={() => setPageNum((n) => n - 1)}>上一页</button>
            <span className="pdf-pageno">{pageNum} / {numPages}</span>
            <button className="mini-btn" disabled={pageNum >= numPages} onClick={() => setPageNum((n) => n + 1)}>下一页</button>
          </div>
        </>
      )}
      <span style={{ display: 'none' }}>{title}</span>
    </div>
  )
}
