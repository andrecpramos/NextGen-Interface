<!-- ADR-042: controls that do something, in a Svelte page. Read by markup-actions.test.ts alone. -->
<script>
  let open = false
</script>

<button on:click={() => cancelSession(id)}>Cancel session</button>
<button onclick={publish}>Publish plan</button>
<button on:click={() => (open = true)}>New session</button>
{#if $user.isAdmin}
  <button on:click={archive}>Archive season</button>
{/if}
{#if sessions.length}
  <button on:click={exportCsv}>Export CSV</button>
{/if}
<!-- Only for whoever wrote it: about who, as much as a role is. -->
{#if article.author.username === user?.username}
  <button on:click={removeArticle}>Delete article</button>
{/if}
<!-- SvelteKit's form actions: a button with no type submits the form, by HTML's default. -->
<form method="POST" use:enhance>
  <button class="btn btn-primary">Publish article</button>
  <button type="button">Preview</button>
</form>
