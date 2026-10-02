// 启动入口：npm start 跑的就是这个文件
require('dotenv').config(); // 读取 backend/.env（如 AI_API_KEY）
const app = require('./src/app');

// 端口可被环境变量 PORT 覆盖，默认 3001（按 API 契约）
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Linverse 后端已启动：http://localhost:${PORT}`);
});
