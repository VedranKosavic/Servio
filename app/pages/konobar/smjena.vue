<script setup lang="ts">
/**
 * `/konobar/smjena` — where *Završi smjenu* used to be.
 *
 * The waiter no longer ends the shift (the owner's call, 15.09.2026): the šanker
 * closes the whole night with *Zaključi smjenu* on `/sanker/zakljuci`, and a
 * konobar's numbers appear on *Moja smjena* once it is closed. The address stays
 * as a redirect so an installed app or an old bookmark lands somewhere useful
 * instead of on a 404. `POST /api/shifts/:id/settle` still exists on the server,
 * unused by any screen.
 */
definePageMeta({
  middleware: [() => navigateTo('/konobar/moja-smjena', { replace: true })],
})
</script>

<template>
  <div />
</template>
