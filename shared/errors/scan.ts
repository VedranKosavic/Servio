/**
 * WP0 owns this fragment: *Prijem sa slike* (PHASE4 §2.9).
 *
 * `SCAN_NOT_CONFIGURED` is a **supported state**, not a fault: a venue with no
 * `ANTHROPIC_API_KEY` gets a calm card and the typed *Ručno* form open beneath
 * it. The sentence therefore names the way forward and nothing else.
 */
export const SCAN_ERRORS = {
  SCAN_NOT_CONFIGURED: 'Prepoznavanje sa slike nije podešeno — unesi prijem ručno.',
  SCAN_NOT_FOUND: 'Taj sken ne postoji.',
  SCAN_NOT_PARSED: 'Ovaj sken još nije pročitan.',
  SCAN_ALREADY_APPLIED: 'Ovaj sken je već proknjižen.',
  ALIAS_EXISTS: 'Taj naziv je već povezan s nekim artiklom.',
}
