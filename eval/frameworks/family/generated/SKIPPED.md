# Routes not declared

2 route(s) were discovered and deliberately not turned into capabilities.

A missing capability degrades safely: Rule 7 guarantees every screen stays reachable
without the assistant. A wrongly declared one sends a user confidently to the wrong
place. Where this generator was unsure, it omitted — and said so here.

## The same screen as a route that picks its own parameter — declared once, there (1)

- `/my/children/:childId/medical` — the same screen as /my/children/medical, which picks the childId itself and redirects to /my/children/…

## Only redirects to a screen declared at its own address — an old name for it (1)

- `/my/schedule` — only redirects to /my, which is declared at its own address
