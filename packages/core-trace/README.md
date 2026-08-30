# @nextgen/core-trace

The `TurnTrace` record and everything built on it: storage, encryption, the ring buffer,
export, and the "why did you do that?" renderer.

**Boundary:** owns the explainability record (Rule 9). It knows nothing about finance and
nothing about routing — it records what a turn did and renders an account of it.

## Explainability is a record, not narration

Asking the model to explain itself produces plausible fiction. Plausible fiction about a
financial action is worse than no explanation, because it is confidently wrong in exactly
the situation where the user is trying to decide whether to trust the system.

So a trace contains **zero model-generated prose**, and that is enforced twice:

- **In the types.** There is no `setReasoning` on `TurnRecorder`, and no field on
  `TurnTrace` a free-text model answer could land in. Stage 3 *does* return a `reasoning`
  string — the router never reads it out of the response.
- **At the storage boundary,** where a type can no longer follow. `assertNoModelProse`
  rejects a trace carrying `reasoning`, `explanation`, `rationale`, `modelResponse`,
  `narration`, `summary`, `thought` or `analysis`, and `put()` calls it.

The one piece of free text in a trace is the **transcript** — the user's own words. It is
marked UNTRUSTED wherever it is stored and is never re-interpreted as an instruction.

`explain()` builds every sentence from ids, scores, enums and resolved values. It works
offline, works with the model unloaded, and cannot drift from the behaviour it describes.

The half that matters most is `paramSources`: for each value the user can see, the
explanation says whether **code worked it out**, the model read it, or it came from the
screen. A user checking a number wants to know which — and after FINDINGS Finding 3, so
does the next developer.

## Every turn produces a trace, including the ones that failed

A convention of calling `store.put()` at the end of each path cannot deliver that: the
paths that most need a trace are the ones that threw before reaching the end.

So the turn runs *inside* the recorder, and the record is written in a `finally`:

```ts
await recorder.run({ transcript }, async (r) => {
  r.decidedAt('embedding');
  r.capability('spending.by_category', 'read', '/spending');
  r.param('from', '2026-07-01', 'deterministic');
  r.outcome('execute');
});
```

A thrown error is captured into the trace and **rethrown** — the caller still sees the
failure, and the failure is still on the record. A turn that never reports an outcome is
recorded as `error`, not as success: forgetting to say how a turn ended is not the same
as it having gone well.

## Storage

Encrypted with AES-256-GCM. GCM rather than CBC because it authenticates: a tampered
trace fails to decrypt rather than decoding into something plausible, and the entire value
of a trace is that it is a faithful record.

Traces are the most sensitive thing this application holds. The transactions say what
happened; the transcripts say what the user was *worried about*.

Key management belongs to the platform keystore (WP-09 / WP-10) — this takes a key and
says so. Capped by a ring buffer, oldest dropped, and exportable in full because it is the
user's record and the offline eval corpus.
