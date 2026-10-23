import { useEffect, useMemo, useState } from 'react'
import { I, Toast, Spin, Empty, useToast } from '../components'
import { getLatestShantouBoard, type ShantouBoard } from '@api'

// 汕头看板页：周末仪表盘，渲染 shantou_boards 里一整期的 JSON 载荷。
// 版块：天气头区（灯塔图全幅 + 渐变蒙版）/ 太阳轨迹（按打开时刻实时算圆点）/ 指标 /
// 生活指数 / 四日预报横滑（温度·紫外线·风力切换）/ 周末两日游 / 展会时间线 / 出行建议。
// 样式全部 st- 前缀、只用现有 CSS 变量，玻璃保持 v1（伪玻璃，见 styles.css 登记）。
// 防御性：payload 任一子块缺失整块不渲染，数组用 (x || []) 兜底。
type AnyObj = Record<string, any>

// 固定配图素材（public/ 自托管，不进数据载荷）：南澳岛灯塔照片 / 老城骑楼插画
type TripImg = { src: string; alt: string; credit?: string }
const IMG_LIGHTHOUSE: TripImg = {
  src: '/nanao-lighthouse.jpg',
  alt: '汕头南澳岛三囱崖灯塔：红白条纹的双塔立在海边礁石上，傍晚海边看日落正合适',
  credit: '图 / 网易订阅',
}
const IMG_QILOU: TripImg = {
  src: '/oldtown-qilou.webp',
  alt: '汕头老城骑楼群剪影插画：黄昏天空下连排的骑楼建筑，拱门透出暖光',
}

// 两日游配图选择：按卡片文本匹配——老城/骑楼/小公园 → 骑楼图；
// 日落/灯塔/南澳/海边 → 灯塔图；都没命中按下标兜底（第 0 张灯塔、第 1 张骑楼）；
// 同一张图整页最多用一次，冲突时该卡无图。
function pickTripImages(items: AnyObj[]): (TripImg | null)[] {
  const used = new Set<string>()
  return items.map((it, i) => {
    const text = `${it.theme || ''}${it.title || ''}${it.body || ''}`
    let img: TripImg | null = null
    if (text.includes('老城') || text.includes('骑楼') || text.includes('小公园')) {
      img = IMG_QILOU
    } else if (
      text.includes('日落') ||
      text.includes('灯塔') ||
      text.includes('南澳') ||
      text.includes('海边')
    ) {
      img = IMG_LIGHTHOUSE
    } else if (i === 0) {
      img = IMG_LIGHTHOUSE
    } else if (i === 1) {
      img = IMG_QILOU
    }
    if (!img || used.has(img.src)) return null
    used.add(img.src)
    return img
  })
}

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

// 本地今天拼成 YYYY-MM-DD（不用 new Date(str) 解析，避免时区差一天）
function todayStr(): string {
  const d = new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

// '2026-10-18' → 「10月18日」：纯字符串拆拼，不用 Date
function fmtDate(s: string): string {
  const p = (s || '').split('-')
  if (p.length !== 3) return s || ''
  return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日'
}

// "6:11" → 分钟数
function toMin(t: string): number {
  const p = (t || '').split(':')
  if (p.length < 2) return NaN
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10)
}

// 倒计时天数：UTC 日期差，避免时区差一天
function daysUntil(target: string, today: string): number {
  const a = target.split('-').map((n) => parseInt(n, 10))
  const b = today.split('-').map((n) => parseInt(n, 10))
  if (a.length !== 3 || b.length !== 3 || a.some(isNaN) || b.some(isNaN)) return NaN
  return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000)
}

