import { useEffect, useState } from 'react'
import { I, Toast, Spin, Empty, useToast } from '../components'
import { getLatestBriefing, type DailyBriefing } from '@api'

// 每日早报页：打开就是最新一期，按板块筛选，条目点开看全文 + 来源链接。
// 内容是全站公共的（不分账号），后端每天早上生成新一期写进库，这里只读。
// 版式照演示小样：顶部「大标题 + 共 N 条」一行，下面板块筛选胶囊，
// 列表扁平渲染（不分组小标题，每张卡自带板块标签）；「全部」视图下
// 摊平后的第一条当「今日头条」卡（琥珀描边 + 金色标签），单板块视图不设头条。
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

  const total = data.sections.reduce((n, s) => n + s.items.length, 0)
  const visibleSections = sec === 'all' ? data.sections : data.sections.filter((s) => s.name === sec)
  // 摊平成一个列表：每项带上所属板块名，key 用「板块名-板块内下标」保持稳定
  const flat = visibleSections.flatMap((s) =>
    s.items.map((item, i) => ({ item, sectionName: s.name, key: `${s.name}-${i}` })))

  return (
    <div className="brief-page">
      {/* 顶部标题行：大标题 + 右侧「共 N 条」小 pill */}
      <div className="brief-top">
        <h2 className="brief-top-title">{data.title}</h2>
        <span className="brief-count">共 {total} 条</span>
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

      {/* 扁平列表：全部视图下第一条是「今日头条」卡 */}
      <div className="brief-list">
        {flat.map(({ item, sectionName, key }, idx) => {
          const open = expanded.has(key)
          const featured = sec === 'all' && idx === 0
          return (
            <div key={key}
              className={'brief-card' + (featured ? ' featured' : '') + (open ? ' open' : '')}
              style={{ animationDelay: `${idx * 40}ms` }}
              onClick={() => toggle(key)}>
              <div className={'brief-cat' + (featured ? ' gold' : '')}>
                {featured ? `今日头条 · ${sectionName}` : sectionName}
              </div>
              <div className="brief-card-title">{item.title}</div>
              <div className="brief-card-body">{item.body}</div>
              <div className="brief-foot">
                <span className="brief-src">
                  来源：{item.source_name}
                  <a href={item.source_url} target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}>
                    原文 ↗
                  </a>
                </span>
                <span className="brief-more">{open ? '收起' : '点开看全文'}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部提示 */}
      <div className="kb-footer-tip">
        <I n="info" size={14} />
        <span>早报每天早上自动生成，内容来自公开新闻来源，点来源可看原文</span>
      </div>

      <Toast msg={toastMsg} tkey={toastKey} />
    </div>
  )
}
