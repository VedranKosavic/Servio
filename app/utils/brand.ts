/**
 * The wordmark, auto-imported.
 *
 * The constants themselves live in `shared/brand.ts`, because `nuxt.config.ts`
 * reads them for the PWA manifest and a config file cannot use auto-imports.
 * This one-line re-export is what puts `APP_NAME` into every `.vue` file
 * without an import — Nuxt auto-imports everything `app/utils/*` exports.
 */
export { APP_DESCRIPTION, APP_NAME, APP_TAGLINE, THEME_COLOR_DARK, THEME_COLOR_LIGHT } from '#shared/brand'
