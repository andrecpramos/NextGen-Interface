import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { aesTraceCrypto, SqliteTraceStore } from './store.ts';
import { TraceRecorder } from './recorder.ts';
import { explain, formatExplanation } from './explain.ts';
import { assertNoModelProse, ModelProseError, type TurnTrace } from './types.ts';

const store = (opts = {}) => new SqliteTraceStore(new DatabaseSync(':memory:'), opts);

const baseTrace = (over: Partial<TurnTrace> = {}): TurnTrace => ({
  turnId: 'turn_1',
  transcript: 'how much did I spend on food last month',
  decidedAt: 'llm',
  candidates: [
    { capabilityId: 'spending.by_category', score: 0.71 },
    { capabilityId: 'spending.total', score: 0.68 },
    { capabilityId: 'transactions.list', score: 0.52 },
  ],
  outcome: 'execute',
  capabilityId: 'spending.by_category',
  capabilityKind: 'read',
  route: '/spending',
  params: { category: 'food', from: '2026-07-01', to: '2026-07-31' },
  missing: [],
  requiresConfirmation: false,
  modelId: 'qwen2.5:1.5b',
  promptVersion: 'v3',
  paramSources: { category: 'deterministic', from: 'deterministic', to: 'deterministic' },
  dataRead: [{ table: 'transactions', rowCount: 42, from: '2026-07-01', to: '2026-07-31' }],
  latency: { stage1: 0, stage2: 9, stage3: 140, total: 152 },
  undoToken: null,
  notes: [],
  createdAt: '2026-08-29T12:00:00.000Z',
  ...over,
});

// ------------------------------------------------------ zero model prose --

describe('Rule 9 — a trace contains no model-generated prose', () => {
  it('rejects a trace carrying the model\'s own account of itself', () => {
    // stage 3 DOES return a `reasoning` string. The router drops it; this is the
    // second line, at the storage boundary, where a type can no longer follow.
    expect(() =>
      assertNoModelProse({ ...baseTrace(), reasoning: 'I chose this because the user asked about food' }),
    ).toThrow(ModelProseError);
  });

  it('rejects every known prose field, not just reasoning', () => {
    for (const field of ['explanation', 'rationale', 'modelResponse', 'narration', 'summary', 'thought', 'analysis']) {
      expect(() => assertNoModelProse({ ...baseTrace(), [field]: 'plausible fiction' })).toThrow(ModelProseError);
    }
  });

  it('refuses to store one', () => {
    const s = store();
    expect(() => s.put({ ...baseTrace(), reasoning: 'because' } as unknown as TurnTrace)).toThrow(ModelProseError);
    expect(s.count()).toBe(0);
  });

  it('allows a null or absent prose field rather than being superstitious', () => {
    expect(() => assertNoModelProse({ ...baseTrace(), reasoning: null })).not.toThrow();
    expect(() => assertNoModelProse({ ...baseTrace() })).not.toThrow();
  });

  it('keeps the user\'s own words — the transcript is not model prose', () => {
    const s = store();
    s.put(baseTrace());
    expect(s.get('turn_1')?.transcript).toBe('how much did I spend on food last month');
  });
});

// ---------------------------------------------- every turn leaves a trace --

