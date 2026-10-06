# Ground truth for `Tutor-Support-System`

**Written 2026-09-12 from `src/App.tsx` alone, before the generator was run on it.**
That order is the whole point: a ground truth written after seeing the output is not a
ground truth, it is a transcript.

**The app.** [lamnh404/Tutor-Support-System](https://github.com/lamnh404/Tutor-Support-System),
MIT, React 18 + React Router v6 (`<Routes>`/`<Route>` elements), TypeScript, Vite. Cloned
at commit on branch `main`. Roles: `STUDENT`, `TUTOR`, `ADMIN`.

## How this app gates routes

A **third shape**, different from both apps we have read so far:

```tsx
<Route element={<ProtectedRoute user={user} allowedRoles={['ADMIN']} />}>
  <Route path='/admin/overview' element={<Overview/>} />
  ...
</Route>
```

The guard is a **wrapper route** whose `element` is a component taking `allowedRoles`, and
the guarded routes are its children. Compare:

| App | Where the roles are |
|---|---|
| the fixture app | a named role set per route, `ROUTE_ROLES.staff`, resolved from a permissions module |
| bulletproof-react | inside the page component, `<Authorization allowedRoles={[ROLES.ADMIN]}>` |
| **this app** | **on a parent `<Route element={<ProtectedRoute allowedRoles={[…]} />}>`, inherited by its children** |

`ProtectedRoute` is declared in the same file: no user → redirect to `/login`; roles given
and not matched → redirect to `/404`; otherwise render the child route.

## The ground truth

16 routes. `*` is the catch-all (a redirect to `/404`), which is the app's 404 and not a
destination.

| # | Route | Guard in source | May reach it |
|---|---|---|---|
| 1 | `/` | none | everyone (signed out too) |
| 2 | `/login` | none | everyone |
| 3 | `/register` | none | everyone |
| 4 | `/404` | none | everyone |
| 5 | `/settings` | `<ProtectedRoute user={user} />`, no roles | **any signed-in user**: STUDENT, TUTOR, ADMIN |
| 6 | `/search` | `allowedRoles={['STUDENT','TUTOR']}` | STUDENT, TUTOR |
| 7 | `/library` | same | STUDENT, TUTOR |
| 8 | `/:id` | same | STUDENT, TUTOR |
| 9 | `/dashboard` | same | STUDENT, TUTOR |
| 10 | `/dashboard/:tabId` | same | STUDENT, TUTOR |
| 11 | `/course/:id` | same | STUDENT, TUTOR |
| 12 | `/calendar` | same | STUDENT, TUTOR |
| 13 | `/admin/overview` | `allowedRoles={['ADMIN']}` | **ADMIN only** |
| 14 | `/admin/users` | same | **ADMIN only** |
| 15 | `admin/analytics` | same | **ADMIN only** (note: written without a leading `/` in the source) |
| 16 | `/admin/logs` | same | **ADMIN only** |
| — | `*` | none | the 404 catch-all, not a destination |

### What a correct run must produce (Rule 17)

- An **ADMIN** registry contains the four `/admin/*` screens; a **STUDENT** or **TUTOR**
  registry **does not contain them at all** — absent, not hidden.
- The seven STUDENT/TUTOR screens are absent from an ADMIN registry, because `ADMIN` is
  not in `['STUDENT','TUTOR']`. This app's admin genuinely cannot open `/search`: the
  guard redirects them to `/404`.
- `/settings` appears for all three roles.
- The four public routes appear for every audience.
- Anything whose guard cannot be read must be **omitted and reported**, never defaulted to
  "everyone" (Rule 17's zero-tolerance kill criterion).

### Two things to watch, recorded before the run

1. **`admin/analytics` has no leading slash.** React Router treats it as relative, so the
   real path is `/admin/analytics`. A generator that copies the string verbatim emits a
   route that does not exist.
2. **`/:id` is a bare parameter at the root.** It matches almost anything, and a bundle
   that offers it as a destination would send a user to a profile page for whatever word
   they typed. It is a real route, so it belongs in the registry — but it is the kind of
   route a guided answer should not propose without a value.
