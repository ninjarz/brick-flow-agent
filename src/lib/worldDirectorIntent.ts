export type DirectorIntentTarget = {
  status: 'none' | 'resolved' | 'ambiguous'
  entityId?: string
  entityName?: string
  candidates: Array<{ id: string; name: string }>
}

export type DirectorIntentReferences = {
  status: 'none' | 'resolved' | 'ambiguous'
  primary?: DirectorIntentTarget['candidates'][number]
  mentions: DirectorIntentTarget['candidates']
}

const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[\s·・]/g, '')
const descriptiveTokens = (value: string) => value
  .split(/[，。,.、\s]+/)
  .flatMap((phrase) => {
    const normalized = normalize(phrase)
    if (normalized.length < 2) return []
    return [normalized, ...normalized.match(/[\p{Script=Han}]{2,4}/gu) ?? []]
  })

export const resolveDirectorIntentTarget = (
  text: string,
  entities: Array<{ id: string; name: string; description?: string }>,
): DirectorIntentTarget => {
  const normalizedText = normalize(text)
  const exactMentions = entities.filter((entity) => normalizedText.includes(normalize(entity.name)))
  if (exactMentions.length === 1) return { status: 'resolved', entityId: exactMentions[0].id, entityName: exactMentions[0].name, candidates: exactMentions }
  if (exactMentions.length > 1) return { status: 'ambiguous', candidates: exactMentions }

  const descriptive = entities.filter((entity) => {
    const words = descriptiveTokens(entity.description ?? '')
    return words.some((word) => normalizedText.includes(word))
  })
  if (descriptive.length === 1) return { status: 'resolved', entityId: descriptive[0].id, entityName: descriptive[0].name, candidates: descriptive }
  if (descriptive.length > 1) return { status: 'ambiguous', candidates: descriptive }
  return { status: 'none', candidates: [] }
}

export const resolveDirectorIntentReferences = (
  text: string,
  entities: Array<{ id: string; name: string; description?: string }>,
): DirectorIntentReferences => {
  const normalizedText = normalize(text)
  const mentions = entities.filter((entity) => normalizedText.includes(normalize(entity.name)))
  if (mentions.length > 0) return { status: 'resolved', primary: mentions.at(-1), mentions }
  const descriptive = resolveDirectorIntentTarget(text, entities)
  if (descriptive.status === 'resolved') return { status: 'resolved', primary: descriptive.candidates[0], mentions: descriptive.candidates }
  return { status: descriptive.status, mentions: descriptive.candidates }
}
