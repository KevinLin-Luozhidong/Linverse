-- 006 会话收藏：给 conversations 加 favorite 标记（2026-10-24，用户要求会话可主动收藏）
-- 幂等：IF NOT EXISTS，线上库与新库都可反复执行
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_conversations_profile_favorite ON conversations ("profileId", favorite DESC, id DESC);
