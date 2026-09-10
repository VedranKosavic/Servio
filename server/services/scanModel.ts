/**
 * The only file in Šank that imports the Anthropic SDK (PHASE4 §2.9).
 *
 * It is constructed **lazily, once, and only when `ANTHROPIC_API_KEY` is set**.
 * When it is not, `scanDelivery` throws `503 SCAN_NOT_CONFIGURED` and the typed
 * *Ručno* form is right there — that is a supported state, not a broken one:
 * the key is optional in `.env.example` and CI never has it.
 *
 * The key never leaves the server. There is no `runtimeConfig.public` entry for
 * it, no `useFetch` to Anthropic from a phone, and no route that echoes it.
 *
 * **Four rules, each of which is a bug if broken** (and each is why the request
 * below looks the way it does):
 *
 *   1. **No assistant prefill.** A 400 on this model family.
 *   2. **No `budget_tokens`.** Also a 400 — adaptive thinking is the default on
 *      `claude-opus-5` and is exactly what reading a crumpled otpremnica wants.
 *   3. **The model id is `claude-opus-5`, with no date suffix.**
 *   4. **`parsed_output` may be `null`** — that is a `parsed` scan with `error`
 *      set and an empty draft, not an exception thrown at the owner at 09:00
 *      with a van outside.
 *
 * `betas: ['server-side-fallback-2026-07-01']` with `fallbacks: 'default'` is
 * Anthropic's recommendation for this model: its classifiers can decline a
 * request, and `default` re-runs it server-side on the recommended substitute,
 * routed by refusal category — so we never maintain a model list of our own.
 */
import type { ScanAliasLine, ScanCatalogueLine, ScanParse } from '#shared/types'
import type { ScanModel } from './scan'

/** Exactly this string. A date suffix is a different (and wrong) model id. */
export const SCAN_MODEL_ID = 'claude-opus-5'

/** One otpremnica is a page of text, not a book. */
const MAX_TOKENS = 16_000

let cached: ScanModel | null = null

/**
 * The real client, or `null` when there is no key.
 *
 * The SDK is loaded with a dynamic `import()` rather than a top-level one so
 * that a venue with no key — and every vitest run — never pulls it into the
 * server bundle at all.
 */
export function realScanModel(): ScanModel | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (cached) return cached

  cached = {
    async read(input) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const { betaZodOutputFormat } = await import('@anthropic-ai/sdk/helpers/beta/zod')
      const { scanParseSchema } = await import('#shared/schemas/scan')

      const client = new Anthropic()

      const res = await client.beta.messages.parse({
        model: SCAN_MODEL_ID,
        max_tokens: MAX_TOKENS,
        // Opus 5's classifiers can decline a request; `default` re-runs it
        // server-side on Anthropic's recommended substitute, routed by refusal
        // category, so we never maintain a model list of our own.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { format: betaZodOutputFormat(scanParseSchema) },
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: input.imageBase64 },
            },
            { type: 'text', text: prompt(input.catalogue, input.aliases) },
          ],
        }],
      })

      // A refusal is checked **before** the content is read: on a refusal the
      // content is not the answer, and reading it would put nonsense on the
      // owner's screen as if the model had said it.
      if (res.stop_reason === 'refusal') {
        throw new Error(`model refused: ${res.stop_details?.category ?? 'unknown'}`)
      }

      // `parsed_output` is null when the answer did not validate. The caller
      // turns that into a parsed scan with an error and an empty draft.
      return (res.parsed_output ?? null) as ScanParse | null as ScanParse
    },
  }

  return cached
}

/**
 * The prompt. It carries the venue's own shelf and every alias it has learned,
 * because "Coca Cola 0,25" on a supplier's invoice is only recognisable against
 * a catalogue that has a *Coca-Cola 0,25 l* in it.
 *
 * It asks for `null` rather than a guess wherever the paper is unreadable: a
 * price the owner has to correct is worse than a blank he has to type, because
 * a wrong number that looks right is the one he will not check.
 */
function prompt(catalogue: ScanCatalogueLine[], aliases: ScanAliasLine[]): string {
  return [
    'Pročitaj ovu otpremnicu (dostavnicu) iz kafića u Bosni i Hercegovini.',
    '',
    'Vrati dobavljača, broj otpremnice, datum i sve stavke. Za svaku stavku vrati',
    'tekst reda tačno kako piše na papiru (`text`), količinu (`qty`), pakovanje',
    '(`pack`), cijenu po pakovanju u feninzima (`unit_price_fen`, 1 KM = 100),',
    'te `stock_item_id` iz kataloga ispod ako si siguran koja je to roba.',
    '',
    'Pravila:',
    '- Ako nešto ne možeš pročitati, vrati null. Nemoj pogađati.',
    '- `stock_item_id` mora biti tačan id iz kataloga; ako nijedan ne odgovara, vrati null.',
    '- `confidence` je 0..1: koliko si siguran da je red spojen s tačnim artiklom.',
    '',
    'Katalog (id · naziv · brend · pakovanje · osnovna jedinica):',
    ...catalogue.map(c =>
      `${c.id} · ${c.name} · ${c.brand ?? '-'} · ${c.pack_name ?? '-'}`
      + ` ${c.pack_qty ?? '-'} · ${c.base_unit}`),
    '',
    aliases.length > 0 ? 'Već naučeni nazivi dobavljača (naziv → id):' : 'Nema naučenih naziva.',
    ...aliases.map(a => `${a.alias} → ${a.stock_item_id}${a.supplier_name ? ` (${a.supplier_name})` : ''}`),
  ].join('\n')
}
