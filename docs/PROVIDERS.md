# Scholia 服务商核对

核对日期：2026-11-15。未用真实密钥调用；以下是官方文档与本地模拟的边界，不能视为真实账户可用性证明。所有预设使用按量 API，套餐专属端点需按控制台修改。

| 服务商 | OpenAI Chat base URL | 默认文字模型 / 图像模型 | 模型目录 |
| --- | --- | --- | --- |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-5.3`（纯文字） / `glm-5.3-flash`、`glm-5.3-flashx` | 官方公开索引未列出 GET models 的契约；尝试兼容 `/models`，失败保留默认模型，可手填视觉模型 |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` 同时支持文字、图像；`deepseek-v4-pro` 不支持图像 | `/models`，读取 name、input_modalities、effort 元数据 |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3.7-plus`，文字与图像；另有 `qwen3.8-max`、`qwen3.8-flash` | 同域 `/api/v1/models`，筛选 TG、读取 output.models、分页到 total |
| Kimi | `https://api.moonshot.cn/v1` | `kimi-k3.1-pro`，文字与图像；另有 `kimi-k3` | `/models`，OpenAI data 列表 |

千问官方推荐新业务空间域名 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，旧北京域名仍可使用。新加坡等地域的密钥必须匹配地域；在设置的高级接口地址中修改。模型目录失败时仍可选默认/手填模型；描述原样显示，不翻译。视觉能力使用具体模型的目录元数据、匹配该模型的连接测试或已核对的准确 ID，不沿用另一模型的测试。

四家 Chat 流均按 SSE `data:` JSON 处理，最终文字来自 `choices[].delta.content`，思考来自 `reasoning_content`，后者不进入回答、译文或笔记；结束支持 `finish_reason: stop` 与 `[DONE]`。GLM 5.3 和 Kimi K3 系列始终思考，支持 low/high/max；DeepSeek 可由目录返回推理档位。请求仅在实际选择档位后传 reasoning_effort，不给无档位模型强加参数。

| 服务商 | 密钥错误 | 欠费 | 限流 |
| --- | --- | --- | --- |
| GLM | HTTP 401，error.code 1000/1001/1003 | HTTP 429，1113 | HTTP 429，1302/1305；1308 是额度上限 |
| DeepSeek | HTTP 401 | HTTP 402 | HTTP 429 |
| 千问 | HTTP 401，InvalidApiKey/invalid_api_key | HTTP 403，Arrearage（兼容错误体在 error 内） | HTTP 429，Throttling.RateQuota；AllocationQuota/insufficient_quota 区分为额度 |
| Kimi | HTTP 401，invalid_authentication_error / incorrect_api_key_error | HTTP 429，exceeded_current_quota_error（欠费或额度不足）；明确余额消息时显示余额，否则显示额度 | HTTP 429，rate_limit_reached_error |

本地 HTTP 模拟覆盖每家目录形态、思考与答案分块、结束、三类错误；GLM 的模拟目录只验证兼容解析，不证明其线上存在。原有 SSE 测试覆盖 UTF-8 跨块和提前 EOF。

## Google Gemini 和 OpenAI

2026-11-18 加入两个官方 API 预设。连接向导支持自填模型 ID。两者都用 Bearer 密钥读取 `/models` 并向 `/chat/completions` 发送流式请求，列表依账号返回内容而异。默认使用 [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) 和 [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini)。端点见 [Google 兼容接口](https://ai.google.dev/gemini-api/docs/openai) 和 [OpenAI 模型目录](https://developers.openai.com/api/reference/resources/models/methods/list)。

## 官方来源

- GLM：[模型与端点](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3.md)、[视觉模型](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash.md)、[Chat SSE 与错误体](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)、[错误码](https://docs.bigmodel.cn/cn/faq/api-code.md)、[文档索引](https://docs.bigmodel.cn/llms.txt)。
- DeepSeek：[模型目录](https://api-docs.deepseek.com/api/list-models/)、[图像](https://api-docs.deepseek.com/guides/vision/)、[思考字段](https://api-docs.deepseek.com/guides/thinking_mode/)、[错误码](https://api-docs.deepseek.com/quick_start/error_codes/)。
- 千问：[兼容端点](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、[推荐模型](https://help.aliyun.com/zh/model-studio/models)、[模型目录](https://help.aliyun.com/zh/model-studio/list-models)、[思考与流式](https://help.aliyun.com/zh/model-studio/deep-thinking)、[错误码](https://help.aliyun.com/zh/model-studio/error-code-start)。
- Kimi：[模型与视觉](https://platform.kimi.com/docs/guide/kimi-k3-1-pro-quickstart)、[目录](https://platform.kimi.com/docs/api/list-models)、[思考字段](https://platform.kimi.com/docs/guide/use-thinking-models)、[Chat](https://platform.kimi.com/docs/api/chat)、[错误码](https://platform.kimi.com/docs/api/errors)。
