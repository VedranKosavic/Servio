/**
 * Everything the owner can change without a deploy.
 *
 * `venues.settings_json` holds only the keys he has actually touched; every read
 * goes through `getSettings()`, which spreads the stored JSON over the defaults
 * below. That means a key nobody has ever set reads as its documented default
 * rather than as `undefined`, and adding a setting here needs no migration.
 *
 * **No service parses `settings_json` itself.** One parser, one merge, one place
 * to look when a threshold behaves oddly.
 */
import { z } from 'zod'
import type { Role } from './types'

export const DEFAULT_SETTINGS = {
  timezone: 'Europe/Sarajevo',
  business_day_start_hour: 6,
  /** When the café is expected to close, local. Used for the early-close flag. */
  closing_time: '03:00',
  early_close_min: 60,

  /** How long a waiter may undo his own round without asking anybody. */
  void_self_window_s: 300,
  self_void_max_per_shift: 5,
  self_void_max_fen: 3000,
  /** How long after a lock a bartender's PIN can still decide a void. */
  bartender_approve_window_s: 900,

  staff_drinks_per_shift: 2,
  staff_drink_max_fen: 300,

  /** A close inside `max(fen, expected × pct/100)` needs no note. */
  cash_tolerance_fen: 500,
  cash_tolerance_pct: 1,
  variance_alert_fen: 1000,

  waste_pin_threshold_fen: 1000,
  waste_shift_fen: 2000,
  waste_events_per_shift_per_user: 3,

  comp_large_fen: 2000,
  comp_shift_fen: 5000,
  void_bartender_shift_fen: 3000,
  payout_owner_fen: 5000,

  payment_methods: ['cash'] as ('cash' | 'card')[],
  cash_custody: 'per_waiter',
  track_cash_tips: false,

  /**
   * The fine gate on the seven approval routes. `ROUTE_ROLES` is the coarse one:
   * an owner who drops `bartender` from this list gets a bartender who is
   * exactly a waiter, refused by the service even though the route let him in.
   */
  approver_roles: ['admin', 'bartender'] as Role[],
  payout_approver_roles: ['admin'] as Role[],

  /** During a rush anybody carries anybody's tray; refusing would lose the sale. */
  allow_cross_waiter_rounds: true,
  bartender_can_receive_goods: false,
  show_venue_totals_to_staff: false,

  shared_device_idle_s: 300,
  heartbeat_fresh_s: 600,
  clock_skew_alert_s: 300,
  /** How far back a queued round may claim to be before it is clamped. */
  max_sync_lag_h: 12,

  grams_per_bowl_default: 20,
  gpb_band_pct: 15,
  coals_per_bowl_alert: 5,

  // -- Phase 4: Razgovor, slike i Raspored ----------------------------------
  // Every one of these is published on *Pravila*, which is the point of them
  // being settings at all: a threshold the staff cannot read is a rule nobody
  // agreed to (PLAN §8).

  /** How long the author of a text message may delete it himself. */
  chat_delete_own_s: 900,
  /** 200 MB of chat photos per venue per month. */
  chat_image_month_bytes: 209_715_200,
  /** 30 MB and 25 files per person per day, across both upload kinds. */
  upload_user_day_bytes: 31_457_280,
  upload_user_day_files: 25,
  /** After this many days a chat photo is unlinked; the message stays. */
  chat_retention_days: 90,
  /** Minutes past `start_time` before *Sati* prints a late arrival. */
  roster_late_grace_min: 30,
  /** Phase 5 — read by nothing in Phase 4. A swap needs no owner confirmation in v1. */
  swap_needs_owner: false,
}

export type Settings = typeof DEFAULT_SETTINGS

/**
 * Every key optional: a PATCH sends only what changed, and the stored JSON is
 * only ever a partial. An unknown key is a 400 — `.strict()` is what makes a
 * typo in *Postavke* an error instead of a setting that silently does nothing.
 */
