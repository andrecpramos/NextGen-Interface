<script setup lang="ts">
const error = ref<unknown>()

useHead({
  title: 'Search',
})
</script>

<template>
  <div>
    <div v-if="error">
      <h1>{{ $t('Error occurred on fetching') }}</h1>
    </div>
    <h2>{{ $t('Search the catalogue') }}</h2>
    <input type="text" name="q" :placeholder="$t('Type to search...')" />
  </div>
</template>
