<template>
  <div class="auth-page">
    <h1>Sign in</h1>
    <form @submit.prevent="login">
      <input type="email" name="email" placeholder="Email" />
      <input type="password" name="password" placeholder="Password" />
      <button type="submit">Sign in</button>
    </form>
  </div>
</template>
