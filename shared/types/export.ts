/**
 * *Izvoz* — the four CSV files Phase 2 ships, described once for both sides.
 *
 * The server builds the file and the `/a/izvoz` page draws a card and a
 * *Preuzmi* link for each one, and both read the table below rather than
 * spelling a path out twice. A download is a plain navigation and not a
 * `$fetch`, so it never goes through `useAdminApi` — the browser has to follow
 * the URL itself for `Content-Disposition` to save a file — which is why the
 * one place that knows these URLs is here, beside the types.
 *
 * `PLAN.md` §11 names the files with **underscores** (`dnevni_pazar.csv`) and
 * `docs/BACKEND.md` §14.15 requires **hyphens** in path segments. Both are
 * honoured: the path is `/api/owner/export/dnevni-pazar`, the saved file is
 * `dnevni_pazar.csv`.
 *
 * The remaining four files of PLAN §11 page 5 — `prijemi`, `nargila`,
 * `kategorije`, `sati` — are Phase 3b and are deliberately not here.
 */

/** The four files. The key is also the last segment of the route's path. */
export type ExportKey = 'smjene' | 'dnevni-pazar' | 'stavke' | 'popis'

export interface ExportSpec {
  key: ExportKey
  /** The route, with no query string. */
  path: string
  /** What the browser saves it as — underscores, per PLAN §11. */
  filename: string
  /** The card's title on `/a/izvoz`. Bosnian, like everything on screen. */
  title_bs: string
  /** One line under it: what one row of the file is. */
  sub_bs: string
  /**
   * What the file needs before it can be built. `period` takes `from` and `to`
   * off the page's *Period* picker; `count` needs one *popis* chosen by hand,
   * because a count is one moment and not a range.
   */
  needs: 'period' | 'count'
}

export const EXPORTS: Record<ExportKey, ExportSpec> = {
  'smjene': {
    key: 'smjene',
    path: '/api/owner/export/smjene',
    filename: 'smjene.csv',
    title_bs: 'Smjene',
    sub_bs: 'Jedan red po smjeni: promet, gotovina, kartica, razlika, manjak robe.',
    needs: 'period',
  },
  'dnevni-pazar': {
    key: 'dnevni-pazar',
    path: '/api/owner/export/dnevni-pazar',
    filename: 'dnevni_pazar.csv',
    title_bs: 'Dnevni pazar',
    sub_bs: 'Jedan red po danu, sabrane sve smjene tog dana.',
    needs: 'period',
  },
  'stavke': {
    key: 'stavke',
    path: '/api/owner/export/stavke',
    filename: 'stavke.csv',
    title_bs: 'Stavke',
    sub_bs: 'Jedan red po stavci: vrijeme, konobar, sto, artikal, iznos, status.',
    needs: 'period',
  },
  'popis': {
    key: 'popis',
    path: '/api/owner/export/popis',
    filename: 'popis.csv',
    title_bs: 'Popis',
    sub_bs: 'Jedan red po stavci popisa: izbrojano, teoretski, razlika i njena vrijednost.',
    needs: 'count',
  },
}

/** In the order the cards are drawn on *Izvoz*. */
export const EXPORT_ORDER: ExportKey[] = ['smjene', 'dnevni-pazar', 'stavke', 'popis']

export interface ExportQuery {
  /** Business dates, inclusive, `YYYY-MM-DD`. */
  from?: string
  to?: string
  /** `stavke.csv` only: full names instead of initials. */
  full_names?: boolean
  /** `popis.csv` only. */
  count_id?: string
}

/**
 * The URL a *Preuzmi* link points at.
 *
 * Written here rather than in a component so the page cannot invent a filter
 * the route does not implement, and so `export.test.ts` checks the same string
 * the browser will ask for.
 */
export function exportUrl(key: ExportKey, q: ExportQuery = {}): string {
  const search = new URLSearchParams()
  if (q.from) search.set('from', q.from)
  if (q.to) search.set('to', q.to)
  if (q.full_names) search.set('full_names', '1')
  if (q.count_id) search.set('count_id', q.count_id)
  const text = search.toString()
  return text ? `${EXPORTS[key].path}?${text}` : EXPORTS[key].path
}

/**
 * The line every file ends with, and the sentence the page repeats above the
 * cards. Šank is **not a fiscal device** (CLAUDE.md): no receipts, no PDV, no
 * numbering — so a file that leaves the building says what it is.
 */
export const EXPORT_DISCLAIMER = 'interni izvještaj — nije fiskalni'

/** What one route hands back: the bytes, and what to call them. */
export interface CsvFile {
  filename: string
  /** The whole file, BOM included. */
  text: string
}
