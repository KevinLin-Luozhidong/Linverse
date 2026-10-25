// ============================================================================
// 数据库连接 + 建表（Supabase Postgres）
//
// 连接：读环境变量 DATABASE_URL（Supabase 后台 → Database → Connection string
// → Transaction pooler，6543 端口）。serverless 函数必须走 pooler，不能直连
// 5432，否则函数实例一多会把数据库连接数打满。
//
// 建表：启动 / 冷启动时自动执行一次：
//  1. 版本化迁移（backend/src/db/migrations/ 下的 00N_*.sql，按编号顺序执行，
//     跑过的记在 schema_migrations 表里，重跑自动跳过）；
//  2. SCHEMA_SQL 的 IF NOT EXISTS 建表作为兜底（幂等）。
// supabase/schema.sql 里还有一份同样的建表 SQL，万一自动建表没跑成，
// 可以去 Supabase 的 SQL 编辑器里手动执行兜底（两边必须保持一致）。
//
// 注意：Postgres 里不加引号的字段名会自动转成小写（profileId 会变成
// profileid，前端收到的字段名就变了）。所以下面所有驼峰字段名都用双引号
// 包起来（"profileId"），保证和原来 SQLite 版的字段名一字不差。
// ============================================================================
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// 连接池：serverless 环境下每个函数实例是短命的，池子不用大，
// 空闲连接及时回收，避免占着 Supabase 的连接数不放
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // 没配也不炸：用到时才真正连库
  max: 5, // 单实例最大连接数
  idleTimeoutMillis: 10000, // 空闲 10 秒就回收
  connectionTimeoutMillis: 10000, // 连不上 10 秒就报错，不无限卡住
  // 语句级超时：以前只有建连超时，慢查询能无限拖住请求；单条 SQL 超 30 秒就报错，
  // 兜底不让一条慢查询拖垮整个 serverless 函数（正常查询都在毫秒级，30 秒很宽松）
  statement_timeout: 30000,
});

// 池子自己抛错（比如网络断了）时只打日志，不让整个进程崩掉
pool.on('error', (err) => {
  console.error('[db] 连接池错误：', err.message);
});

// ---------- 建表 SQL（Postgres 语法） ----------
// 说明：
// - id 用 SERIAL PRIMARY KEY（Postgres 最传统的自增主键写法）。
//   注意：不要换成 GENERATED ALWAYS AS IDENTITY——2026-10-03 线上实测，
//   当时写的 `id GENERATED ALWAYS AS IDENTITY PRIMARY KEY` 少了列类型
//   （合法写法应是 `id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY`），
//   报 syntax error at or near "ALWAYS"。SERIAL 已经过线上验证、
//   走任何代理都兼容，对我们（只让数据库自动生成 id，从不手填 id）
//   行为完全等价，所以就用 SERIAL，不折腾。
// - 0/1 开关字段（mastered/pinned/archived）继续用 INTEGER 存 0/1，
//   和原来 SQLite 的行为完全一致，前端不用改
// - 时间统一用 TIMESTAMPTZ，默认 now()；打卡日期/复习日期用 TEXT 存 YYYY-MM-DD，
//   方便直接做字符串比较（和原来一致）
const SCHEMA_SQL = `
-- ⚠️ Supabase 政策变更（2026-10-30 生效）：public 下新建的表不再自动授予
-- Data API（anon / authenticated）访问权。以后新增 CREATE TABLE 时，必须在
-- 同一脚本里显式加 GRANT（例如 GRANT SELECT, INSERT, UPDATE, DELETE ON 新表
-- TO anon, authenticated；）。现有表不受影响；本后端走 DATABASE_URL 直连，
-- 不经 Data API，但 RLS 全开、不要动。另：本串必须与 supabase/schema.sql
-- 保持一致，改一边同步另一边。
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

-- 全站配置：key/value 键值对。现在存 site_password_hash（访问密码的 SHA256）。
-- 没设密码 = 公开状态；设了之后所有 /api/*（除 site 相关）都要带 x-site-token。
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

-- 每日早报存档：一天一期，date 主键天然去重；sections 存板块数组
-- （[{name, items:[{title, body, source_name, source_url}]}]），全站公共只读。
CREATE TABLE IF NOT EXISTS daily_briefings (
  date DATE PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 2026-10-30 新政：新表必须显式 GRANT（见本文件顶部注释）
GRANT SELECT, INSERT, UPDATE, DELETE ON daily_briefings TO anon, authenticated;

-- 汕头看板存档：周末仪表盘，周六、周日各一期；date 主键天然去重；
-- payload 存一整期完整载荷（天气头/太阳轨迹/指标/生活指数/四日预报/
-- 两日游/展会/出行建议），全站公共只读。
CREATE TABLE IF NOT EXISTS shantou_boards (
  date DATE PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 2026-10-30 新政：新表必须显式 GRANT（见本文件顶部注释）
GRANT SELECT, INSERT, UPDATE, DELETE ON shantou_boards TO anon, authenticated;

-- RLS（行级安全）：Supabase 公开 API 门默认敞开，没开 RLS 的表谁都能读写删。
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
ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_faq ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shantou_boards ENABLE ROW LEVEL SECURITY;
`;

