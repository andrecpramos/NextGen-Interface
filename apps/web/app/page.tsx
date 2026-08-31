import { Assistant } from './Assistant';

/**
 * The landing surface is the assistant.
 *
 * Not a dashboard with a chat box in the corner — the assistant *is* the app,
 * and the conventional structure sits underneath it in the rail. That ordering
 * is the whole thesis, and it is the one thing about this page that is not a
 * preference.
 */
export default function Page() {
  return <Assistant />;
}
