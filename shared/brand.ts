/**
 * The wordmark — the one place the product's visible name is written.
 *
 * The folder, the repo, the database file (`data/sank.db`), the cookie prefixes
 * (`sank_d` / `sank_s`), the localStorage keys (`sank:*`), the env vars and the
 * docs all still say *sank*, and they stay that way: renaming an identifier is a
 * migration, renaming a wordmark is a string. A different final name may come
 * later, so every screen reads these constants instead of typing the name.
 *
 * It lives in `shared/` because `nuxt.config.ts` (the PWA manifest) has to read
 * it too, and the config is loaded before Nuxt's auto-imports exist — it can
 * only import a path. `app/utils/brand.ts` re-exports these names so that every
 * `.vue` file gets `APP_NAME` auto-imported, with no import line.
 *
 * **When the name changes, change it here and nowhere else.** Keep it a
 * nominative noun that no sentence has to decline: the Bosnian copy is written
 * so the wordmark never needs a genitive or a locative ending.
 */

/** The product name, as every screen shows it. */
export const APP_NAME = 'Servio'

/** Under the wordmark on `/admin` and on the admin login card. */
export const APP_TAGLINE = 'Kontrolna ploča'

/** The PWA's description, and the one line that says what this is. */
export const APP_DESCRIPTION = 'Narudžbe, smjene i stanje šanka'
