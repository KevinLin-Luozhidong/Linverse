-- Linverse 数据库建表 SQL（Supabase Postgres）
-- 用法：Supabase 后台 → SQL Editor → 粘贴执行
-- 注意：后端冷启动时会自动执行同样的建表（幂等），这里是手动兜底

CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  "profileId" INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '新的对话',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY ("profileId") REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  "profileId" INTEGER NOT NULL,
  "conversationId" INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY ("conversationId") REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mistakes (
  id SERIAL PRIMARY KEY,
  "profileId" INTEGER NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  "questionText" TEXT NOT NULL DEFAULT '',
  "questionImageUrl" TEXT NOT NULL DEFAULT '',
  "answerText" TEXT NOT NULL DEFAULT '',
  "answerImageUrl" TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  mastered INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY ("profileId") REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  "profileId" INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  color TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY ("profileId") REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vocabulary (
  id SERIAL PRIMARY KEY,
  "profileId" INTEGER NOT NULL,
  word TEXT NOT NULL,
  phonetic TEXT NOT NULL DEFAULT '',
  meaning TEXT NOT NULL DEFAULT '',
  mastered INTEGER NOT NULL DEFAULT 0,
  "intervalDays" INTEGER NOT NULL DEFAULT 1,
  "nextReview" TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY ("profileId") REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS word_history (
  id SERIAL PRIMARY KEY,
  "profileId" INTEGER NOT NULL,
  word TEXT NOT NULL,
  looked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("profileId", word),
  FOREIGN KEY ("profileId") REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checkins (
  id SERIAL PRIMARY KEY,
  "profileId" INTEGER NOT NULL,
  date TEXT NOT NULL,
  UNIQUE ("profileId", date),
  FOREIGN KEY ("profileId") REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  "profileId" INTEGER PRIMARY KEY,
  "displayName" TEXT NOT NULL DEFAULT '',
  "fontSize" TEXT NOT NULL DEFAULT 'medium',
  theme TEXT NOT NULL DEFAULT 'light',
  "aiProvider" TEXT NOT NULL DEFAULT 'demo',
  "aiModel" TEXT NOT NULL DEFAULT '',
  "aiEndpoint" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY ("profileId") REFERENCES profiles(id) ON DELETE CASCADE
);

-- RLS（行级安全）：Supabase 的公开 API 门默认敞开，没开 RLS 的表谁都能读写删。
-- 后端走 Postgres 直连（postgres 角色不受 RLS 限制），所以只开 RLS、不建策略：
-- 公开 API 被锁死，后端一切照常。2026-10-10 补：修 Supabase 安全告警 rls_disabled_in_public
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mistakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.word_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
