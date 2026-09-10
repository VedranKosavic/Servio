/**
 * One decode path for every photo this app sends (PHASE4 §3, WP1).
 *
 * This file is written by WP3 because it landed first; WP1 (*Razgovor*) imports
 * it unchanged for chat images. Two callers, two settings, one function:
 *
 * - chat:     `downscale(file, { maxEdge: 1280, quality: 0.75 })` → 100–180 KB
 * - otpremnica: `downscale(file, { maxEdge: 1600, quality: 0.85 })` — the small
 *   print on an A4 delivery note has to stay readable for the model.
 *
 * **Why a canvas and not the file as it came off the camera.** A modern phone
 * takes 4–8 MB photos; the server refuses anything over 1.5 MB (chat) or 2.5 MB
 * (delivery), and a café on a phone connection would be uploading for a minute.
 * Drawing the picture into a canvas at a smaller size and re-encoding it as JPEG
 * gets it under the cap in a fraction of a second, on the phone, before a byte
 * leaves it.
 *
 * **Re-encoding drops EXIF, including GPS** — the canvas only ever sees pixels,
 * never the metadata block. That is a privacy gain, not a side effect, and it is
 * one of the lines published in *Pravila*.
 *
 * Orientation needs no code of ours: browsers apply the EXIF rotation while
 * decoding into an `<img>`, so what the canvas receives is already upright.
 */

export interface DownscaleOptions {
  /** The longest edge of the result, in pixels. A smaller picture is left alone. */
  maxEdge: number
  /** JPEG quality, 0–1. */
  quality: number
}

/**
 * A file the browser could not turn into a picture — a HEIC a desktop Chrome
 * does not know, a PDF renamed `.jpg`, a half-downloaded file.
 *
 * It carries the Bosnian sentence the screen shows, so a caller does not have to
 * know which failure it caught.
 */
export class ImageDecodeError extends Error {
  constructor() {
    super('Ovaj format ne radi — slikaj iz aplikacije.')
    this.name = 'ImageDecodeError'
  }
}

/** Decode `file` into an `<img>`, honouring EXIF orientation. */
function decode(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    // An object URL is a short-lived local address for a Blob; it is revoked in
    // `downscale`'s `finally` so the picture is not held in memory afterwards.
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => { URL.revokeObjectURL(url); reject(new ImageDecodeError()) }
    img.src = url
  })
}

/** The size the picture is drawn at: the longest edge capped, aspect kept. */
export function fitTo(width: number, height: number, maxEdge: number): { width: number, height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge || longest === 0) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * `File` → a JPEG `Blob` no wider or taller than `maxEdge`.
 *
 * Throws `ImageDecodeError` — and nothing else — when the browser cannot read
 * the file, so every caller has one `catch` and one sentence.
 */
export async function downscale(file: Blob, options: DownscaleOptions): Promise<Blob> {
  const img = await decode(file)
  const url = img.src
  try {
    const size = fitTo(img.naturalWidth, img.naturalHeight, options.maxEdge)
    if (size.width === 0 || size.height === 0) throw new ImageDecodeError()

    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageDecodeError()
    ctx.drawImage(img, 0, 0, size.width, size.height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', options.quality)
    })
    if (!blob || blob.size === 0) throw new ImageDecodeError()
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The two presets, named where they are used rather than typed twice. */
export const CHAT_IMAGE: DownscaleOptions = { maxEdge: 1280, quality: 0.75 }
export const DELIVERY_IMAGE: DownscaleOptions = { maxEdge: 1600, quality: 0.85 }
