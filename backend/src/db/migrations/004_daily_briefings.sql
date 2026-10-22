-- 004_daily_briefings.sql —— 新建每日早报存档表 daily_briefings
--
-- 人话：给 Linverse 加「每日早报」功能，早报内容按天存一份，一天一期，
-- 用 date 当主键天然去重。sections 用 JSONB 存板块数组（每个板块下又是
-- 若干条目），结构会随前端展示需求演化，没必要拆成多张关系表。
--
-- 两条规矩照仓库惯例办：① RLS 只开启不建策略——后端走 Postgres 直连，
-- 用的是 postgres 角色，不受 RLS 限制；公开 Data API 那边没有任何策略
-- 放行，等于默认锁死，防止绕过后端直接读写。② 显式 GRANT——Supabase
-- 2026-10-30 政策变更后，public 下新建的表不再自动授予 Data API
-- （anon / authenticated）访问权，不写这句以后走 Data API 会被拒。

CREATE TABLE IF NOT EXISTS public.daily_briefings (
  date DATE PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_briefings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_briefings TO anon, authenticated;
