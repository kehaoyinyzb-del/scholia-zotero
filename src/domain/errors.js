export class ReadingError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

const explanations = {
  'codex-old': [
    '需要更新 Codex',
    '当前版本不支持 Scholia 使用的连接协议。',
    '在连接选项中安装已验证版本。',
  ],
  'google-auth': [
    'Google 授权不可用',
    '请检查 Google 账号授权及项目权限。',
    '在模型设置重新登录 Google 账号。',
  ],
  'google-client': [
    '此版本尚未开通 Google 账号登录',
    '发布方需要为 Scholia 配置 Google 授权客户端。',
    '现在可选择 Gemini（API Key）。',
  ],
  'login-timeout': ['登录等待超时', '尚未完成浏览器授权。', '请检查登录页和网络，然后重新登录。'],
  platform: [
    '当前平台不受支持',
    '未找到匹配当前系统及架构的官方发布物。',
    '可以使用 API 密钥连接。',
  ],
  download: [
    'Codex 下载失败',
    '未能从官方发布地址下载或准备程序。',
    '检查网络后重试，或在连接选项中手动选择位置。',
  ],
  'download-hash': ['下载校验未通过', '文件与固定版本的官方哈希不一致。', '请重新下载。'],
  proxy: [
    '代理地址不可用',
    'Codex 代理需要不含用户名和密码的 HTTP(S) 地址。',
    '请在连接选项中修改。',
  ],
  quota: ['额度已用尽', '当前账户的可用额度不足。', '请等待额度恢复，或切换其他服务商模型。'],
  'summary-no-text': ['没有可读取的文本层', '未生成总结。', '请先对 PDF 做 OCR，再重新总结。'],
  'summary-chapter': ['无法定位本章', '文献没有可定位的章节目录。', '请选择全文或本页。'],
  'summary-citation': ['总结出处不完整', '模型未给出可定位的原文出处。', '请重新生成。'],
  'annotation-position': [
    '未创建高亮',
    '无法将这句出处唯一定位到可靠的原文坐标。',
    '请回到原文手动选择这句话。',
  ],
  'annotation-readonly': ['无法创建标注', '当前文库只读。', '请使用可编辑的文库。'],
  'reader-image': [
    '页面图像尚未就绪',
    '当前页面正在重绘，尚未取得可见区域图像。',
    '请等待图像显示完整后重新发送。',
  ],
  'reader-changed': ['文献已切换', '引用的材料属于另一篇文献。', '请在当前文献重新发送问题。'],
  'reader-not-ready': ['PDF 尚未就绪', '阅读器还未提供页面内容。', '请等待 PDF 显示后重试。'],
  'reader-text': ['原文提取失败', '阅读器未能返回本页字符数据。', '请重新打开 PDF 后重试。'],
  'reader-geometry': ['页面尺寸无法读取', '页面边界和文字坐标均不可用。', '请等待该页渲染后重试。'],
  'reader-capture': ['页面读取失败', '未能取得当前页面。', '请等待页面渲染完成后重新发送。'],
  executable: [
    '未找到 Codex',
    '本机尚未发现可用的程序。',
    '点击登录可自动下载，也可在连接选项中手动选择位置。',
  ],
  selection: ['尚未选中文字', '当前操作需要选区。', '请在 PDF 中选中文字后重试。'],
  'no-text': ['未取得可读内容', '本页没有文本层，且没有可用图像。', '请等待渲染或选择视觉模型。'],
  'no-text-translation': [
    '本页无法进行文字翻译',
    '本页没有可选择的文本层。',
    '可在模型设置中选择图像模型解读页面，或使用带文本层的 PDF。',
  ],
  cancelled: ['已取消', '回答尚未完成。', '可以调整引用后重新发送。'],
  timeout: ['请求超时', '在设定时间内未收到完整回答。', '请稍后重试或减少引用内容。'],
  login: ['登录已失效', 'Codex 需要重新登录。', '点击重新登录，完成后可重试原来的问题。'],
  key: ['密钥无效或未配置', '服务商未接受本地保存的密钥。', '请在设置中重新保存密钥。'],
  model: ['模型不可用', '所选模型或接口无法处理请求。', '请检查模型 ID 和 API 地址。'],
  rate: ['请求被限流', '服务商暂时限制请求数量。', '请稍后重试，或切换其他模型。'],
  balance: ['余额不足', '服务商拒绝了付费请求。', '请在服务商账户中检查余额。'],
  context: ['请求不被接受', '可能超出上下文或图像能力限制。', '请缩小范围并运行连接测试。'],
  service: ['服务暂时故障', '服务商返回了服务器错误。', '请稍后重试。'],
  connection: [
    '网络或连接失败',
    '未能连接模型服务。',
    '请检查网络、Zotero 代理或 Codex 连接选项。',
  ],
  protocol: ['回答格式异常', '没有收到完整且可解析的结果。', '请重试，已有引用会保留。'],
  unconfigured: ['尚未配置模型', '当前用途没有有效的模型配置。', '请先打开模型设置。'],
  vision: ['这次未发送图像', '所选模型的图像能力尚未确认。', '请测试视觉模型或仅询问文字条款。'],
};

export function errorFeedback(error, providerType = '') {
  let code = error.code;
  if (error.name === 'AbortError') code = 'cancelled';
  if (error.name === 'TimeoutError') code = 'timeout';
  const status = error.status ?? error.details?.status;
  if ([401, 403].includes(status) && !['quota', 'balance'].includes(code))
    code =
      providerType === 'google-oauth' ? 'google-auth' : providerType === 'codex' ? 'login' : 'key';
  const statusCodes = { 400: 'context', 402: 'balance', 404: 'model', 429: 'rate' };
  if (!['quota', 'balance', 'key'].includes(code)) code = statusCodes[status] || code;
  if (status >= 500 && status <= 599) code = 'service';
  code = explanations[code] ? code : 'connection';
  const [title, reason, action] = explanations[code];
  const pageIndex = error.details?.pageIndex;
  return {
    code,
    title,
    reason,
    action:
      action +
      (error.details?.resetAt
        ? ` 预计可重试时间为 ${new Date(error.details.resetAt).toLocaleString()}。`
        : ''),
    status: Number.isInteger(status) ? status : null,
    rpcCode: error.details?.rpcCode ?? null,
    ...(Number.isInteger(pageIndex) ? { filePage: pageIndex + 1 } : {}),
  };
}
