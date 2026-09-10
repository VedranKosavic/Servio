/**
 * The one decode path for every photo the app sends (PHASE4 §3, WP1).
 *
 * A phone camera writes a 4 MB, 4000 px JPEG. The server refuses anything over
 * 1.5 MB for chat, café wifi refuses rather more than that, and nobody needs
 * four thousand pixels of a fridge. So every picture goes through here first and
 * comes out at 100–180 KB.
 *
 * **How the resize works, since none of it is Vue.** `URL.createObjectURL(file)`
 * makes a temporary `blob:` URL for bytes that are already in memory — no
 * upload, no copy. An `<img>` loads it, and *the browser applies the EXIF
 * orientation flag while decoding*, which is why a photo taken sideways comes
 * out upright without us reading any metadata. We then draw that image into a
 * `<canvas>` at the size we want, and `canvas.toBlob('image/jpeg', quality)`
 * re-encodes what was drawn.
 *
 * **Re-encoding drops EXIF, including GPS**, because the canvas holds pixels and
 * nothing else. That is a privacy gain rather than a side effect, and *Pravila*
 * says so out loud: a photo of the bar taken at work carries no coordinates to
 * anybody.
 *
 * The object URL is revoked in a `finally`: a blob URL keeps the whole file
 * alive in memory until it is released, and a shift's worth of leaked photos is
 * a phone that reloads itself.
 */

export interface DownscaleOptions {
  /** The longest edge of the result, in pixels. */
  maxEdge: number
  /** JPEG quality, 0–1. */
  quality: number
}

/** Chat: small enough to send on one bar of signal, big enough to see the mess. */
export const CHAT_IMAGE: DownscaleOptions = { maxEdge: 1280, quality: 0.75 }

/**
 * An otpremnica: bigger, because the small print on an A4 delivery note has to
 * stay legible for the model that reads it (WP3 imports this).
 */
export const DELIVERY_IMAGE: DownscaleOptions = { maxEdge: 1600, quality: 0.85 }

/** The one sentence a picture we cannot decode is allowed to produce. */
export const IMAGE_ERROR = 'Ovaj format ne radi — slikaj iz aplikacije.'

export class ImageDecodeError extends Error {
  constructor() {
    super(IMAGE_ERROR)
    this.name = 'ImageDecodeError'
  }
}

export interface DownscaledImage {
  blob: Blob
  width: number
  height: number
}

/**
 * Decode, shrink and re-encode one picture as a JPEG.
 *
 * Anything the browser cannot decode — a HEIC an older Android hands over, a
 * PDF somebody picked in the gallery, a truncated file — throws
 * `ImageDecodeError`, whose message is the Bosnian sentence the screen shows.
 */
export async function downscale(
  file: Blob, options: DownscaleOptions = CHAT_IMAGE,
): Promise<DownscaledImage> {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    const { width, height } = fit(image.naturalWidth, image.naturalHeight, options.maxEdge)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageDecodeError()
    ctx.drawImage(image, 0, 0, width, height)

    const blob = await toJpeg(canvas, options.quality)
    return { blob, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The target size: the longest edge capped, the aspect ratio kept, never upscaled. */
export function fit(
  width: number, height: number, maxEdge: number,
): { width: number, height: number } {
  const longest = Math.max(width, height)
  if (longest === 0) throw new ImageDecodeError()
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new ImageDecodeError())
    image.src = url
  })
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new ImageDecodeError())),
      'image/jpeg',
      quality,
    )
  })
}
