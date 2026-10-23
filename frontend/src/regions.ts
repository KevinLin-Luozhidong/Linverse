// 看板地区注册表：前端单一数据源。
// 加新地区 = 在 BOARD_REGIONS 里加一行 + 后端（backend/src/routes/shantou.js 的 KNOWN_REGIONS）
// 注册同名 id，并准备好该地区对应的看板数据。界面结构不用改。

export interface BoardRegion {
  id: string
  name: string
}

export const BOARD_REGIONS: BoardRegion[] = [
  { id: 'shantou', name: '汕头' },
]

export const DEFAULT_REGION_ID = 'shantou'

export const REGION_STORAGE_KEY = 'linverse.boardRegion'

// id 是否在注册表里
export function isBoardRegion(id: string): boolean {
  return BOARD_REGIONS.some((r) => r.id === id)
}

// 显示名，找不到就回落到默认地区的名字
export function boardRegionName(id: string): string {
  const hit = BOARD_REGIONS.find((r) => r.id === id)
  if (hit) return hit.name
  return BOARD_REGIONS.find((r) => r.id === DEFAULT_REGION_ID)?.name ?? DEFAULT_REGION_ID
}

// 读 localStorage，校验不在注册表里就回落默认地区
export function loadBoardRegion(): string {
  try {
    const saved = window.localStorage.getItem(REGION_STORAGE_KEY)
    if (saved && isBoardRegion(saved)) return saved
  } catch {
    // localStorage 不可用时忽略，走默认地区
  }
  return DEFAULT_REGION_ID
}

// 写 localStorage
export function saveBoardRegion(id: string): void {
  try {
    window.localStorage.setItem(REGION_STORAGE_KEY, id)
  } catch {
    // 写入失败（隐私模式等）不影响当前会话使用
  }
}
