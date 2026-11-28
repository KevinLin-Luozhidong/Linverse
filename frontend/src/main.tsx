import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
// 专业数学排版：KaTeX（根号横线、分数、上下标、化学 mhchem 全交给它，不再手写转换）
import 'katex/dist/katex.min.css'
import 'katex/contrib/mhchem'
import App from './App'

// 应用入口：挂载到 #root
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
// React 已接管：撤掉 index.html 里的原生启动屏
;(window as unknown as { __hideSplash?: () => void; __reactBooted?: boolean }).__reactBooted = true
;(window as unknown as { __hideSplash?: () => void }).__hideSplash?.()
