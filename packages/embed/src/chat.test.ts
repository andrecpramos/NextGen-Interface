import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { smalltalkFor, type Smalltalk } from './chat.ts';

/**
 * The few things a visitor says to the assistant that are not a question about the app: hello, thank
 * you, who are you, what can you do. Matched before routing and exactly, for the reason `commands.ts`
 * gives — and for a reason of its own: a greeting scores weakly against every screen, so a router
 * handed "hi" refuses it, and a visitor who is greeted with "that is not something I can do here"
 * has learned the assistant is not for them.
 *
 * It has to be as careful about what it does *not* match: anything longer than the phrase is a real
 * question, and goes to the router.
 */

const kind = (text: string, lang = 'en'): Smalltalk | null => smalltalkFor(text, lang)?.kind ?? null;

describe('smalltalkFor — what it recognises', () => {
  it('greets back, in the page’s language, however it is written', () => {
    for (const hi of ['hi', 'Hi!', 'HELLO', 'hey', 'hey there', 'good morning', 'Good afternoon.', 'hello assistant', 'howdy']) expect(kind(hi)).toBe('greeting');
    for (const oi of ['olá', 'Olá!', 'ola', 'oi', 'bom dia', 'Boa tarde', 'boa noite', 'olá assistente']) expect(kind(oi, 'pt-PT')).toBe('greeting');
  });

  it('recognises thanks, goodbyes and how-are-yous', () => {
    for (const t of ['thanks', 'Thank you!', 'thanks a lot', 'thx', 'cheers']) expect(kind(t)).toBe('thanks');
    for (const t of ['obrigado', 'Obrigada!', 'muito obrigado', 'valeu']) expect(kind(t, 'pt')).toBe('thanks');
    for (const b of ['bye', 'goodbye', 'see you later', 'cya']) expect(kind(b)).toBe('goodbye');
    for (const b of ['adeus', 'tchau', 'até logo']) expect(kind(b, 'pt')).toBe('goodbye');
    for (const h of ['how are you', 'How are you?', "how's it going", "what's up"]) expect(kind(h)).toBe('howAreYou');
    for (const h of ['tudo bem', 'como estás', 'Como está?']) expect(kind(h, 'pt')).toBe('howAreYou');
  });

  it('recognises who it is', () => {
    for (const q of ['who are you', 'what are you?', 'are you a bot', 'are you human', "what's your name"]) expect(kind(q)).toBe('identity');
    for (const q of ['quem és tu', 'quem é você', 'és um robô', 'como te chamas']) expect(kind(q, 'pt')).toBe('identity');
  });

  it('recognises being lost, which is the whole reason for this product', () => {
    for (const q of ['help', 'help me', 'I need help', 'what can you do', 'What can I ask?', 'how do you work', "I don't know what to do", "i'm lost", 'i have no idea', 'where do I start']) {
      expect(kind(q)).toBe('help');
    }
    for (const q of ['ajuda', 'preciso de ajuda', 'o que sabes fazer', 'o que podes fazer', 'não sei o que fazer', 'estou perdido', 'como funciona']) {
      expect(kind(q, 'pt')).toBe('help');
    }
  });

  it('takes an acknowledgement for what it is, so "ok" is not a question for the router', () => {
    for (const q of ['ok', 'okay', 'sure', 'cool', 'got it', 'yes', 'no']) expect(kind(q)).toBe('ok');
    for (const q of ['ok', 'sim', 'não', 'percebi', 'certo']) expect(kind(q, 'pt')).toBe('ok');
  });

  it('understands either language on either page, the page’s own first', () => {
    expect(kind('olá', 'en')).toBe('greeting');
    expect(kind('hello', 'pt')).toBe('greeting');
  });
});

/**
 * A closed list of exact phrases is not enough for the one thing this product exists for: a visitor
 * who is lost says it a hundred ways, and each one the list misses is refused. So being lost, and
 * being thankful, are also recognised by *vocabulary*: every word is a generic one (a filler, never a
 * word about the app) and at least one is the marker. A single word about the app — appointment,
 * calendar, medical, fees — and it is a question.
 */
