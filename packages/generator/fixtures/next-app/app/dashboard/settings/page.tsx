import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Account settings',
};

export default function SettingsPage() {
  return (
    <form>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" />
      <button type="submit">Save changes</button>
    </form>
  );
}
