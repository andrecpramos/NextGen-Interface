<!-- ADR-031: read by markup.test.ts alone; belongs to no fixture app. -->
<script>
  let open = false
</script>

<button on:click={() => (open = true)}>New event</button>
<button on:click={() => remove(id)}>Delete</button>
