// ============================================================================
// 数据访问层（DAO）
// 这里是整个后端唯一直接碰数据库的地方：所有 SQL 都集中在这里。
//
// ★ Postgres 版说明（原来是 SQLite）：
//   - 占位符从 ? 换成 $1、$2……（pg 的规矩，顺序必须和 params 数组对上）
//   - 新增用 RETURNING * 直接拿回插入的行（原来靠 lastInsertRowid）
//   - INSERT OR IGNORE 换成 ON CONFLICT DO NOTHING
//   - 驼峰字段名（"profileId" 等）必须加双引号，否则 Postgres 会转成小写，
//     前端收到的字段名就变了；JS 代码里的变量名不受影响，不用动
//   - 每个函数都是 async 的，返回 Promise，上层路由记得加 await
//   - 函数名、参数、返回值格式和原来完全一致，routes 不用改逻辑，只加 await
// ============================================================================
const { query } = require('./index');

// ---------- 通用小工具 ----------

// 把前端传来的 0/1、true/false 统一转成数据库存的整数 0/1
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

// ---------- 全站配置（site_config：访问密码等） ----------

// 清空所有用户数据并重置 ID 自增：TRUNCATE 全部业务表。
// site_config 不动（访问密码保留）；RESTART IDENTITY 让 id 从 1 重新开始
async function resetAll() {
  await query(`TRUNCATE TABLE profiles, conversations, messages, mistakes, notes,
    vocabulary, word_history, checkins, settings RESTART IDENTITY`);
}

// 读配置：没有返回 null
async function getSiteConfig(key) {
  const r = await query('SELECT value FROM site_config WHERE key = $1', [key]);
  return r.rows[0] ? r.rows[0].value : null;
}

// 写配置：有则更新，无则插入
async function setSiteConfig(key, value) {
  await query(
    `INSERT INTO site_config (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

async function deleteSiteConfig(key) {
  await query(`DELETE FROM site_config WHERE key = $1`, [key]);
}

// ---------- 账号（profiles） ----------

async function listProfiles() {
  const r = await query('SELECT * FROM profiles ORDER BY id');
  return r.rows;
}

async function createProfile(name) {
  const r = await query('INSERT INTO profiles (name) VALUES ($1) RETURNING *', [name]);
  return r.rows[0];
}

async function updateProfile(id, name) {
  await query('UPDATE profiles SET name = $1 WHERE id = $2', [name, id]);
  const r = await query('SELECT * FROM profiles WHERE id = $1', [id]);
  return r.rows[0] || null;
}

// 换头像：存 Supabase Storage 的图片地址
async function setAvatar(id, url) {
  await query('UPDATE profiles SET avatar_url = $1 WHERE id = $2', [url, id]);
  const r = await query('SELECT * FROM profiles WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function deleteProfile(id) {
  // 外键带 CASCADE，删除账号会连带删除该账号的所有数据
  const r = await query('DELETE FROM profiles WHERE id = $1', [id]);
  return r.rowCount;
}

// ---------- 对话（conversations / messages） ----------

async function listConversations(profileId) {
  const r = await query(
    'SELECT * FROM conversations WHERE "profileId" = $1 ORDER BY id DESC',
    [profileId]
  );
  return r.rows;
}

async function getConversation(id, profileId) {
  const r = await query(
    'SELECT * FROM conversations WHERE id = $1 AND "profileId" = $2',
    [id, profileId]
  );
  const conv = r.rows[0] || null;
  if (!conv) return null;
  // 一次查出该对话的全部消息（按时间正序）
  const m = await query(
    'SELECT * FROM messages WHERE "conversationId" = $1 AND "profileId" = $2 ORDER BY id',
    [id, profileId]
  );
  conv.messages = m.rows;
  return conv;
}

async function createConversation(profileId, title) {
  const r = await query(
    'INSERT INTO conversations ("profileId", title) VALUES ($1, $2) RETURNING *',
    [profileId, title || '新的对话']
  );
  return r.rows[0];
}

async function addMessage(profileId, conversationId, role, content) {
  const r = await query(
    'INSERT INTO messages ("profileId", "conversationId", role, content) VALUES ($1, $2, $3, $4) RETURNING *',
    [profileId, conversationId, role, content]
  );
  return r.rows[0];
}

async function deleteConversation(id, profileId) {
  const r = await query(
    'DELETE FROM conversations WHERE id = $1 AND "profileId" = $2',
    [id, profileId]
  );
  return r.rowCount;
}

// ---------- 错题（mistakes） ----------

async function listMistakes(profileId, subject) {
  if (subject) {
    // 按科目筛选
    const r = await query(
      'SELECT * FROM mistakes WHERE "profileId" = $1 AND subject = $2 ORDER BY id DESC',
      [profileId, subject]
    );
    return r.rows;
  }
  const r = await query(
    'SELECT * FROM mistakes WHERE "profileId" = $1 ORDER BY id DESC',
    [profileId]
  );
  return r.rows;
}

async function createMistake(m) {
  const r = await query(
    `INSERT INTO mistakes ("profileId", subject, "questionText", "questionImageUrl", "answerText", "answerImageUrl", reason, mastered)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      m.profileId, m.subject || '', m.questionText || '', m.questionImageUrl || '',
      m.answerText || '', m.answerImageUrl || '', m.reason || '', bool(m.mastered),
    ]
  );
  return r.rows[0];
}

