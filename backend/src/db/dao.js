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
const { query, pool } = require('./index');

// ---------- 鉴权短缓存（2026-10-22 优化） ----------
// 人话：几乎每个接口进来都要查一次库验密码/账号凭证，其实这些值很少变。
// 给最稳定的几个值加 30 秒进程内缓存，少跑很多趟数据库。
// 注意：serverless 多实例之间缓存不互通，30 秒 TTL 就是为此留的余地，
// 过期后仍以数据库为准；改密码等写操作会同步刷新缓存，立即生效。
const AUTH_CACHE_TTL_MS = 30 * 1000;
// 只缓存这几个稳定的鉴权键；限流计数（site_verify_fail_* 等）变得勤，绝不缓存
const CACHED_CONFIG_KEYS = new Set([
  'site_password_hash',
  'danger_password_hash',
  'owner_session_hash',
  'owner_session_expires',
]);
const configCache = new Map(); // key -> { value, at }
const profileAuthCache = new Map(); // String(profileId) -> { value, at }

function cacheGet(map, key) {
  const hit = map.get(key);
  if (!hit) return { found: false };
  if (Date.now() - hit.at > AUTH_CACHE_TTL_MS) {
    map.delete(key);
    return { found: false };
  }
  return { found: true, value: hit.value };
}

function cacheSet(map, key, value) {
  map.set(key, { value, at: Date.now() });
}

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
  profileAuthCache.clear(); // 账号全没了，鉴权缓存一起清掉
}

// 读配置：没有返回 null。白名单内的鉴权键先看缓存（含缓存住的 null，避免反复查空）
async function getSiteConfig(key) {
  if (CACHED_CONFIG_KEYS.has(key)) {
    const hit = cacheGet(configCache, key);
    if (hit.found) return hit.value;
  }
  const r = await query('SELECT value FROM site_config WHERE key = $1', [key]);
  const value = r.rows[0] ? r.rows[0].value : null;
  if (CACHED_CONFIG_KEYS.has(key)) cacheSet(configCache, key, value);
  return value;
}

