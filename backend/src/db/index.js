// ============================================================================
// 数据库连接 + 建表（Supabase Postgres）
//
// 连接：读环境变量 DATABASE_URL（Supabase 后台 → Database → Connection string
// → Transaction pooler，6543 端口）。serverless 函数必须走 pooler，不能直连
// 5432，否则函数实例一多会把数据库连接数打满。
//
// 建表：启动 / 冷启动时自动执行一次 CREATE TABLE IF NOT EXISTS（幂等），
// 表已存在就直接跳过。supabase/schema.sql 里还有一份同样的建表 SQL，
// 万一自动建表没跑成，可以去 Supabase 的 SQL 编辑器里手动执行兜底。
//
// 注意：Postgres 里不加引号的字段名会自动转成小写（profileId 会变成
// profileid，前端收到的字段名就变了）。所以下面所有驼峰字段名都用双引号
// 包起来（"profileId"），保证和原来 SQLite 版的字段名一字不差。
// ============================================================================
const { Pool } = require('pg');

// 连接池：serverless 环境下每个函数实例是短命的，池子不用大，
// 空闲连接及时回收，避免占着 Supabase 的连接数不放
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // 没配也不炸：用到时才真正连库
  max: 5, // 单实例最大连接数
  idleTimeoutMillis: 10000, // 空闲 10 秒就回收
  connectionTimeoutMillis: 10000, // 连不上 10 秒就报错，不无限卡住
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
  theme TEXT NOT NULL DEFAULT 'system', -- 默认跟随系统深浅色，用户可在设置页手动覆盖
  "aiProvider" TEXT NOT NULL DEFAULT 'demo',
  "aiModel" TEXT NOT NULL DEFAULT '',
  "aiEndpoint" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY ("profileId") REFERENCES profiles(id) ON DELETE CASCADE
);
`;

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
    // 主题默认跟随系统：老表只改默认值不影响已有行；
    // 之前被默认成 light 的行（用户没手动选过）一起迁到 system，真正实现"默认随系统"
    try {
      await pool.query(`ALTER TABLE settings ALTER COLUMN theme SET DEFAULT 'system'`);
      const r = await pool.query(`UPDATE settings SET theme = 'system' WHERE theme = 'light'`);
      console.log('[db] 主题已迁为跟随系统，影响行数：', r.rowCount);
    } catch (err) {
      console.error('[db] 主题迁移失败 →', err.message);
    }
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

module.exports = { pool, query, initDb, SCHEMA_SQL };
