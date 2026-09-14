<script>
	const { data } = $props();
</script>

{#if data.error}
	<h1>Could not load your orders</h1>
{/if}

<h2>Your orders</h2>
