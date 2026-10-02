# Linverse 单文件预览包

`preview.html`：把前端打成**一个独立 HTML**（JS/CSS 全内联），手机浏览器直接打开就能点，不依赖后端。

## 数据
全部走浏览器 `localStorage`（演示模式），源码在 `frontend/src/preview/demoApi.ts`，
函数名/签名与 `frontend/src/api.ts` 完全一致，构建时靠 vite alias 切换：

- 正常联调版：`vite.config.ts` 把 `@api` 指向 `src/api.ts`
- 预览版：`vite.preview.config.ts` 把 `@api` 指向 `src/preview/demoApi.ts`

## 重新打包
```bash
cd frontend
npm run build:preview   # 产物 dist-preview/index.html
cp dist-preview/index.html ../preview/preview.html
```

## 说明
- AI 问答：设置页自填 Key 后走浏览器直连供应商（DeepSeek/OpenAI 兼容接口、Gemini），不填 Key 走内置演示回答
- 照片：canvas 等比缩放 + JPEG 质量循环，单张压到 200KB 以内
- localStorage 上限 4MB，超了会提示"空间不足，删一些带图内容再试"
- `shots/`：无头 Chrome 验收截图（含预览版点击验证）
