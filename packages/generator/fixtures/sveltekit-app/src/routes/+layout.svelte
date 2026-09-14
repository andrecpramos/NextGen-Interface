<script>
	import Nav from './Nav.svelte';
	const { children } = $props();
</script>

<Nav />
{@render children()}
