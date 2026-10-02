import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
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
