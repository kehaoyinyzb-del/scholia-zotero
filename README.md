# Scholia for Zotero

Scholia 是 Zotero 10 的中文 PDF 阅读助手。在阅读器里就能针对当前页、选中的原文或前面的回答提问，也可以翻译、按章节总结，并把结果保存为 Zotero 子笔记。

## 安装

1. 下载 `scholia-0.15.0.xpi`。[GitHub Releases](https://github.com/kehaoyinyzb-del/scholia-zotero/releases/tag/v0.15.0)
2. 在 Zotero 打开 **工具 → 插件**，点击齿轮，选择 **从文件安装插件**。
3. 打开 PDF，点击工具栏的 **Scholia**。在 **Zotero 设置 → Scholia** 管理连接，配置行右侧可以删除该连接。

## 模型连接

| 入口 | 使用方式 |
| --- | --- |
| Codex · 用 ChatGPT 登录 | 通过本机 Codex 在系统浏览器授权 |
| Gemini · 用 Google 登录 | 需要发布方预先配置桌面 OAuth 客户端及项目权限。**本次 v0.15.0 公开预览包尚未开通真实 Google 账号登录** |
| Gemini（API Key） | 使用自己的 Gemini API 密钥 |
| OpenAI（GPT API） | 使用自己的 OpenAI API 密钥 |

支持从服务商目录选择模型，也可配置兼容的 Chat Completions 接口。使用在线模型时，插件会把本次问题及相应的文献材料发送给所选服务商；视具体操作，材料可能包含文本、页面图像或全文分段。API 密钥和 Google 刷新凭据保存在 Zotero 的本地登录管理器中。[连接与配额配置](docs/INSTALL.md)

## 从源码构建

已使用 Node.js 26、npm 和 Python 3 在 macOS 上构建。安装依赖后可依次运行以下命令。

```sh
npm ci
npm test
npm run build
```

产物在 `dist/`，包括 Zotero 插件 XPI、Chromium 和 Firefox 的网页导入扩展及 SHA-256 校验清单。在安装了 Zotero 10 的 macOS 上，可用 `npm run e2e -- --only model-chat` 在独立配置目录运行模型菜单和问答回归测试。该场景使用模拟服务商响应。

## 开源许可

项目原创代码采用 MIT 许可证。ECDICT 词典、KaTeX、Codex CLI 及测试材料分别保留对应许可。[MIT 许可证](LICENSE) · [第三方许可](THIRD-PARTY-LICENSES.md) · [测试材料](samples/SOURCES.md)