export const settingsSchema = z.object({
  timezone: z.string().min(1).max(64),
  business_day_start_hour: z.int().min(0).max(12),
  closing_time: z.string().regex(/^\d{2}:\d{2}$/),
  early_close_min: z.int().min(0).max(600),

  void_self_window_s: z.int().min(0).max(3600),
  self_void_max_per_shift: z.int().min(0).max(100),
  self_void_max_fen: z.int().min(0).max(10_000_000),
  bartender_approve_window_s: z.int().min(0).max(86_400),

  staff_drinks_per_shift: z.int().min(0).max(20),
  staff_drink_max_fen: z.int().min(0).max(10_000_000),

  cash_tolerance_fen: z.int().min(0).max(10_000_000),
  cash_tolerance_pct: z.number().min(0).max(100),
  variance_alert_fen: z.int().min(0).max(10_000_000),

  waste_pin_threshold_fen: z.int().min(0).max(10_000_000),
  waste_shift_fen: z.int().min(0).max(10_000_000),
  waste_events_per_shift_per_user: z.int().min(0).max(100),

  comp_large_fen: z.int().min(0).max(10_000_000),
  comp_shift_fen: z.int().min(0).max(10_000_000),
  void_bartender_shift_fen: z.int().min(0).max(10_000_000),
  payout_owner_fen: z.int().min(0).max(10_000_000),

  payment_methods: z.array(z.enum(['cash', 'card'])).min(1),
  cash_custody: z.enum(['per_waiter', 'shared']),
  track_cash_tips: z.boolean(),

  approver_roles: z.array(z.enum(['admin', 'waiter', 'bartender'])).min(1),
  payout_approver_roles: z.array(z.enum(['admin', 'waiter', 'bartender'])).min(1),

  allow_cross_waiter_rounds: z.boolean(),
  bartender_can_receive_goods: z.boolean(),
  show_venue_totals_to_staff: z.boolean(),

  shared_device_idle_s: z.int().min(0).max(86_400),
  heartbeat_fresh_s: z.int().min(0).max(86_400),
  clock_skew_alert_s: z.int().min(0).max(86_400),
  max_sync_lag_h: z.int().min(1).max(168),

  grams_per_bowl_default: z.number().min(1).max(200),
  gpb_band_pct: z.number().min(0).max(100),
  coals_per_bowl_alert: z.int().min(0).max(100),

  chat_delete_own_s: z.int().min(0).max(86_400),
  chat_image_month_bytes: z.int().min(0).max(10_737_418_240),
  upload_user_day_bytes: z.int().min(0).max(1_073_741_824),
  upload_user_day_files: z.int().min(0).max(500),
  chat_retention_days: z.int().min(1).max(3650),
  roster_late_grace_min: z.int().min(0).max(240),
  swap_needs_owner: z.boolean(),
}).strict().partial()

export type SettingsPatch = z.infer<typeof settingsSchema>

/**
 * The stored JSON, merged over the defaults. Anything unparseable falls back to
 * the defaults rather than throwing: a corrupt settings blob must not stop the
 * café from taking orders.
 */
export function mergeSettings(settingsJson: string | null | undefined): Settings {
  if (!settingsJson) return { ...DEFAULT_SETTINGS }
  try {
    const stored = JSON.parse(settingsJson) as Record<string, unknown>
    return { ...DEFAULT_SETTINGS, ...stored }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** The Bosnian label of each setting, for *Postavke* and the `settings_changed` log. */
export const SETTINGS_LABELS: Partial<Record<keyof Settings, string>> = {
  timezone: 'Vremenska zona',
  business_day_start_hour: 'Početak radnog dana',
  closing_time: 'Vrijeme zatvaranja',
  early_close_min: 'Rano zatvaranje (min)',
  void_self_window_s: 'Vlastiti storno (sekundi)',
  self_void_max_per_shift: 'Vlastitih storna po smjeni',
  self_void_max_fen: 'Najveći vlastiti storno',
  bartender_approve_window_s: 'Šanker odobrava (sekundi)',
  staff_drinks_per_shift: 'Pića za osoblje po smjeni',
  staff_drink_max_fen: 'Najskuplje piće za osoblje',
  cash_tolerance_fen: 'Tolerancija kase',
  cash_tolerance_pct: 'Tolerancija kase (%)',
  variance_alert_fen: 'Prag za javljanje manjka',
  waste_pin_threshold_fen: 'Otpis traži PIN iznad',
  waste_shift_fen: 'Otpis po smjeni',
  waste_events_per_shift_per_user: 'Otpisa po smjeni po osobi',
  comp_large_fen: 'Veliki gratis',
  comp_shift_fen: 'Gratis po smjeni',
  void_bartender_shift_fen: 'Storno šankera po smjeni',
  payout_owner_fen: 'Isplata traži vlasnika iznad',
  payment_methods: 'Načini plaćanja',
  cash_custody: 'Ko drži pazar',
  track_cash_tips: 'Prati napojnice',
  approver_roles: 'Ko odobrava',
  payout_approver_roles: 'Ko odobrava isplate',
  allow_cross_waiter_rounds: 'Tura na tuđem stolu',
  bartender_can_receive_goods: 'Šanker prima robu',
  show_venue_totals_to_staff: 'Osoblje vidi ukupan pazar',
  shared_device_idle_s: 'Zajednički uređaj — mirovanje',
  heartbeat_fresh_s: 'Uređaj se javlja svakih',
  clock_skew_alert_s: 'Odstupanje sata',
  max_sync_lag_h: 'Najstarija tura (sati)',
  grams_per_bowl_default: 'Grama po luli',
  gpb_band_pct: 'Dozvoljeno odstupanje (%)',
  coals_per_bowl_alert: 'Žara po luli',
  chat_delete_own_s: 'Brisanje svoje poruke (sekundi)',
  chat_image_month_bytes: 'Slike u razgovoru — mjesečno',
  upload_user_day_bytes: 'Slike po osobi — dnevno',
  upload_user_day_files: 'Slika po osobi dnevno',
  chat_retention_days: 'Slike u razgovoru se čuvaju (dana)',
  roster_late_grace_min: 'Tolerancija kašnjenja (min)',
  swap_needs_owner: 'Zamjenu potvrđuje vlasnik',
}
