/**
 * *Zaključi smjenu* — the arithmetic, written once for the server and the screen.
 *
 * The owner's close is a plain subtraction, not a cash count:
 *
 *     Sav prihod − Dnevnica − Otpis − Rashod − Policija − Osoblje
 *       − Plaćanje robe − Plaćanje okusa za nargilu − Plaćanje žara
 *       − Plaćanje kafe − Merkator − Dodatna plaćanja = Za predati
 *
 * The first six are the server's and nobody types them (the owner's call,
 * 16.09.2026): promet, the venue's fixed daily wage, and the four categories
 * marked on the floor — *Otpis*, *Rashod*, *Policija* and *Osoblje* — which
 * come off the night by themselves, the way *Dnevnica* always has. The five
 * typed ones are what the šanker paid out of the takings and only he can know,
 * and *Dodatna plaćanja* is the same thing without a fixed name: a label and an
 * amount, as many as the night had. The
 * šanker's screen shows a live *Za predati* while he types, and the server
 * stores its own — both call `zaPredati`, so the number he saw is the number
 * that was written. It may be negative, and nothing here hides that.
 */

export interface ClosingAmounts {
  prihod_fen: number
  dnevnica_fen: number
  otpis_fen: number
  rashod_fen: number
  policija_fen: number
  osoblje_fen: number
  roba_fen: number
  okusi_fen: number
  zar_fen: number
  kafa_fen: number
  merkator_fen: number
  /** The sum of *Dodatna plaćanja*; the lines themselves are on the closing. */
  extra_fen: number
}

/**
 * The four amounts the šanker types, in the order the screen asks for them.
 *
 * *Rashod* left this list on 16.09.2026: it is marked on the table it was drunk
 * at, so the server counts it like *Otpis* and typing it again would subtract
 * it twice.
 */
export const TYPED_KEYS = [
  'roba_fen', 'okusi_fen', 'zar_fen', 'kafa_fen', 'merkator_fen',
] as const
export type TypedKey = (typeof TYPED_KEYS)[number]

/** Every subtracted line, in order, with its Bosnian label. */
export const CLOSING_LINES: { key: Exclude<keyof ClosingAmounts, 'prihod_fen'>, label: string }[] = [
  { key: 'dnevnica_fen', label: 'Dnevnica' },
  { key: 'otpis_fen', label: 'Otpis' },
  { key: 'rashod_fen', label: 'Rashod' },
  { key: 'policija_fen', label: 'Policija' },
  { key: 'osoblje_fen', label: 'Osoblje' },
  { key: 'roba_fen', label: 'Plaćanje robe' },
  { key: 'okusi_fen', label: 'Plaćanje okusa za nargilu' },
  { key: 'zar_fen', label: 'Plaćanje žara' },
  { key: 'kafa_fen', label: 'Plaćanje kafe' },
  { key: 'merkator_fen', label: 'Merkator' },
]

/** One *Dodatno plaćanje*: what it was called, and what it cost. */
export interface ClosingExtra {
  label: string
  fen: number
}

/**
 * Every subtracted line of a closing, in the order it is read — the fixed ones
 * and then whatever the šanker typed under *Dodatna plaćanja*.
 *
 * Both screens that print a closing (*Zaključi smjenu* when it is done, and
 * *Kasa* on the owner's *Smjena*) fold this, so a line added here appears on
 * both or on neither.
 */
export function closingLines(
  amounts: ClosingAmounts, extras: ClosingExtra[] = [],
): { label: string, fen: number }[] {
  return [
    ...CLOSING_LINES.map(line => ({ label: line.label, fen: amounts[line.key] })),
    ...extras.map(extra => ({ label: extra.label, fen: extra.fen })),
  ]
}

/** `prihod − everything else`, in feninga. Integers in, an integer out. */
export function zaPredati(a: ClosingAmounts): number {
  return a.prihod_fen
    - a.dnevnica_fen
    - a.otpis_fen
    - a.rashod_fen
    - a.policija_fen
    - a.osoblje_fen
    - a.roba_fen
    - a.okusi_fen
    - a.zar_fen
    - a.kafa_fen
    - a.merkator_fen
    - a.extra_fen
}