// 写配置：有则更新，无则插入。写成功后同步刷新缓存，改密码立即生效不用等 TTL
async function setSiteConfig(key, value) {
  await query(
    `INSERT INTO site_config (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
  if (CACHED_CONFIG_KEYS.has(key)) cacheSet(configCache, key, value);
}


// ---------- 账号（profiles） ----------

async function listProfiles(profileId) {
  const r = await query(
    'SELECT id, name, avatar_url FROM profiles WHERE id = $1',
    [profileId]
  );
  return r.rows;
}

async function getProfileAuthHash(id) {
  const hit = cacheGet(profileAuthCache, String(id));
  if (hit.found) return hit.value;
  const r = await query('SELECT auth_token_hash FROM profiles WHERE id = $1', [id]);
  const value = r.rows[0] ? r.rows[0].auth_token_hash : null;
  cacheSet(profileAuthCache, String(id), value);
  return value;
}

async function createProfile(name, tokenHash) {
  const r = await query(
    'INSERT INTO profiles (name, auth_token_hash) VALUES ($1, $2) RETURNING id, name, avatar_url',
    [name, tokenHash]
  );
  if (r.rows[0]) cacheSet(profileAuthCache, String(r.rows[0].id), tokenHash);
  return r.rows[0];
}

// 仅用于旧账号迁移：只能给尚未绑定凭证的账号设置一次，避免覆盖现有所有者。
async function claimProfile(id, tokenHash) {
  const r = await query(
    'UPDATE profiles SET auth_token_hash = $1 WHERE id = $2 AND auth_token_hash IS NULL RETURNING id, name, avatar_url',
    [tokenHash, id]
  );
  if (r.rows[0]) cacheSet(profileAuthCache, String(id), tokenHash);
  return r.rows[0] || null;
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
  if (r.rowCount > 0) profileAuthCache.delete(String(id));
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

async function clearWordHistory(profileId) {
  const r = await query('DELETE FROM word_history WHERE "profileId" = $1', [profileId]);
  return r.rowCount;
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

async function recentCheckinDates(profileId, days = 7) {
  const r = await query(
    'SELECT date FROM checkins WHERE "profileId" = $1 ORDER BY date DESC LIMIT $2',
    [profileId, days]
  );
  return r.rows.map((x) => x.date);
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
  listProfiles, getProfileAuthHash, createProfile, claimProfile, updateProfile, deleteProfile, setAvatar,
  listConversations, getConversation, createConversation, addMessage, deleteConversation,
  listMistakes, createMistake, updateMistake, deleteMistake, countMistakes,
  listNotes, createNote, updateNote, deleteNote, countNotes,
  listVocabulary, createVocabulary, setVocabularyMastered, reviewVocabulary,
  listDueVocabulary, countWords,
  recordWordHistory, listWordHistory, clearWordHistory,
  checkin, countCheckinDays, streakDays,
  getSettings, updateSettings,
  getSiteConfig, setSiteConfig, resetAll, recentCheckinDates,
  kbCount, kbClear, kbInsertBatch, kbReplaceBatch, kbSearch, kbKeywordSearch, kbBookStats, kbDeleteBook,
  kbFaqSearch, kbFaqInsertBatch,
};

// ---------- RAG 知识库 ----------
// 表 kb_chunks：book/chapter/section/page_start/page_end/text/embedding(vector 2048)
// 注意：embedding 用 pgvector 存，SQL 里拼成 '[0.1,0.2,...]' 字面量 + ::vector 强转。

async function kbCount() {
  const r = await query('SELECT COUNT(*)::int AS c FROM kb_chunks');
  return r.rows[0].c;
}

// 原子替换整本知识库：清空与批量插入必须在同一连接/事务里完成。
async function kbReplaceBatch(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error('kbReplaceBatch requires a non-empty chunks array');
  }
  const vals = [];
  const params = [];
  chunks.forEach((c, i) => {
    const b = i * 7;
    vals.push(`(${b + 1},${b + 2},${b + 3},${b + 4},${b + 5},${b + 6},${b + 7}::vector)`);
    params.push(
      c.book || '', c.chapter || '', c.section || '',
      c.page_start || 0, c.page_end || 0, c.text || '',
      '[' + (c.embedding || []).join(',') + ']'
    );
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM kb_chunks');
    const r = await client.query(
      `INSERT INTO kb_chunks (book, chapter, section, page_start, page_end, text, embedding)
       VALUES ${vals.join(',')}`,
      params
    );
    await client.query('COMMIT');
    return r.rowCount;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// 按书统计：每本书的块数（文字/图片分开）、入库时间。知识库管理页用。
async function kbBookStats() {
  const r = await query(
    `SELECT book,
            COALESCE(COUNT(*)::int, 0) AS chunks,
            COALESCE(SUM(CASE WHEN text LIKE '【教材插图】%' THEN 1 ELSE 0 END)::int, 0) AS fig_chunks,
            COALESCE(COUNT(*)::int, 0) - COALESCE(SUM(CASE WHEN text LIKE '【教材插图】%' THEN 1 ELSE 0 END)::int, 0) AS text_chunks,
            MIN(created_at) AS first_ingest,
            MAX(created_at) AS last_ingest
     FROM kb_chunks
     GROUP BY book
     ORDER BY MIN(created_at) ASC`
  );
  return r.rows;
}

// 按书名删除整本书的知识块（知识库管理页的删除按钮用，前端必须二次确认）
// 同时清除该书在 kb_faq 的标准问答，两步在同一个事务里保证原子性。
async function kbDeleteBook(book) {
  // 事务内必须复用同一个 client；pool.query 会在每次调用时独立借还连接，
  // 不能保证 BEGIN / DELETE / COMMIT 落在同一条数据库连接上。
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('DELETE FROM kb_chunks WHERE book = $1', [book]);
    await client.query('DELETE FROM kb_faq WHERE book = $1', [book]);
    await client.query('COMMIT');
    return r.rowCount;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

async function kbClear() {
  await query('DELETE FROM kb_chunks');
}

// 批量入库：chunks = [{book, chapter, section, page_start, page_end, text, embedding:[2048]}]
// 一次拼多行 VALUES，单次建议 ≤100 块（Vercel 请求体 4.5MB 上限）
async function kbInsertBatch(chunks) {
  if (!chunks.length) return 0;
  const vals = [];
  const params = [];
  chunks.forEach((c, i) => {
    const b = i * 7;
    vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::vector)`);
    params.push(
      c.book || '', c.chapter || '', c.section || '',
      c.page_start || 0, c.page_end || 0, c.text || '',
      '[' + (c.embedding || []).join(',') + ']'
    );
  });
  const r = await query(
    `INSERT INTO kb_chunks (book, chapter, section, page_start, page_end, text, embedding)
     VALUES ${vals.join(',')}`,
    params
  );
  return r.rowCount;
}

