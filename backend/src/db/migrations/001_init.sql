-- 001_init.sql —— 建库基线（v0.3.1 时的全量表结构）
--
-- 人话：这是数据库的"出生证明"。空库第一次跑 initDb 时执行它，
-- 一次建出全部 12 张表 + pgvector 扩展 + RLS 全开。
-- 所有语句都是 IF NOT EXISTS 的幂等写法：在已有库上重跑也不会报错、
-- 不会动已有数据，所以线上库第一次引入版本化迁移时跑它也是安全的。
-- 以后加表/加列不要改这个文件，新建 00N_xxx.sql 写增量。

CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- v0.1.5：头像（Supabase Storage 的图片地址）
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
-- v0.2.0：每个账号独立的随机认证凭证（只存 SHA-256，不存明文）
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS auth_token_hash TEXT;

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
  theme TEXT NOT NULL DEFAULT 'system', -- 默认跟随系统深浅色，用户可在设置页手动覆盖
  "aiProvider" TEXT NOT NULL DEFAULT 'demo',
  "aiModel" TEXT NOT NULL DEFAULT '',
  "aiEndpoint" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY ("profileId") REFERENCES profiles(id) ON DELETE CASCADE
);

-- 全站配置：key/value 键值对。存 site_password_hash（访问密码）、
-- danger_password_hash（所有者密码）、allow_signup（新账号注册开关）等。
CREATE TABLE IF NOT EXISTS site_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- pgvector 扩展：RAG 知识库向量检索用（Supabase 原生支持）
CREATE EXTENSION IF NOT EXISTS vector;

-- RAG 知识库块：教材转写文本 + 2048 维向量（智谱 embedding-3）
CREATE TABLE IF NOT EXISTS kb_chunks (
  id SERIAL PRIMARY KEY,
  book TEXT NOT NULL DEFAULT '',
  chapter TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  page_start INTEGER NOT NULL DEFAULT 0,
  page_end INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  embedding vector(2048),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 高频问答库：人工校准的标准问答（一问一答，带页码）
CREATE TABLE IF NOT EXISTS kb_faq (
  id SERIAL PRIMARY KEY,
  book TEXT NOT NULL DEFAULT '',
  chapter TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  page_start INTEGER NOT NULL DEFAULT 0,
  page_end INTEGER NOT NULL DEFAULT 0,
  embedding vector(2048),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS（行级安全）：Supabase 公开 API 门默认敞开，没开 RLS 的表谁都能读写删。
-- 后端走 Postgres 直连（postgres 角色不受 RLS 限制），所以只开 RLS、不建策略：
-- 公开 API 被锁死，后端一切照常。
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mistakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.word_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_faq ENABLE ROW LEVEL SECURITY;
