-- 011：消息元数据（引用块持久化）
-- 问题：kbRefs（RAG 引用块）只在 /ask 当次响应里返回，重进历史会话就没了，
-- 因为 messages 表没有地方存它。
-- 做法：加一个 metadata JSONB 列，assistant 消息存 { kbRefs: [...] }，user 消息
-- 存 '{}'（默认）。前端读历史时从 metadata.kbRefs 还原引用块。
-- 安全：Postgres 11+ 带常量默认值的 ADD COLUMN 是元数据操作，不重写表、
-- 不逐行回填；IF NOT EXISTS 让重跑和多实例并发都安全（先直接对线上库执行
-- 验证过，再随代码部署；部署时本文件再次执行为空操作）。
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