describe('every turn produces a trace', () => {
  it('records a successful turn', async () => {
    const s = store();
    const recorder = new TraceRecorder(s);
    await recorder.run({ transcript: 'show my budgets' }, async (r) => {
      r.decidedAt('deterministic');
      r.capability('budget.view', 'navigate', '/budget');
      r.outcome('execute');
      return 'ok';
    });
    expect(s.count()).toBe(1);
    expect(s.latest()).toMatchObject({ outcome: 'execute', capabilityId: 'budget.view' });
  });

  it('records a turn that THREW, and still rethrows', async () => {
    // The paths that most need a trace are the ones that failed before the end.
    // A convention of calling put() last cannot cover them; a finally can.
    const s = store();
    const recorder = new TraceRecorder(s);
    await expect(
      recorder.run({ transcript: 'break please' }, async () => {
        throw new Error('database unavailable');
      }),
    ).rejects.toThrow('database unavailable');

    expect(s.count()).toBe(1);
    const t = s.latest()!;
    expect(t.outcome).toBe('error');
    expect(t.error).toBe('database unavailable');
    expect(t.notes).toContain('the turn threw before completing');
  });

  it('records an out-of-scope turn', async () => {
    const s = store();
    await new TraceRecorder(s).run({ transcript: 'what time is it' }, async (r) => {
      r.decidedAt('embedding');
      r.capability('unsupported.general', 'unsupported', null);
      r.outcome('out_of_scope');
    });
    expect(s.latest()).toMatchObject({ outcome: 'out_of_scope', capabilityKind: 'unsupported' });
  });

  it('records a clarify with what was missing', async () => {
    const s = store();
    await new TraceRecorder(s).run({ transcript: 'add 50' }, async (r) => {
      r.decidedAt('llm');
      r.capability('transaction.create', 'write', '/transactions/new');
      r.missing(['category']);
      r.outcome('clarify');
    });
    expect(s.latest()).toMatchObject({ outcome: 'clarify', missing: ['category'] });
  });

  it('defaults to error when a turn never says how it ended', async () => {
    // A turn that forgot to report its outcome did not succeed quietly.
    const s = store();
    await new TraceRecorder(s).run({ transcript: 'silent' }, async () => {});
    expect(s.latest()?.outcome).toBe('error');
  });

  it('always records a total latency', async () => {
    const s = store();
    await new TraceRecorder(s).run({ transcript: 'x' }, async (r) => r.outcome('execute'));
    expect(s.latest()!.latency.total).toBeGreaterThanOrEqual(0);
  });
});

// -------------------------------------------------------------- encryption --

describe('encrypted at rest', () => {
  it('stores ciphertext, not the transcript', () => {
    const db = new DatabaseSync(':memory:');
    const s = new SqliteTraceStore(db, { crypto: aesTraceCrypto(randomBytes(32)) });
    s.put(baseTrace());
    const raw = db.prepare('SELECT payload FROM traces').get() as { payload: string };
    expect(raw.payload).not.toContain('spend on food');
    expect(raw.payload).not.toContain('spending.by_category');
    expect(s.get('turn_1')?.transcript).toContain('spend on food');
  });

  it('detects tampering rather than decoding into something plausible', () => {
    const db = new DatabaseSync(':memory:');
    const s = new SqliteTraceStore(db, { crypto: aesTraceCrypto(randomBytes(32)) });
    s.put(baseTrace());
    const raw = (db.prepare('SELECT payload FROM traces').get() as { payload: string }).payload;
    const [iv, tag, body] = raw.split('.');
    const flipped = Buffer.from(body!, 'base64');
    flipped[0] = flipped[0]! ^ 0xff;
    db.prepare('UPDATE traces SET payload = ?').run(`${iv}.${tag}.${flipped.toString('base64')}`);
    expect(() => s.get('turn_1')).toThrow();
  });

  it('rejects a key of the wrong length', () => {
    expect(() => aesTraceCrypto(randomBytes(16))).toThrow(TypeError);
  });
});

// ------------------------------------------------------------ ring buffer --

