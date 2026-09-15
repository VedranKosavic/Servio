/**
 * *Kontrolna ploča* — every table the owner may edit, listed once.
 *
 * The hub page (`app/pages/admin/kontrola/index.vue`) draws this; a test checks
 * that every `ready` row points at a page that exists. A screen still being
 * built is `ready: false` and renders greyed out with its `soon` line, the same
 * rule `adminNav.ts` follows — so a package adding one flips one boolean here.
 *
 * **What is not here, on purpose.** Orders, payments, stock movements and closed
 * shifts are the ledger: append-only, enforced by SQLite triggers. They appear
 * only in the read-only section, which links to the screens that correct a
 * mistake the honest way (storno, korekcija, poništen prijem) rather than by
 * editing history.
 */

export interface KontrolaLink {
  id: string
  to: string
  /** Bosnian, from PLAN §12 where the glossary has the word. */
  label: string
  sub: string
  ready: boolean
  soon?: string
}

export interface KontrolaSection {
  id: string
  title: string
  /** One line under the title, for the section that needs explaining. */
  note?: string
  links: KontrolaLink[]
}

export const KONTROLA: KontrolaSection[] = [
  {
    id: 'ljudi',
    title: 'Ljudi i uređaji',
    links: [
      { id: 'osoblje', to: '/admin/postavke/osoblje', label: 'Osoblje', sub: 'Novi radnik, uloga, PIN, aktivan', ready: true },
      { id: 'uredaji', to: '/admin/postavke/uredaji', label: 'Uređaji', sub: 'Kod za prijavu telefona, povlačenje', ready: true },
    ],
  },
  {
    id: 'meni',
    title: 'Meni',
    links: [
      { id: 'meni', to: '/admin/meni', label: 'Artikli i cijene', sub: 'Novi artikal, cijena, normativ', ready: true },
      { id: 'kategorije', to: '/admin/postavke/kategorije', label: 'Kategorije', sub: 'Redoslijed i nazivi kategorija', ready: true },
    ],
  },
  {
    id: 'zaliha',
    title: 'Zaliha',
    links: [
      { id: 'artikli', to: '/admin/kontrola/artikli', label: 'Artikli zalihe', sub: 'Jedinica, paket, nabavna cijena, tolerancija', ready: false, soon: 'uskoro' },
      { id: 'prijem', to: '/admin/roba/prijem', label: 'Prijem robe', sub: 'Šta je stiglo na policu', ready: true },
      { id: 'pocetno', to: '/admin/roba/pocetno-stanje', label: 'Početno stanje', sub: 'Prvi popis sa cijenama', ready: true },
    ],
  },
  {
    id: 'lokal',
    title: 'Lokal',
    links: [
      { id: 'stolovi', to: '/admin/kontrola/stolovi', label: 'Stolovi', sub: 'Stolovi i zone na planu', ready: false, soon: 'uskoro' },
      { id: 'sabloni', to: '/admin/kontrola/sabloni', label: 'Šabloni smjena', sub: 'Vrijeme prve i druge smjene', ready: false, soon: 'uskoro' },
      { id: 'podesavanja', to: '/admin/kontrola/podesavanja', label: 'Podešavanja', sub: 'Pragovi i ko odobrava', ready: false, soon: 'uskoro' },
    ],
  },
  {
    id: 'historija',
    title: 'Historija',
    note: 'Samo za čitanje. Greška se ispravlja stornom, korekcijom ili poništenjem prijema, nikad izmjenom zapisa.',
    links: [
      { id: 'smjene', to: '/admin/smjene', label: 'Smjene', sub: 'Noći, pazar i predaje', ready: true },
      { id: 'stanje', to: '/admin/roba', label: 'Stanje šanka', sub: 'Zaliha i kretanja po artiklu', ready: true },
      { id: 'prijemi', to: '/admin/roba/prijem/historija', label: 'Historija prijema', sub: 'Proknjiženi prijemi robe', ready: true },
    ],
  },
]
