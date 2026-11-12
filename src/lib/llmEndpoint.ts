const providerUrl = (endpoint: string) => {
  const url = new URL(endpoint.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid endpoint')
  url.hash = ''
  return url
}

export const chatCompletionEndpoint = (endpoint: string) => {
  const url = providerUrl(endpoint)
  const path = url.pathname.replace(/\/+$/, '')
  if (!path) url.pathname = '/v1/chat/completions'
  else if (/\/v\d+$/.test(path)) url.pathname = `${path}/chat/completions`
  return url.toString()
}

export const modelListEndpoint = (endpoint: string) => {
  const url = providerUrl(chatCompletionEndpoint(endpoint))
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = /\/(chat\/completions|completions|responses|models)$/.test(path)
    ? path.replace(/\/(chat\/completions|completions|responses|models)$/, '/models')
    : `${path}/models`
  return url.toString()
}
