# Scholia · 安装与开始使用

适用于 Zotero 10。当前版本 **0.15.0**，已在 macOS 上实测。Windows、Linux 尚未实机验证。

## 安装

1. 下载或向分享者索取 [scholia-0.15.0.xpi](https://github.com/kehaoyinyzb-del/scholia-zotero/releases/download/v0.15.0/scholia-0.15.0.xpi)。
2. 打开 Zotero 的 **工具 → 插件**，点齿轮菜单中的 **从文件安装插件**，选中这个 XPI 并确认安装。
3. 打开一篇 PDF，点阅读器工具栏上的 **Scholia**。第一次会显示下方引导。


## 连接账号与 API 密钥

**Codex · 用 ChatGPT 登录**。点该按钮，在浏览器完成 ChatGPT 授权后返回 Zotero。若电脑缺少 Codex，首次使用会提示下载官方组件。连接成功后，可从阅读面板的模型菜单选用 Codex。

使用你的 ChatGPT 套餐额度，不另外收费。部分套餐可能无法使用，以 OpenAI 说明为准。[OpenAI 套餐说明](https://learn.chatgpt.com/docs/pricing)

**用 API 密钥**。展开“使用 API 密钥”，选择 Gemini（API Key）、OpenAI（GPT API）或其他预设服务商，粘贴密钥后自动检测。通过后直接提问。连接时会检查图像能力，仅文字模型适合文字问题。API 用量按服务商账户计费。

**Gemini · 用 Google 登录**。点一次后，在系统浏览器的 Google 页面选择账号并授权，返回 Zotero 即可选用该连接。普通用户无需准备客户端 JSON。首次登录需要发布方已开通 Google 授权；看到“此版本尚未开通”时，可直接使用 Gemini（API Key）。从旧版升级、已经授权的账号可继续使用其本地凭据。

**Gemini（API Key）** 和 **OpenAI（GPT API）** 各自保存密钥。两种 Gemini 连接可同时存在，在 PDF 阅读面板的模型菜单按服务商选择。点配置行右侧的 **删除 → 确认删除** 可移除该配置和它在本机保存的凭据。

打开 PDF 后点 **总结全文**，即可查看核心要点和页码出处，还能继续追问、重新生成、存为子笔记。文献库条目的右键菜单也有“总结全文”。

## 发布方配置 Google 登录

为 Scholia 注册 Google Cloud **桌面应用** OAuth 客户端，启用 Generative Language API，并按目标用户范围配置同意屏幕。测试模式须将目标账号加入测试用户。下载发布方专用的桌面客户端文件，构建时传入本机路径。安装包仅包含该桌面客户端的三个字段，桌面客户端随包分发，其内容可被解包读取。[Google 桌面 OAuth 说明](https://developers.google.com/identity/protocols/oauth2/native-app)

```sh
SCHOLIA_GOOGLE_OAUTH_CLIENT_FILE=/path/to/scholia-desktop-client.json npm run build
```

插件使用客户端的项目作为 Gemini API 配额项目。发布方需要为目标用户配置该项目的 `serviceusage.services.use` 权限，并按实际授权范围完成 Google 要求的应用验证。账号选取、用户授权和 API 项目权限是三个独立环节。缺少发布方配置时，构建日志会显示 `unconfigured`，安装包仍可使用 Codex 与 API Key。[配额项目权限](https://docs.cloud.google.com/docs/quotas/set-quota-project)

## 遇到问题

- **找不到入口**。确认插件已启用，打开 PDF 后再找阅读器工具栏“Scholia”。
- **登录页打不开或下载失败**。检查网络。API 和下载使用 Zotero 网络设置。Codex 子进程继承进程代理环境，也可在 **更多 → 连接账号 → 高级** 填写 Codex HTTP(S) 代理。自动跟随系统 PAC 的行为尚未核验。
- **回答一直转圈**。点“停止”后重试。长文总结会显示正在读取的页数。若提示登录失效，重新登录后点“重试这次提问”。额度不足或限流可等待恢复，也可切换模型。
- **密钥错误或其他报错**。按提示处理，仍失败时点“复制诊断信息”发给维护者，内容包含版本和错误状态码，并会省略密钥、文献正文及本机路径。



## 用自己的 API 密钥复测

1. 打开 Scholia 的模型设置，添加 Google Gemini、OpenAI（GPT API）、智谱 GLM、DeepSeek、通义千问或 Kimi，粘贴对应平台的密钥；等待自动连接测试成功。千问预设是北京按量接口，其他地域或套餐请在高级选项填写控制台给出的地址。
2. 打开模型下拉列表，确认目录或默认模型可选。GLM 若目录不可用，可手填 `glm-5.3-flash` 测视觉；其余默认模型均支持图像。切换模型后重新测试。
3. 在 PDF 中提问、划词翻译，并问页面图像内容；确认答案不含思考过程。复制回答与存为笔记，核对原文数值和单位。
4. 若失败，核对密钥、地域、账户余额与限流提示；使用“复制诊断信息”反馈。不要发送密钥。本轮仅用本地模拟服务验收，未用真实密钥调用，详见 [服务商核对](PROVIDERS.md)。
