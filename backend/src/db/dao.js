// ============================================================================
// 数据访问层（DAO）
// 这里是整个后端唯一直接碰 SQLite 的地方：所有 SQL 都集中在这里。
//
// ★ 以后换 Supabase Postgres，只需重写这个文件：
//   保持每个函数的名字、参数、返回值格式不变，上层 routes 不用改一行。
// ============================================================================
const db = require('./index');

// ---------- 通用小工具 ----------

// 把前端传来的 0/1、true/false 统一转成 SQLite 存的整数 0/1
function bool(v) {
  return v ? 1 : 0;
}

// 今天的日期字符串 YYYY-MM-DD（按服务器本地时区）
function today() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// ---------- 账号（profiles） ----------

function listProfiles() {
  return db.prepare('SELECT * FROM profiles ORDER BY id').all();
}

function createProfile(name) {
  const r = db.prepare('INSERT INTO profiles (name) VALUES (?)').run(name);
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(r.lastInsertRowid);
}

function updateProfile(id, name) {
  db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run(name, id);
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
}

function deleteProfile(id) {
  // 外键带 CASCADE，删除账号会连带删除该账号的所有数据
  return db.prepare('DELETE FROM profiles WHERE id = ?').run(id).changes;
}

// ---------- 对话（conversations / messages） ----------

function listConversations(profileId) {
  return db
    .prepare('SELECT * FROM conversations WHERE profileId = ? ORDER BY id DESC')
    .all(profileId);
}

function getConversation(id, profileId) {
  const conv = db
    .prepare('SELECT * FROM conversations WHERE id = ? AND profileId = ?')
    .get(id, profileId);
  if (!conv) return null;
  // 一次查出该对话的全部消息（按时间正序）
  conv.messages = db
    .prepare('SELECT * FROM messages WHERE conversationId = ? AND profileId = ? ORDER BY id')
    .all(id, profileId);
  return conv;
}

function createConversation(profileId, title) {
  const r = db
    .prepare('INSERT INTO conversations (profileId, title) VALUES (?, ?)')
    .run(profileId, title || '新的对话');
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(r.lastInsertRowid);
}

function addMessage(profileId, conversationId, role, content) {
  const r = db
    .prepare(
      'INSERT INTO messages (profileId, conversationId, role, content) VALUES (?, ?, ?, ?)'
    )
    .run(profileId, conversationId, role, content);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(r.lastInsertRowid);
}

function deleteConversation(id, profileId) {
  return db
    .prepare('DELETE FROM conversations WHERE id = ? AND profileId = ?')
    .run(id, profileId).changes;
}

// ---------- 错题（mistakes） ----------

function listMistakes(profileId, subject) {
  if (subject) {
    // 按科目筛选
    return db
      .prepare('SELECT * FROM mistakes WHERE profileId = ? AND subject = ? ORDER BY id DESC')
      .all(profileId, subject);
  }
  return db
    .prepare('SELECT * FROM mistakes WHERE profileId = ? ORDER BY id DESC')
    .all(profileId);
}