describe('ring buffer', () => {
  it('caps the number of stored traces', () => {
    const s = store({ capacity: 10 });
    for (let i = 0; i < 25; i++) {
      s.put(baseTrace({ turnId: `turn_${i}`, createdAt: `2026-08-29T12:00:${String(i).padStart(2, '0')}.000Z` }));
    }
    expect(s.count()).toBe(10);
  });

  it('drops the oldest, keeping the most recent', () => {
    const s = store({ capacity: 5 });
    for (let i = 0; i < 12; i++) {
      s.put(baseTrace({ turnId: `turn_${i}`, createdAt: `2026-08-29T12:00:${String(i).padStart(2, '0')}.000Z` }));
    }
    const ids = s.recent(5).map((t) => t.turnId);
    expect(ids).toEqual(['turn_11', 'turn_10', 'turn_9', 'turn_8', 'turn_7']);
  });

  it('keeps insertion order stable when timestamps collide', () => {
    // Fast turns share a millisecond, and "most recent" must still mean the last
    // one written rather than an arbitrary pick.
    const s = store({ capacity: 3 });
    for (let i = 0; i < 6; i++) s.put(baseTrace({ turnId: `turn_${i}`, createdAt: '2026-08-29T12:00:00.000Z' }));
    expect(s.recent(3).map((t) => t.turnId)).toEqual(['turn_5', 'turn_4', 'turn_3']);
  });

  it('exports oldest first, and clears completely', () => {
    const s = store();
    for (let i = 0; i < 3; i++) {
      s.put(baseTrace({ turnId: `turn_${i}`, createdAt: `2026-08-29T12:00:0${i}.000Z` }));
    }
    expect(s.export().map((t) => t.turnId)).toEqual(['turn_0', 'turn_1', 'turn_2']);
    s.clear();
    expect(s.count()).toBe(0);
    expect(s.export()).toEqual([]);
  });
});

// ------------------------------------------------------------- explanation --

describe('"why did you do that?" renders from the record alone', () => {
  it('reports what it did and how it decided', () => {
    const e = explain(baseTrace());
    expect(e.headline).toContain('spending.by_category');
    expect(e.steps.join(' ')).toContain('how much did I spend on food last month');
    expect(e.steps.join(' ')).toContain('language model');
    expect(e.steps.join(' ')).toContain('qwen2.5:1.5b');
  });

  it('says what else it nearly chose, and by how much it lost', () => {
    const e = explain(baseTrace());
    expect(e.alternatives[0]).toContain('spending.total');
    expect(e.alternatives[0]).toContain('0.030'); // 0.71 - 0.68
  });

  it('says where every visible value came from', () => {
    // The important half: a user checking a number wants to know whether code
    // worked it out or the model guessed it.
    const e = explain(baseTrace());
    expect(e.values.join(' ')).toContain('from = 2026-07-01 (worked out by code');
    const modelParam = explain(baseTrace({
      params: { query: 'coffee' },
      paramSources: { query: 'model' },
    }));
    expect(modelParam.values.join(' ')).toContain('read from your words by the model');
  });

  it('lists tables, row counts and date ranges', () => {
    expect(explain(baseTrace()).dataUsed[0]).toBe('42 rows from transactions between 2026-07-01 and 2026-07-31');
  });

  it('says plainly when nothing was read', () => {
    expect(explain(baseTrace({ dataRead: [] })).dataUsed).toEqual(['No stored data was read.']);
  });

  it('explains a confirmation as policy, not as confidence', () => {
    const e = explain(baseTrace({
      capabilityId: 'budget.delete', capabilityKind: 'destructive', requiresConfirmation: true,
    }));
    expect(e.headline).toContain('confirm');
    expect(e.steps.join(' ')).toContain('does not depend on how confident');
  });

  it('explains a declared refusal', () => {
    const e = explain(baseTrace({
      outcome: 'out_of_scope', capabilityId: 'unsupported.move_money', capabilityKind: 'unsupported',
    }));
    expect(e.headline).toContain('outside what the app does');
    expect(e.steps.join(' ')).toContain('declares it does not do');
  });

  it('says when the model was not used at all', () => {
    const e = explain(baseTrace({ decidedAt: 'deterministic', latency: { stage1: 1, total: 1 } }));
    expect(e.timing).toContain('without using the model at all');
    expect(e.steps.join(' ')).toContain('a phrase it knows exactly');
  });

  it('explains a failed turn instead of going quiet', () => {
    const e = explain(baseTrace({ outcome: 'error', error: 'database unavailable' }));
    expect(e.headline).toContain('Could not complete');
  });

  it('renders without consulting anything — no model, no network, no I/O', () => {
    // The whole point: this works offline, works with the model unloaded, and
    // cannot drift from the behaviour it describes.
    const text = formatExplanation(explain(baseTrace()));
    expect(text).toContain('How it decided:');
    expect(text).toContain('Values:');
    expect(text).toContain('Data used:');
  });
});
