<!-- Rendered by EditorPage.svelte: its controls are the page's. -->
<script>
  export let article
</script>

<form method="POST" use:enhance>
  <input name="title" value={article.title} />
  <button class="btn btn-primary">Publish article</button>
</form>
