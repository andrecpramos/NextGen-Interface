# WP-43 — Rule 17 on an app we do not own

**Measured 2026-09-12** against [GROUND_TRUTH.md](GROUND_TRUTH.md), which was written from
the app's source **before** the generator was run on it.

**The app.** [lamnh404/Tutor-Support-System](https://github.com/lamnh404/Tutor-Support-System),
MIT, React Router v6 in JSX form, 16 routes, three roles (`STUDENT`, `TUTOR`, `ADMIN`).
Chosen from six candidates: two had no licence at all and were rejected outright, three had
fewer than 20 route entries, and this one gates its routes in a shape neither reference app
uses.

---

## The first run leaked, which is what this work package existed to find

| Ground truth | What the kit shipped |
|---|---|
| 4 `/admin/*` screens: **ADMIN only** | in `PUBLIC`, delivered to every user |
| 7 screens: **STUDENT/TUTOR only** | in `PUBLIC`, delivered to every user |
| `/settings`: any signed-in user | in `PUBLIC` |
| 16 routes across 3 roles | **16 routes, 1 audience, 0 skipped** |

Scored against the ground truth, the same way the second run is scored below: **33 of 48
role assignments correct, 15 role leaks, 0 screens missing**. Every leak is a screen a
role could see and should not have.

Worse than the leak was the silence around it. `SKIPPED.md` said *"0 route(s) were
discovered and deliberately not turned into capabilities"*, and `doctor` finished with
*"Built, and nothing needs fixing."* The only signal anywhere was `init`'s one line:
**GUESSED role table: (none)**.

**PLAN.md §8's kill criterion — *"any role mis-assignment by the generator, ever"* — fired
on the first app that could trigger it.**

### Why

The app gates routes in a **third shape**, which the generator could not read:

```tsx
<Route element={<ProtectedRoute user={user} allowedRoles={['ADMIN']} />}>
  <Route path='/admin/users' element={<UserManagement />} />
```

| App | Where its roles live | Read before WP-43? |
|---|---|---|
| `fut-app` | `roles: ROUTE_ROLES.squadManage`, resolved from a permissions module | yes |
| bulletproof-react | inside the page: `<Authorization allowedRoles={[ROLES.ADMIN]}>` | no — still not |
| **Tutor-Support-System** | **on a parent route's element, inherited by its children** | **now yes** |

And underneath that, a default that was safe for the app it was written for and unsafe
here: with no permissions module, every route resolved to one invented audience called
`PUBLIC`. A guard the parser could not read became *"everyone"* — the exact inversion of
Rule 17's zero-tolerance rule, which says an unreadable guard drops its route.

---

## The fix

1. **A guard on a parent route is inherited by its children**, and a child can only narrow
   it, never widen it. `allowedRoles`, `roles`, `requiredRoles` and `anyOfRoles` are read.
2. **A guard that names roles the parser cannot evaluate yields `null`**, which drops the
   route and reports it as `unresolved-roles` — the same path an unreadable
   `ROUTE_ROLES.x` has always taken.
3. **With no permissions module, the role universe is what the route table itself names.**
   An unguarded route then means "any role this application has", instead of an audience
   the application never mentions. `PUBLIC` remains correct for an app with no roles at
   all, which is what it was written for.

## The second run

Scored against the same ground truth, unchanged:

| Measure | Result |
|---|---|
| Routes discovered | **16 of 16 — 100% recall** |
| Role assignments correct | **48 of 48** |
| **Role leaks** | **0** |
| Screens missing from a role that should see them | 0 |
| Rule 16: files modified in the clone | **0** |

Per registry, which is the shape Rule 17 actually asks about:

| Role | Screens |
|---|---|
| `ADMIN` | `/`, `/404`, `/login`, `/register`, `/settings`, and the four `/admin/*` |
| `STUDENT` | `/`, `/404`, `/login`, `/register`, `/settings`, `/search`, `/library`, `/:id`, `/calendar`, `/course/:id`, `/dashboard`, `/dashboard/:tabId` |
| `TUTOR` | the same twelve as `STUDENT` |

An `ADMIN` registry contains no `/search`, because this app's guard genuinely redirects an
admin away from it. A `STUDENT` registry contains no `/admin/*` at all — absent, not
hidden.

### The ground truth's two traps, both handled

- **`admin/analytics` is written without a leading slash** in the source. React Router
  resolves it relative to the parent, and discovery emitted `/admin/analytics`.
- **`/:id` is a bare parameter at the root.** It is a real route and is declared, and the
  script tag will not navigate to it without a value (WP-41's `fillParams`).

---

## What is still not read

**bulletproof-react's shape: a guard inside the page component.** `<Authorization
allowedRoles={[ROLES.ADMIN]}>` wrapping a page's body is invisible to route discovery, and
that app still generates one `PUBLIC` audience. It is a different problem from this one —
the route table is not lying there, it simply says nothing — and the honest answer for now
is `init`'s warning plus `doctor`'s role list, which an adopter can compare against their
own app. Reading component-level guards is a separate work package, and it should be sized
only once someone wants it.

## Coverage this adds

`fixtures/guarded-app` reproduces the shape in miniature, including a guard whose roles are
computed at run time, so the "drop and report" path is exercised by
`discover-guards.test.ts` rather than only by a clone that lives outside the repository.
