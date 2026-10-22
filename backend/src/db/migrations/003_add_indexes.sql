-- 003_add_indexes.sql —— 给高频查询补普通 B-tree 索引
--
-- 人话：业务表几乎都按 "profileId"（哪个账号的）查数据，但建表时一个索引
-- 都没建，现在数据少不觉得，数据涨了每次查询都要把整张表翻一遍。本次给
-- 最常用的过滤/排序组合补上索引。全部 IF NOT EXISTS，幂等，重跑不报错。
-- 不建的两处（已确认不用建）：
--   - settings."profileId" 本身就是主键，自带索引；
--   - checkins 已有 UNIQUE("profileId", date) 唯一约束，自带同款索引；
--   - kb_chunks 的向量索引：embedding 是 2048 维，超过 pgvector 向量索引
--     2000 维上限，建了会报错；且当前 1116 块全表扫足够快，不动。

CREATE INDEX IF NOT EXISTS idx_mistakes_profile_id
  ON mistakes ("profileId", id DESC);

CREATE INDEX IF NOT EXISTS idx_notes_profile_updated
  ON notes ("profileId", updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_vocabulary_profile_due
  ON vocabulary ("profileId", mastered, "nextReview");

CREATE INDEX IF NOT EXISTS idx_conversations_profile_id
  ON conversations ("profileId", id DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
  ON messages ("conversationId", id);

CREATE INDEX IF NOT EXISTS idx_messages_profile_id
  ON messages ("profileId");

CREATE INDEX IF NOT EXISTS idx_word_history_profile_looked
  ON word_history ("profileId", looked_at DESC);
