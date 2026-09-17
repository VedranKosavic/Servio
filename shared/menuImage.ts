/**
 * The URL of a menu article's picture, or `null` when it has none.
 *
 * `?v=` is the product's `image_version`: the server answers the picture with a
 * year-long immutable cache, so a new picture has to be a new URL.
 */
export function productImageUrl(productId: string, version: string | null | undefined): string | null {
  return version ? `/api/products/${productId}/image?v=${encodeURIComponent(version)}` : null
}

/** The belt behind the admin phone's downscale (400 px, JPEG). */
export const PRODUCT_IMAGE_MAX_BYTES = 300_000