describe('smalltalkFor — being lost, said any way', () => {
  it('recognises the many ways of saying it', () => {
    for (const q of [
      'i have no idea what to do here', "i'm new here and totally lost", 'please help me understand this app', 'I am so confused',
      'i really have no clue how this works', "i don't know where to start", 'help please', 'im stuck', 'how do i get started',
      'i have no idea what i am doing',
    ]) expect(kind(q), q).toBe('help');
    for (const q of ['não faço ideia do que fazer aqui', 'estou perdido e não sei o que fazer', 'ajuda por favor', 'sou novo aqui e estou confuso', 'não sei por onde começar']) {
      expect(kind(q, 'pt'), q).toBe('help');
    }
  });

  // Seen in the bench, 2026-09-22: each of these has no marker *word* ("know", "sure", "do" are generic
  // on their own), so they were routed, and a visitor who said they were lost got two unrelated screens.
  it('recognises being lost with no marker word in it', () => {
    for (const q of ["I don't know what to do here", 'i do not know what to do', "I'm not sure what to do here", 'what do I do here?']) {
      expect(kind(q), q).toBe('help');
    }
    for (const q of ['não sei o que fazer aqui', 'o que faço aqui?', 'o que devo fazer?', 'não percebo isto', 'não entendo nada disto']) {
      expect(kind(q, 'pt'), q).toBe('help');
    }
  });

  // Routed, "o que é esta página?" scored every screen alike and offered two. It asks where the visitor is.
  it('takes a question about the page the visitor is on as that, not as a search', () => {
    for (const q of ['What is this page?', "what's this page for", 'what can I do here?', 'where am I', 'explain this screen']) {
      expect(kind(q), q).toBe('thisPage');
    }
    for (const q of ['O que é esta página?', 'para que serve este ecrã', 'o que posso fazer aqui?', 'onde estou?']) {
      expect(kind(q, 'pt'), q).toBe('thisPage');
    }
    // …and a question about a page by name is still a question for the router.
    expect(kind('what is the medical page')).toBeNull();
    expect(kind('o que é a página de notificações', 'pt')).toBeNull();
  });

  it('is still a question once a word is about the app, however lost it sounds', () => {
    for (const q of ["i don't know where the calendar is", 'what do i do about the fees', "i'm not sure how to book an appointment"]) expect(kind(q), q).toBeNull();
    for (const q of ['não sei onde estão as quotas', 'o que faço para marcar uma consulta']) expect(kind(q, 'pt'), q).toBeNull();
    // A phrase of generic words that is not about being lost is not taken for it.
    expect(kind('i know')).toBeNull();
  });

  it('the moment a word is about the app, it is a question for the router', () => {
    for (const q of [
      'i have no idea where the calendar is', 'help me book an appointment', "i don't know what to do about my child's fees",
      "i'm lost, where is the medical page", 'i need help with my settings', 'help me find the squad', 'how do i start a new booking',
    ]) expect(kind(q), q).toBeNull();
    for (const q of ['estou perdido, onde vejo o calendário', 'preciso de ajuda com as quotas', 'ajuda-me a marcar uma consulta']) expect(kind(q, 'pt'), q).toBeNull();
  });

  it('a greeting in front of it changes nothing', () => {
    expect(smalltalkFor('hi, i have no idea what to do', 'en')).toEqual({ kind: 'help', rest: '' });
    expect(smalltalkFor('olá, estou perdido', 'pt')).toEqual({ kind: 'help', rest: '' });
  });

  it('recognises thanks said with more words, and only thanks', () => {
    for (const q of ['thank you so much for your help', 'thanks for the help', 'thanks a lot, really appreciate it', 'many thanks']) expect(kind(q), q).toBe('thanks');
    for (const q of ['muito obrigado pela ajuda', 'obrigada por tudo']) expect(kind(q, 'pt'), q).toBe('thanks');
    for (const q of ['thanks, now show me the calendar', 'thank you but where are the fees', 'obrigado, agora quero ver o calendário']) expect(kind(q), q).toBeNull();
  });

  it('is not put off by a stretched word: hiii, heyyy, helloooo, thankssss, okkk', () => {
    for (const q of ['hiii', 'heyyy', 'helloooo', 'hellooo!!', 'HIIIII']) expect(kind(q), q).toBe('greeting');
    expect(kind('thankssss')).toBe('thanks');
    expect(kind('byeee')).toBe('goodbye');
    expect(kind('okkk')).toBe('ok');
    expect(kind('olaaaa', 'pt')).toBe('greeting');
    expect(kind('helppp')).toBe('help');
    expect(smalltalkFor('heyyy where is the calendar?', 'en')).toEqual({ kind: 'greeting', rest: 'where is the calendar?' });
  });

  it('understands the plainest ways of asking what this is', () => {
    for (const q of ['what is this', 'what is this app', 'how does this app work', 'how does it work', 'what does this do']) expect(kind(q), q).toBe('help');
  });
});

