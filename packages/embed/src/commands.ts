// Spoken commands: the few things a visitor says to the assistant itself, rather than asks it.
//
// Matched before routing and exactly — the whole utterance, after case, accents and punctuation
// are dropped, with an optional "please" — so "fechar" closes the screen at once instead of
// becoming a question the router has to guess at. Deliberately a short, closed list in both
// languages the product speaks: anything longer is a question, and goes to the router as one.

// There is no `menu`: the assistant has no navigation of its own to open — the app's is always in view
// (ADR-026). "Menu" is a question like any other.
export type Command = 'close' | 'tour' | 'back' | 'home' | 'stop' | 'repeat' | 'mute';

type Phrases = Readonly<Record<Command, readonly string[]>>;

// Written already normalised: lower case, no accents, no punctuation.
const PT: Phrases = {
  close: ['fechar', 'fecha', 'fechar assistente', 'fecha o assistente', 'sair', 'sai'],
  // The app's own tour, or the steps this page declares. Only when it is the whole request.
  tour: ['tutorial', 'tour', 'visita guiada', 'fazer a visita guiada', 'mostra me como funciona', 'mostre me como funciona', 'guia me'],
  back: ['voltar', 'volta', 'voltar atras', 'volta atras', 'pagina anterior'],
  home: ['inicio', 'voltar ao inicio', 'volta ao inicio', 'ir para o inicio', 'pagina inicial'],
  stop: ['parar', 'para', 'silencio', 'cala te', 'chega'],
  repeat: ['repetir', 'repete', 'outra vez', 'podes repetir', 'pode repetir'],
  mute: ['parar de ouvir', 'para de ouvir', 'desligar microfone', 'desliga o microfone'],
};

const EN: Phrases = {
  close: ['close', 'close assistant', 'close the assistant', 'exit', 'dismiss'],
  tour: ['tutorial', 'tour', 'take the tour', 'start the tour', 'guided tour', 'show me around', 'walk me through this page'],
  back: ['back', 'go back', 'previous page'],
  home: ['home', 'go home', 'home page', 'start page'],
  stop: ['stop', 'quiet', 'be quiet', 'enough'],
  repeat: ['repeat', 'repeat that', 'say again', 'say that again', 'again'],
  mute: ['stop listening', 'mute', 'mute microphone', 'turn off microphone'],
};

const POLITE = /^(?:por favor|please)\s+|\s+(?:por favor|please)$/g;

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The command `text` is, or `null` when it is a question. The page's language is tried first. */
export function commandFor(text: string, lang: string | null | undefined): Command | null {
  const said = normalise(text).replace(POLITE, '').trim();
  if (!said) return null;
  const tables = lang?.toLowerCase().startsWith('pt') ? [PT, EN] : [EN, PT];
  for (const table of tables) {
    for (const command of Object.keys(table) as Command[]) {
      if (table[command].includes(said)) return command;
    }
  }
  return null;
}