// 向量检索：embedding 是 2048 维数组，按余弦距离（<=>）取最相关的 topK 块。
// 数据量小（几百块）直接全表扫，毫秒级，不建索引。
async function kbSearch(embedding, topK = 5) {
  const vec = '[' + embedding.join(',') + ']';
  const r = await query(
    `SELECT book, chapter, section, page_start, page_end, text,
            (embedding <=> $1::vector) AS distance
     FROM kb_chunks
     ORDER BY distance ASC
     LIMIT $2`,
    [vec, topK]
  );
  return r.rows;
}

// 高频问答检索：把问题转成向量，在 kb_faq 里找最像的一道标准问答，
// 返回余弦距离最小的一条（调用方按阈值决定是否采用）。
async function kbFaqSearch(embedding) {
  const vec = '[' + embedding.join(',') + ']';
  const r = await query(
    `SELECT book, chapter, question, answer, page_start, page_end,
            (embedding <=> $1::vector) AS distance
     FROM kb_faq
     ORDER BY distance ASC
     LIMIT 1`,
    [vec]
  );
  return r.rows;
}

// 高频问答入库：items = [{book, chapter, question, answer, page_start, page_end, embedding:[2048]}]
async function kbFaqInsertBatch(items) {
  if (!items.length) return 0;
  const vals = [];
  const params = [];
  items.forEach((c, i) => {
    const b = i * 7;
    vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::vector)`);
    params.push(
      c.book || '', c.chapter || '', c.question || '', c.answer || '',
      c.page_start ?? 0, c.page_end ?? 0,
      '[' + (c.embedding || []).join(',') + ']'
    );
  });
  const r = await query(
    `INSERT INTO kb_faq (book, chapter, question, answer, page_start, page_end, embedding)
     VALUES ${vals.join(',')}`,
    params
  );
  return r.rowCount;
}

// 关键词检索：和向量检索互补。向量懂同义（如"定义"≈"含义"），关键词保精确
// （如数学符号 card(A)、"韦恩图"这种生僻术语向量容易搜偏）。
// 中文不分词，直接拆 2-gram 做 ILIKE 模糊匹配，按命中不同 gram 数排序。
async function kbKeywordSearch(question, limit = 9) {
  const t = String(question || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  const grams = [];
  const seen = new Set();
  for (let i = 0; i + 1 < t.length && grams.length < 20; i++) {
    const g = t.slice(i, i + 2);
    if (!seen.has(g)) { seen.add(g); grams.push(g); }
  }
  if (!grams.length) return [];
  const n = grams.length;
  const where = grams.map((_, i) => `text ILIKE $${i + 1}`).join(' OR ');
  const score = grams.map((_, i) => `(CASE WHEN text ILIKE $${n + i + 1} THEN 1 ELSE 0 END)`).join(' + ');
  const params = grams.map((g) => `%${g}%`);
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 20) : 9;
  const r = await query(
    `SELECT book, chapter, section, page_start, page_end, text, (${score}) AS hits
     FROM kb_chunks WHERE ${where}
     ORDER BY hits DESC, id ASC LIMIT ${safeLimit}`,
    params.concat(params)
  );
  return r.rows;
}
