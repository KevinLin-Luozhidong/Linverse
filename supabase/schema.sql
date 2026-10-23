-- Linverse 数据库建表 SQL（Supabase Postgres）
-- 用法：Supabase 后台 → SQL Editor → 粘贴执行
-- 注意两点：
--  1. 后端冷启动时会自动执行同样的建表＋版本化迁移（幂等），这里是手动兜底；
--  2. 这份文件必须和 backend/src/db/index.js 的 SCHEMA_SQL 保持一致，
--     改了一边就要同步另一边，否则灾难恢复时会建出不一样的库。
-- 历史教训：这份文件曾经漏掉 site_config 整张表——按它重建的库会导致
-- 访问密码门直接报错。所以每次改表结构，两边都要对一遍。
--
-- ⚠️ Supabase 政策变更（2026-10-30 生效）：public 下新建的表不再自动授予
-- Data API（anon / authenticated）访问权。以后新增 CREATE TABLE 时，必须在
-- 同一脚本里显式加 GRANT（例如 GRANT SELECT, INSERT, UPDATE, DELETE ON 新表
-- TO anon, authenticated；），否则前端若走 Data API 会直接报权限拒绝。
-- 现有表不受影响；Linverse 后端走 DATABASE_URL 直连 Postgres，不经 Data API，
-- 所以后端读写不受此政策影响——但 RLS 照样全开，不要动。

CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- v0.1.5：头像（Supabase Storage 的图片地址）
  avatar_url TEXT,
  -- v0.2.0：每个账号独立的随机认证凭证（只存 SHA-256，不存明文）
  auth_token_hash TEXT
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
  theme TEXT NOT NULL DEFAULT 'system',
  "aiProvider" TEXT NOT NULL DEFAULT 'demo',
  "aiModel" TEXT NOT NULL DEFAULT '',
  "aiEndpoint" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY ("profileId") REFERENCES profiles(id) ON DELETE CASCADE
);

-- 全站配置：key/value 键值对。存 site_password_hash（访问密码）、danger_password_hash
--（所有者密码）、allow_signup（新账号注册开关）等。没设访问密码 = 公开状态。
CREATE TABLE IF NOT EXISTS site_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- pgvector 扩展：RAG 知识库向量检索用（Supabase 原生支持）
CREATE EXTENSION IF NOT EXISTS vector;

-- RAG 知识库块：教材转写文本 + 2048 维向量（智谱 embedding-3）。
-- 一本书切成几百块存这里；问答时把问题也转成向量，按余弦相似度取最相关的几块喂给 AI。
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

-- 高频问答库：人工校准的标准问答（一问一答，带页码）。
-- 用户提问时先向量匹配这里：高置信度命中则优先采用标准答案，没命中再走普通 RAG。
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
-- 后端走 Postgres 直连（postgres 角色不受 RLS 限制），所以只开 RLS、不建策略：
-- 公开 API 被锁死，后端一切照常。2026-10-10 补：修 Supabase 安全告警 rls_disabled_in_public
-- 每日早报存档：一天一期，date 主键天然去重；sections 存板块数组
-- （[{name, items:[{title, body, source_name, source_url}]}]），全站公共只读。
CREATE TABLE IF NOT EXISTS daily_briefings (
  date DATE PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 汕头看板存档：周末仪表盘，周六、周日各一期；date 主键天然去重；
-- payload 存一整期完整载荷（天气头/太阳轨迹/指标/生活指数/四日预报/
-- 两日游/展会/出行建议），全站公共只读。
CREATE TABLE IF NOT EXISTS public.shantou_boards (
  date DATE PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
ALTER TABLE public.daily_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shantou_boards ENABLE ROW LEVEL SECURITY;

-- 2026-10-30 新政：新建的表必须显式 GRANT（见本文件顶部注释）
GRANT SELECT, INSERT, UPDATE, DELETE ON daily_briefings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shantou_boards TO anon, authenticated;

-- 2026-10-22 优化：高频查询索引（与 migrations/003_add_indexes.sql 保持一致）
CREATE INDEX IF NOT EXISTS idx_mistakes_profile_id ON mistakes ("profileId", id DESC);
CREATE INDEX IF NOT EXISTS idx_notes_profile_updated ON notes ("profileId", updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_vocabulary_profile_due ON vocabulary ("profileId", mastered, "nextReview");
CREATE INDEX IF NOT EXISTS idx_conversations_profile_id ON conversations ("profileId", id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages ("conversationId", id);
CREATE INDEX IF NOT EXISTS idx_messages_profile_id ON messages ("profileId");
CREATE INDEX IF NOT EXISTS idx_word_history_profile_looked ON word_history ("profileId", looked_at DESC);
