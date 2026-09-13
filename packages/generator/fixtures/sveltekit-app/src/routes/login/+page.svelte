<script>
	import { enhance } from '$app/forms';
</script>

<svelte:head>
	<title>Sign in • Acme</title>
</svelte:head>

<h1>Sign in</h1>
<form use:enhance method="POST">
	<input name="email" type="email" placeholder="Email" />
	<input name="password" type="password" placeholder="Password" />
	<button type="submit">Sign in</button>
</form>
