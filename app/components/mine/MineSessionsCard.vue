<script setup lang="ts">
/**
 * *Moji podaci* — every sign-in of this person, and nobody else's (§1.7).
 *
 * PLAN §5 wants a waiter able to notice a login on a phone that is not his.
 * That is the whole feature: no revoke button, no device management, just the
 * list and one honest sentence about what to do with it. Revoking is the
 * owner's, on `/a` → *Uređaji*, because a waiter who could revoke sessions
 * could revoke a colleague's mid-shift.
 *
 * The list is twenty rows at most and the current session is marked, so "that
 * one is me" never needs guessing.
 */
import type { MySession } from '#shared/types'

defineProps<{ sessions: MySession[] }>()

/** `"2026-09-08T22:41:00Z"` → `"08.09. 22:41"`, on the café's wall clock. */
const stamp = new Intl.DateTimeFormat('bs-BA', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23', timeZone: 'Europe/Sarajevo',
})

function when(iso: string | null): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '—'
  return stamp.format(new Date(iso))
}
</script>

<template>
  <section class="card flex flex-col gap-2 p-4">
    <h2 class="text-xl font-bold">
      Moji podaci
    </h2>

    <p class="text-[15px] text-text-2">
      Ovdje su sve tvoje prijave. Ako vidiš prijavu koju ne prepoznaješ, reci
      vlasniku — nije optužba ni za koga, nego stvar koju vrijedi provjeriti.
    </p>

    <div v-if="sessions.length" class="flex flex-col">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="flex items-baseline justify-between gap-3 border-t border-line py-2.5 first:border-t-0 first:pt-0"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="truncate text-[17px]">{{ session.device_label }}</span>
            <span v-if="session.current" class="chip chip-good shrink-0">ovaj telefon</span>
            <span v-else-if="session.borrowed" class="chip chip-warn shrink-0">posuđen</span>
          </div>
          <div class="num text-sm text-text-2">
            zadnji put {{ when(session.last_seen_at) }}
          </div>
        </div>
        <span class="num shrink-0 text-[15px] text-text-2">{{ when(session.created_at) }}</span>
      </div>
    </div>

    <p v-else class="py-4 text-center text-text-2">
      Nema zapisanih prijava.
    </p>
  </section>
</template>
