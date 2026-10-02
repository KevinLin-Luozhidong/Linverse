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
| 多账号   | profiles 隔离：每个账号的数据完全独立，设置页可切换          |

## 本地运行

**环境要求**：Node.js 18+（推荐 20 LTS）。

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
├── backend/
│   ├── server.js        # 启动入口（npm start）
│   ├── uploads/         # 上传的图片（git 忽略）
│   ├── data/            # SQLite 数据库文件（git 忽略）
│   └── src/
│       ├── app.js       # Express 组装
│       ├── db/          # 数据访问层：建表 + DAO（以后换 Supabase 只需重写这一层）
│       ├── ai/          # AI provider 抽象：ask() 统一入口
│       └── routes/      # 各模块路由
├── package.json         # npm workspaces：frontend + backend
└── README.md
```

## 未来部署说明（简述）

- **前端**：Vercel 托管最省事——连上 GitHub 仓库后每次 push 自动构建部署，免费额度个人用足够；记得把后端 API 地址配成环境变量。
- **后端**：SQLite 是单机文件数据库，上云后换成 **Supabase 免费 Postgres**：在 Supabase 建项目、把表结构迁过去，然后只重写 `backend/src/db/` 这一层（DAO 函数签名不变，路由不用动）。
- **图片**：用户量上来后把 `backend/uploads/` 换成对象存储（如 Supabase Storage 或 Cloudflare R2），`/api/upload` 返回外链 URL 即可，前端不用改。
