// The mock application's own script: mount the real widget, as an adopter's page would.
//
// Moved out of app.html so this page carries no inline script — the same constraint the
// shipped one-liner is held to (`tooling/scripts/check-csp.mjs`). The bench should not be
// the one place we relax it.
//
// The role comes from the page, which the server rendered from `?role=`, so switching
// role changes what the assistant can reach here exactly as it changes the nav.
//
// Bench-only query parameters, so a state can be linked to or screenshotted:
//   ?open        open the assistant screen
//   ?ask=…       ask something on load
//   ?menu        open the menu

const role = document.body.dataset.role;
const keepRole = (to) => (to.includes('?') ? to : `${to}?role=${encodeURIComponent(role)}`);

// The mock app "takes" what is attached, as an adopter's upload form would, so the bench shows
// the whole path: attachments are off unless a page opts in and handles the event.
window.addEventListener('nextgen:attach', (event) => {
  event.preventDefault();
  console.info('[bench] attached:', event.detail.files.map((file) => file.name).join(', '));
});

NextGen.start('/nextgen', role, {
  attach: true,
  // Without this every navigation drops `?role=`, and the next page renders as the
  // default role — the assistant would appear to change what it can reach mid-session.
  navigate: (to) => {
    location.assign(keepRole(to));
  },
}).then((assistant) => {
  const params = new URLSearchParams(location.search);
  if (params.has('open') || params.has('menu')) assistant.open();
  if (params.get('ask')) assistant.ask(params.get('ask'));
  if (params.has('menu')) {
    setTimeout(() => assistant.host.shadowRoot.querySelector('.menu')?.click(), 150);
  }
});
