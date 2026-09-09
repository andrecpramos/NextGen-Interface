# @nextgen/data

Persistence for the finance domain: schema, migrations, repositories, the fixed query
set, the undo journal, and seeded fixtures.

**Boundary:** SQLite is the shipping dialect — the device is the source of truth
([ADR-008](../../.claude/decisions/ADR-008.md)). Postgres exists so the backend can hold the
same shape, not because anything reads from it on the critical path.

## Money is signed integer minor units ([ADR-010](../../.claude/decisions/ADR-010.md))

Negative leaves the account, positive arrives. `SUM(amountMinor)` is therefore always a
correct balance and cannot disagree with itself. "Spending" is the sum of the *outflows*,
which is the one thing this choice makes easy to get wrong — so it is written once, in
the query engine, and tested.

**Pass a decimal string, not a number, wherever the exact amount matters.**
`fromMajorUnits` parses a string digit by digit and is exact; a number has already been
through binary floating point before it arrives. The literal `1.005` *is*
`1.00499999999999989`, so it becomes `100`, not `101` — the cent was lost at the call
site. `'1.005'` becomes `101`. Both behaviours are pinned by tests.

The parser never decides the sign. "twenty euros" and "minus twenty euros" both mean the
quantity 20; which direction it moves is a property of the capability that received it.
`signed(magnitude, direction, currency)` is where that gets applied.

Nothing here converts between currencies. A transaction whose currency disagrees with its
account is **refused** at the repository, because a conversion needs a rate, a rate has a
date and a source, and a wrong one silently corrupts every historical aggregate.

## The query engine is the reason injected text cannot reach the database

The model selects a capability id and typed slots. This maps that pair onto one of a
fixed, named, fully parameterised set of queries. No column name, table name, operator or
ordering ever comes from a caller — slots choose *which* fixed predicate runs, never its
text. Adding a query means adding a member to `QUERIES` and a case in the class, which is
deliberately more friction than string-building.

`memo` and `merchant` are marked UNTRUSTED in `schema/spec.ts` and listed by
`untrustedColumns()`. Reading them is safe; putting them in a prompt needs the fencing in
[security.md](../../.claude/docs/security.md).

### Category roll-up is a recursive CTE, not a join

"food" must aggregate "groceries", "restaurants", "coffee" and "takeaway". The tree is
arbitrary-depth, so a join to a fixed number of levels works on today's taxonomy and
silently under-reports the moment anyone nests a category deeper. `UNION` rather than
`UNION ALL`, so a cycle terminates instead of recursing forever.

## Migrations

Hand-written, append-only, one transaction per step, `user_version` bumped inside it — so
a failure leaves the database at the last version that fully succeeded, never halfway
through one. `migrateFileWithBackup` additionally copies the file first and restores it on
throw, because a torn write is not something a transaction can undo.

The test asserts row preservation **from every prior version**, not just the newest hop.
Testing only the latest is how a v1→v2 data loss ships to the devices that skipped a
release.

## Fixtures

~500 transactions over 18 months from a **fixed seed**, so every run is byte-identical.
`endDate` defaults to a constant rather than today: a fixture set anchored to the clock
produces tests that pass in August and fail in September.

Monthly fixed costs plus a variable tail, because all-random spending makes budget
assertions meaningless. **No real financial data, including the author's own** — every
row is generated, and the merchant names are invented.
