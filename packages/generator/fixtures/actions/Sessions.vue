<!-- ADR-042: controls that do something, in a Vue template. Read by markup-actions.test.ts alone. -->
<template>
  <form @submit.prevent="save">
    <button @click="cancelSession(id)">{{ $t('sessions.cancel') }}</button>
    <v-btn @click="publish">Publish plan</v-btn>
    <button type="submit">Save changes</button>
    <!-- Opens, moves, closes, leaves: not actions. -->
    <button @click="showForm = true">New session</button>
    <button @click="$router.push('/training')">Back to training</button>
    <button @click="showForm = false">Close</button>
    <button @click="logout()">Sign out</button>
    <a href="" @click.prevent="goTo({ feed: 'following' })">Your Feed</a>
    <!-- Only for some people: never listed, whatever the condition means. -->
    <button v-if="canDelete" @click="remove(id)">Delete session</button>
    <div v-if="user.isAdmin">
      <button @click="archive()">Archive season</button>
    </div>
    <button :disabled="!canEdit" @click="reorder()">Reorder drills</button>
    <!-- A condition about anything else narrows nothing. -->
    <button v-if="sessions.length > 0" @click="exportCsv()">Export CSV</button>
  </form>
</template>

<script setup>
const showForm = ref(false)
</script>