// ---------- 版本化迁移 ----------
// 人话：表结构不是一成不变的（加列、改默认值都叫"迁移"）。以前迁移 SQL
// 散落在 initDb() 函数体里，没人记得哪些跑过。现在规矩是：
// 每次改表结构 → 在 migrations/ 下新建 00N_名字.sql（编号递增），
// initDb 按编号顺序执行没跑过的，跑完记到 schema_migrations 表。
// 幂等：每个迁移文件里的语句本身也要写成 IF NOT EXISTS / 条件 UPDATE，
// 重跑不报错、不重复改数据。
async function runMigrations() {
  // 先建迁移记录表（它自己也要幂等）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const dir = path.join(__dirname, 'migrations');
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    // serverless 打包万一没把 migrations 目录打进去，不硬炸：
    // 打日志，靠下面的 SCHEMA_SQL 兜底建表（表结构层面等价）
    console.warn('[db] 迁移目录读取失败，跳过版本化迁移：', err.message);
    return;
  }
  const done = new Set(
    (await pool.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version)
  );
  for (const f of files) {
    const version = f.replace(/\.sql$/, '');
    if (done.has(version)) continue; // 跑过就跳过
    console.log('[db] 执行迁移：', f);
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    // 整个文件一次发给 pg（pg 原生支持多语句）；文件内语句各自幂等
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    console.log('[db] 迁移完成：', f);
  }
}

// ---------- 对外接口 ----------

// 通用查询：dao.js 里所有 SQL 都走这里
// 用法：await query('SELECT * FROM profiles WHERE id = $1', [id])
async function query(text, params) {
  return pool.query(text, params);
}

// 建表（幂等）：serverless 冷启动 / 本地启动时调一次
// 返回 true=建表成功（或表已存在），false=失败
// 注意两点：
//  1. 建表语句拆成一条一条单独执行——哪张表失败日志里直接点名，
//     也避开某些连接池对"多语句拼成一串"的解析 quirks；
//  2. 失败不抛错（只打日志），调用方根据返回值决定下次请求是否重试。
let _initPromise = null;
function initDb() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!process.env.DATABASE_URL) {
      // 没配 DATABASE_URL（比如只做 require 验收）时跳过，保证 require 不炸
      console.warn('[db] 未设置 DATABASE_URL，跳过建表');
      return true; // 不算失败：本地验收场景
    }
    // 第一步：版本化迁移。失败只打日志不抛错——SCHEMA_SQL 兜底能保证表结构，
    // 不能因为某个迁移文件出问题就让整个 API 冷启动失败。
    try {
      await runMigrations();
    } catch (err) {
      console.error('[db] 版本化迁移失败，已降级为 SCHEMA_SQL 兜底 →', err.message);
    }
    // 第二步：SCHEMA_SQL 兜底（IF NOT EXISTS，幂等）
    // 按分号切出每条 CREATE TABLE，逐条执行（语句里没有函数体，不会有多余的分号）
    const statements = SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean);
    for (const sql of statements) {
      const firstLine = sql.split('\n')[0]; // 日志里只打印 CREATE TABLE xxx 这一行
      try {
        await pool.query(sql);
        console.log('[db] 建表 OK：', firstLine);
      } catch (err) {
        console.error('[db] 建表失败：', firstLine, '→', err.message);
        return false;
      }
    }
    console.log('[db] 建表检查完成，共', statements.length, '条语句');
    return true;
  })().catch((err) => {
    console.error('[db] 建表异常：', err.message);
    return false;
  }).then((ok) => {
    if (!ok) _initPromise = null; // 失败了下次请求再试一次，不是一次失败就永久放弃
    return ok;
  });
  return _initPromise;
}

module.exports = { pool, query, initDb, runMigrations, SCHEMA_SQL };
