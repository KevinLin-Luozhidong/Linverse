-- 010：生词本去重（第三轮词典审查 MA-03）
-- 问题：vocabulary 表没有 (profileId, word) 唯一约束，前后端双重检查都有竞态，
-- 同一个词能插出两条。先清掉既有重复（每组留 id 最小的一条），再把 word 统一成
-- 小写去空格，最后建唯一索引；dao.createVocabulary 改成 ON CONFLICT DO NOTHING
-- 幂等写入，重复提交返回已有的那条。

-- 1. 清重复：同一账号、规范化后相同的词，只留 id 最小的一条
DELETE FROM vocabulary a USING vocabulary b
WHERE a."profileId" = b."profileId"
  AND lower(trim(a.word)) = lower(trim(b.word))
  AND a.id > b.id;

-- 2. 统一既有数据：word 全部小写去空格（之后写入也在 dao 层统一做）
UPDATE vocabulary SET word = lower(trim(word));

-- 3. 唯一索引：同一账号同一个词只能有一条
CREATE UNIQUE INDEX IF NOT EXISTS vocabulary_profile_word_unique
  ON vocabulary ("profileId", word);
