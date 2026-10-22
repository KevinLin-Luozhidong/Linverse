import { useEffect, useState } from 'react'
import { I, Toast, Spin, Empty, useToast } from '../components'
import { getLatestBriefing, type DailyBriefing } from '@api'

// 每日早报页：打开就是最新一期，按板块筛选，条目点开看全文 + 来源链接。
// 内容是全站公共的（不分账号），后端每天早上生成新一期写进库，这里只读。
// active prop：面板可见时为 true；隐藏时清掉展开状态（和知识库页 B2 同理，
// 避免切回来还留着上次展开的条目）。
export default function Briefing({ active }: { active?: boolean }) {
  const [data, setData] = useState<DailyBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [sec, setSec] = useState('all') // 当前筛选板块：all = 全部
  const [expanded, setExpanded] = useState<Set<string>>(new Set()) // 展开中的条目 key
  const [toastMsg, toastKey, setToast] = useToast()

  const reload = () => {
    setLoading(true)
    getLatestBriefing()
      .then(setData)
      .catch((e) => setToast(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  useEffect(() => {
    if (active === false) setExpanded(new Set())
  }, [active])

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (loading) return <Spin />
  if (!data) return <Empty text="还没有早报，每天早上 8 点左右生成新一期" />

  const visible = sec === 'all' ? data.sections : data.sections.filter((s) => s.name === sec)
  let idx = 0 // 全局序号：给卡片算阶梯入场延迟

  return (
    <div className="brief-page">
      {/* 页头：和知识库页同款玻璃卡，图标换成火焰红 */}
      <div className="brief-header">
        <div className="brief-header-icon">
          <I n="flame" size={22} />
        </div>
        <div>
          <h2 className="brief-header-title">{data.title}</h2>
          <p className="brief-header-sub">{fmtDateCN(data.date)}</p>
        </div>
      </div>

      {/* 板块筛选：一行横滑的胶囊 */}
      <div className="brief-chips">
        <button className={'brief-chip' + (sec === 'all' ? ' on' : '')} onClick={() => setSec('all')}>
          全部
        </button>
        {data.sections.map((s) => (
          <button key={s.name}
            className={'brief-chip' + (sec === s.name ? ' on' : '')}
            onClick={() => setSec(s.name)}>
            {s.name}
          </button>
        ))}
      </div>

      {/* 条目列表：按板块分组，点卡片展开/收起 */}
      {visible.map((s) => (
        <div key={s.name}>
          <div className="brief-sec-title">{s.name}</div>
          <div className="brief-list">
            {s.items.map((item, i) => {
              const key = `${s.name}-${i}`
              const open = expanded.has(key)
              const delay = idx++ * 40
              return (
                <div key={key}
                  className={'brief-card' + (open ? ' open' : '')}
                  style={{ animationDelay: `${delay}ms` }}
                  onClick={() => toggle(key)}>
                  <div className="brief-card-title">{item.title}</div>
                  <div className="brief-card-body">{item.body}</div>
                  {open ? (
                    <div className="brief-source">
                      来源：
                      <a href={item.source_url} target="_blank" rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}>
                        {item.source_name}
                      </a>
                    </div>
                  ) : (
                    <div className="brief-more">展开全文</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* 底部提示 */}
      <div className="kb-footer-tip">
        <I n="info" size={14} />
        <span>早报每天早上自动生成，内容来自公开新闻来源，点来源可看原文</span>
      </div>

      <Toast msg={toastMsg} tkey={toastKey} />
    </div>
  )
}

// 'YYYY-MM-DD' → 「2026 年 10 月 22 日」：纯字符串拆拼，不用 Date，避免时区差一天
function fmtDateCN(date: string) {
  const p = date.split('-')
  if (p.length !== 3) return date
  return `${p[0]} 年 ${Number(p[1])} 月 ${Number(p[2])} 日`
}
