// 小助手：包装 async 路由，出错时统一转成 JSON 500，避免服务崩溃
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// 参数缺失时的统一报错
function need(res, cond, msg) {
  if (!cond) {
    res.status(400).json({ error: msg });
    return true;
  }
  return false;
}

module.exports = { ah, need };
