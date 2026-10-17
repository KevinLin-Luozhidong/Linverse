-- 002_theme_default_system.sql —— 主题默认跟随系统
--
-- 人话：之前 settings.theme 列的默认值是 'light'（浅色），后来决定默认跟随
-- 系统深浅色。只改列默认值不影响已有行；再把之前被默认成 light 的行
-- （用户没手动选过主题）一起迁到 system，真正实现"默认随系统"。
-- 幂等：重跑时 UPDATE 命中 0 行，不报错。
-- 原来这段逻辑散落在 index.js 的 initDb() 函数体里，现搬到版本化迁移里统一管理。

ALTER TABLE settings ALTER COLUMN theme SET DEFAULT 'system';
UPDATE settings SET theme = 'system' WHERE theme = 'light';