function createMistake(m) {
  const r = db
    .prepare(
      `INSERT INTO mistakes (profileId, subject, questionText, questionImageUrl, answerText, answerImageUrl, reason, mastered)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      m.profileId, m.subject || '', m.questionText || '', m.questionImageUrl || '',
      m.answerText || '', m.answerImageUrl || '', m.reason || '', bool(m.mastered)
    );
  return db.prepare('SELECT * FROM mistakes WHERE id = ?').get(r.lastInsertRowid);
}

function updateMistake(id, profileId, patch) {
  // 只更新传来的字段，避免覆盖没传的字段
  const fields = [];
  const values = [];
  for (const k of ['subject', 'questionText', 'questionImageUrl', 'answerText', 'answerImageUrl', 'reason']) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(patch[k]);
    }
  }
  if (patch.mastered !== undefined) {
    fields.push('mastered = ?');
    values.push(bool(patch.mastered));
  }
  if (fields.length === 0) {
    return db.prepare('SELECT * FROM mistakes WHERE id = ? AND profileId = ?').get(id, profileId);
  }
  values.push(id, profileId);
  db.prepare(`UPDATE mistakes SET ${fields.join(', ')} WHERE id = ? AND profileId = ?`).run(...values);
  return db.prepare('SELECT * FROM mistakes WHERE id = ? AND profileId = ?').get(id, profileId);
}

function deleteMistake(id, profileId) {
  return db
    .prepare('DELETE FROM mistakes WHERE id = ? AND profileId = ?')
    .run(id, profileId).changes;
}

function countMistakes(profileId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM mistakes WHERE profileId = ?')
    .get(profileId).n;
}

// ---------- 笔记（notes） ----------

function listNotes(profileId, { q, tag, archived } = {}) {
  // 搜索/标签/归档都是可选条件，动态拼 SQL
  let sql = 'SELECT * FROM notes WHERE profileId = ?';
  const params = [profileId];
  if (q) {
    sql += ' AND (title LIKE ? OR content LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (tag) {
    sql += ' AND tags LIKE ?';
    params.push(`%"${tag}"%`); // tags 存的是 JSON 数组，这里做简单的包含匹配
  }
  if (archived !== undefined) {
    sql += ' AND archived = ?';
    params.push(bool(archived === '1' || archived === 1 || archived === true));
  }
  sql += ' ORDER BY pinned DESC, updated_at DESC'; // 置顶的排前面
  return db.prepare(sql).all(...params);
}

function createNote(n) {
  const r = db
    .prepare(
      `INSERT INTO notes (profileId, title, content, images, tags, color, pinned, archived)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      n.profileId, n.title || '', n.content || '',
      JSON.stringify(n.images || []), JSON.stringify(n.tags || []),
      n.color || '', bool(n.pinned), bool(n.archived)
    );
  return db.prepare('SELECT * FROM notes WHERE id = ?').get(r.lastInsertRowid);
}

