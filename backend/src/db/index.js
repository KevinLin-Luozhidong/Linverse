// ============================================================================
// 数据库连接 + 建表
// 注意：以后要换 Supabase Postgres，只需重写 src/db/ 这一层目录，
// 每个函数的「接口签名」（名字、参数、返回值）保持不变，上层路由代码不用动。
// ============================================================================
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// 数据库文件位置：
// - 本地开发：backend/data/linverse.db（data 目录已进 .gitignore，不会提交）
// - 云端（Railway）：设置环境变量 DATA_DIR=/data，并挂一个 Volume 到 /data，
//   数据库和上传图片都会写进 Volume，重新部署不丢数据
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'linverse.db'));
db.pragma('journal_mode = WAL'); // 写前日志，读写并发更稳
db.pragma('foreign_keys = ON');

// ---------- 建表（所有个人数据表都带 profileId，用于多账号隔离） ----------
db.exec(`
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profileId INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '新的对话',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profileId INTEGER NOT NULL,
  conversationId INTEGER NOT NULL,
  role TEXT NOT NULL,          -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mistakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profileId INTEGER NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  questionText TEXT NOT NULL DEFAULT '',
  questionImageUrl TEXT NOT NULL DEFAULT '',
  answerText TEXT NOT NULL DEFAULT '',
  answerImageUrl TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  mastered INTEGER NOT NULL DEFAULT 0,   -- 0 未掌握 / 1 已掌握
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profileId INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',     -- JSON 数组
  tags TEXT NOT NULL DEFAULT '[]',       -- JSON 数组
  color TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vocabulary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profileId INTEGER NOT NULL,
  word TEXT NOT NULL,
  phonetic TEXT NOT NULL DEFAULT '',
  meaning TEXT NOT NULL DEFAULT '',
  mastered INTEGER NOT NULL DEFAULT 0,
  intervalDays INTEGER NOT NULL DEFAULT 1,   -- 记忆曲线：下次复习间隔（天）
  nextReview TEXT NOT NULL DEFAULT (date('now')),
  reviewCount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS word_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profileId INTEGER NOT NULL,
  word TEXT NOT NULL,
  looked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (profileId, word),   -- 同一账号查过的词只保留一条
  FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profileId INTEGER NOT NULL,
  date TEXT NOT NULL,          -- YYYY-MM-DD
  UNIQUE (profileId, date),    -- 同一天只记一次
  FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  profileId INTEGER PRIMARY KEY,         -- 一个账号一行
  displayName TEXT NOT NULL DEFAULT '',
  fontSize TEXT NOT NULL DEFAULT 'medium',
  theme TEXT NOT NULL DEFAULT 'light',
  aiProvider TEXT NOT NULL DEFAULT 'demo',
  aiModel TEXT NOT NULL DEFAULT '',
  aiEndpoint TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE
);
`);

module.exports = db;
