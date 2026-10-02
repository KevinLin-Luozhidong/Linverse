// ============================================================================
// Vercel serverless 入口：把整个 Express 后端挂到 Vercel 函数上
//
// 关键认知（实测验证）：Express 的 app 本来就是一个 (req, res) 处理函数，
// Vercel 调函数时传的也是 (req, res)，所以直接 app(req, res) 就行，
// 不需要 serverless-http 那层包裹（实测那层在 Vercel 的调用方式下会卡死，
// 因为它只认 AWS Lambda 的 event 格式）。
//
// API 的 URL 和字段名和原来一字不差，前端不用改。
// 冷启动时先执行 initDb() 建表（幂等，表已存在就跳过），之后实例复用时跳过。
//
// ★ 重要：Vercel 项目设置里必须打开
//   「Include source files outside of the Root Directory in the Build Step」
//   （项目 → Settings → General → Root Directory），
//   否则 require('../../backend/src/app') 的文件不会被打包进函数。
// ============================================================================
const app = require('../../backend/src/app');
const { initDb } = require('../../backend/src/db');

let _ready = false;

module.exports = async (req, res) => {
  if (!_ready) {
    // 只有建表成功才标记 ready；失败的话下次请求会再试一次，
    // 不会因为一次冷启动失败就永久跳过建表
    _ready = await initDb();
  }
  app(req, res);
};
