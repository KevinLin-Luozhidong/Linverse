# Linverse

Linverse（学习宇宙）——专为中国高中生打造的 AI 学习助手：照着课本讲题，按考试的规矩答题。

## 简介

与通用 AI 不同，Linverse 结合高中课本与教辅知识回答问题，并严格按照考试答题规范组织答案——讲步骤、抓得分点，不只给结果。

## 功能

- **AI 助手**：随时提问，支持拍照问图；打字机流式输出、深度思考模式
- **错题本**：记录题目、正确答案、错因，按科目整理
- **笔记本**：课堂重点、解题方法，支持插入图片
- **词典**：音标、释义、例句、同义词、词性变化
- **个人中心**：连续打卡天数、刷题量统计

## 技术路线

- 当前：JavaScript / TypeScript（Web App）
- 未来：Swift（iOS 原生，API-first 架构，数据层复用）

## 状态

🚧 开发中（MVP 阶段）

---

## 功能列表

| 模块     | 说明                                                        |
| -------- | ----------------------------------------------------------- |
| AI 问答  | 选供应商（DeepSeek / Gemini / OpenAI / 自定义 / 演示模式），支持图片提问、深度思考开关，对话自动存档 |
| 拍照问图 | 图片上传后可直接问 AI 看图讲题；无 Key 时 OCR 接口诚实提示   |
| 错题本   | 按科目分类，记录题目 / 答案 / 错因，可标记"已掌握"           |
| 笔记本   | 支持插图、标签、颜色、置顶、归档，支持搜索                   |
| 生词本   | 记忆曲线复习（答对按 1/3/7/15/30 天推进，答错重置为 1 天），有"今日待复习" |
| 词典     | 英英释义 + 免费翻译的中文释义、音标、例句、同义词，查词自动进历史 |
| 个人中心 | 打卡（连续天数）、刷题/笔记/生词统计、4 枚成就徽章           |
| 多账号   | 每个账号有独立认证凭证；API 校验凭证与 profileId，阻止跨账号读写 |

## 账号安全与换设备

- 每个账号使用独立的随机恢复密钥；服务端只保存该密钥的 SHA-256 哈希。
- 设置页“多账号”中可以查看并复制当前账号的恢复密钥。换设备时需要同时提供账号 ID 和恢复密钥；**只知道账号 ID 不足以找回账号**。
- 请把恢复密钥保存在安全的地方。丢失密钥且无法从原设备导出时，服务端无法还原明文密钥。
- 旧版本账号首次迁移时，需要先设置全站访问密码，然后重新打开应用完成绑定。全站访问密码用于进站，账号恢复密钥用于区分账号所有权，两者不是同一个凭证。

- 知识库入库、标准问答入库和整本书删除需要额外的所有者管理会话；在设置页验证所有者密码后获得 30 分钟授权。普通账号凭证不能单独执行这些管理操作。

## 本地运行

**环境要求**：Node.js 22+（`package.json` 的 `engines` 字段声明，Vercel 会按此选择 serverless 函数运行时）。

```bash
# 1. 进入项目根目录，安装所有依赖（前后端一起装）
npm run install:all

# 2. 同时启动后端（:3001）和前端（:5173）
npm run dev

# 3. 浏览器打开 http://localhost:5173
```

只想单独起后端调试：

```bash
cd backend
npm install
npm start   # 跑在 http://localhost:3001
```

## AI Key 配置

两种方式，优先级：**请求时带的 Key ＞ 环境变量 `AI_API_KEY`**。

1. **环境变量**（推荐，Key 不经过前端）：在 `backend/` 下建 `.env`（已进 `.gitignore`，不会提交），写入 `AI_API_KEY=你的Key`
2. **前端设置页**：在 App 的设置页选择供应商并填写 Key，Key 会存在浏览器的 localStorage 里，每次问答时带给后端。

> ⚠️ 安全提醒：localStorage 存 Key 只适合**个人自用**。在公用设备上用完请删除 Key；如果要给多人用，请改走服务端代理模式（Key 只放服务端环境变量，前端不再存储）。

没配 Key 也能用：AI 会进入**演示模式**，返回带解题步骤的中文示例回答，并明确标注"演示模式"，不会伪装成真实 AI。OCR 接口无 Key 时会诚实返回 `{text:"", error:"需配置 AI Key"}`。

自定义供应商（比如本地 Ollama）：设置页填接口地址即可——
- 以 `/v1` 结尾的地址会自动拼 `/chat/completions`（OpenAI 兼容服务）；
- 只有根地址（如 `http://localhost:11434`）会走 Ollama 的 `/api/chat`；
- 写了完整路径的地址原样使用。

## 项目结构

```
linverse/
├── frontend/            # 前端（Vite + React + TypeScript）
│   ├── api/index.js     # Vercel serverless 入口：把 backend/src/app 整个 Express 应用挂上去
│   └── vercel.json      # /api/* → /api/index 的 rewrite 规则
├── backend/
│   ├── server.js        # 本地启动入口（npm start）
│   └── src/
│       ├── app.js       # Express 组装（鉴权网关、CORS、路由挂载）
│       ├── db/          # 数据访问层：index.js（连接+建表+版本化迁移）、dao.js、migrations/
│       ├── ai/          # AI provider 抽象：ask() 统一入口
│       └── routes/      # 各模块路由
├── supabase/
│   └── schema.sql       # 建表 SQL 手动兜底（和 backend 自动建表保持一致，改一边同步另一边）
├── package.json         # npm workspaces：frontend + backend
└── README.md
```

## 部署说明（当前方案）

**架构**：单个 Vercel 项目 ＋ Supabase Postgres（新加坡机房）。

- **Vercel**：项目的 Root Directory 设为 `frontend/`；前端构建产物和后端 API（`frontend/api/index.js` 把整个 Express 应用挂到 serverless 函数上）同项目部署。`frontend/vercel.json` 把 `/api/*` 请求 rewrite 到 `/api/index`。
  - ⚠️ Vercel 项目设置里必须打开「Include source files outside of the Root Directory in the Build Step」，否则 `require('../../backend/src/app')` 的文件不会被打包进函数。
- **数据库**：Supabase Postgres。应用冷启动时自动建表＋执行版本化迁移（`backend/src/db/migrations/`，幂等）；`supabase/schema.sql` 是手动兜底（Supabase → SQL Editor 粘贴执行）。
- **图片**：上传走 `/api/upload`（multer 内存模式）→ 存 Supabase Storage，返回 https 公开链接；serverless 函数无本地磁盘。

**环境变量**（Vercel → Settings → Environment Variables）：

| 变量 | 必填 | 说明 |
| ---- | ---- | ---- |
| `DATABASE_URL` | 是 | Supabase → Database → Connection string → **Transaction pooler（6543 端口）**。serverless 必须走 pooler，不能直连 5432，否则函数实例一多会打满连接数 |
| `CORS_ORIGINS` | 否 | 生产环境默认只允许同源；如需开放给其他域名，填 `https://a.com,https://b.com`（逗号分隔） |
| `AI_API_KEY` | 否 | 服务端 AI Key（推荐，Key 不经过前端）；不填则用前端设置页的 Key 或演示模式 |

**版本规则**：根目录、`backend/`、`frontend/` 三个 `package.json` 的 `version` 必须一致（当前 `0.3.1`）。发版时同步改三处。

**预览版 vs 正式版**：`frontend/src/preview/` 是纯前端演示（数据存浏览器 localStorage，不连后端）；正式版走 `frontend/src/api.ts` 调后端 API。两套 API 封装字段名保持一致。