// 天气小图标：太阳 / 云 / 多云（inline SVG，I 组件里没有天气图标）
function WeatherIcon({ kind }: { kind: string }) {
  if (kind === 'sun') {
    return (
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
      </svg>
    )
  }
  if (kind === 'cloud') {
    return (
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 9.6 4.6 4.6 0 0 0 7 18.5z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8.5" r="3" />
      <path d="M8.5 2.5v1.2M2.5 8.5h1.2M4.3 4.3l.9.9M12.7 4.3l-.9.9" />
      <path d="M9 20h8.5a3.5 3.5 0 0 0 .5-6.96A4.8 4.8 0 0 0 9 12.6 3.8 3.8 0 0 0 9 20z" />
    </svg>
  )
}

// 简易罗盘：箭头默认指北，按 compass_deg 顺时针旋转
function Compass({ deg }: { deg: number }) {
  return (
    <div className="st-compass" aria-hidden="true">
      <span className="st-compass-n">北</span>
      <span className="st-compass-e">东</span>
      <span className="st-compass-s">南</span>
      <span className="st-compass-w">西</span>
      <div className="st-compass-arrow" style={{ transform: 'rotate(' + deg + 'deg)' }}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M12 2l4 10h-3v10h-2V12H8z" />
        </svg>
      </div>
    </div>
  )
}

// 太阳轨迹卡：圆点位置按椭圆数学实时算（frac 0→1 对应日出→日落）。
// 只在"打开当天 == 看板日期"时显示圆点和实时状态，否则只给静态弧 + 日出日落时间。
function SunCard({ sun, payloadDate }: { sun: AnyObj; payloadDate: string }) {
  const sunriseMin = toMin(sun.sunrise)
  const sunsetMin = toMin(sun.sunset)
  const valid = !isNaN(sunriseMin) && !isNaN(sunsetMin) && sunsetMin > sunriseMin
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const isToday = todayStr() === payloadDate
  let status = ''
  let dot: { x: number; y: number } | null = null
  if (valid && isToday) {
    if (nowMin < sunriseMin) {
      status = '太阳还没升起 · 日出 ' + sun.sunrise + ' · 日光时长 ' + (sun.daylight || '')
    } else if (nowMin > sunsetMin) {
      status = '太阳已在 ' + sun.sunset + ' 落山 · 今夜最低 ' + sun.night_low_c + '°C'
    } else {
      const frac = (nowMin - sunriseMin) / (sunsetMin - sunriseMin)
      dot = { x: 160 - 140 * Math.cos(Math.PI * frac), y: 148 - 132 * Math.sin(Math.PI * frac) }
      const left = sunsetMin - nowMin
      status = '距日落还有 ' + Math.floor(left / 60) + '小时' + (left % 60) + '分 · 日光时长 ' + (sun.daylight || '')
    }
  }
  return (
    <section className="st-sun st-card">
      <div className="st-sec-title">
        <I n="clock" size={16} /> 太阳轨迹
      </div>
      <svg className="st-sun-svg" viewBox="0 0 320 168" role="img" aria-label="太阳轨迹">
        <line x1="10" y1="148" x2="310" y2="148" className="st-sun-horizon" />
        <path d="M 20 148 A 140 132 0 0 1 300 148" className="st-sun-arc" fill="none" />
        {dot && (
          <g>
            <circle cx={dot.x} cy={dot.y} r="11" className="st-sun-glow" />
            <circle cx={dot.x} cy={dot.y} r="6" className="st-sun-dot" />
          </g>
        )}
        <text x="20" y="164" textAnchor="middle" className="st-sun-t">{sun.sunrise || ''}</text>
        <text x="300" y="164" textAnchor="middle" className="st-sun-t">{sun.sunset || ''}</text>
      </svg>
      {status ? (
        <div className="st-sun-status">{status}</div>
      ) : (
        <div className="st-sun-status">
          日出 {sun.sunrise || '--'} · 日落 {sun.sunset || '--'}
          {sun.daylight ? ' · 日光时长 ' + sun.daylight : ''}
        </div>
      )}
    </section>
  )
}

// 指标卡：按 tiles 数组顺序渲染，不硬编码 key。
// wind 带 compass_deg 画罗盘，uv 的 badge 橙色底，aqi 带 marker_pct 画 6 段彩条。
const AQI_SEGS = ['st-aqi-seg1', 'st-aqi-seg2', 'st-aqi-seg3', 'st-aqi-seg4', 'st-aqi-seg5', 'st-aqi-seg6']

function Tile({ t }: { t: AnyObj }) {
  const key = t.key
  const hasCompass = key === 'wind' && typeof t.compass_deg === 'number'
  const hasAqi = key === 'aqi' && typeof t.marker_pct === 'number'
  const hasBar = key === 'humidity' && typeof t.bar === 'number'
  return (
    <div className={'st-tile st-card st-tile-' + (key || 'x')}>
      <div className="st-tile-head">
        <span className="st-tile-label">{t.label}</span>
        {hasCompass && <Compass deg={t.compass_deg} />}
      </div>
      <div className="st-tile-val">
        <span className="st-tile-num">{t.value}</span>
        {t.unit ? <span className="st-tile-unit">{t.unit}</span> : null}
        {t.badge ? (
          <span className={'st-badge' + (key === 'uv' ? ' st-badge-uv' : '')}>{t.badge}</span>
        ) : null}
      </div>
      {hasBar && (
        <div className="st-bar">
          <i style={{ width: Math.max(0, Math.min(100, t.bar)) + '%' }} />
        </div>
      )}
      {hasAqi && (
        <div className="st-aqi" aria-hidden="true">
          <div className="st-aqi-segs">
            {AQI_SEGS.map((c) => (
              <span key={c} className={c} />
            ))}
          </div>
          <div className="st-aqi-marker" style={{ left: Math.max(0, Math.min(100, t.marker_pct)) + '%' }} />
        </div>
      )}
      {t.note ? <div className="st-tile-note">{t.note}</div> : null}
    </div>
  )
}

export default function Shantou({ active }: { active?: boolean }) {
  const [data, setData] = useState<ShantouBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'temp' | 'uv' | 'wind'>('temp') // 预报指标切换
  const [toastMsg, toastKey, setToast] = useToast()

  // 覆盖层显隐时 active 变化：切到看板 tab 才拉（首次挂载 active 为 undefined 也拉）
  useEffect(() => {
    if (active === false) return
    let alive = true
    setLoading(true)
    getLatestShantouBoard()
      .then((r) => { if (alive) setData(r) })
      .catch(() => { if (alive) setToast('看板加载失败，请稍后再试') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const p: AnyObj = useMemo(() => ((data && (data as AnyObj).payload) || {}) as AnyObj, [data])
  const payloadDate: string = p.date || (data ? (data as AnyObj).date : '') || ''
  const today = todayStr()

  if (loading) return <Spin />
  if (!data) return <Empty text="还没有看板数据，周末会生成新一期" />

  const hero: AnyObj | undefined = p.hero
  const sun: AnyObj | undefined = p.sun
  const tiles: AnyObj[] = p.tiles || []
  const life: AnyObj | undefined = p.life
  const lifeItems: AnyObj[] = (life && life.items) || []
  const forecast: AnyObj[] = p.forecast || []
  const trips: AnyObj | undefined = p.trips
  const tripItems: AnyObj[] = (trips && trips.items) || []
  const events: AnyObj | undefined = p.events
  const eventItems: AnyObj[] = (events && events.items) || []
  const advice: AnyObj[] = p.advice || []
  const tripImgs = pickTripImages(tripItems)

  const tabs: { k: 'temp' | 'uv' | 'wind'; t: string }[] = [
    { k: 'temp', t: '温度' },
    { k: 'uv', t: '紫外线' },
    { k: 'wind', t: '风力' },
  ]

  return (
    <div className="st-page">
      {/* 天气头区：灯塔图全幅 + 渐变蒙版，白字压图上（上地点日期 / 下天气实况） */}
      {hero && (
        <section className="st-hero">
          <img
            className="st-hero-img"
            src="/nanao-lighthouse.jpg"
            alt="汕头南澳岛三囱崖灯塔：红白条纹的双塔立在海边礁石上，背后是蓝天和大海"
          />
          <div className="st-hero-shade" aria-hidden="true" />
          <div className="st-hero-inner">
            <div>
              <div className="st-hero-place">{hero.place}</div>
              <div className="st-hero-date">
                {fmtDate(payloadDate)} {p.weekday || ''}
              </div>
            </div>
            <div>
              <div className="st-hero-main">
                <span className="st-hero-cond">{hero.condition}</span>
                <span className="st-hero-temp">{hero.temp_c}°C</span>
              </div>
              {hero.sub ? <div className="st-hero-sub">{hero.sub}</div> : null}
            </div>
          </div>
          {hero.credit ? <div className="st-hero-credit">{hero.credit}</div> : null}
        </section>
      )}

      {sun && <SunCard sun={sun} payloadDate={payloadDate} />}

      {tiles.length > 0 && (
        <section className="st-tiles" aria-label="今日气象指标">
          {tiles.map((t, i) => (
            <Tile key={t.key || i} t={t} />
          ))}
        </section>
      )}

      {life && lifeItems.length > 0 && (
        <section className="st-life" aria-label="生活指数">
          <div className="st-sec-head">
            <div className="st-sec-title">
              <I n="info" size={16} /> 生活指数
            </div>
            {life.sub ? <div className="st-sec-sub">{life.sub}</div> : null}
          </div>
          <div className="st-life-grid">
            {lifeItems.map((it, i) => (
              <div key={it.name || i} className="st-life-item st-card">
                <div className="st-life-top">
                  <span className="st-life-name">{it.name}</span>
                  <span className={'st-life-level' + (it.hot ? ' is-hot' : '')}>{it.level}</span>
                </div>
                <div className={'st-bar' + (it.hot ? ' is-hot' : '')}>
                  <i style={{ width: Math.max(0, Math.min(100, it.bar || 0)) + '%' }} />
                </div>
                <div className="st-life-text">{it.text}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {forecast.length > 0 && (
        <section className="st-fc" aria-label="四日天气预报">
          <div className="st-sec-head">
            <div className="st-sec-title">
              <I n="chart" size={16} /> 四日预报
            </div>
            <div className="st-fc-tabs" role="tablist" aria-label="预报指标切换">
              {tabs.map((x) => (
                <button
                  key={x.k}
                  type="button"
                  role="tab"
                  aria-selected={tab === x.k}
                  className={'st-fc-tab' + (tab === x.k ? ' on' : '')}
                  onClick={() => setTab(x.k)}
                >
                  {x.t}
                </button>
              ))}
            </div>
          </div>
          <div className="st-fc-scroll">
            {forecast.map((f, i) => (
              <div key={f.date_label || i} className={'st-fc-card st-card' + (f.today ? ' is-today' : '')}>
                <div className="st-fc-day">
                  <span>{f.weekday}</span>
                  <span className="st-fc-date">{f.date_label}</span>
                  {f.today ? <span className="st-fc-tag">今天</span> : null}
                </div>
                <div className="st-fc-icon">
                  <WeatherIcon kind={f.icon} />
                </div>
                <div className="st-fc-cond">{f.condition}</div>
                <div className="st-fc-big">
                  {tab === 'temp' && (
                    <>
                      <b>{f.hi_c}°</b>
                      <span>/{f.lo_c}°</span>
                    </>
                  )}
                  {tab === 'uv' && (
                    <>
                      <b>{f.uv}</b>
                      <span>{f.uv_label}</span>
                    </>
                  )}
                  {tab === 'wind' && (
                    <>
                      <b>{f.wind_kmh}</b>
                      <span>km/h {f.wind_dir}</span>
                    </>
                  )}
                </div>
                {f.note ? <div className="st-fc-note">{f.note}</div> : null}
              </div>
            ))}
          </div>
        </section>
      )}

      {trips && tripItems.length > 0 && (
        <section className="st-trips" aria-label="周末两日游">
          <div className="st-sec-head">
            <div className="st-sec-title">
              <I n="heart" size={16} /> 周末两日游
            </div>
            {trips.sub ? <div className="st-sec-sub">{trips.sub}</div> : null}
          </div>
          <div className="st-trips-list">
            {tripItems.map((it, i) => (
              <div key={it.title || i} className="st-trip st-card">
                {tripImgs[i] && (
                  <div className="st-trip-media">
                    <img src={tripImgs[i]!.src} alt={tripImgs[i]!.alt} />
                    {tripImgs[i]!.credit ? (
                      <span className="st-trip-credit">{tripImgs[i]!.credit}</span>
                    ) : null}
                  </div>
                )}
                <div className="st-trip-top">
                  <span className="st-trip-day">{it.day_label}</span>
                  <span className="st-trip-theme">{it.theme}</span>
                </div>
                <div className="st-trip-title">{it.title}</div>
                <div className="st-trip-body">{it.body}</div>
                <div className="st-trip-stops">
                  {(it.stops || []).map((s: string, j: number) => (
                    <span key={j} className="st-pill">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {events && eventItems.length > 0 && (
        <section className="st-events" aria-label="展会与活动">
          <div className="st-sec-head">
            <div className="st-sec-title">
              <I n="flame" size={16} /> 展会时间线
            </div>
            {events.sub ? <div className="st-sec-sub">{events.sub}</div> : null}
          </div>
          <div className="st-ev-list">
            {eventItems.map((ev, i) => (
              <div key={ev.title || i} className={'st-ev' + (ev.next ? ' is-next' : '')}>
                <div className="st-ev-date">
                  <b>{ev.date_label}</b>
                  <span>{ev.week_label}</span>
                </div>
                <div className="st-ev-line" aria-hidden="true">
                  <i className="st-ev-dot" />
                </div>
                <div className="st-ev-card st-card">
                  <div className="st-ev-title">
                    <span>{ev.title}</span>
                    {ev.badge ? <span className="st-badge">{ev.badge}</span> : null}
                  </div>
                  {(ev.meta || []).map((m: AnyObj, j: number) => {
                    // 倒计时行：v 为空、countdown_to 有值，按打开当天算天数
                    if (m.countdown_to) {
                      const d = daysUntil(m.countdown_to, today)
                      const txt = isNaN(d) ? '' : d > 0 ? '距开幕 ' + d + ' 天' : d === 0 ? '就是今天' : '已开幕'
                      return (
                        <div key={j} className="st-ev-meta">
                          <span className="st-ev-k">{m.k}：</span>
                          <span className="st-ev-v">{txt}</span>
                        </div>
                      )
                    }
                    return (
                      <div key={j} className="st-ev-meta">
                        <span className="st-ev-k">{m.k}：</span>
                        <span className="st-ev-v">{m.v}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          {events.note ? <div className="st-ev-note">{events.note}</div> : null}
        </section>
      )}

      {advice.length > 0 && (
        <section className="st-advice" aria-label="出行建议">
          <div className="st-sec-head">
            <div className="st-sec-title">
              <I n="check" size={16} /> 出行建议
            </div>
          </div>
          <div className="st-advice-grid">
            {advice.map((a, i) => (
              <div key={a.title || i} className="st-advice-item st-card">
                <div className="st-advice-title">{a.title}</div>
                <div className="st-advice-text">{a.text}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {p.foot ? <footer className="st-foot">{p.foot}</footer> : null}

      <Toast msg={toastMsg} tkey={toastKey} />
    </div>
  )
}
