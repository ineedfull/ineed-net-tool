<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { X } from "lucide-vue-next";

defineProps({ title: String, titleId: String, busy: Boolean });
const emit = defineEmits(["close"]);
const dialog = ref(null);
let previousFocus;

onMounted(() => {
  previousFocus = document.activeElement;
  dialog.value.showModal();
});
onBeforeUnmount(() => {
  dialog.value?.close();
  if (previousFocus?.isConnected) previousFocus.focus();
});

function backdropClick(event) {
  if (event.target !== dialog.value) return;
  const box = dialog.value.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  ) {
    emit("close");
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="desktop-dialog"
    :aria-labelledby="titleId"
    aria-modal="true"
    @cancel.prevent="!busy && emit('close')"
    @click="!busy && backdropClick($event)"
  >
    <header class="dialog-header">
      <h2 :id="titleId">{{ title }}</h2>
      <button
        class="icon-button"
        type="button"
        :aria-label="'关闭' + title"
        :disabled="busy"
        autofocus
        @click="emit('close')"
      >
        <X :size="18" />
      </button>
    </header>
    <slot />
  </dialog>
</template>
