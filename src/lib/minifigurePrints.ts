import { CanvasTexture, SRGBColorSpace } from 'three'

const cache = new Map<string, CanvasTexture>()

/** Printed artwork stays flat against the mould, like a decorated minifigure. */
export const getMinifigurePrint = (role: string, surface: 'torso' | 'face' | 'shield', accent: string) => {
  if (typeof document === 'undefined') return
  const key = `${role}:${surface}:${accent}`
  const cached = cache.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const line = (points: number[][], color: string, width: number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
    ctx.stroke()
  }
  const dot = (x: number, y: number, radius: number, color: string) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  const gold = '#d2b370'
  const ink = '#272622'
  if (surface === 'shield') {
    dot(256, 256, 248, '#b49657')
    dot(256, 256, 230, '#57212b')
    ctx.strokeStyle = gold; ctx.lineWidth = 5
    ctx.beginPath(); ctx.arc(256, 256, 212, 0, Math.PI * 2); ctx.stroke()
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8
      dot(256 + Math.sin(angle) * 238, 256 + Math.cos(angle) * 238, 5, '#f3df9a')
    }
    for (const sign of [-1, 1]) for (let i = 0; i < 5; i++) {
      line([[256 + sign * 15, 222 + i * 15], [256 + sign * (140 - i * 20), 153 + i * 35], [256 + sign * 55, 298]], gold, 13)
    }
    line([[256, 180], [283, 247], [256, 325], [229, 247], [256, 180]], gold, 12)
    dot(256, 244, 12, '#f3df9a')
  } else if (surface === 'face') {
    // Tiny white catchlights and asymmetric brows keep the expression readable.
    for (const x of [173, 339]) {
      dot(x, 232, 22, ink)
      dot(x - 5, 225, 5, '#fff6df')
    }
    const brow = role === 'priest' ? '#8a8072' : '#553b2d'
    line([[139, 175], [166, 166], [196, 177]], brow, role === 'priest' ? 15 : 11)
    line([[313, 176], [340, role === 'knight' ? 158 : 166], [370, 169]], brow, 11)
    ctx.strokeStyle = ink
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.ellipse(256, 313, 56, 27, 0, .12, Math.PI - .12)
    ctx.stroke()
    if (role === 'archer') {
      for (const x of [133, 152, 175, 337, 360, 379]) dot(x, 282 + x % 13, 4, '#bc8059')
      line([[154, 225], [139, 213]], ink, 7)
      line([[357, 225], [373, 213]], ink, 7)
    } else if (role === 'knight') {
      for (let x = 185; x <= 330; x += 22) line([[x, 360 + Math.abs(x - 256) * -.15], [x + 3, 370 + Math.abs(x - 256) * -.15]], '#9e7354', 3)
    } else {
      line([[187, 312], [205, 286], [240, 295]], '#e8ddc5', 16)
      line([[272, 295], [307, 286], [325, 312]], '#e8ddc5', 16)
      line([[203, 355], [256, 386], [309, 355]], '#e8ddc5', 21)
    }
  } else {
    ctx.fillStyle = role === 'knight' ? '#6b2330' : role === 'archer' ? '#345745' : '#e7ddc1'
    ctx.fillRect(0, 0, 512, 512)
    // Collar follows the mould's sloping shoulders.
    line([[148, 0], [256, 94], [364, 0]], '#282c30', 30)
    line([[148, 0], [256, 81], [364, 0]], gold, 8)
    if (role === 'knight') {
      for (let row = 0; row < 4; row++) {
        const y = 328 + row * 24
        line([[35, y], [256, y + 21], [477, y]], '#392c32', 12)
        line([[40, y - 5], [256, y + 14], [472, y - 5]], '#af8d75', 3)
      }
      line([[69, 26], [90, 308], [145, 366]], gold, 10)
      line([[443, 26], [422, 308], [367, 366]], gold, 10)
      // Winged crest with a diamond heart.
      for (const sign of [-1, 1]) {
        for (let feather = 0; feather < 4; feather++) line([[256 + sign * 12, 197 + feather * 12], [256 + sign * (100 - feather * 15), 149 + feather * 31], [256 + sign * 44, 236]], gold, 9)
      }
      ctx.fillStyle = gold
      ctx.beginPath(); ctx.moveTo(256, 158); ctx.lineTo(280, 213); ctx.lineTo(256, 260); ctx.lineTo(232, 213); ctx.closePath(); ctx.fill()
    } else if (role === 'archer') {
      line([[78, 0], [413, 460]], '#1f302a', 59)
      line([[78, 0], [413, 460]], '#815a39', 42)
      line([[66, 0], [401, 460]], '#b28b55', 3)
      line([[90, 0], [425, 460]], '#b28b55', 3)
      ctx.save(); ctx.translate(266, 255); ctx.rotate(-.63)
      ctx.strokeStyle = gold; ctx.lineWidth = 9; ctx.strokeRect(-32, -28, 64, 56)
      ctx.restore()
      line([[276, 60], [301, 107], [280, 157]], '#bca877', 5)
      for (let i = 0; i < 4; i++) {
        const y = 145 + i * 30
        line([[149, y], [195, y + 19], [149, y + 34]], '#d4bf8c', 5)
      }
    } else {
      for (const x of [112, 400]) {
        ctx.fillStyle = '#233b57'; ctx.fillRect(x - 37, 0, 74, 512)
        line([[x - 28, 0], [x - 28, 512]], gold, 5)
        line([[x + 28, 0], [x + 28, 512]], gold, 5)
        for (let y = 130; y < 500; y += 80) {
          line([[x, y - 20], [x + 14, y], [x, y + 20], [x - 14, y], [x, y - 20]], gold, 4)
        }
      }
      dot(256, 154, 31, gold)
      dot(256, 154, 22, '#273e57')
      line([[256, 132], [256, 176]], '#d7c899', 4)
      line([[234, 154], [278, 154]], '#d7c899', 4)
      for (const x of [205, 256, 307]) line([[x, 289], [x - 8, 421]], '#b5a78a', 3)
    }
    ctx.fillStyle = '#352e29'; ctx.fillRect(0, 444, 512, 57)
    line([[0, 451], [512, 451]], '#aa8757', 3)
    ctx.fillStyle = gold; ctx.fillRect(224, 450, 64, 43)
    ctx.fillStyle = '#392e26'; ctx.fillRect(237, 459, 38, 25)
    dot(398, 86, 21, accent)
    dot(398, 86, 8, gold)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  cache.set(key, texture)
  return texture
}
