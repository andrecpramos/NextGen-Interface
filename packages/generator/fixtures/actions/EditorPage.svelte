<!-- ADR-042: a markup page whose controls live in the components it renders. Read by markup-actions.test.ts. -->
<script>
  import Editor from './Editor.svelte'
  import AdminTools from './AdminTools.svelte'
  import { page } from '$app/stores'
</script>

<h1>Editor</h1>
<Editor article={data.article} />
{#if $page.data.user.isAdmin}
  <AdminTools />
{/if}
