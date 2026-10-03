import { useEffect, useState } from 'react'
import { I, Toast, Empty, useToast} from '../components'
import { listFavs, removeFav, type Fav } from '../favs'

// 我的收藏：AI 回答卡片的收藏列表（本地存储，按账号隔离）
// 点卡片展开看全文，支持取消收藏

export default function Favorites({ profileId, onBack }: {
  profileId: string | null; onBack: () => void
}) {
  const [favs, setFavs] = useState<Fav[]>([])
  const [openId, setOpenId] = useState('')
  const [toastMsg, toastKey, setToast] = useToast()

  useEffect(() => {
    if (profileId) setFavs(listFavs(profileId))
  }, [profileId])

  const unFav = (id: string) => {
    if (!profileId) return
    removeFav(profileId, id)
    setFavs((v) => v.filter((f) => f.id !== id))
    setToast('已取消收藏')
  }

  const fmt = (iso: string) => {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }

  return (
    <div className="settings" style={{ height: '100%' }}>
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="返回"><I n="back" /></button>
        <div className="topbar-title">我的收藏</div>
        <div className="topbar-spacer" />
      </div>
      <div className="fav-sec" style={{ flex: 1, overflowY: 'auto' }}>
        {favs.length === 0 ? (
          <Empty text="还没有收藏，在 AI 回答卡片上点收藏试试" />
        ) : favs.map((f) => (
          <div key={f.id} className="fav-card">
            <div className="fav-q" onClick={() => setOpenId(openId === f.id ? '' : f.id)}>
              {f.q}
            </div>
            <div className="fav-a" style={openId === f.id ? { display: 'block', WebkitLineClamp: 'unset' } : undefined}>
              {f.a}
            </div>
            <div className="fav-foot">
              <span className="fav-time">{fmt(f.at)}</span>
              <button className="mini-btn" style={{ color: 'var(--red)' }} onClick={() => unFav(f.id)}>
                取消收藏
              </button>
            </div>
          </div>
        ))}
      </div>
      <Toast msg={toastMsg} tkey={toastKey} />
    </div>
  )
}