function updateNote(id, profileId, patch) {
  const fields = [];
  const values = [];
  for (const k of ['title', 'content', 'color']) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(patch[k]);
    }
  }
  for (const k of ['images', 'tags']) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(JSON.stringify(patch[k]));
    }
  }
  for (const k of ['pinned', 'archived']) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(bool(patch[k]));
    }
  }
  fields.push("updated_at = datetime('now')");
  values.push(id, profileId);
  db.prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ? AND profileId = ?`).run(...values);
  return db.prepare('SELECT * FROM notes WHERE id = ? AND profileId = ?').get(id, profileId);
}

function deleteNote(id, profileId) {
  return db
    .prepare('DELETE FROM notes WHERE id = ? AND profileId = ?')
    .run(id, profileId).changes;
}

function countNotes(profileId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM notes WHERE profileId = ?')
    .get(profileId).n;
}

// ---------- 生词本（vocabulary） ----------

// 记忆曲线间隔表（天）：1 → 3 → 7 → 15 → 30
const INTERVALS = [1, 3, 7, 15, 30];

function listVocabulary(profileId) {
  return db
    .prepare('SELECT * FROM vocabulary WHERE profileId = ? ORDER BY id DESC')
    .all(profileId);
}

function createVocabulary(v) {
  const r = db
    .prepare(
      'INSERT INTO vocabulary (profileId, word, phonetic, meaning) VALUES (?, ?, ?, ?)'
    )
    .run(v.profileId, v.word, v.phonetic || '', v.meaning || '');
  return db.prepare('SELECT * FROM vocabulary WHERE id = ?').get(r.lastInsertRowid);
}

function setVocabularyMastered(id, profileId, mastered) {
  db.prepare('UPDATE vocabulary SET mastered = ? WHERE id = ? AND profileId = ?')
    .run(bool(mastered), id, profileId);
  return db.prepare('SELECT * FROM vocabulary WHERE id = ? AND profileId = ?').get(id, profileId);
}

// 复习一次：答对（known）按记忆曲线推进间隔，答错（unknown）重置为 1 天
function reviewVocabulary(id, profileId, known) {
  const row = db
    .prepare('SELECT * FROM vocabulary WHERE id = ? AND profileId = ?')
    .get(id, profileId);
  if (!row) return null;
  let next;
  if (known) {
    // 找到当前间隔在间隔表中的位置，推进到下一档
    const idx = INTERVALS.indexOf(row.intervalDays);
    next = INTERVALS[Math.min(idx === -1 ? 0 : idx + 1, INTERVALS.length - 1)];
  } else {
    next = 1; // 答错了就回到 1 天，明天再看
  }
  // 计算下次复习日期：今天 + next 天
  const d = new Date();
  d.setDate(d.getDate() + next);
  const nextReview = d.toISOString().slice(0, 10);
  db.prepare(
    'UPDATE vocabulary SET intervalDays = ?, nextReview = ?, reviewCount = reviewCount + 1 WHERE id = ? AND profileId = ?'
  ).run(next, nextReview, id, profileId);
  return db.prepare('SELECT * FROM vocabulary WHERE id = ? AND profileId = ?').get(id, profileId);
}

// 今天该复习的词：nextReview <= 今天 且还没掌握
function listDueVocabulary(profileId) {
  return db
    .prepare(
      'SELECT * FROM vocabulary WHERE profileId = ? AND mastered = 0 AND nextReview <= ? ORDER BY nextReview'
    )
    .all(profileId, today());
}

function countWords(profileId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM vocabulary WHERE profileId = ?')
    .get(profileId).n;
}

// ---------- 查词历史（word_history） ----------

function recordWordHistory(profileId, word) {
  // INSERT OR IGNORE：同一账号查过的词只保留一条（表上有 UNIQUE 约束）
  db.prepare('INSERT OR IGNORE INTO word_history (profileId, word) VALUES (?, ?)').run(profileId, word);
}

function listWordHistory(profileId) {
  return db
    .prepare('SELECT * FROM word_history WHERE profileId = ? ORDER BY looked_at DESC')
    .all(profileId);
}

// ---------- 打卡（checkins） ----------

function checkin(profileId) {
  // 同一天重复打卡只记一次：UNIQUE(profileId, date) 保证，IGNORE 让重复打卡不报错
  db.prepare('INSERT OR IGNORE INTO checkins (profileId, date) VALUES (?, ?)')
    .run(profileId, today());
  return db
    .prepare('SELECT COUNT(*) AS n FROM checkins WHERE profileId = ?')
    .get(profileId).n;
}

function countCheckinDays(profileId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM checkins WHERE profileId = ?')
    .get(profileId).n;
}

// 连续打卡天数：从今天（或昨天）往前数，断一天就停
function streakDays(profileId) {
  const rows = db
    .prepare('SELECT date FROM checkins WHERE profileId = ? ORDER BY date DESC')
    .all(profileId)
    .map((r) => r.date);
  if (rows.length === 0) return 0;
  const set = new Set(rows);
  // 今天没打卡就从昨天开始算（否则 streak 会因为"今天还没打卡"被清零）
  let cursor = new Date();
  const t = today();
  if (!set.has(t)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    if (!set.has(key)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ---------- 设置（settings，一个账号一行） ----------

function getSettings(profileId) {
  let s = db.prepare('SELECT * FROM settings WHERE profileId = ?').get(profileId);
  if (!s) {
    // 第一次访问自动建一行默认设置
    db.prepare('INSERT INTO settings (profileId) VALUES (?)').run(profileId);
    s = db.prepare('SELECT * FROM settings WHERE profileId = ?').get(profileId);
  }
  return s;
}

function updateSettings(profileId, patch) {
  getSettings(profileId); // 确保行存在
  const fields = [];
  const values = [];
  for (const k of ['displayName', 'fontSize', 'theme', 'aiProvider', 'aiModel', 'aiEndpoint']) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(patch[k]);
    }
  }
  if (fields.length > 0) {
    values.push(profileId);
    db.prepare(`UPDATE settings SET ${fields.join(', ')} WHERE profileId = ?`).run(...values);
  }
  return getSettings(profileId);
}

module.exports = {
  today,
  listProfiles, createProfile, updateProfile, deleteProfile,
  listConversations, getConversation, createConversation, addMessage, deleteConversation,
  listMistakes, createMistake, updateMistake, deleteMistake, countMistakes,
  listNotes, createNote, updateNote, deleteNote, countNotes,
  listVocabulary, createVocabulary, setVocabularyMastered, reviewVocabulary,
  listDueVocabulary, countWords,
  recordWordHistory, listWordHistory,
  checkin, countCheckinDays, streakDays,
  getSettings, updateSettings,
};
