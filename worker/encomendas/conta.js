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
 */

import { json, lerCorpoJson } from './http.js';
import { pedirAoObjecto, respostaJson } from './objecto.js';
import { lerEncomenda, vistaPublica, ESTADOS, RE_ID, iguais } from './encomenda.js';
import { enviar, logoDe, marcaDe } from './email.js';
import { siteUrl } from './catalogo.js';
import { limpar, emailValido } from './contas.js';
import { documento, bloco, p, pequeno, caixaCodigo } from './email-html.js';

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
      const segredo = aleatorio(32);
      await s.put(`sessao:${await resumo(segredo)}`, { criada: agora, expira: agora + SESSAO_MS, renovada: agora, mostrar: String(c.mostrar || '').slice(0, 160) });
      await this.aparar(agora);
      await this.prazo(agora);
      return { ok: true, segredo };
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
        await this.prazo(agora);
        renovou = true;
      }
      return { ok: true, email: (await s.get('email')) || '', mostrar: v.mostrar || '', renovou };
    }

    return { erro: 'operação' };
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

  /* O objecto limpa-se sozinho: o alarme fica para depois da sessão mais longa possível. */
  async prazo(agora) {
    await this.ctx.storage.setAlarm(agora + SESSAO_MS + DIA_MS);
  }

  async alarm() {
    const s = this.ctx.storage;
    const agora = Date.now();
    let ultima = 0;
    for (const [k, v] of await s.list({ prefix: 'sessao:' })) {
      if (!v || agora > v.expira) await s.delete(k); else ultima = Math.max(ultima, v.expira);
    }
    if (!ultima) { await s.deleteAll(); return; }
    await s.delete('codigo');
    await s.setAlarm(ultima + DIA_MS);
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
  return { token, email: r.email, mostrar: r.mostrar || r.email, renovou: Boolean(r.renovou) };
}
const semSessao = () => json({ erro: 'Entre outra vez na sua conta.', sessao: false }, 401, { 'Set-Cookie': APAGAR_COOKIE });
const renovar = (s) => (s.renovou ? { 'Set-Cookie': cookieDaSessao(s.token, SESSAO_DIAS * 86400) } : {});

async function eu(request, env) {
  let s;
  try { s = await sessaoDe(request, env); } catch (e) { console.error('sessão por ler', e.message); return json({ erro: POUCO }, 503); }
  if (!s) return semSessao();
  let encomendas;
  try { encomendas = await encomendasDaConta(env, s.email); } catch (e) { console.error('encomendas da conta por ler', e.message); return json({ erro: 'Não conseguimos ler as suas encomendas agora. Tente daqui a pouco.' }, 503); }
  return json({ email: s.mostrar, encomendas }, 200, renovar(s));
}

async function fichaDaConta(request, env, url) {
  let s;
  try { s = await sessaoDe(request, env); } catch (e) { console.error('sessão por ler', e.message); return json({ erro: POUCO }, 503); }
  if (!s) return semSessao();
  const id = url.searchParams.get('e') || '';
  const naoHa = () => json({ erro: 'Não encontrámos esta encomenda na sua conta.' }, 404, renovar(s));
  if (!RE_ID.test(id)) return naoHa();
  let enc;
  try { enc = await lerEncomenda(env, id); } catch (e) { console.error('encomenda por ler', id, e.message); return json({ erro: POUCO }, 503); }
  if (!enc || emailDaConta((enc.cliente || {}).email) !== s.email) return naoHa();
  return json(vistaDaConta(enc), 200, renovar(s));
}

async function sair(request, env) {
  const m = RE_TOKEN.exec(lerCookie(request.headers.get('Cookie'), COOKIE));
  if (m) {
    try { await pedirAoObjecto(env, 'CONTA', m[1], { op: 'sair', resumo: await resumo(m[2]) }); } catch (e) { console.error('sessão por apagar', e.message); }
  }
  return json({ ok: true }, 200, { 'Set-Cookie': APAGAR_COOKIE });
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
  return json({ erro: 'Rota desconhecida.' }, 404);
}
