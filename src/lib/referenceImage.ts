export type PreparedReferenceImage = {
  name: string
  dataUrl: string
  width: number
  height: number
}

const maxReferenceImageBytes = 20 * 1024 * 1024
const maxReferenceImageDimension = 1280
const jpegQuality = 0.84

const loadImage = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => {
    URL.revokeObjectURL(url)
    resolve(image)
  }
  image.onerror = () => {
    URL.revokeObjectURL(url)
    reject(new Error('REFERENCE_IMAGE_DECODE_FAILED'))
  }
  image.src = url
})

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(new Error('REFERENCE_IMAGE_ENCODE_FAILED'))
  reader.readAsDataURL(blob)
})

export const prepareReferenceImage = async (file: File): Promise<PreparedReferenceImage> => {
  if (!file.type.startsWith('image/')) throw new Error('REFERENCE_IMAGE_TYPE')
  if (file.size > maxReferenceImageBytes) throw new Error('REFERENCE_IMAGE_SIZE')

  const image = await loadImage(file)
  const scale = Math.min(1, maxReferenceImageDimension / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('REFERENCE_IMAGE_ENCODE_FAILED')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('REFERENCE_IMAGE_ENCODE_FAILED')),
      'image/jpeg',
      jpegQuality,
    )
  })

  return {
    name: file.name,
    dataUrl: await blobToDataUrl(blob),
    width,
    height,
  }
}
