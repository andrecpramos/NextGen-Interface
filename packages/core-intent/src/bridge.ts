// A word the application does not use, bridged to one it does.
//
// Stage 2 knows only the words in the registry: a word that appears in no capability contributes
// nothing (embedder.ts). That is right for "weather" and wrong for "lesões" when the app says
// "lesão", for "injuries" when it says "injury", and for "password" when a Portuguese app says
// "palavra-passe": the visitor used the app's own idea in a form it did not write down.
//
// So before stage 2 embeds a question, each word the registry does not know is tried in two ways,
// and whatever the registry *does* know is added beside it:
//
// 1. **Its other forms** — plural and singular, masculine and feminine, the common verb endings — by
//    rules of the two languages the product speaks, never by a list of this or any app's words.
// 2. **The same idea in the other language, or its everyday synonym**, from `CONCEPTS` below: a short,
//    closed list of what almost every web application has (an account, a password, notifications, a
//    calendar, payments, children, health). General knowledge about apps, not about any one app.
//
// What it will not do, by construction:
// - touch a word the registry already knows. A question in the app's own words is embedded exactly as
//   before, so the calibrated behaviour of well-described questions does not move;
// - add a word the registry does not know. An unknown word stays worth nothing, so an out-of-scope
//   question ("what's the weather") stays out of scope;
// - affect stage 1, which is exact on purpose, or what the trace records as the visitor's words.

import { normalize } from './text.ts';
import type { Registry } from './types.ts';

/**
 * Groups of words that name the same thing in an app, in English and Portuguese (both variants). Lower
 * case, no accents — as `normalize` leaves them. Nouns and noun phrases only: verbs are mostly the frame
 * of a question ("show", "ver") and would add noise to every screen alike.
 */
const CONCEPTS: readonly (readonly string[])[] = [
  ['password', 'passwords', 'palavra-passe', 'palavra passe', 'senha', 'senhas', 'passe'],
  ['account', 'accounts', 'conta', 'contas'],
  ['profile', 'profiles', 'perfil', 'perfis'],
  ['settings', 'setting', 'definicoes', 'definicao', 'configuracoes', 'configuracao', 'preferencias', 'preferences'],
  ['language', 'languages', 'idioma', 'idiomas', 'lingua', 'linguas'],
  ['notifications', 'notification', 'notificacoes', 'notificacao', 'alerts', 'alert', 'alertas', 'alerta', 'avisos', 'aviso'],
  ['email', 'emails', 'e-mail', 'e-mails', 'mail', 'correio'],
  ['message', 'messages', 'mensagem', 'mensagens', 'inbox', 'caixa de entrada'],
  ['announcements', 'announcement', 'anuncios', 'anuncio', 'news', 'novidades', 'noticias', 'noticia', 'comunicados', 'comunicado'],
  ['home', 'homepage', 'dashboard', 'inicio', 'pagina inicial', 'painel', 'overview', 'resumo'],
  ['calendar', 'calendario', 'schedule', 'agenda', 'horario', 'horarios', 'events', 'eventos', 'evento'],
  ['payment', 'payments', 'pagamento', 'pagamentos', 'billing', 'faturacao', 'invoice', 'invoices', 'fatura', 'faturas', 'fees', 'fee', 'quotas', 'quota', 'mensalidade', 'mensalidades'],
  ['document', 'documents', 'documento', 'documentos', 'files', 'ficheiros', 'ficheiro', 'arquivos', 'arquivo'],
  ['report', 'reports', 'relatorio', 'relatorios'],
  ['statistics', 'stats', 'estatisticas', 'estatistica', 'analytics', 'metricas'],
  ['help', 'support', 'ajuda', 'suporte', 'apoio'],
  ['child', 'children', 'kid', 'kids', 'son', 'sons', 'daughter', 'daughters', 'filho', 'filhos', 'filha', 'filhas', 'miudo', 'miudos', 'miuda', 'miudas', 'crianca', 'criancas', 'educando', 'educandos', 'educanda', 'educandas'],
  ['parent', 'parents', 'guardian', 'guardians', 'pai', 'pais', 'mae', 'maes', 'encarregado', 'encarregados', 'encarregada'],
  ['health', 'medical', 'saude', 'medico', 'medica', 'clinico', 'clinica'],
  ['injury', 'injuries', 'injured', 'hurt', 'lesao', 'lesoes', 'lesionado', 'lesionada', 'lesionados', 'magoado', 'magoada', 'magoou'],
  ['player', 'players', 'athlete', 'athletes', 'jogador', 'jogadores', 'jogadora', 'jogadoras', 'atleta', 'atletas'],
  ['team', 'teams', 'squad', 'squads', 'equipa', 'equipas', 'equipe', 'equipes', 'plantel', 'plantéis'],
  ['coach', 'coaches', 'trainer', 'treinador', 'treinadores', 'treinadora'],
  ['training', 'trainings', 'practice', 'practices', 'treino', 'treinos', 'sessao de treino'],
  ['match', 'matches', 'game', 'games', 'jogo', 'jogos', 'partida', 'partidas'],
  ['member', 'members', 'membro', 'membros', 'socio', 'socios', 'user', 'users', 'utilizador', 'utilizadores', 'usuario', 'usuarios'],
  ['booking', 'bookings', 'reservation', 'reservations', 'appointment', 'appointments', 'reserva', 'reservas', 'marcacao', 'marcacoes', 'consulta', 'consultas'],
  ['order', 'orders', 'encomenda', 'encomendas', 'pedido', 'pedidos'],
  ['product', 'products', 'produto', 'produtos', 'item', 'items', 'artigo', 'artigos'],
  ['cart', 'basket', 'carrinho', 'cesto'],
  ['delivery', 'shipping', 'entrega', 'entregas', 'envio', 'envios'],
  ['subscription', 'subscriptions', 'plan', 'plans', 'subscricao', 'assinatura', 'plano', 'planos'],
  ['privacy', 'privacidade'],
  ['security', 'seguranca'],
  ['photo', 'photos', 'picture', 'pictures', 'foto', 'fotos', 'fotografia', 'fotografias', 'imagem', 'imagens', 'gallery', 'galeria'],
  ['video', 'videos'],
  ['course', 'courses', 'curso', 'cursos', 'lesson', 'lessons', 'aula', 'aulas'],
  ['grade', 'grades', 'nota', 'notas', 'avaliacao', 'avaliacoes', 'results', 'resultados'],
  ['attendance', 'presencas', 'presenca', 'faltas', 'falta', 'assiduidade'],
  ['history', 'historico', 'historia'],
  ['contact', 'contacts', 'contacto', 'contactos', 'contato', 'contatos'],
  ['address', 'morada', 'endereco'],
  ['search', 'pesquisa', 'procura', 'busca'],
];

