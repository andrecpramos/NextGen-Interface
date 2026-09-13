<script setup lang="ts">
const route = useRoute()
const type = computed(() => route.params.type)

// A conditional title is code: not read.
useHead({
  title: type.value === 'movie' ? 'Movies' : 'TV Shows',
})
</script>

<template>
  <h1>{{ type }}</h1>
</template>
