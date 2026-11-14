/* A CONTA DO CLIENTE (13 nov 2026; o Leandro: «a conta cliente para o cliente ver as encomendas»).
 *
 * Entra-se com o email e um código de 6 algarismos que vai por email: sem palavra-passe (nada para
 * esquecer nem para roubar). Lá dentro, as encomendas feitas com esse email, em que ponto está cada
 * uma e o caminho que fez (o histórico, sem as notas internas do painel).
 *
 * As rotas são /conta/api/… e chegam pelo Worker do site (worker/www.js, a service binding
 * ENCOMENDAS): no domínio a sessão é um cookie do próprio site (__Host-, HttpOnly, Secure,
 * SameSite=Lax), que nenhum script lê, e não há CORS. Pelo workers.dev as rotas respondem igual,
 * mas sem o cookie não há conta.
 *
 *   POST /conta/api/codigo     { email }                  → { pedido }   e o código vai por email
 *   POST /conta/api/entrar     { email, pedido, codigo }  → { ok }       e o cookie da sessão
 *   GET  /conta/api/eu                                    → { email, encomendas: [resumo…] }
 *   GET  /conta/api/encomenda?e=<id>                      → a encomenda, se for desta conta
 *   POST /conta/api/sair                                  → apaga a sessão e o cookie
 *
 * UM OBJECTO DURÁVEL POR CONTA (Conta, aqui; o nome é o resumo SHA-256 do email da conta, na UE): o
 * código (só o resumo, 10 minutos, 5 tentativas), as sessões (só o resumo de cada uma, 30 dias,
 * renovados com o uso) e quando se pediram códigos (o travão por email). Conferir o código e contar a
 * tentativa é um passo só: dois pedidos ao mesmo tempo não ganham tentativas a mais. O objecto
 * apaga-se sozinho quando já não tem sessões.
 *
 * AS ENCOMENDAS DA CONTA são as do KV (order:…) cujo email é o da conta: lêem-se dos metadados da
 * lista (encomenda.js, metadadosDe), sem ler cada encomenda. A ficha lê o objecto da encomenda e
 * confere o email outra vez. O email «da conta» é o escrito em minúsculas; no Gmail, sem os pontos
 * nem o «+etiqueta» (vão dar à mesma caixa). Noutros domínios o «+etiqueta» fica: não se sabe se dá
 * à mesma pessoa.
 *
 * Os POST só se aceitam vindos do site (o Origin): um site alheio não pede códigos nem fecha sessões
 * em nome de quem o visita.
 *
 * O CARTÃO DAS PELÍCULAS (13 nov 2026; o cartão de papel da loja, «Películas Hidrogel»: 5 casas e na 6.ª uma
 * película de oferta, a contar na loja E no site): as do site contam sozinhas (cada película de hidrogel numa
 * encomenda paga); as da loja e as ofertas entregues marca-as o dono no painel, pelo email do cliente:
 *
 *   GET  /painel/cartoes?email=…                          → { email, cartao, movimentos }
 *   POST /painel/cartoes/carimbo { email, n, por, nota? } → o mesmo (n de −10 a 10: as da loja; o negativo corrige)
 *   POST /painel/cartoes/oferta  { email, por, nota? }    → o mesmo · 409 sem oferta por entregar
 */

import { json, lerCorpoJson } from './http.js';
import { pedirAoObjecto, respostaJson } from './objecto.js';
import { lerEncomenda, alterarEncomenda, vistaPublica, ESTADOS, RE_ID, iguais } from './encomenda.js';
import { enviar, avisar, falhou, logoDe, marcaDe } from './email.js';
import { siteUrl, lerCatalogo } from './catalogo.js';
import { limpar, emailValido, telefoneValido, nifValido, RE_CODIGO_POSTAL } from './contas.js';
import { documento, bloco, p, pequeno, caixaCodigo } from './email-html.js';
import { renderSVG } from './vendor/uqr.mjs';

export const COOKIE = '__Host-lf-sessao';
export const SESSAO_DIAS = 30;
export const CODIGO_MINUTOS = 10;
export const TENTATIVAS = 5;
export const CODIGOS_POR_HORA = 4;
export const CODIGOS_POR_DIA = 10;
export const MAX_SESSOES = 10;
const DIA_MS = 86400 * 1000;
const SESSAO_MS = SESSAO_DIAS * DIA_MS;
const CODIGO_MS = CODIGO_MINUTOS * 60 * 1000;
const REPETIDO_MS = 20 * 1000;          // dois toques seguidos no botão não mandam dois emails
const RE_TOKEN = /^([0-9a-f]{64})\.([A-Za-z0-9_-]{43})$/;
export const POR_CARTAO = 5;                                               // 5 casas; a 6.ª é oferta
export const CONTAM = Object.freeze(['paga', 'pronta', 'enviada', 'levantada']);  // as encomendas que carimbam
const CARTAO_MS = 3 * 365 * DIA_MS;                                        // o cartão guarda-se 3 anos depois do último movimento
const CONTA_MS = 2 * 365 * DIA_MS;                                         // os dados guardam-se 2 anos depois da última entrada
const RE_PEDIDO = /^[A-Za-z0-9_-]{22}$/;

/* ---------------------------------------------------------------- o email da conta e os segredos */

export function emailDaConta(email) {
  const e = String(email || '').replace(/[\p{Cc}\p{Cf}\s]/gu, '').toLowerCase();
  const i = e.lastIndexOf('@');
  if (i < 1) return e;
  const local = e.slice(0, i);
  const dominio = e.slice(i + 1);
  if (dominio === 'gmail.com' || dominio === 'googlemail.com') return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
  return `${local}@${dominio}`;
}

