// 我的收藏：纯前端 localStorage 存储，按账号隔离
// 收藏的是 AI 回答卡片（问题 + 答案 + 时间），不用走后端

export interface Fav { id: string; q: string; a: string; at: string }

const keyOf = (profileId: string) => `linverse.favs.${profileId}`

function read(pid: string): Fav[] {
  try {
    const raw = localStorage.getItem(keyOf(pid))
    return raw ? (JSON.parse(raw) as Fav[]) : []
  } catch {
    return []
  }
}

function write(pid: string, list: Fav[]) {
  localStorage.setItem(keyOf(pid), JSON.stringify(list))
}

// 判断某条回答是否已收藏：用问题+答案前 64 字做指纹
export function favFingerprint(q: string, a: string) {
  return `${q}@@${a.slice(0, 64)}`
}

export function isFav(pid: string, q: string, a: string) {
  const fp = favFingerprint(q, a)
  return read(pid).some((f) => favFingerprint(f.q, f.a) === fp)
}

export function toggleFav(pid: string, q: string, a: string): boolean {
  const list = read(pid)
  const fp = favFingerprint(q, a)
  const idx = list.findIndex((f) => favFingerprint(f.q, f.a) === fp)
  if (idx >= 0) {
    list.splice(idx, 1)
    write(pid, list)
    return false // 取消收藏
  }
  list.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, q, a, at: new Date().toISOString() })
  write(pid, list)
  return true
}

export function listFavs(pid: string): Fav[] {
  return read(pid)
}

export function removeFav(pid: string, id: string) {
  write(pid, read(pid).filter((f) => f.id !== id))
}
