-- 009：演示模式已删，settings.aiProvider 的新建行默认值从 'demo' 改成 'deepseek'
-- 只改默认值，不动已有行（已有行的 'demo' 由前端读出时映射成 deepseek）
ALTER TABLE settings ALTER COLUMN "aiProvider" SET DEFAULT 'deepseek';