async function resumo(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* O nome do objecto da conta: o resumo do email da conta (o email nunca é o nome). */
export const idDaConta = (conta) => resumo(`lfmobile-conta:${conta}`);

/* n bytes aleatórios em base64url (16 → 22 caracteres; 32 → 43). */
function aleatorio(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Seis algarismos sem enviesar nenhum: 4 294 000 000 é o maior múltiplo de um milhão que cabe em
   32 bits; o que passa disso tira-se outra vez. */
export function codigoNovo() {
  const a = new Uint32Array(1);
  do { crypto.getRandomValues(a); } while (a[0] >= 4294000000);
  return String(a[0] % 1000000).padStart(6, '0');
}

/* ---------------------------------------------------------------- o objecto de cada conta */

export class Conta {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    let corpo;
    try { corpo = await request.json(); } catch { return respostaJson({ erro: 'pedido' }, 400); }
    let resposta;
    await this.ctx.blockConcurrencyWhile(async () => { resposta = await this.fazer(corpo && typeof corpo === 'object' ? corpo : {}); });
    return respostaJson(resposta);
  }

  async fazer(c) {
    const s = this.ctx.storage;
    const agora = Date.now();

    if (c.op === 'pedirCodigo') {
      const antes = (await s.get('codigo')) || null;
      if (antes && agora - antes.criado < REPETIDO_MS && agora < antes.expira) return { ok: true, pedido: antes.pedido, jaEnviado: true };
      const pedidos = ((await s.get('pedidos')) || []).filter((t) => agora - t < DIA_MS);
      if (pedidos.filter((t) => agora - t < 3600 * 1000).length >= CODIGOS_POR_HORA || pedidos.length >= CODIGOS_POR_DIA) return { travado: true };
      const codigo = codigoNovo();
      const pedido = aleatorio(16);
      await s.put('codigo', { pedido, resumo: await resumo(`${pedido}:${codigo}`), expira: agora + CODIGO_MS, tentativas: 0, criado: agora });
      await s.put('pedidos', [...pedidos, agora]);
      await s.put('email', String(c.email || ''));
      await this.prazo(agora);
      return { ok: true, pedido, codigo };
    }

    if (c.op === 'entrar') {
      const cod = await s.get('codigo');
      if (!cod || !iguais(cod.pedido, c.pedido)) return { erro: 'pedido' };
      if (agora > cod.expira) { await s.delete('codigo'); return { erro: 'expirou' }; }
      cod.tentativas += 1;
      if (!iguais(cod.resumo, c.resumo)) {
        if (cod.tentativas >= TENTATIVAS) { await s.delete('codigo'); return { erro: 'esgotou' }; }
        await s.put('codigo', cod);
        return { erro: 'errado', restam: TENTATIVAS - cod.tentativas };
      }
      await s.delete('codigo');
      return { ok: true, segredo: await this.novaSessao(agora, c.mostrar) };
    }

    // entrar sem código: o Google já provou que o email é desta pessoa (o Worker conferiu o token)
    if (c.op === 'entrarSemCodigo') {
      if (!(await s.get('email'))) await s.put('email', String(c.email || ''));
      return { ok: true, segredo: await this.novaSessao(agora, c.mostrar) };
    }

    if (c.op === 'sessao' || c.op === 'sair') {
      if (!/^[0-9a-f]{64}$/.test(String(c.resumo || ''))) return { ok: false };
      const chave = `sessao:${c.resumo}`;
      if (c.op === 'sair') { await s.delete(chave); return { ok: true }; }
      const v = await s.get(chave);
      if (!v) return { ok: false };
      if (agora > v.expira) { await s.delete(chave); return { ok: false }; }
      // a sessão renova-se com o uso, uma vez por dia (cada renovação é uma escrita)
      let renovou = false;
      if (agora - v.renovada > DIA_MS) {
        v.expira = agora + SESSAO_MS;
        v.renovada = agora;
        await s.put(chave, v);
        await s.put('visto', agora);
        await this.prazo(agora);
        renovou = true;
      }
      return { ok: true, email: (await s.get('email')) || '', mostrar: v.mostrar || '', renovou, dados: (await s.get('dados')) || null, ...(await this.cartao()) };
    }

    // os dados do cliente (o checkout vem preenchido com eles)
    if (c.op === 'gravarDados') {
      if (!c.dados || typeof c.dados !== 'object') return { erro: 'dados' };
      const dados = { ...c.dados, actualizado_em: new Date(agora).toISOString() };
      await s.put('dados', dados);
      await this.prazo(agora);
      return { ok: true, dados };
    }

    // sair em todos os aparelhos: todas as sessões saem (os dados e o cartão ficam)
    if (c.op === 'sairTodos') {
      for (const k of (await s.list({ prefix: 'sessao:' })).keys()) await s.delete(k);
      return { ok: true };
    }

    // apagar a conta: sai tudo o que o objecto guarda (as encomendas ficam: a lei manda guardá-las)
    if (c.op === 'apagar') {
      await s.deleteAll();
      try { await s.deleteAlarm(); } catch { /* sem alarme */ }
      return { ok: true };
    }

    if (c.op === 'cartao') return this.cartao();
    if (c.op === 'email') return { email: (await s.get('email')) || '', mostrar: (await s.get('mostrar')) || '' };

    // o dono marca no painel as películas compradas na loja (n negativo corrige um engano)
    if (c.op === 'carimbar') {
      const n = Number(c.n);
      if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 10) return { erro: 'n' };
      const { carimbos } = await this.cartao();
      const loja = carimbos.reduce((t, x) => t + (Number(x.n) || 0), 0);
      if (loja + n < 0) return { erro: 'negativo' };
      await s.put('carimbos', [...carimbos, { em: new Date(agora).toISOString(), n, por: String(c.por || '').slice(0, 120), ...(c.nota ? { nota: String(c.nota).slice(0, 300) } : {}) }]);
      return this.mexeu(agora, c.email);
    }

    // a oferta entregue: só se o cartão a tiver (as do site vêm contadas de fora, em `site`)
    if (c.op === 'oferta') {
      const g = await this.cartao();
      if (cartaoDe(Number(c.site) || 0, g).disponiveis < 1) return { erro: 'sem-oferta', ...g };
      await s.put('ofertas', [...g.ofertas, { em: new Date(agora).toISOString(), por: String(c.por || '').slice(0, 120), ...(c.nota ? { nota: String(c.nota).slice(0, 300) } : {}) }]);
      return this.mexeu(agora, c.email);
    }

    return { erro: 'operação' };
  }

  async cartao() {
    const s = this.ctx.storage;
    return { carimbos: (await s.get('carimbos')) || [], ofertas: (await s.get('ofertas')) || [] };
  }

  /* Um movimento no cartão: a data (para o prazo de 3 anos) e o email (um cartão que nasce no painel,
     de alguém que nunca entrou no site). */
  async mexeu(agora, email) {
    const s = this.ctx.storage;
    await s.put('mexido', agora);
    if (email && !(await s.get('email'))) await s.put('email', String(email));
    await this.prazo(agora);
    return { ok: true, ...(await this.cartao()) };
  }

  /* Uma sessão nova: só o resumo do segredo fica guardado; a conta fica «vista» agora. */
  async novaSessao(agora, mostrar) {
    const s = this.ctx.storage;
    const segredo = aleatorio(32);
    await s.put(`sessao:${await resumo(segredo)}`, { criada: agora, expira: agora + SESSAO_MS, renovada: agora, mostrar: String(mostrar || '').slice(0, 160) });
    await s.put('visto', agora);
    if (mostrar) await s.put('mostrar', String(mostrar).slice(0, 160));
    await this.aparar(agora);
    await this.prazo(agora);
    return segredo;
  }

  /* As sessões que passaram do prazo saem; acima de MAX_SESSOES, saem as mais antigas. */
  async aparar(agora) {
    const s = this.ctx.storage;
    const vivas = [];
    for (const [k, v] of await s.list({ prefix: 'sessao:' })) {
      if (!v || agora > v.expira) await s.delete(k); else vivas.push([k, v]);
    }
    vivas.sort((a, b) => b[1].criada - a[1].criada);
    for (const [k] of vivas.slice(MAX_SESSOES)) await s.delete(k);
  }

  /* O objecto limpa-se sozinho: o alarme fica para depois da sessão mais longa possível e, com um cartão,
     para depois dos 3 anos do último movimento. */
  async prazo(agora) {
    const s = this.ctx.storage;
    const mexido = (await s.get('mexido')) || 0;
    const visto = (await s.get('dados')) ? ((await s.get('visto')) || agora) : 0;
    await s.setAlarm(Math.max(agora + SESSAO_MS + DIA_MS, mexido ? mexido + CARTAO_MS + DIA_MS : 0, visto ? visto + CONTA_MS + DIA_MS : 0));
  }

  async alarm() {
    const s = this.ctx.storage;
    const agora = Date.now();
    let ultima = 0;
    for (const [k, v] of await s.list({ prefix: 'sessao:' })) {
      if (!v || agora > v.expira) await s.delete(k); else ultima = Math.max(ultima, v.expira);
    }
    const mexido = (await s.get('mexido')) || 0;
    const cartaoAte = mexido ? mexido + CARTAO_MS : 0;
    if (mexido && cartaoAte <= agora) { await s.delete('carimbos'); await s.delete('ofertas'); await s.delete('mexido'); }
    // os dados do cliente: 2 anos depois da última vez que entrou
    const temDados = Boolean(await s.get('dados'));
    const dadosAte = temDados ? ((await s.get('visto')) || 0) + CONTA_MS : 0;
    if (temDados && dadosAte <= agora) await s.delete('dados');
    const proximo = Math.max(ultima, cartaoAte > agora ? cartaoAte : 0, dadosAte > agora ? dadosAte : 0);
    if (!proximo) { await s.deleteAll(); return; }
    await s.delete('codigo');
    await s.setAlarm(proximo + DIA_MS);
  }
}

