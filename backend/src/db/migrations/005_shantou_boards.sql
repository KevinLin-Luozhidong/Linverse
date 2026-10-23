-- 005_shantou_boards.sql —— 新建汕头看板存档表 shantou_boards
--
-- 人话：给 Linverse 加「汕头看板」功能，看板内容一期一份完整 JSON 载荷
-- （天气头/太阳轨迹/指标/生活指数/四日预报/两日游/展会/出行建议），
-- 用 date 当主键天然去重。payload 用 JSONB 整体存一整期的数据，
-- 结构会随前端展示需求演化，没必要拆成多张关系表。由周末任务每周六、
-- 周日各生成一期 upsert 进来。
--
-- 两条规矩照仓库惯例办：① RLS 只开启不建策略——后端走 Postgres 直连，
-- 用的是 postgres 角色，不受 RLS 限制；公开 Data API 那边没有任何策略
-- 放行，等于默认锁死，防止绕过后端直接读写。② 显式 GRANT——Supabase
-- 2026-10-30 政策变更后，public 下新建的表不再自动授予 Data API
-- （anon / authenticated）访问权，不写这句以后走 Data API 会被拒。

CREATE TABLE IF NOT EXISTS public.shantou_boards (
  date DATE PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shantou_boards ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shantou_boards TO anon, authenticated;
