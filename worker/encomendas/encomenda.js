/* A ENCOMENDA NO KV: a forma (docs/ENCOMENDAS.md, §4), os ids, a chave, os estados e as vistas.
 *
 * Chaves do namespace ORDERS (só este Worker escreve):
 *   order:<id>       a encomenda inteira, 400 dias (cada escrita renova o prazo)
 *   session:<cs_…>   → <id>   (modo «online»: a página da Stripe que a abriu)
 *   pi:<pi_…>        → <id>   (modo «online»: o pagamento; é por ele que um reembolso chega cá)
 *   evt:<evt_…>      → 1, 30 dias (um webhook repetido não repete emails)
 *
 * Cada escrita conta para a quota do KV, que é da conta inteira (1 000 por dia no plano
 * gratuito): grava-se o menos possível, e nunca por pedidos que não dão em nada.
 */

export const TTL_ENCOMENDA = 400 * 86400;
export const TTL_EVENTO = 30 * 86400;

/* Sem 0/O/1/I: os ids dizem-se ao telefone e escrevem-se à mão. */
export const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const RE_ID = /^LF-\d{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
export const RE_CHAVE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{20}$/;

/* 256 = 8 × 32: o resto por 32 não enviesa nenhuma letra. */
export function aleatorio(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (x) => ALFABETO[x % ALFABETO.length]).join('');
}
/* LF-AAAAMMDD-XXXXXX: a data (de Lisboa) à frente faz os ids ordenarem por dia no list(). */
export const novoId = (hoje) => `LF-${String(hoje).replace(/-/g, '')}-${aleatorio(6)}`;
export const novaChave = () => aleatorio(20);

/* Comparação em tempo constante: a chave de uma encomenda não se adivinha letra a letra pelo
   tempo de resposta. */