/* ---------------------------------------------------------------- as encomendas da conta */

const resumoDaConta = (nome, m) => ({
  encomenda: nome.replace(/^order:/, ''),
  estado: m.estado,
  entrega: m.entrega,
  total_cents: m.total_cents,
  criada_em: m.criada_em,
  linhas: (Array.isArray(m.linhas) ? m.linhas : []).map(([n, q]) => ({ nome: n, qtd: q })),
  ...(m.mais ? { linhas_a_mais: m.mais } : {}),
});

/* As encomendas cujo email é o da conta, as mais recentes primeiro. Os metadados guardam o email
   cortado aos 80 caracteres (aos 40 numa encomenda enorme): esse, que pode estar cortado, confere-se
   na encomenda. */
export async function encomendasDaConta(env, conta) {
  const out = [];
  let cursor;
  for (let volta = 0; volta < 100; volta++) {
    const r = await env.ORDERS.list({ prefix: 'order:', ...(cursor ? { cursor } : {}) });
    for (const k of r.keys || []) {
      const m = k.metadata;
      if (!m || typeof m.email !== 'string' || !m.email) continue;
      let dela = emailDaConta(m.email) === conta;
      if (!dela && (m.email.length === 80 || m.email.length === 40)) {
        const enc = await lerEncomenda(env, k.name.replace(/^order:/, ''));
        dela = Boolean(enc) && emailDaConta((enc.cliente || {}).email) === conta;
      }
      if (dela) out.push(resumoDaConta(k.name, m));
    }
    if (r.list_complete || !r.cursor) break;
    cursor = r.cursor;
  }
  return out.sort((a, b) => String(b.criada_em || '').localeCompare(String(a.criada_em || '')));
}

/* O caminho da encomenda que o cliente vê: cada mudança de estado, com a data. As notas só nas
   que lhe foram ditas por email (a «enviada» leva o rastreio, a «anulada» a razão: painel,
   ecras/encomenda.js); as outras notas do painel e as linhas da Stripe que não mudaram nada são
   internas e ficam de fora. */
export function historicoDoCliente(enc) {
  const out = [];
  let anterior = null;
  for (const h of Array.isArray(enc.historico) ? enc.historico : []) {
    if (!h || !ESTADOS.includes(h.estado) || h.estado === anterior) continue;
    const linha = { em: h.em, estado: h.estado };
    if ((h.estado === 'enviada' || h.estado === 'anulada') && typeof h.nota === 'string' && h.nota.trim()) linha.nota = h.nota.trim().slice(0, 300);
    out.push(linha);
    anterior = h.estado;
  }
  return out;
}

/* A ficha da encomenda na conta: a vista pública (sem email, telefone nem chave), a data, a morada
   de envio (é a dele) e o caminho. */
