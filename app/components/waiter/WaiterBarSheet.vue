<script setup lang="ts">
/**
 * *Šank* — everything that happens at the counter rather than at a table.
 *
 * Tapping the bar on the plan used to do nothing at all. The owner's list, in
 * his order (22.09.2026): the shelf, a nargila to take away, a drink to take
 * away, what the staff drank tonight, and what was spilled.
 *
 * **Four of the five are one thing wearing four hats**: a tab on no table, the
 * *Bez stola* the app already has. A takeaway is a tab somebody pays for; what
 * the staff drank and what was spilled are tabs nobody pays for, marked
 * *Osoblje* and *Otpis* the moment the round is locked — which is what puts
 * them in the shift's own subtraction (`shiftCategories`) instead of on the
 * waiter's money. The fifth, *Stanje šanka*, is a read, and it opens over the
 * plan rather than walking the waiter into the bartender's screen.
 *
 * Every row rings the goods up the ordinary way, so the grams and the bottles
 * come off the shelf exactly as a sold one does. That is the whole reason it
 * is a menu and not a text box.
 */
const emit = defineEmits<{
  close: []
  /** The shelf, over the plan. */
  stanje: []
  /** A tab on no table: a sale the guest pays for. */
  nargila: []
  pice: []
  /** A tab on no table that nobody pays for, marked the moment it is locked. */
  osoblje: []
  otpis: []
}>()

useSheetDismiss(() => emit('close'))
</script>

<template>
  <div class="fixed inset-0 z-50">
    <div class="sheet-scrim" @click="emit('close')" />

    <div
      class="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] w-full max-w-3xl flex-col gap-4 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3"
      role="dialog"
      aria-label="Šank"
    >
      <span class="mx-auto h-1 w-10 shrink-0 rounded-full bg-line" />

      <div class="flex items-center gap-3">
        <button
          type="button"
          class="flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-2 text-text-2"
          aria-label="Zatvori"
          @click="emit('close')"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <span class="section-title grow truncate">Šank</span>
      </div>

      <ul class="flex flex-col gap-2">
        <li>
          <button type="button" class="bar-row" @click="emit('stanje')">
            <span class="bar-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7h18M3 12h18M3 17h18" /><path d="M7 7v10M17 7v10" />
              </svg>
            </span>
            <span class="bar-text">
              <span class="bar-name">Stanje šanka</span>
              <small class="bar-sub">Koliko je čega ostalo na polici</small>
            </span>
            <svg class="bar-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </li>

        <li>
          <button type="button" class="bar-row" @click="emit('nargila')">
            <span class="bar-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3c1.6 2 .6 3.2 0 4.2-.8 1.3-.3 2.4.8 3.3" />
                <path d="M7 12h10l-1.2 7.2a2 2 0 0 1-2 1.8h-3.6a2 2 0 0 1-2-1.8z" />
              </svg>
            </span>
            <span class="bar-text">
              <span class="bar-name">Nargila za ponijeti</span>
              <small class="bar-sub">Bez stola, grami se skidaju sa stanja</small>
            </span>
            <svg class="bar-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </li>

        <li>
          <button type="button" class="bar-row" @click="emit('pice')">
            <span class="bar-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" /><path d="M17 9h2a2.5 2.5 0 0 1 0 5h-2" /><path d="M5 21h12" />
              </svg>
            </span>
            <span class="bar-text">
              <span class="bar-name">Piće za ponijeti</span>
              <small class="bar-sub">Kafa, voda, sok — bilo šta s menija</small>
            </span>
            <svg class="bar-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </li>

        <!-- The two that nobody pays for. They ring up the same goods and come
             off the shift at the end, so the waiter is never short for them. -->
        <li>
          <button type="button" class="bar-row" @click="emit('osoblje')">
            <span class="bar-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-4A3.5 3.5 0 0 0 5 18.5V20" />
                <circle cx="10.5" cy="8" r="3.2" /><path d="M17.5 11.5a3 3 0 1 0-1.8-5.4" /><path d="M19 20v-1.2a3 3 0 0 0-2.2-2.9" />
              </svg>
            </span>
            <span class="bar-text">
              <span class="bar-name">Osoblje</span>
              <small class="bar-sub">Šta je osoblje popilo u smjeni — ne naplaćuje se</small>
            </span>
            <span class="chip chip-accent shrink-0">bez naplate</span>
          </button>
        </li>

        <li>
          <button type="button" class="bar-row" @click="emit('otpis')">
            <span class="bar-ico bar-ico-warn" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="M6 7l1 12.2A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.8L18 7" />
              </svg>
            </span>
            <span class="bar-text">
              <span class="bar-name">Otpis</span>
              <small class="bar-sub">Proliveno, razbijeno, pogrešno napravljeno</small>
            </span>
            <span class="chip chip-warn shrink-0">otpis</span>
          </button>
        </li>
      </ul>

      <p class="pb-1 text-center text-caption tracking-normal text-muted">
        Sve s ovog spiska skida sa stanja šanka isto kao i prodana tura.
      </p>
    </div>
  </div>
</template>

<style scoped>
.bar-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  min-height: 68px;
  padding: 12px 14px;
  border-radius: var(--radius-card);
  border: 1.5px solid var(--line);
  background: var(--surface);
  color: var(--text);
  text-align: left;
  transition: transform var(--dur-tap) var(--ease-standard);
}

.bar-row:active { transform: scale(0.98); }

.bar-ico {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: var(--radius-field);
  background: var(--accent-soft);
  color: var(--accent-text);
}

.bar-ico svg { width: 22px; height: 22px; }
.bar-ico-warn { background: var(--warn-soft); color: var(--warn); }

.bar-text { display: flex; min-width: 0; flex-direction: column; gap: 2px; flex-grow: 1; }

.bar-name { font-size: var(--text-body); font-weight: 600; }

.bar-sub {
  font-size: var(--text-caption);
  line-height: 1.3;
  color: var(--text-2);
}

.bar-chev { width: 20px; height: 20px; flex-shrink: 0; color: var(--muted); }
</style>
