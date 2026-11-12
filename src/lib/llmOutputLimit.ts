export class LlmOutputLimitError extends Error {
  constructor(locale: 'zh-CN' | 'en-US', readonly reasoningOnly: boolean) {
    super(locale === 'zh-CN'
      ? reasoningOnly ? '模型只返回了思考内容，尚未生成搭建指令便耗尽输出预算。请降低模型侧推理强度，或选择能稳定输出 JSON 的模型。' : '模型输出被长度上限截断，未收到完整方案。'
      : reasoningOnly ? 'The model exhausted its output budget before returning a final plan.' : 'The model output was truncated before a complete plan was returned.')
    this.name = 'LlmOutputLimitError'
  }
}
