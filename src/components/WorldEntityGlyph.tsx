import { useEffect, useState } from 'react'

export const WorldEntityGlyph = ({ definitionId }: { definitionId: string }) => {
  const [image, setImage] = useState<string>()
  useEffect(() => {
    let canceled = false
    void import('../lib/worldEntityPreview').then(module => module.getWorldEntityPreview(definitionId)).then(value => {
      if (!canceled) setImage(value)
    }).catch(() => { /* The labelled catalog button remains available without WebGL. */ })
    return () => { canceled = true }
  }, [definitionId])
  return <span className="npc-catalog-glyph" aria-hidden="true">
    {image ? <img src={image} alt="" /> : <span className="npc-preview-placeholder" />}
  </span>
}
