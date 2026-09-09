/**
 * WP5's error sentences (`docs/BACKEND.md` §4, §6.9). Bosnian, because this is
 * what the phone puts on the screen.
 *
 * `NO_DEVICE` and `NO_SESSION` are deliberately **not** here even though the
 * heartbeat throws the first one: they are auth codes and WP1 owns their
 * sentence in `shared/errors/auth.ts`. Two fragments defining one key would let
 * the spread order in the barrel silently decide which sentence wins.
 */
export const SYNC_ERRORS = {
  LOG_ENTRY_NOT_FOUND: 'Zapis nije pronađen.',
  LOG_TEMPLATE_MISSING: 'Nepoznata vrsta zapisa.',
} as const
