-- 008_add_kb_profile_id.sql —— 知识库表预留用户字段
--
-- 人话：需求文档第 7 节早就要求"所有表预留用户字段"，但 kb_chunks / kb_faq 两张
-- 知识库表一直没有。profile_id = 0 表示全站共享（现有三本教材都按共享算），
-- 以后某人自建库就写自己的 profileId；检索时按 profile_id IN (0, 当前用户) 过滤。
-- 现有数据零破坏：新列 NOT NULL DEFAULT 0，老行自动变成共享。
-- 全部 IF NOT EXISTS，幂等，重跑不报错。
ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS profile_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kb_faq ADD COLUMN IF NOT EXISTS profile_id INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_kb_chunks_profile_id ON kb_chunks (profile_id);
CREATE INDEX IF NOT EXISTS idx_kb_faq_profile_id ON kb_faq (profile_id);
