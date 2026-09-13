<script setup lang="ts">
const item = await getMedia()
useHead({ title: item.name })
</script>

<template>
  <MediaDetails :item="item" />
</template>
