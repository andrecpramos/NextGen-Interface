import type { MetaFunction } from '@remix-run/node';

export const meta: MetaFunction = () => [{ title: 'Sign Up' }];

export default function Join() {
  return (
    <form method="post">
      <label htmlFor="email">Email address</label>
      <input id="email" name="email" type="email" />
      <button type="submit">Create account</button>
    </form>
  );
}
