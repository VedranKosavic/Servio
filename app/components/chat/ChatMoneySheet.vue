<script setup lang="ts">
/**
 * The money sheet: *Svi* and *Konobari* are not where somebody's pazar goes.
 *
 * It **never blocks** anything (PLAN §8). The rule it protects is a fairness
 * rule, not a security one — nobody's manjak, razlika or predaja belongs on a
 * screen his colleagues read — and a refusal would only teach people to write
 * "šest dvanaest pedeset" instead. So the sheet asks once, *Ipak pošalji* sends
 * with `money_ack: true`, and the Dnevnik keeps a quiet record that the question
 * was asked and answered.
 *
 * *Pošalji u Admini* appears only for somebody who can open *Admini* at all — an
 * admin. A waiter's way to the owner is *Prijavi vlasniku* on a message that
 * already exists, and offering him a channel he cannot see would be a button
 * that always answers 403.
 */
defineProps<{ busy?: boolean, canAdmini?: boolean }>()

const emit = defineEmits<{ close: [], send: [], admini: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-40 bg-black/60" @click="emit('close')" />

  <div
    class="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-3 rounded-t-2xl border-t border-line bg-surface px-4 pb-6 pt-4"
    role="dialog"
    aria-label="Iznosi u kanalu"
  >
    <p class="section-title">
      Iznosi kolega ne idu u Svi — pošalji u Admini?
    </p>
    <p class="text-text-2">
      Pazar, manjak i razlika su između tebe i vlasnika.
    </p>

    <button
      v-if="canAdmini"
      type="button"
      class="btn btn-primary min-h-14 text-body"
      :disabled="busy"
      @click="emit('admini')"
    >
      Pošalji u Admini
    </button>
    <button type="button" class="btn min-h-14 text-body" :disabled="busy" @click="emit('send')">
      Ipak pošalji
    </button>
    <button type="button" class="btn btn-ghost min-h-12 text-body" @click="emit('close')">
      Odustani
    </button>
  </div>
</template>