export function iguais(a, b) {
  const x = String(a ?? ''), y = String(b ?? '');
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

export const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';
export const agoraISO = () => new Date().toISOString();

/* ---------------------------------------------------------------- estados */

export const ESTADOS = Object.freeze(['registada', 'pendente', 'paga', 'pronta', 'enviada', 'levantada', 'anulada', 'reembolsada', 'falhou', 'expirou']);

/* As transições que o painel pode pedir (§4, a coluna «quem»). As da Stripe são do webhook
   (stripe.js, aplicarEvento). Os finais (levantada, anulada, reembolsada) não mudam mais. */
export const TRANSICOES_PAINEL = Object.freeze({
  registada: ['paga', 'pronta', 'anulada'],
  pendente: ['paga', 'anulada'],
  paga: ['pronta', 'enviada', 'levantada', 'anulada'],
  pronta: ['levantada', 'anulada'],
  enviada: ['anulada'],
  falhou: ['paga', 'anulada'],
  expirou: ['paga', 'anulada'],
  levantada: [],
  anulada: [],
  reembolsada: [],
});

const NOMES = { registada: 'registada', pendente: 'pendente', paga: 'paga', pronta: 'pronta', enviada: 'enviada', levantada: 'levantada', anulada: 'anulada', reembolsada: 'reembolsada', falhou: 'falhou', expirou: 'expirou' };

/* A razão de uma transição do painel não se poder fazer, ou null quando pode. */
export function razaoParaNao(enc, novo) {
  if (!ESTADOS.includes(novo)) return 'Esse estado não existe.';
  const levantamento = enc.entrega === 'levantamento';
  if (novo === 'pronta' && !levantamento) return 'Só uma encomenda para levantar na loja fica «pronta»; uma para enviar marca-se «enviada».';
  if (novo === 'levantada' && !levantamento) return 'Só uma encomenda para levantar na loja se marca «levantada».';
  if (novo === 'enviada' && levantamento) return 'Uma encomenda para levantar na loja não se marca «enviada»; marque-a «pronta».';
  if (enc.estado === novo) return `A encomenda já está «${NOMES[novo]}».`;
  // Só as transições que fazem sentido para ESTA entrega: a mensagem lista-as.
  const permitidas = (TRANSICOES_PAINEL[enc.estado] || []).filter((e) => (levantamento ? e !== 'enviada' : !['pronta', 'levantada'].includes(e)));
  if (!permitidas.includes(novo)) {
    return permitidas.length
      ? `De «${NOMES[enc.estado]}» só se passa a ${permitidas.map((e) => `«${NOMES[e]}»`).join(', ')}.`
      : `Uma encomenda «${NOMES[enc.estado]}» não muda mais de estado.`;
  }
  return null;
}

/* Muda o estado e acrescenta a linha ao histórico (`por`: site, stripe, ou o email de quem
   marcou no painel; `nota` opcional). */
export function mudarEstado(enc, estado, { por, nota = '', em = agoraISO() } = {}) {
  enc.estado = estado;
  const linha = { em, estado, por: por || 'painel' };
  if (nota) linha.nota = nota;
  enc.historico = [...(enc.historico || []), linha];
  enc.actualizada_em = em;
  return enc;
}

/* ---------------------------------------------------------------- a encomenda */

/* A encomenda nova, com a forma do §4. `contas` vem de contas.js. */
export function criarEncomenda({ id, chave, modo, estado, zona, contas, cliente, termosPagina, em = agoraISO() }) {
  return {
    v: 1,
    encomenda: id,
    chave,
    modo,
    estado,
    entrega: zona.id,
    linhas: contas.linhas,
    artigos_cents: contas.artigos_cents,
    portes_cents: contas.portes_cents,
    portes_por_confirmar: contas.portes_por_confirmar,
    total_cents: contas.total_cents,
    cliente,
    termos: { aceites_em: em, pagina: termosPagina },
    historico: [{ em, estado, por: 'site' }],
    criada_em: em,
    actualizada_em: em,
  };
}

/* ---------------------------------------------------------------- KV */

export const chaveKV = (id) => `order:${id}`;

export async function lerEncomenda(env, id) {
  const bruto = await env.ORDERS.get(chaveKV(id));
  return bruto ? JSON.parse(bruto) : null;
}

/* Os metadados da chave: o que a lista do painel precisa SEM ler cada encomenda (uma leitura por
   encomenda esgotava os subpedidos de um pedido do Worker). Cabe em 1 024 bytes: corta-se o que
   for preciso e diz-se quantas linhas ficaram de fora. */
const corte = (s, n) => String(s || '').slice(0, n);
export function metadadosDe(enc) {
  const c = enc.cliente || {};
  const base = {
    estado: enc.estado,
    modo: enc.modo,
    entrega: enc.entrega,
    total_cents: enc.total_cents,
    criada_em: enc.criada_em,
    actualizada_em: enc.actualizada_em,
    nome: corte(c.nome, 60),
    telefone: corte(c.telefone, 20),
    email: corte(c.email, 80),
  };
  const linhas = (enc.linhas || []).map((l) => [corte(l.nome, 50), l.qtd]);
  let m = { ...base, linhas };
  while (JSON.stringify(m).length > 1000 && linhas.length) {
    linhas.pop();
    m = { ...base, linhas, mais: (enc.linhas || []).length - linhas.length };
  }
  return m;
}

export async function gravarEncomenda(env, enc, { em = agoraISO() } = {}) {
  enc.actualizada_em = em;
  await env.ORDERS.put(chaveKV(enc.encomenda), JSON.stringify(enc), { expirationTtl: TTL_ENCOMENDA, metadata: metadadosDe(enc) });
  return enc;
}

/* Um id que ainda não existe (uma colisão em 2^30 por dia é improvável, mas uma leitura custa
   pouco e evita gravar por cima de uma encomenda de outra pessoa). */
export async function idLivre(env, hoje) {
  for (let i = 0; i < 5; i++) {
    const id = novoId(hoje);
    if (!(await env.ORDERS.get(chaveKV(id)))) return id;
  }
  throw new Error('não se arranjou um id livre');
}

/* ---------------------------------------------------------------- vistas */

/* O que o site lê (§3): só o que a pessoa já sabe. Sem email, telefone, morada nem chave. */
export function vistaPublica(enc) {
  return {
    encomenda: enc.encomenda,
    estado: enc.estado,
    modo: enc.modo,
    entrega: enc.entrega,
    portes_por_confirmar: Boolean(enc.portes_por_confirmar),
    linhas: (enc.linhas || []).map((l) => ({ nome: l.nome, qtd: l.qtd, total_cents: l.total_cents, escolhas: l.escolhas || [] })),
    artigos_cents: enc.artigos_cents,
    portes_cents: enc.portes_cents,
    total_cents: enc.total_cents,
    cliente: { nome: primeiroNome((enc.cliente || {}).nome) },
  };
}

/* O resumo da lista do painel (§5), feito dos metadados da chave. */
export function resumoDeMetadados(nome, m) {
  const id = nome.replace(/^order:/, '');
  if (!m) return { encomenda: id };
  const r = {
    encomenda: id,
    estado: m.estado,
    modo: m.modo,
    entrega: m.entrega,
    total_cents: m.total_cents,
    cliente: { nome: m.nome || '', telefone: m.telefone || '' },
    criada_em: m.criada_em,
    actualizada_em: m.actualizada_em,
    linhas: (m.linhas || []).map(([nome, qtd]) => ({ nome, qtd })),
  };
  if (m.mais) r.linhas_a_mais = m.mais;
  return r;
}
