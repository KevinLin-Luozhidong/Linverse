// 专业数学排版：KaTeX（数学公式）+ mhchem（化学方程式）。
// 根号横线、分数叠排、上下标、化学式全部交给引擎，不再手写转换。
// （用户 2026-11-28 立：各科符号必须用专业库，不许自己转换；GPT 选型亦推荐 KaTeX。）
import katex from 'katex'

// 把一段 LaTeX 用 KaTeX 渲染成 HTML 字符串；失败返回 null，调用方回退到纯文本。
// throwOnError:false：公式没写完（流式输出中途）也不炸，只显示源码；
// trust:false：不执行 \href 等危险命令，只出安全的 HTML+MathML。
export function renderMathHtml(latex: string): string | null {
  try {
    return katex.renderToString(latex, { throwOnError: false, trust: false, displayMode: false })
  } catch {
    return null
  }
}