async function updateMistake(id, profileId, patch) {
  // 只更新传来的字段，避免覆盖没传的字段（$n 编号按 values 数组顺序来）
  const fields = [];
  const values = [];
  let i = 1;
  for (const k of ['subject', 'questionText', 'questionImageUrl', 'answerText', 'answerImageUrl', 'reason']) {
    if (patch[k] !== undefined) {
      fields.push(`"${k}" = $${i++}`);
      values.push(patch[k]);
    }
  }
  if (patch.mastered !== undefined) {
    fields.push(`mastered = $${i++}`);
    values.push(bool(patch.mastered));
  }
  if (fields.length === 0) {
    const r0 = await query(
      'SELECT * FROM mistakes WHERE id = $1 AND "profileId" = $2',
      [id, profileId]
    );
    return r0.rows[0] || null;
  }
  values.push(id, profileId);
  await query(
    `UPDATE mistakes SET ${fields.join(', ')} WHERE id = $${i++} AND "profileId" = $${i++}`,
    values
  );
  const r = await query(
    'SELECT * FROM mistakes WHERE id = $1 AND "profileId" = $2',
    [id, profileId]
  );
  return r.rows[0] || null;
}

async function deleteMistake(id, profileId) {
  const r = await query(
    'DELETE FROM mistakes WHERE id = $1 AND "profileId" = $2',
    [id, profileId]
  );
  return r.rowCount;
}

async function countMistakes(profileId) {
  const r = await query(
    'SELECT COUNT(*) AS n FROM mistakes WHERE "profileId" = $1',
    [profileId]
  );
  return Number(r.rows[0].n);
}

// ---------- 笔记（notes） ----------

async function listNotes(profileId, { q, tag, archived } = {}) {
  // 搜索/标签/归档都是可选条件，动态拼 SQL（$n 编号跟着 params 走）
  let sql = 'SELECT * FROM notes WHERE "profileId" = $1';
  const params = [profileId];
  let i = 2;
  if (q) {
    sql += ` AND (title LIKE $${i} OR content LIKE $${i + 1})`;
    params.push(`%${q}%`, `%${q}%`);
    i += 2;
  }
  if (tag) {
    sql += ` AND tags LIKE $${i}`;
    params.push(`%"${tag}"%`); // tags 存的是 JSON 数组，这里做简单的包含匹配
    i += 1;
  }
  if (archived !== undefined) {
    sql += ` AND archived = $${i}`;
    params.push(bool(archived === '1' || archived === 1 || archived === true));
    i += 1;
  }
  sql += ' ORDER BY pinned DESC, updated_at DESC'; // 置顶的排前面
  const r = await query(sql, params);
  return r.rows;
}

