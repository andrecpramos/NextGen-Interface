import { Component } from '@angular/core';

@Component({
  selector: 'app-login',
  template: `
    <h1>Sign in</h1>
    <form>
      <input type="email" name="email" placeholder="Email" />
      <button type="submit">Sign in</button>
    </form>
  `,
})
export default class LoginComponent {}
