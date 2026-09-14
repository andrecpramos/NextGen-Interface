<script>
	const { data } = $props();
</script>

<svelte:head>
	<title>Dashboard • Acme</title>
</svelte:head>

<h1>{data.user.name}'s dashboard</h1>
<p>Recent activity</p>
