/**
 * *Pravila* on the phone: the published text, the acknowledgement, and the one
 * rule that decides whether S12 stands in front of S1.
 *
 * **The gate is a client rule and nothing else** (PHASE4 §2.8). The server
 * never refuses an order because a waiter has not read v3 — refusing to record
 * a round the guest is already drinking would put money outside the ledger,
 * which is the one thing this app exists to prevent. So the gate lives here,
 * and the evidence is the `rules_acked` entry with its timestamp.
 *
 * **When it appears, and when it deliberately does not.** The gate stands at
 * the *first login after a new version* and never mid-shift: a version
 * published at 22:00 must not step between a waiter and a table. That is what
 * the *baseline* below is. On the first read of a session the version at that
 * moment is written down; the gate arms only while the current version is still
 * that one. A version that appears later in the same session is loaded, shown
 * on the page, and waits for the next login to become a gate.
 *
 * `useState`, not a module-level `ref`: it is Nuxt's per-request store, so a
 * server render never leaks one phone's answer into the next one's page — the
 * same reason `useMe()` uses it.
 */
import type { RulesView } from '#shared/types'

/**
 * The session this phone last evaluated the gate for, and the version it saw
 * then. In `localStorage` rather than in memory so that a reload — a waiter who
 * pulled the page down mid-gate — does not hand him a free pass; it starts with
 * `sank:` so `useMe().wipeLocalState()` clears it when the device is revoked.
 */
const BASELINE_KEY = 'sank:rules:gate'

interface Baseline {
  session: string
  version: number
}

/**
 * The starter document, offered in the editor when a venue has never published
 * anything. It is a **draft**, not the rules: the owner edits it and publishes
 * it in his own words, which is the whole difference between a house rule and a
 * page of text an app came with.
 *
 * The `{{…}}` tokens are the live thresholds (`app/utils/markdownish.ts`), so
 * the number on every phone follows *Podešavanja* without a new version.
 */
export const RULES_DRAFT_MD = `# Pravila lokala

Ovo su pravila po kojima radimo. Pišu ovdje zato što pravilo koje ne znaš
unaprijed nije pravilo.

## Smjena

- Dolazak je na vrijeme; kašnjenje preko {{roster_late_grace_min}} se vidi u *Satima* i o njemu se razgovara.
- Smjena se završava kroz *Završi smjenu* — pazar se predaje, ne ostavlja.
- Tolerancija pazara je {{cash_tolerance_fen}} ili {{cash_tolerance_pct}} očekivanog iznosa.

## Roba i šank

- Šanker sipa; konobar ne uzima flaše sa police.
- Otpis iznad {{waste_pin_threshold_fen}} potvrđuje šanker ili vlasnik svojim PIN-om.
- Najviše {{waste_events_per_shift_per_user}} otpisa po osobi po smjeni.

## Storno i gratis

- Svoju grešku ispravljaš sam u prvih {{void_self_window_s}} od zaključavanja.
- Poslije toga odlučuje šanker, u roku od {{bartender_approve_window_s}}.
- Na račun kuće: {{staff_drinks_per_shift}} po smjeni, do {{staff_drink_max_fen}} po piću.

## Razgovor

- Slike su samo šanka, robe i prostora — gosti nikad.
- Svoju poruku možeš obrisati u prvih {{chat_delete_own_s}}.
- Slike u razgovoru žive {{chat_retention_days}}, poslije toga ih više nema.
`

export function useRules() {
  const api = useApi()
  const me = useMe()

  const view = useState<RulesView | null>('sank:rules', () => null)
  const loaded = useState<boolean>('sank:rules:loaded', () => false)
  const baseline = useState<number | null>('sank:rules:baseline', () => null)
  const error = useState<string | null>('sank:rules:error', () => null)
  const acking = ref(false)

  const version = computed(() => view.value?.version ?? 0)
  const published = computed(() => version.value > 0)
  const mustAck = computed(() => view.value?.must_ack === true)

  /**
   * Does S12 stand in front of S1 right now?
   *
   * Three things at once: something is published, this reader owes an
   * acknowledgement, and the version he owes is the one this session started
   * with. Drop the third and a publish at 22:00 becomes a wall in front of a
   * table, which §2.8 forbids.
   */
  const gateActive = computed(() =>
    mustAck.value && baseline.value !== null && version.value <= baseline.value)

  /** Write down the version this session began with, once per session. */
  function syncBaseline() {
    if (!import.meta.client) return
    const sessionId = me.session.value?.id
    const current = view.value
    if (!sessionId || !current) return

    try {
      const raw = localStorage.getItem(BASELINE_KEY)
      const saved = raw ? JSON.parse(raw) as Baseline : null
      if (saved && saved.session === sessionId && typeof saved.version === 'number') {
        baseline.value = saved.version
        return
      }
      baseline.value = current.version
      localStorage.setItem(BASELINE_KEY,
        JSON.stringify({ session: sessionId, version: current.version } satisfies Baseline))
    } catch {
      // Private mode, or storage disabled. A phone that cannot remember still
      // has to behave: treat this session as if it began at the current
      // version, which is the honest reading of "first login after a change".
      baseline.value = current.version
    }
  }

  /** `GET /api/rules`. A failure is a state, never an exception for a screen. */
  async function load(): Promise<RulesView | null> {
    try {
      view.value = await api.getRules()
      loaded.value = true
      error.value = null
    } catch (err) {
      error.value = apiErrorText(err, 'Pravila se nisu učitala — provjeri vezu.')
    }
    syncBaseline()
    return view.value
  }

  /** One read per session; every later caller gets the answer already here. */
  async function ensure(): Promise<RulesView | null> {
    if (!loaded.value) return load()
    syncBaseline()
    return view.value
  }

  /**
   * The poll says the version moved (`ChangesResult.rules_version`).
   *
   * It refetches the text — a phone showing v2 while v3 is published is exactly
   * the *Pravila lying* this feature exists to prevent — and it does **not**
   * touch the baseline, so the gate stays down until the next login.
   */
  async function onVersion(next: number | undefined): Promise<void> {
    if (typeof next !== 'number') return
    if (next === version.value) return
    await load()
  }

  /** *Potvrđujem*. Once per version; the server refuses an older one. */
  async function ack(): Promise<boolean> {
    const current = view.value
    if (!current || current.version < 1 || acking.value) return false
    acking.value = true
    try {
      view.value = await api.ackRules(current.version)
      error.value = null
      return true
    } catch (err) {
      // `RULES_STALE` means a newer version landed between the read and the tap:
      // re-read, and the screen shows the text he actually has to confirm.
      error.value = apiErrorText(err, 'Potvrda nije snimljena — pokušaj ponovo.')
      await load()
      return false
    } finally {
      acking.value = false
    }
  }

  return {
    view,
    error,
    acking,
    version,
    published,
    mustAck,
    gateActive,
    load,
    ensure,
    onVersion,
    ack,
  }
}
