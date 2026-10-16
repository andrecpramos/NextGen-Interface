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
//   ?open        open the assistant panel
//   ?full        open it full screen
//   ?ask=…       ask something on load
//   ?companion   pretend the app already has an assistant of its own (ADR-026): what the router cannot
//                place, and what is attached, go to it; it answers with a canned line, so the merge can
//                be seen without a model
//   ?decide=confirm|eager   how readily it moves (ADR-027); balanced without it
//   ?search      offer the mock app's /search for what no screen matches (ADR-027)
// Lessons (`nextgen:learn`) are logged to the console, as a page that keeps them would store them.

const role = document.body.dataset.role;
// The page language rides along with the role, so it survives a move (English is the default and is left out).
const lang = new URLSearchParams(location.search).get('lang');
const keepRole = (to) =>
  to.includes('?') ? to : `${to}?role=${encodeURIComponent(role)}${lang ? `&lang=${encodeURIComponent(lang)}` : ''}`;

// The mock app "takes" what is attached, as an adopter's upload form would, so the bench shows
// the whole path: attachments are off unless a page opts in and handles the event.
window.addEventListener('nextgen:attach', (event) => {
  event.preventDefault();
  console.info('[bench] attached:', event.detail.files.map((file) => file.name).join(', '));
});

const params = new URLSearchParams(location.search);
const pt = (lang ?? '').startsWith('pt');
const companion = params.has('companion')
  ? {
      name: pt ? 'Assistente da escola' : 'School assistant',
      ask: async ({ text, files }) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        const got = files.length > 0 ? ` (${files.map((file) => file.name).join(', ')})` : '';
        return pt
          ? `[demonstração] O assistente da escola responderia aqui a «${text}»${got}.`
          : `[demo] The school's own assistant would answer "${text}"${got} here.`;
      },
      open: () => console.info('[bench] the school assistant would open here'),
      tour: (route) => {
        console.info(`[bench] the school tour would start on ${route}`);
        return true;
      },
    }
  : undefined;

window.addEventListener('nextgen:learn', (event) => console.info('[bench] lesson:', JSON.stringify(event.detail)));
// Each turn's record (ADR-030): the adopter's "why", in the console.
window.addEventListener('nextgen:turn', (event) => console.info('[bench] turn:', event.detail.trace));

// The mock app's own "New …" control (ADR-031): it only opens a form, as most apps' do — and says so with
// aria-haspopup, so the assistant may press it for a visitor who asked to start one.
const newItem = document.getElementById('new-item');
const newDialog = document.getElementById('new-dialog');
if (newItem && newDialog) {
  const title = document.querySelector('h1')?.textContent?.trim() ?? '';
  // A page the mock names only by its path has nothing to make.
  if (title.startsWith('/')) newItem.hidden = true;
  newItem.textContent = `${pt ? 'Novo' : 'New'} ${title.toLowerCase()}`;
  newDialog.querySelector('.dialog-title').textContent = newItem.textContent;
  newItem.addEventListener('click', () => {
    newDialog.showModal();
    newDialog.querySelector('input')?.focus();
  });
}

NextGen.start('/nextgen', role, {
  attach: true,
  ...(companion ? { companion } : {}),
  ...(params.get('decide') ? { decide: params.get('decide') } : {}),
  ...(params.has('search') ? { search: '/search?q={query}' } : {}),
  // Without this every navigation drops `?role=`, and the next page renders as the
  // default role — the assistant would appear to change what it can reach mid-session.
  navigate: (to) => {
    location.assign(keepRole(to));
  },
}).then((assistant) => {
  if (params.has('open') || params.has('full')) assistant.open({ expanded: params.has('full') });
  if (params.get('ask')) assistant.ask(params.get('ask'));
});
