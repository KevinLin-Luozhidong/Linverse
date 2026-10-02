# Linverse 云端部署说明（Vercel + Supabase，全免费）

## 架构

```
手机浏览器
   │
   ▼
Vercel（linverse 项目）
   ├── /            → Vite 前端静态页面
   └── /api/*       → serverless 函数（frontend/api/index.js）
                        包着整个 Express 后端，URL 和字段名和原来一字不差
                           │
                           ▼
                      Supabase（免费版）
                           ├── Postgres 数据库（错题/笔记/词典/设置…）
                           └── Storage（linverse-uploads bucket，存图片）
```

本地开发也直连 Supabase（`cd backend && node server.js`），不再用 SQLite。

## 需要填的 4 个环境变量

去 **Vercel → linverse 项目 → Settings → Environment Variables** 添加
（Environment 选 Production，保存后要 Redeploy 才生效）：

| 变量名 | 去哪里找 |
|---|---|
| `DATABASE_URL` | Supabase 后台 → Project Settings → Database → Connection string → **Transaction pooler**（6543 端口那条），把里面的 `[YOUR-PASSWORD]` 换成你的数据库密码 |
| `SUPABASE_URL` | Supabase 后台 → Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase 后台 → Project Settings → API → `anon` `public` key（备用，前端以后直连 Supabase 时用，目前后端用不到） |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 后台 → Project Settings → API → `service_role` `secret` key |

⚠️ `SUPABASE_SERVICE_ROLE_KEY` 权限很大（能读写所有数据），**只能放 Vercel 后台**，
绝不能写进前端代码或发给任何人。

本地开发时把这 4 个写进 `backend/.env`（这个文件已进 .gitignore，不会提交）：
```
DATABASE_URL=postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-xxx.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

## Vercel 项目设置（必须开，否则后端函数打包不进去）

项目 → Settings → General → Root Directory：
勾选 **「Include source files outside of the Root Directory in the Build Step」**。
（因为 serverless 函数在 `frontend/api/` 里，但它要 `require('../../backend/src/app')`，
不打开这个开关，`backend/` 的文件不会被打包。）

## Supabase 建表（二选一）

1. **自动**：后端冷启动时会自动执行 `CREATE TABLE IF NOT EXISTS` 建表，什么都不用做。
2. **手动兜底**：Supabase 后台 → SQL Editor → 把 `supabase/schema.sql` 的内容粘贴进去执行。

图片 bucket（`linverse-uploads`）会在第一次上传时自动创建（公开读）。
如果自动创建失败，去 Supabase 后台 → Storage → New bucket，
名字填 `linverse-uploads`，打开 Public，保存即可。

## 花钱吗？

- Vercel Hobby：免费。
- Supabase 免费版：Postgres 500MB、Storage 1GB、每月额度够个人用。
都不用绑卡，没有 30 天到期。