describe('smalltalkFor — what it must leave alone', () => {
  it('leaves a real question to the router, even when it starts or ends with smalltalk', () => {
    for (const q of ['help me book an appointment', 'thanks, now show me my child’s medical status', 'where do I see my bookings', 'i need help with my settings', 'what can you tell me about the squad']) {
      const talk = smalltalkFor(q, 'en');
      expect(talk?.kind === 'help' || talk?.kind === 'thanks' ? talk.rest : 'routed').not.toBe('');
    }
    expect(kind('help me book an appointment')).toBeNull();
    expect(kind('where do I see my bookings')).toBeNull();
    expect(kind('what can you tell me about the squad')).toBeNull();
  });

  it('lets a greeting go and routes what follows it', () => {
    expect(smalltalkFor('hi, where is the calendar?', 'en')).toEqual({ kind: 'greeting', rest: 'where is the calendar?' });
    expect(smalltalkFor('Olá! Quero ver o estado médico', 'pt')).toEqual({ kind: 'greeting', rest: 'Quero ver o estado médico' });
    expect(smalltalkFor('good morning I lost my password', 'en')).toEqual({ kind: 'greeting', rest: 'I lost my password' });
  });

  it('takes a greeting followed by smalltalk as the smalltalk', () => {
    expect(smalltalkFor('hello, how are you?', 'en')).toEqual({ kind: 'howAreYou', rest: '' });
    expect(smalltalkFor('hi what can you do', 'en')).toEqual({ kind: 'help', rest: '' });
  });

  it('is nothing for the empty, the punctuation, and text with no letters', () => {
    for (const q of ['', '   ', '?!', '...', '123']) expect(kind(q)).toBeNull();
  });

  it('does not mistake a word inside another for a greeting', () => {
    for (const q of ['history of the squad', 'high scores', 'hello-kitty fan page', 'ohio']) expect(kind(q)).toBeNull();
    expect(smalltalkFor('history of the squad', 'en')).toBeNull();
  });

  it('is not fooled by length or repetition into matching', () => {
    expect(kind('hi '.repeat(50))).toBeNull();
    expect(kind('x'.repeat(5000))).toBeNull();
  });

  it('is exact and cheap: nothing here scales with what the visitor pastes', () => {
    const started = performance.now();
    for (let i = 0; i < 200; i++) smalltalkFor('help '.repeat(400), 'en');
    expect(performance.now() - started).toBeLessThan(500);
  });
});

/**
 * Small talk is matched *before* the router, so a phrase it wrongly claims never reaches a screen.
 * Every question the repository knows is a real one — each golden utterance with a destination, and
 * every example phrase the fixture's registries were generated with — must reach the router. This was
 * a one-off check when chat.ts was written; it is a test so that widening the vocabulary cannot
 * quietly swallow a question.
 */
describe('smalltalkFor — never takes a known real question', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const golden = [
    'eval/frameworks/family/golden-set.jsonl',
    'eval/bulletproof-react/golden-set.jsonl',
    'packages/core-intent/eval/golden-set.jsonl',
  ].flatMap((file) =>
    readFileSync(join(ROOT, file), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map(
        (line) =>
          JSON.parse(line) as {
            utterance: string;
            language?: string;
            route?: string | null;
            expect?: { route?: string | null; capability?: string | null };
          },
      )
      // Three shapes: a destination as `route`, as `expect.route`, or as `expect.capability`.
      .filter((entry) => entry.route || entry.expect?.route || entry.expect?.capability),
  );
  const generated = join(ROOT, 'eval', 'frameworks', 'family', 'generated');
  const examples = readdirSync(generated)
    .filter((file) => /^registry\..+\.json$/.test(file))
    .flatMap((file) => (JSON.parse(readFileSync(join(generated, file), 'utf8')) as { capabilities: { examples?: string[] }[] }).capabilities)
    .flatMap((capability) => capability.examples ?? []);

  it('routes every golden question that has a destination', () => {
    expect(golden.length).toBeGreaterThan(100);
    for (const { utterance, language } of golden) {
      const said = smalltalkFor(utterance, language ?? 'en');
      expect(said === null || said.rest !== '', utterance).toBe(true);
    }
  });

  it('routes every example phrase the fixture registries carry', () => {
    expect(examples.length).toBeGreaterThan(50);
    for (const phrase of examples) {
      for (const lang of ['en', 'pt']) {
        const said = smalltalkFor(phrase, lang);
        expect(said === null || said.rest !== '', phrase).toBe(true);
      }
    }
  });
});
