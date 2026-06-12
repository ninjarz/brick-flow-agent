export type LDrawColorDefinition = {
  name: string
  code: number
  value: string
  edge: string
  alpha?: number
}

const colorPattern = /^0\s+!COLOUR\s+(\S+).*?\s+CODE\s+(\d+)\s+VALUE\s+(#[0-9A-Fa-f]{6})\s+EDGE\s+(#[0-9A-Fa-f]{6}|-?\d+)(?:\s+ALPHA\s+(\d+))?/

export const parseLDrawColorDefinitions = (source: string): LDrawColorDefinition[] =>
  source
    .split(/\r?\n/)
    .map((line) => line.match(colorPattern))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      name: match[1],
      code: Number(match[2]),
      value: match[3].toUpperCase(),
      edge: match[4].startsWith('#') ? match[4].toUpperCase() : match[4],
      alpha: match[5] ? Number(match[5]) : undefined,
    }))