/** Normalised word -> the groups it belongs to. Built once. */
const BY_WORD = (() => {
  const index = new Map<string, (readonly string[])[]>();
  for (const group of CONCEPTS) {
    const members = [...new Set(group.map(normalize))];
    for (const member of members) {
      for (const word of [member, ...member.split(' ')].filter((w) => w.length > 2)) {
        if (!index.has(word)) index.set(word, []);
        index.get(word)!.push(members);
      }
    }
  }
  return index;
})();

/**
 * The other forms a word might take, by the rules of the language, most likely first. Crude on purpose —
 * a candidate that is not a word is simply one the registry does not know, and is never added.
 */
function forms(word: string): string[] {
  const out: string[] = [];
  const swap = (from: string, to: string): void => {
    if (word.length > from.length + 2 && word.endsWith(from)) out.push(word.slice(0, -from.length) + to);
  };
  // Portuguese plurals and genders: lesoes -> lesao, jogadores -> jogador, papeis -> papel, sessoes -> sessao.
  swap('oes', 'ao');
  swap('aes', 'ao');
  swap('ais', 'al');
  swap('eis', 'el');
  swap('ois', 'ol');
  swap('ns', 'm');
  swap('res', 'r');
  swap('zes', 'z');
  swap('es', '');
  swap('s', '');
  swap('a', 'o');
  swap('as', 'os');
  swap('ao', 'oes');
  // English: injuries -> injury, matches -> match, players -> player, and the singular's plural.
  swap('ies', 'y');
  swap('y', 'ies');
  if (word.length > 3) out.push(`${word}s`, `${word}es`);
  // Verb endings, both languages: injured -> injure/injury handled by the concepts; training -> train.
  swap('ing', '');
  swap('ed', '');
  return out;
}

const VOCABULARY = new WeakMap<Registry, ReadonlySet<string>>();

/** Every word the registry's documents use, as `normalize` leaves them. Built once per registry. */
function vocabularyOf(registry: Registry): ReadonlySet<string> {
  let known = VOCABULARY.get(registry);
  if (!known) {
    known = new Set(normalize(registry.documents.join(' ')).split(' ').filter(Boolean));
    VOCABULARY.set(registry, known);
  }
  return known;
}

/** Guards the work done: nothing a visitor pastes makes this slow. */
const MAX_WORDS = 40;
/** How many of the app's own words stand in for one idea the visitor said differently. */
const PER_CONCEPT = 2;
/** The shortest word whose other forms are tried ("lesoes" is 6; "novas" and "meus" are not). */
const MIN_FORM_LENGTH = 6;

/**
 * The words to add to `utterance` so the registry can recognise what it says — each one a form or a
 * synonym of a word in it that the registry does not know. Empty when there is nothing to bridge.
 */
export function bridgeWords(utterance: string, registry: Registry): string[] {
  const known = vocabularyOf(registry);
  const said = normalize(utterance).split(' ').filter(Boolean);
  if (said.length > MAX_WORDS) return [];
  const saidSet = new Set(said);
  const added = new Set<string>();
  const isKnown = (phrase: string): boolean => phrase.split(' ').every((w) => known.has(w));

  for (const word of said) {
    if (word.length < 3 || known.has(word)) continue;
    // 1. Another form of the same word, that the app uses — and then nothing more: the app's own word
    //    for it is found, and stacking its translations on top only dilutes the rest of the question.
    //    Short words are left alone: they are mostly determiners and adjectives ("novas", "meus"),
    //    whose other form only adds noise to every screen alike.
    const form = word.length >= MIN_FORM_LENGTH ? forms(word).find((f) => known.has(f)) : undefined;
    if (form) {
      added.add(form);
      continue;
    }
    // 2. The same idea in the app's words. A group already present in the question in a form the app
    //    knows is left alone: the visitor has said it the app's way already.
    for (const key of [word, ...forms(word)]) {
      for (const group of BY_WORD.get(key) ?? []) {
        if (group.some((m) => m.split(' ').every((w) => saidSet.has(w)) && isKnown(m))) continue;
        // At most two of the app's words per idea: one bridged word must not outweigh the rest of the question.
        for (const member of group.filter(isKnown).slice(0, PER_CONCEPT)) for (const w of member.split(' ')) added.add(w);
      }
    }
  }
  for (const word of said) added.delete(word);
  return [...added];
}

/** `utterance` with its bridge words after it: what stage 2 embeds. The visitor's own words come first, unchanged. */
export function bridge(utterance: string, registry: Registry): string {
  const words = bridgeWords(utterance, registry);
  return words.length > 0 ? `${utterance} ${words.join(' ')}` : utterance;
}
