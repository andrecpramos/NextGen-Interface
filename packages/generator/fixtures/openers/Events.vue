<!-- ADR-031: read by markup.test.ts alone; belongs to no fixture app. -->
<template>
  <div>
    <button @click="showForm = true">{{ $t('events.new') }}</button>
    <v-btn @click="filters = !filters">Filters</v-btn>
    <button aria-label="Import events" @click.prevent="openImport()"><icon-upload /></button>
    <button @click="save()">Save</button>
    <button @click="showForm = false">Close</button>
    <button @click="showForm = true; track('new')">New tracked</button>
  </div>
</template>

<script setup>
const showForm = ref(false)
</script>