export function vistaDaConta(enc) {
  const c = enc.cliente || {};
  const morada = [c.morada, [c.codigoPostal, c.localidade].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return {
    ...vistaPublica(enc),
    criada_em: enc.criada_em,
    ...(enc.entrega !== 'levantamento' && morada ? { morada } : {}),
    historico: historicoDoCliente(enc),
  };
}

/* ---------------------------------------------------------------- o cartão das películas */

/* Uma película de hidrogel: o nome do artigo di-lo (o Leandro chama-lhes «Película de Hidrogel …»). */
export const ehHidrogel = (nome) => /hidrogel/i.test(String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

/* As películas de hidrogel compradas no site: as das encomendas pagas (CONTAM). Os metadados levam as
   linhas; os de uma encomenda com linhas a mais (cortadas) lêem-se na encomenda. */
export async function peliculasDoSite(env, encomendas) {
  let n = 0;
  const de = [];
  for (const e of encomendas) {
    if (!CONTAM.includes(e.estado)) continue;
    let linhas = Array.isArray(e.linhas) ? e.linhas : [];
    if (e.linhas_a_mais) {
      const enc = await lerEncomenda(env, e.encomenda).catch(() => null);
      if (enc) linhas = (enc.linhas || []).map((l) => ({ nome: l.nome, qtd: l.qtd }));
    }
    const k = linhas.filter((l) => ehHidrogel(l.nome)).reduce((t, l) => t + (Number(l.qtd) || 0), 0);
    if (k > 0) { n += k; de.push({ encomenda: e.encomenda, em: e.criada_em, n: k }); }
  }
  return { n, de };
}

/* O cartão: as do site + as da loja; cada 5 dão uma oferta; as ofertas entregues descontam-se. `atuais`
   são as casas do cartão de agora (0 a 4). */
export function cartaoDe(site, g = {}) {
  const carimbos = Array.isArray(g.carimbos) ? g.carimbos : [];
  const ofertas = Array.isArray(g.ofertas) ? g.ofertas : [];
  const loja = Math.max(0, carimbos.reduce((t, c) => t + (Number(c.n) || 0), 0));
  const total = (Number(site) || 0) + loja;
  const ganhas = Math.floor(total / POR_CARTAO);
  return { por_cartao: POR_CARTAO, site: Number(site) || 0, loja, total, atuais: total - ganhas * POR_CARTAO, disponiveis: Math.max(0, ganhas - ofertas.length), entregues: ofertas.length };
}

/* O cartão de um cliente, como o painel o mostra: as contas e os movimentos (as encomendas do site, os
   carimbos da loja e as ofertas), os mais recentes primeiro. */
export async function vistaDoCartao(env, email) {
  const conta = emailDaConta(email);
  const { n, de } = await peliculasDoSite(env, await encomendasDaConta(env, conta));
  const g = await pedirAoObjecto(env, 'CONTA', await idDaConta(conta), { op: 'cartao' });
  const movimentos = [
    ...de.map((d) => ({ em: d.em, tipo: 'site', n: d.n, encomenda: d.encomenda })),
    ...(g.carimbos || []).map((c) => ({ em: c.em, tipo: 'loja', n: c.n, por: c.por, ...(c.nota ? { nota: c.nota } : {}) })),
    ...(g.ofertas || []).map((o) => ({ em: o.em, tipo: 'oferta', por: o.por, ...(o.nota ? { nota: o.nota } : {}) })),
  ].sort((a, b) => String(b.em || '').localeCompare(String(a.em || '')));
  return { email: limpar(email, 160).toLowerCase(), cartao: cartaoDe(n, g), movimentos };
}

/* As rotas do painel para os cartões (painel.js chama-as com o PAINEL_SEGREDO já conferido). */
export async function rotaCartoes(request, env, url, resto) {
  if (resto === '/cartoes') {
    if (request.method !== 'GET') return json({ erro: 'Método não permitido.' }, 405);
    // pelo código QR do cliente: o id da conta (o painel abre #/cartoes?conta=<id>)
    const conta = String(url.searchParams.get('conta') || '');
    if (conta) {
      if (!/^[0-9a-f]{64}$/.test(conta)) return json({ erro: 'Este código não é de um cartão da LF Mobile.' }, 404);
      const g = await pedirAoObjecto(env, 'CONTA', conta, { op: 'email' });
      if (!g.email) return json({ erro: 'Este cartão já não existe (a conta foi apagada?).' }, 404);
      return json({ ...(await vistaDoCartao(env, g.mostrar || g.email)), conta });
    }
    const email = limpar(url.searchParams.get('email'), 160).toLowerCase();
    if (!emailValido(email)) return json({ erro: 'Escreva o email do cliente.', campo: 'email' }, 400);
    return json(await vistaDoCartao(env, email));
  }
  const r = /^\/cartoes\/(carimbo|oferta)$/.exec(resto);
  if (!r) return json({ erro: 'Rota desconhecida.' }, 404);
  if (request.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405);
  const { corpo, resposta } = await lerCorpoJson(request);
  if (resposta) return resposta;
  const email = limpar(corpo.email, 160).toLowerCase();
  if (!emailValido(email)) return json({ erro: 'Escreva o email do cliente.', campo: 'email' }, 400);
  const conta = emailDaConta(email);
  const id = await idDaConta(conta);
  const por = limpar(corpo.por, 120) || 'painel';
  const nota = limpar(corpo.nota, 300);
  if (r[1] === 'carimbo') {
    const x = await pedirAoObjecto(env, 'CONTA', id, { op: 'carimbar', n: corpo.n, por, nota, email: conta });
    if (x.erro === 'n') return json({ erro: 'Diga quantas películas: de 1 a 10.', campo: 'n' }, 400);
    if (x.erro) return json({ erro: 'O cartão não tem tantas películas da loja para tirar.', campo: 'n' }, 400);
  } else {
    const { n } = await peliculasDoSite(env, await encomendasDaConta(env, conta));
    const x = await pedirAoObjecto(env, 'CONTA', id, { op: 'oferta', site: n, por, nota, email: conta });
    if (x.erro) return json({ erro: 'Este cliente ainda não tem uma película de oferta.' }, 409);
  }
  return json(await vistaDoCartao(env, email));
}

/* ---------------------------------------------------------------- o email do código */

export function emailDoCodigo(env, codigo) {
  const marca = marcaDe(env);
  const site = siteUrl(env);
  const dominio = site.replace(/^https?:\/\//, '');
  const espacado = `${codigo.slice(0, 3)} ${codigo.slice(3)}`;
  const assunto = `${codigo} é o seu código da ${marca}`;
  const aviso = `Vale ${CODIGO_MINUTOS} minutos. Se não foi você que o pediu, ignore este email: sem o código ninguém entra.`;
  const texto = [
    `O seu código para entrar na sua conta da ${marca}:`,
    '',
    `    ${espacado}`,
    '',
    aviso,
  ].join('\n');
  const corpo = [
    bloco(p(`Escreva-o no site para ver as suas encomendas.`, true)),
    caixaCodigo(espacado),
    bloco(pequeno(aviso, true), '8px 40px 0 40px'),
  ].join('');
  const html = documento({
    assunto, preheader: `O seu código: ${espacado}`, titulo: 'O seu código', subtitulo: 'Para entrar na sua conta', corpo,
    logo: logoDe(env), marca, site,
    rodape: `Recebeu este email porque pediram um código para entrar em ${dominio} com este endereço. Não é publicidade.`,
  });
  return { assunto, texto, html };
}

/* ---------------------------------------------------------------- as rotas */

const origensDe = (env) => String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
function vemDoSite(request, env) {
  const o = request.headers.get('Origin');
  if (!o) return false;
  let site = '';
  try { site = new URL(siteUrl(env)).origin; } catch { /* sem SITE_URL */ }
  return o === site || origensDe(env).includes(o);
}

export const cookieDaSessao = (valor, segundos) => `${COOKIE}=${valor}; Path=/; Max-Age=${segundos}; HttpOnly; Secure; SameSite=Lax`;
const APAGAR_COOKIE = cookieDaSessao('', 0);

export function lerCookie(cabecalho, nome) {
  for (const parte of String(cabecalho || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return '';
}

/* O travão por IP: o da Cloudflare (o binding TRAVAO_CHECKOUT, 5 por minuto por chave, em todas as
   localizações) e, se faltar ou falhar, um de memória (só neste isolate). */
const batidas = new Map();
async function travado(env, chave) {
  if (env.TRAVAO_CHECKOUT && typeof env.TRAVAO_CHECKOUT.limit === 'function') {
    try {
      const { success } = await env.TRAVAO_CHECKOUT.limit({ key: chave });
      return !success;
    } catch (e) {
      console.error('travão da Cloudflare falhou (vale o de memória):', e.message);
    }
  }
  const agora = Date.now();
  const r = batidas.get(chave);
  if (!r || agora - r.inicio > 60_000) { batidas.set(chave, { inicio: agora, n: 1 }); return false; }
  r.n += 1;
  if (batidas.size > 5000) batidas.clear();
  return r.n > 10;
}

const POUCO = 'Não conseguimos tratar o pedido agora. Tente daqui a pouco.';

async function pedirCodigo(request, env, ip) {
  if (await travado(env, `conta-codigo:${ip}`)) return json({ erro: 'Demasiados pedidos. Aguarde um minuto e tente outra vez.' }, 429);
  const { corpo, resposta } = await lerCorpoJson(request);
  if (resposta) return resposta;
  const email = limpar(corpo.email, 160).toLowerCase();
  if (!emailValido(email)) return json({ erro: 'Escreva um email válido.', campo: 'email' }, 400);
  const conta = emailDaConta(email);
  let r;
  try { r = await pedirAoObjecto(env, 'CONTA', await idDaConta(conta), { op: 'pedirCodigo', email: conta }); } catch (e) { console.error('conta por ler', e.message); return json({ erro: POUCO }, 503); }
  if (r.travado) return json({ erro: 'Já enviámos vários códigos para este email. Espere um pouco e tente outra vez.', campo: 'email' }, 429);
  if (!r.jaEnviado) {
    // Num wrangler dev local (ENCOMENDAS_LOCAL=1, nunca na Cloudflare) o código vê-se na consola.
    if (env.ENCOMENDAS_LOCAL === '1') console.log(`CÓDIGO DA CONTA (só local) ${email}: ${r.codigo}`);
    const enviado = await enviar(env, { para: email, ...emailDoCodigo(env, r.codigo), responderA: env.STORE_EMAIL || undefined });
    if (enviado !== 'enviado' && env.ENCOMENDAS_LOCAL !== '1') {
      console.error('CÓDIGO DA CONTA NÃO ENVIADO', enviado);
      return json({ erro: 'Não conseguimos enviar o código agora. Tente daqui a pouco.' }, 503);
    }
  }
  return json({ pedido: r.pedido });
}

async function entrar(request, env, ip) {
  if (await travado(env, `conta-entrar:${ip}`)) return json({ erro: 'Demasiadas tentativas. Aguarde um minuto e tente outra vez.' }, 429);
  const { corpo, resposta } = await lerCorpoJson(request);
  if (resposta) return resposta;
  const email = limpar(corpo.email, 160).toLowerCase();
  const pedido = String(corpo.pedido || '');
  const codigo = String(corpo.codigo || '').replace(/\D/g, '');
  if (!emailValido(email) || !RE_PEDIDO.test(pedido)) return json({ erro: 'Peça um código novo.', novo: true }, 400);
  if (codigo.length !== 6) return json({ erro: 'O código tem 6 algarismos.', campo: 'codigo' }, 400);
  const id = await idDaConta(emailDaConta(email));
  let r;
  try { r = await pedirAoObjecto(env, 'CONTA', id, { op: 'entrar', pedido, resumo: await resumo(`${pedido}:${codigo}`), mostrar: email }); } catch (e) { console.error('conta por ler', e.message); return json({ erro: POUCO }, 503); }
  if (r.erro === 'errado') return json({ erro: r.restam === 1 ? 'O código não está certo. Tem mais uma tentativa.' : `O código não está certo. Tem mais ${r.restam} tentativas.`, campo: 'codigo' }, 400);
  if (r.erro === 'esgotou') return json({ erro: 'O código não está certo. Peça um código novo.', campo: 'codigo', novo: true }, 400);
  if (r.erro || !r.segredo) return json({ erro: 'Este código já não vale. Peça um código novo.', campo: 'codigo', novo: true }, 400);
  return json({ ok: true }, 200, { 'Set-Cookie': cookieDaSessao(`${id}.${r.segredo}`, SESSAO_DIAS * 86400) });
}

/* A sessão do pedido (o cookie), conferida no objecto da conta; null sem sessão. */
async function sessaoDe(request, env) {
  const token = lerCookie(request.headers.get('Cookie'), COOKIE);
  const m = RE_TOKEN.exec(token);
  if (!m) return null;
  const r = await pedirAoObjecto(env, 'CONTA', m[1], { op: 'sessao', resumo: await resumo(m[2]) });
  if (!r.ok || !r.email) return null;
  return { id: m[1], token, email: r.email, mostrar: r.mostrar || r.email, renovou: Boolean(r.renovou), dados: r.dados || null, guardado: { carimbos: r.carimbos || [], ofertas: r.ofertas || [] } };
}
/* Sem sessão: 401, o cookie apaga-se, e diz-se o cliente do Google (público) para a página mostrar o «Entrar com o
   Google» — sem ele (ainda não está ligado), o botão não aparece. */
const semSessao = (env) => json({ erro: 'Entre outra vez na sua conta.', sessao: false, google: googleDe(env) }, 401, { 'Set-Cookie': APAGAR_COOKIE });
const googleDe = (env) => (/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(String(env.GOOGLE_CLIENTE || '')) ? env.GOOGLE_CLIENTE : null);
const renovar = (s) => (s.renovou ? { 'Set-Cookie': cookieDaSessao(s.token, SESSAO_DIAS * 86400) } : {});

async function eu(request, env) {
  let s;
  try { s = await sessaoDe(request, env); } catch (e) { console.error('sessão por ler', e.message); return json({ erro: POUCO }, 503); }
  if (!s) return semSessao(env);
  let encomendas;
  try { encomendas = await encomendasDaConta(env, s.email); } catch (e) { console.error('encomendas da conta por ler', e.message); return json({ erro: 'Não conseguimos ler as suas encomendas agora. Tente daqui a pouco.' }, 503); }
  // o cartão das películas: as do site (destas encomendas) + as da loja (o objecto da conta)
  let cartao;
  try {
    const { total, atuais, disponiveis, por_cartao } = cartaoDe((await peliculasDoSite(env, encomendas)).n, s.guardado);
    cartao = { por_cartao, total, atuais, disponiveis };
  } catch (e) { console.error('cartão por contar', e.message); cartao = null; }
  // os dados: os gravados; sem eles, a sugestão da última encomenda (o checkout e o «Os meus dados» começam por ela)
  let sugestao = null;
  if (!s.dados && encomendas.length) {
    try { sugestao = dadosDaEncomenda(await lerEncomenda(env, encomendas[0].encomenda)); } catch (e) { console.error('última encomenda por ler', e.message); }
  }
  let garantias = [];
  try { garantias = await garantiasDaConta(env, encomendas); } catch (e) { console.error('garantias por contar', e.message); }
  const nome = String((s.dados && s.dados.nome) || (sugestao && sugestao.nome) || '').trim().split(/\s+/)[0] || '';
  return json({ email: s.mostrar, nome, encomendas, cartao, dados: s.dados, sugestao, garantias }, 200, renovar(s));
}

async function fichaDaConta(request, env, url) {
  let s;
  try { s = await sessaoDe(request, env); } catch (e) { console.error('sessão por ler', e.message); return json({ erro: POUCO }, 503); }
  if (!s) return semSessao(env);
  const id = url.searchParams.get('e') || '';
  const naoHa = () => json({ erro: 'Não encontrámos esta encomenda na sua conta.' }, 404, renovar(s));
  if (!RE_ID.test(id)) return naoHa();
  let enc;
  try { enc = await lerEncomenda(env, id); } catch (e) { console.error('encomenda por ler', id, e.message); return json({ erro: POUCO }, 503); }
  if (!enc || emailDaConta((enc.cliente || {}).email) !== s.email) return naoHa();
  let cat = null;
  try { cat = await lerCatalogo(env); } catch (e) { console.error('catálogo por ler (garantias)', e.message); }
  return json({ ...vistaDaConta(enc), garantias: garantiasDasLinhas(enc, cat), desistir: prazoDeDesistir(enc) }, 200, renovar(s));
}

async function sair(request, env) {
  const m = RE_TOKEN.exec(lerCookie(request.headers.get('Cookie'), COOKIE));
  if (m) {
    try { await pedirAoObjecto(env, 'CONTA', m[1], { op: 'sair', resumo: await resumo(m[2]) }); } catch (e) { console.error('sessão por apagar', e.message); }
  }
  return json({ ok: true }, 200, { 'Set-Cookie': APAGAR_COOKIE });
}

/* ---------------------------------------------------------------- os dados do cliente */

/* Os dados que a conta guarda (e o checkout usa): todos opcionais; os que vêm, conferidos como no checkout. */
export function validarDados(b) {
  const x = b && typeof b === 'object' ? b : {};
  const d = {
    nome: limpar(x.nome, 120),
    telefone: limpar(x.telefone, 40),
    nif: limpar(x.nif, 12).replace(/\s/g, ''),
    morada: limpar(x.morada, 160),
    codigoPostal: limpar(x.codigoPostal, 8),
    localidade: limpar(x.localidade, 60),
  };
  if (d.telefone && !telefoneValido(d.telefone)) return { erro: 'O telemóvel tem de ter 9 algarismos (ou o indicativo e o número).', campo: 'telefone' };
  if (d.nif && !nifValido(d.nif)) return { erro: 'Este NIF não está certo: confira os algarismos.', campo: 'nif' };
  if (d.codigoPostal && !RE_CODIGO_POSTAL.test(d.codigoPostal)) return { erro: 'Escreva o código postal assim: 0000-000.', campo: 'codigoPostal' };
  return { dados: Object.fromEntries(Object.entries(d).filter(([, v]) => v)) };
}

/* Os dados de uma encomenda (a sugestão, quando a conta ainda não tem os seus). */
export function dadosDaEncomenda(enc) {
  const c = (enc && enc.cliente) || {};
  const d = validarDados(c);
  return d.dados && Object.keys(d.dados).length ? d.dados : null;
}

async function verDados(request, env) {
  let s;
  try { s = await sessaoDe(request, env); } catch (e) { console.error('sessão por ler', e.message); return json({ erro: POUCO }, 503); }
  if (!s) return semSessao(env);
  let sugestao = null;
  if (!s.dados) {
    try {
      const lista = await encomendasDaConta(env, s.email);
      if (lista.length) sugestao = dadosDaEncomenda(await lerEncomenda(env, lista[0].encomenda));
    } catch (e) { console.error('última encomenda por ler', e.message); }
  }
  return json({ email: s.mostrar, dados: s.dados, sugestao }, 200, renovar(s));
}

async function gravarDados(request, env) {
  let s;
  try { s = await sessaoDe(request, env); } catch (e) { console.error('sessão por ler', e.message); return json({ erro: POUCO }, 503); }
  if (!s) return semSessao(env);
  const { corpo, resposta } = await lerCorpoJson(request);
  if (resposta) return resposta;
  const v = validarDados(corpo);
  if (v.erro) return json({ erro: v.erro, campo: v.campo }, 400);
  let r;
  try { r = await pedirAoObjecto(env, 'CONTA', s.id, { op: 'gravarDados', dados: v.dados }); } catch (e) { console.error('dados por gravar', e.message); return json({ erro: POUCO }, 503); }
  return json({ dados: r.dados }, 200, renovar(s));
}

/* ---------------------------------------------------------------- as garantias */

/* A garantia legal: 3 anos nos artigos novos; nos recondicionados, a da loja (o catálogo leva-a: site.json,
   garantias.recondicionados, 18 meses). Conta da entrega: o levantamento, ou o envio (a data em que seguiu). */
export const MESES_NOVOS = 36;
export function somarMeses(iso, meses) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const [a, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t)).split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}
/* A entrega: a PRIMEIRA linha do histórico em que a encomenda ficou levantada ou enviada. As linhas seguintes com o mesmo
   estado (o pedido para desistir, uma linha da Stripe) não mudam o dia em que o cliente recebeu: a 14 nov 2026 a
   garantia de uma levantada a 13 passava a contar do dia do pedido para desistir. */
const entregaDe = (enc) => (Array.isArray(enc.historico) ? enc.historico : []).find((h) => h && (h.estado === 'levantada' || h.estado === 'enviada')) || null;
export function garantiasDasLinhas(enc, cat) {
  const entrega = entregaDe(enc);
  if (!entrega || !['levantada', 'enviada'].includes(enc.estado)) return null;
  const recond = Number(cat && cat.garantias && cat.garantias.recondicionados) || 18;
  return (enc.linhas || []).map((l) => {
    const p = cat && cat.produtos ? cat.produtos[l.produto] : null;
    if (!p) return null;   // um artigo que já não está no catálogo: não se sabe se era novo ou recondicionado
    const meses = p.estado === 'recondicionado' ? recond : MESES_NOVOS;
    return { meses, ate: somarMeses(entrega.em, meses) };
  });
}

/* As garantias que ainda correm, de todas as encomendas entregues (as que acabam primeiro, primeiro). */
async function garantiasDaConta(env, encomendas) {
  const entregues = encomendas.filter((e) => e.estado === 'levantada' || e.estado === 'enviada').slice(0, 30);
  if (!entregues.length) return [];
  const cat = await lerCatalogo(env);
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const out = [];
  for (const x of entregues) {
    const enc = await lerEncomenda(env, x.encomenda);
    const g = enc ? garantiasDasLinhas(enc, cat) : null;
    (g || []).forEach((gl, i) => { if (gl && gl.ate >= hoje) out.push({ encomenda: x.encomenda, nome: enc.linhas[i].nome, ate: gl.ate }); });
  }
  return out.sort((a, b) => a.ate.localeCompare(b.ate));
}

/* ---------------------------------------------------------------- desistir da compra */

/* O prazo para desistir (DL 24/2014, art. 10.º): 14 dias depois de receber; antes de receber, pode sempre. Num envio
   não se sabe o dia da entrega: conta-se do envio, mais uma semana. Para a loja, um pedido tardio decide-se à mão. */
export const DESISTIR_DIAS = 14;
export function prazoDeDesistir(enc, agora = Date.now()) {
  const pedidos = (Array.isArray(enc.desistencias) ? enc.desistencias : []).map((d) => d.em);
  if (['anulada', 'reembolsada', 'falhou', 'expirou'].includes(enc.estado)) return { pode: false, ate: null, pedidos };
  const entrega = entregaDe(enc);
  if (!entrega) return { pode: true, ate: null, pedidos };
  const dias = entrega.estado === 'enviada' ? DESISTIR_DIAS + 7 : DESISTIR_DIAS;
  const ate = new Date(Date.parse(entrega.em) + dias * DIA_MS).toISOString();
  return { pode: agora <= Date.parse(ate), ate, pedidos };
}

async function desistir(request, env, ip) {
  if (await travado(env, `conta-desistir:${ip}`)) return json({ erro: 'Demasiados pedidos. Aguarde um minuto e tente outra vez.' }, 429);
  let s;
  try { s = await sessaoDe(request, env); } catch (e) { console.error('sessão por ler', e.message); return json({ erro: POUCO }, 503); }
  if (!s) return semSessao(env);
  const { corpo, resposta } = await lerCorpoJson(request);
  if (resposta) return resposta;
  const id = String(corpo.e || '');
  const nota = limpar(corpo.nota, 500, { linhas: true });
  const naoHa = () => json({ erro: 'Não encontrámos esta encomenda na sua conta.' }, 404);
  if (!RE_ID.test(id)) return naoHa();
  const em = new Date().toISOString();
  let r;
  try {
    r = await alterarEncomenda(env, id, (enc) => {
      if (emailDaConta((enc.cliente || {}).email) !== s.email) return { parar: true, alheia: true };
      const prazo = prazoDeDesistir(enc);
      if (!prazo.pode) return { parar: true, fora: true };
      const ultimo = (enc.desistencias || []).at(-1);
      // o mesmo pedido outra vez (um duplo toque): não se repete
      if (ultimo && Date.parse(em) - Date.parse(ultimo.em) < 10 * 60 * 1000) return { parar: true, repetido: true };
      enc.desistencias = [...(enc.desistencias || []), { em, por: 'cliente (conta)', ...(nota ? { nota } : {}) }];
      enc.historico = [...(enc.historico || []), { em, estado: enc.estado, por: 'cliente', nota: `Pediu para desistir da compra, na conta do site.${nota ? ` «${nota}»` : ''}` }];
      return { novo: true };
    }, { em });
  } catch (e) { console.error('desistência por gravar', id, e.message); return json({ erro: POUCO }, 503); }
  if (!r.enc || r.alheia) return naoHa();
  if (r.fora) return json({ erro: 'O prazo para desistir desta encomenda já passou. Fale connosco pelo WhatsApp.' }, 409);
  if (r.novo) {
    // o aviso ao cliente (a confirmação, em suporte duradouro) e à loja (pede-lhe que trate da devolução)
    const resultado = await avisar(env, 'desistencia', r.enc, { nota, em });
    if (falhou(resultado)) console.error('EMAIL DA DESISTÊNCIA NÃO ENVIADO', id, JSON.stringify(resultado));
    try { await alterarEncomenda(env, id, (x) => { x.avisos = { ...(x.avisos || {}), [`desistencia:${em}`]: resultado }; return {}; }); } catch (e) { console.error('aviso por gravar', id, e.message); }
  }
  return json({ ok: true, desistir: prazoDeDesistir(r.enc) }, 200, renovar(s));
}

/* ---------------------------------------------------------------- sair em todos os aparelhos, apagar a conta */

async function sairTodos(request, env) {
  let s;
  try { s = await sessaoDe(request, env); } catch (e) { console.error('sessão por ler', e.message); return json({ erro: POUCO }, 503); }
  if (!s) return semSessao(env);
  try { await pedirAoObjecto(env, 'CONTA', s.id, { op: 'sairTodos' }); } catch (e) { console.error('sessões por apagar', e.message); return json({ erro: POUCO }, 503); }
  return json({ ok: true }, 200, { 'Set-Cookie': APAGAR_COOKIE });
}

async function apagarConta(request, env) {
  let s;
  try { s = await sessaoDe(request, env); } catch (e) { console.error('sessão por ler', e.message); return json({ erro: POUCO }, 503); }
  if (!s) return semSessao(env);
  try { await pedirAoObjecto(env, 'CONTA', s.id, { op: 'apagar' }); } catch (e) { console.error('conta por apagar', e.message); return json({ erro: POUCO }, 503); }
  return json({ ok: true }, 200, { 'Set-Cookie': APAGAR_COOKIE });
}

/* ---------------------------------------------------------------- o código QR do cartão */

/* O QR leva o endereço do cartão no painel (#/cartoes?conta=<id da conta>): o Leandro lê-o na loja (com a câmara do
   telemóvel ou no painel) e abre o cartão deste cliente. O id é o resumo do email: não diz o email, e sem a entrada no
   painel não serve para nada. */
export const enderecoDoCartao = (env, id) => `${String(env.PAINEL_URL || 'https://backoffice.lfmobile.pt').replace(/\/+$/, '')}/#/cartoes?conta=${id}`;
async function qrDoCartao(request, env) {
  let s;
  try { s = await sessaoDe(request, env); } catch (e) { console.error('sessão por ler', e.message); return new Response('', { status: 503 }); }
  if (!s) return new Response('', { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const svg = renderSVG(enderecoDoCartao(env, s.id), { ecc: 'M', border: 3, pixelSize: 8 });
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

/* ---------------------------------------------------------------- entrar com o Google */

/* SEM o script do Google na página: «Entrar com o Google» leva à página do Google (o pedido OpenID, response_type
   id_token, com um state e um nonce que a página guarda no sessionStorage) e o Google devolve o id_token no fragmento
   de /conta/. A página confere o state e manda o token e o nonce para aqui; aqui confere-se a assinatura (RS256, as
   chaves públicas do Google), o emissor, o cliente (aud), o prazo, o nonce e o email verificado. Quem não começou o
   pedido neste browser não tem o state nem o nonce: um token alheio não entra (memória bilhete-preso-a-quem-autentica). */
const CHAVES_DO_GOOGLE = 'https://www.googleapis.com/oauth2/v3/certs';
let chavesGuardadas = { em: 0, chaves: null };
async function chavesDoGoogle() {
  if (chavesGuardadas.chaves && Date.now() - chavesGuardadas.em < 3600 * 1000) return chavesGuardadas.chaves;
  const r = await fetch(CHAVES_DO_GOOGLE, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw new Error(`as chaves do Google: HTTP ${r.status}`);
  const j = await r.json();
  chavesGuardadas = { em: Date.now(), chaves: Array.isArray(j.keys) ? j.keys : [] };
  return chavesGuardadas.chaves;
}
const deBase64Url = (t) => {
  const b = String(t).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
export async function verificarTokenDoGoogle(token, { cliente, nonce, agora = Date.now(), chaves = null }) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) return { erro: 'forma' };
  let cab; let carga;
  try {
    cab = JSON.parse(new TextDecoder().decode(deBase64Url(partes[0])));
    carga = JSON.parse(new TextDecoder().decode(deBase64Url(partes[1])));
  } catch { return { erro: 'forma' }; }
  if (cab.alg !== 'RS256' || !cab.kid) return { erro: 'alg' };
  const lista = chaves || await chavesDoGoogle();
  const jwk = lista.find((k) => k && k.kid === cab.kid && k.kty === 'RSA');
  if (!jwk) return { erro: 'chave' };
  let ok = false;
  try {
    const chave = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', chave, deBase64Url(partes[2]), new TextEncoder().encode(`${partes[0]}.${partes[1]}`));
  } catch { ok = false; }
  if (!ok) return { erro: 'assinatura' };
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(carga.iss)) return { erro: 'iss' };
  if (!cliente || carga.aud !== cliente) return { erro: 'aud' };
  if (!(Number(carga.exp) * 1000 > agora - 60 * 1000)) return { erro: 'exp' };
  if (!(Number(carga.iat) * 1000 < agora + 5 * 60 * 1000)) return { erro: 'iat' };
  if (typeof nonce !== 'string' || nonce.length < 16 || carga.nonce !== nonce) return { erro: 'nonce' };
  if (!(carga.email_verified === true || carga.email_verified === 'true')) return { erro: 'email' };
  const email = String(carga.email || '').trim().toLowerCase();
  if (!emailValido(email)) return { erro: 'email' };
  return { email };
}

async function entrarComGoogle(request, env, ip) {
  if (await travado(env, `conta-google:${ip}`)) return json({ erro: 'Demasiadas tentativas. Aguarde um minuto e tente outra vez.' }, 429);
  const cliente = googleDe(env);
  if (!cliente) return json({ erro: 'Entrar com o Google ainda não está disponível. Entre com o email.' }, 503);
  const { corpo, resposta } = await lerCorpoJson(request);
  if (resposta) return resposta;
  let v;
  try { v = await verificarTokenDoGoogle(corpo.id_token, { cliente, nonce: corpo.nonce }); } catch (e) { console.error('Google por conferir', e.message); return json({ erro: POUCO }, 503); }
  if (v.erro) { console.error('token do Google recusado:', v.erro); return json({ erro: 'Não conseguimos entrar com o Google. Tente outra vez, ou entre com o email.' }, 400); }
  const conta = emailDaConta(v.email);
  const id = await idDaConta(conta);
  let r;
  try { r = await pedirAoObjecto(env, 'CONTA', id, { op: 'entrarSemCodigo', email: conta, mostrar: v.email }); } catch (e) { console.error('conta por ler', e.message); return json({ erro: POUCO }, 503); }
  return json({ ok: true }, 200, { 'Set-Cookie': cookieDaSessao(`${id}.${r.segredo}`, SESSAO_DIAS * 86400) });
}

export async function rotaConta(request, env, url, caminho) {
  const sub = caminho.slice('/conta/api'.length);
  const naoPermitido = () => json({ erro: 'Método não permitido.' }, 405);
  if (request.method === 'POST' && !vemDoSite(request, env)) return json({ erro: 'Origem não autorizada.' }, 403);
  const ip = request.headers.get('CF-Connecting-IP') || 'desconhecido';
  if (sub === '/codigo') return request.method === 'POST' ? pedirCodigo(request, env, ip) : naoPermitido();
  if (sub === '/entrar') return request.method === 'POST' ? entrar(request, env, ip) : naoPermitido();
  if (sub === '/eu') return request.method === 'GET' ? eu(request, env) : naoPermitido();
  if (sub === '/encomenda') return request.method === 'GET' ? fichaDaConta(request, env, url) : naoPermitido();
  if (sub === '/sair') return request.method === 'POST' ? sair(request, env) : naoPermitido();
  if (sub === '/dados') return request.method === 'GET' ? verDados(request, env) : request.method === 'POST' ? gravarDados(request, env) : naoPermitido();
  if (sub === '/desistir') return request.method === 'POST' ? desistir(request, env, ip) : naoPermitido();
  if (sub === '/sair-todos') return request.method === 'POST' ? sairTodos(request, env) : naoPermitido();
  if (sub === '/apagar') return request.method === 'POST' ? apagarConta(request, env) : naoPermitido();
  if (sub === '/cartao.svg') return request.method === 'GET' ? qrDoCartao(request, env) : naoPermitido();
  if (sub === '/google') return request.method === 'POST' ? entrarComGoogle(request, env, ip) : naoPermitido();
  return json({ erro: 'Rota desconhecida.' }, 404);
}