async function createNote(n) {
  const r = await query(
    `INSERT INTO notes ("profileId", title, content, images, tags, color, pinned, archived)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      n.profileId, n.title || '', n.content || '',
      JSON.stringify(n.images || []), JSON.stringify(n.tags || []),
      n.color || '', bool(n.pinned), bool(n.archived),
    ]
  );
  return r.rows[0];
}

async function updateNote(id, profileId, patch) {
  const fields = [];
  const values = [];
  let i = 1;
  for (const k of ['title', 'content', 'color']) {
    if (patch[k] !== undefined) {
      fields.push(`"${k}" = $${i++}`);
      values.push(patch[k]);
    }
  }
  for (const k of ['images', 'tags']) {
    if (patch[k] !== undefined) {
      fields.push(`"${k}" = $${i++}`);
      values.push(JSON.stringify(patch[k]));
    }
  }
  for (const k of ['pinned', 'archived']) {
    if (patch[k] !== undefined) {
      fields.push(`"${k}" = $${i++}`);
      values.push(bool(patch[k]));
    }
  }
  fields.push('updated_at = now()');
  values.push(id, profileId);
  await query(
    `UPDATE notes SET ${fields.join(', ')} WHERE id = $${i++} AND "profileId" = $${i++}`,
    values
  );
  const r = await query(
    'SELECT * FROM notes WHERE id = $1 AND "profileId" = $2',
    [id, profileId]
  );
  return r.rows[0] || null;
}

async function deleteNote(id, profileId) {
  const r = await query(
    'DELETE FROM notes WHERE id = $1 AND "profileId" = $2',
    [id, profileId]
  );
  return r.rowCount;
}

async function countNotes(profileId) {
  const r = await query(
    'SELECT COUNT(*) AS n FROM notes WHERE "profileId" = $1',
    [profileId]
  );
  return Number(r.rows[0].n);
}

// ---------- 生词本（vocabulary） ----------

// 记忆曲线间隔表（天）：1 → 3 → 7 → 15 → 30
const INTERVALS = [1, 3, 7, 15, 30];

async function listVocabulary(profileId) {
  const r = await query(
    'SELECT * FROM vocabulary WHERE "profileId" = $1 ORDER BY id DESC',
    [profileId]
  );
  return r.rows;
}

async function createVocabulary(v) {
  const r = await query(
    'INSERT INTO vocabulary ("profileId", word, phonetic, meaning) VALUES ($1, $2, $3, $4) RETURNING *',
    [v.profileId, v.word, v.phonetic || '', v.meaning || '']
  );
  return r.rows[0];
}

async function setVocabularyMastered(id, profileId, mastered) {
  await query(
    'UPDATE vocabulary SET mastered = $1 WHERE id = $2 AND "profileId" = $3',
    [bool(mastered), id, profileId]
  );
  const r = await query(
    'SELECT * FROM vocabulary WHERE id = $1 AND "profileId" = $2',
    [id, profileId]
  );
  return r.rows[0] || null;
}

// 复习一次：答对（known）按记忆曲线推进间隔，答错（unknown）重置为 1 天
async function reviewVocabulary(id, profileId, known) {
  const r0 = await query(
    'SELECT * FROM vocabulary WHERE id = $1 AND "profileId" = $2',
    [id, profileId]
  );
  const row = r0.rows[0] || null;
  if (!row) return null;
  let next;
  if (known) {
    // 找到当前间隔在间隔表中的位置，推进到下一档
    // 注意：pg 返回的字段名保持驼峰（建表时加了双引号），直接用 row.intervalDays
    const idx = INTERVALS.indexOf(Number(row.intervalDays));
    next = INTERVALS[Math.min(idx === -1 ? 0 : idx + 1, INTERVALS.length - 1)];
  } else {
    next = 1; // 答错了就回到 1 天，明天再看
  }
  // 计算下次复习日期：今天 + next 天
  const d = new Date();
  d.setDate(d.getDate() + next);
  const nextReview = d.toISOString().slice(0, 10);
  await query(
    'UPDATE vocabulary SET "intervalDays" = $1, "nextReview" = $2, "reviewCount" = "reviewCount" + 1 WHERE id = $3 AND "profileId" = $4',
    [next, nextReview, id, profileId]
  );
  const r = await query(
    'SELECT * FROM vocabulary WHERE id = $1 AND "profileId" = $2',
    [id, profileId]
  );
  return r.rows[0] || null;
}

// 今天该复习的词：nextReview <= 今天 且还没掌握
async function listDueVocabulary(profileId) {
  const r = await query(
    'SELECT * FROM vocabulary WHERE "profileId" = $1 AND mastered = 0 AND "nextReview" <= $2 ORDER BY "nextReview"',
    [profileId, today()]
  );
  return r.rows;
}

async function countWords(profileId) {
  const r = await query(
    'SELECT COUNT(*) AS n FROM vocabulary WHERE "profileId" = $1',
    [profileId]
  );
  return Number(r.rows[0].n);
}

// ---------- 查词历史（word_history） ----------

async function recordWordHistory(profileId, word) {
  // ON CONFLICT DO NOTHING：同一账号查过的词只保留一条（表上有 UNIQUE 约束）
  await query(
    'INSERT INTO word_history ("profileId", word) VALUES ($1, $2) ON CONFLICT ("profileId", word) DO NOTHING',
    [profileId, word]
  );
}

async function listWordHistory(profileId) {
  const r = await query(
    'SELECT word, looked_at AS "createdAt" FROM word_history WHERE "profileId" = $1 ORDER BY looked_at DESC',
    [profileId]
  );
  return r.rows;
}

// ---------- 打卡（checkins） ----------

async function checkin(profileId) {
  // 同一天重复打卡只记一次：UNIQUE("profileId", date) 保证，DO NOTHING 让重复打卡不报错
  await query(
    'INSERT INTO checkins ("profileId", date) VALUES ($1, $2) ON CONFLICT ("profileId", date) DO NOTHING',
    [profileId, today()]
  );
  return countCheckinDays(profileId);
}

async function countCheckinDays(profileId) {
  const r = await query(
    'SELECT COUNT(*) AS n FROM checkins WHERE "profileId" = $1',
    [profileId]
  );
  return Number(r.rows[0].n);
}

// 连续打卡天数：从今天（或昨天）往前数，断一天就停
async function streakDays(profileId) {
  const r = await query(
    'SELECT date FROM checkins WHERE "profileId" = $1 ORDER BY date DESC',
    [profileId]
  );
  const rows = r.rows.map((x) => x.date);
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

async function getSettings(profileId) {
  let r = await query('SELECT * FROM settings WHERE "profileId" = $1', [profileId]);
  if (r.rows.length === 0) {
    // 第一次访问自动建一行默认设置
    await query('INSERT INTO settings ("profileId") VALUES ($1)', [profileId]);
    r = await query('SELECT * FROM settings WHERE "profileId" = $1', [profileId]);
  }
  return r.rows[0];
}

async function updateSettings(profileId, patch) {
  await getSettings(profileId); // 确保行存在
  const fields = [];
  const values = [];
  let i = 1;
  for (const k of ['displayName', 'fontSize', 'theme', 'aiProvider', 'aiModel', 'aiEndpoint']) {
    if (patch[k] !== undefined) {
      fields.push(`"${k}" = $${i++}`);
      values.push(patch[k]);
    }
  }
  if (fields.length > 0) {
    values.push(profileId);
    await query(
      `UPDATE settings SET ${fields.join(', ')} WHERE "profileId" = $${i}`,
      values
    );
  }
  return getSettings(profileId);
}

module.exports = {
  today,
  listProfiles, createProfile, updateProfile, deleteProfile, setAvatar,
  listConversations, getConversation, createConversation, addMessage, deleteConversation,
  listMistakes, createMistake, updateMistake, deleteMistake, countMistakes,
  listNotes, createNote, updateNote, deleteNote, countNotes,
  listVocabulary, createVocabulary, setVocabularyMastered, reviewVocabulary,
  listDueVocabulary, countWords,
  recordWordHistory, listWordHistory,
  checkin, countCheckinDays, streakDays,
  getSettings, updateSettings,
  getSiteConfig, setSiteConfig, deleteSiteConfig, resetAll,
};
