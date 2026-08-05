import { describe, expect, it } from 'vitest'
import { worldCharacterSparkPresets } from './worldCharacterSparkPresets'

describe('world character spark presets', () => {
  it('offers bilingual labels and sparks for every preset', () => {
    expect(worldCharacterSparkPresets.length).toBeGreaterThanOrEqual(4)
    const ids = new Set<string>()
    for (const preset of worldCharacterSparkPresets) {
      expect(preset.id).toBeTruthy()
      expect(ids.has(preset.id)).toBe(false)
      ids.add(preset.id)
      expect(preset.label['zh-CN']).toBeTruthy()
      expect(preset.label['en-US']).toBeTruthy()
      for (const locale of ['zh-CN', 'en-US'] as const) {
        const spark = preset.spark[locale]
        expect(spark.motive.length).toBeGreaterThan(0)
        expect(spark.temperament.length).toBeGreaterThan(0)
        expect(spark.voice.length).toBeGreaterThan(0)
        expect(spark.motive.length).toBeLessThanOrEqual(180)
        expect(spark.temperament.length).toBeLessThanOrEqual(180)
        expect(spark.voice.length).toBeLessThanOrEqual(180)
        expect(spark.initiative).toBeGreaterThanOrEqual(0)
        expect(spark.initiative).toBeLessThanOrEqual(1)
      }
    }
  })

  it('covers both proactive and reserved initiative profiles', () => {
    const initiatives = worldCharacterSparkPresets.map((preset) => preset.spark['zh-CN'].initiative)
    expect(Math.max(...initiatives)).toBeGreaterThanOrEqual(0.6)
    expect(Math.min(...initiatives)).toBeLessThanOrEqual(0.4)
  })
})
