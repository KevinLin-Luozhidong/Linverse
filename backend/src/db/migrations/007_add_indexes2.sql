-- 007_add_indexes2.sql —— 补第二批高频查询索引（003 漏掉的两处）
--
-- 人话：003 只补了“按账号查”的索引，但还有两处按其他条件查的走全表扫：
--   - 知识库按书分块：WHERE book ORDER BY page_start（按书查页）
--   - 错题按科目筛选：WHERE "profileId" AND subject（003 的索引只有 profileId + id，
--     按科目筛时仍要把该账号的错题全翻一遍）
-- 全部 IF NOT EXISTS，幂等，重跑不报错；迁移按编号顺序自动执行，已跑过的记在 schema_migrations 表里。
-- 不建的一处（已确认不用建）：笔记搜索是前导 % 的 LIKE，走不了 B-tree 索引，
-- 改 pg_trgm 是另一回事，先不动。

CREATE INDEX IF NOT EXISTS idx_kb_chunks_book_page
  ON kb_chunks (book, page_start);

CREATE INDEX IF NOT EXISTS idx_mistakes_profile_subject
  ON mistakes ("profileId", subject, id DESC);
