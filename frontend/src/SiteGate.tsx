import { useState } from 'react'
import { siteVerify, setSiteToken } from '@api'

// 访问密码门：全屏密码输入页。
// 主人先在"设置 → 访问密码"里定好密码，再把密码告诉朋友；朋友打开网址先过这道门。
export default function SiteGate({ onPass }: { onPass: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const p = pw.trim()
    if (!p || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await siteVerify(p)
      setSiteToken(r.token) // token 存本地，后续请求自动带上
      onPass()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '密码不对，再试一次')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <img className="gate-icon" src="/apple-touch-icon.png" alt="Linverse" />
      <div className="gate-title">Linverse</div>
      <div className="gate-sub">输入访问密码进入</div>
      <input
        className="input gate-input" type="password" placeholder="访问密码"
        value={pw} onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        autoFocus
      />
      {err && <div className="gate-err">{err}</div>}
      <button className="btn gate-btn" onClick={submit} disabled={busy}>
        {busy ? '验证中…' : '进入'}
      </button>
    </div>
  )
}
