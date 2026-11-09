<script setup>
import { Table2, LayoutGrid } from "lucide-vue-next";
defineProps({ modelValue: String });
const emit = defineEmits(["update:modelValue"]);
</script>
<template>
  <div class="scan-view-toggle" role="group" aria-label="IP 显示方式">
    <button
      :aria-pressed="modelValue === 'table'"
      @click="emit('update:modelValue', 'table')"
    >
      <Table2 :size="14" />表格
    </button>
    <button
      :aria-pressed="modelValue === 'compact'"
      @click="emit('update:modelValue', 'compact')"
    >
      <LayoutGrid :size="14" />紧凑网格
    </button>
  </div>
</template>
