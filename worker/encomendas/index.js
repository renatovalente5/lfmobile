/* LF MOBILE — O WORKER DAS ENCOMENDAS (lfmobile-encomendas). O contrato está em
 * docs/ENCOMENDAS.md; o site (src/scripts/carrinho.js) e o painel foram escritos contra ele.
 *
 *   POST /checkout            a encomenda do site: refaz as contas com o catálogo publicado,
 *                             grava no KV e, em modo «encomenda», manda os emails e devolve o
 *                             número e a chave; em modo «online», abre a página segura da Stripe.
 *   GET  /encomenda?e=&c=     o que a página «obrigado» mostra (sem dados pessoais); ou ?s=<sessão>.
 *   POST /stripe/webhook      os eventos da Stripe (a fonte da verdade do pagamento).
 *   /painel/…                 as rotas do painel, com o PAINEL_SEGREDO (painel.js).
 *
 * A base é o Worker da Stripe do Armazém dos Pneus (worker/src/index.js): a estrutura dos
 * webhooks, a idempotência por evento, o Checkout hosted em português, o reprice do lado do
 * servidor. Sem dependências npm: fetch puro.
 *
 * SEGREDOS (wrangler secret put; nunca no repositório): PAINEL_SEGREDO, STRIPE_SECRET_KEY,
 * STRIPE_WEBHOOK_SECRET, RESEND_API_KEY. As vars estão no wrangler.toml (§7 do contrato).
 */

import { json, lerCorpoJson } from './http.js';
import { lerCatalogo, modoDe, siteUrl } from './catalogo.js';
import { validarPedido, ErroDoPedido, hojeLisboa } from './contas.js';
import { criarEncomenda, idLivre, novaChave, lerEncomenda, gravarEncomenda, vistaPublica, iguais, RE_ID, RE_CHAVE, TTL_ENCOMENDA, TTL_EVENTO, agoraISO } from './encomenda.js';
import { criarSessao, stripeFetch, verificarAssinatura, aplicarEvento, idDoEvento } from './stripe.js';
import { avisar, falhou } from './email.js';
import { rotaPainel } from './painel.js';

const JANELA_DE_REENTREGA_SEGUNDOS = 3600;   // até quando vale pedir à Stripe que reentregue

/* ---------------------------------------------------------------- CORS
   Só as origens de ALLOWED_ORIGINS. Um pedido SEM Origin (o curl, um servidor) não é um pedido
   entre origens: segue sem cabeçalhos CORS. Um pedido com uma origem desconhecida, 403. */
const origensDe = (env) => String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
function corsDe(request, env) {
  const origem = request.headers.get('Origin');
  if (!origem) return {};
  if (!origensDe(env).includes(origem)) return null;
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/* ---------------------------------------------------------------- o travão do /checkout
   Primeiro o da Cloudflare (o binding TRAVAO_CHECKOUT, 5 por minuto por IP, contado em todas as
   localizações); se o binding faltar ou falhar, vale o de memória, que só trava este isolate.
   Cada /checkout aceite grava no KV, e a quota de escritas é da conta inteira. */
const batidas = new Map();
function travadoEmMemoria(ip, agora = Date.now()) {
  const r = batidas.get(ip);
  if (!r || agora - r.inicio > 60_000) { batidas.set(ip, { inicio: agora, n: 1 }); return false; }
  r.n += 1;
  if (batidas.size > 5000) batidas.clear();
  return r.n > 10;
}
async function travado(env, ip) {
  if (env.TRAVAO_CHECKOUT && typeof env.TRAVAO_CHECKOUT.limit === 'function') {
    try {
      const { success } = await env.TRAVAO_CHECKOUT.limit({ key: `checkout:${ip}` });
      if (!success) return true;
    } catch (e) {
      console.error('travão da Cloudflare falhou (vale o de memória):', e.message);
    }
  }
  return travadoEmMemoria(ip);
}

/* ---------------------------------------------------------------- POST /checkout */

async function checkout(request, env, cors) {
  const ip = request.headers.get('CF-Connecting-IP') || 'desconhecido';
  if (await travado(env, ip)) return json({ erro: 'Demasiadas tentativas. Aguarde um minuto e tente outra vez.' }, 429, cors);
  const { corpo, resposta } = await lerCorpoJson(request, cors);
  if (resposta) return resposta;

  let cat;
  try {
    cat = await lerCatalogo(env);
  } catch (e) {
    console.error('catálogo por ler:', e.message);
    return json({ erro: 'Não conseguimos confirmar os preços agora. Tente daqui a um minuto.' }, 503, cors);
  }
  const modo = modoDe(cat, env);
  if (modo === 'online' && !env.STRIPE_SECRET_KEY) return json({ erro: 'O pagamento no site não está ligado. Encomende pelo WhatsApp.' }, 503, cors);

  const hoje = hojeLisboa();
  let pedido;
  try {
    pedido = validarPedido(corpo, cat, modo, hoje);
  } catch (e) {
    if (e instanceof ErroDoPedido) return json(e.campo ? { erro: e.message, campo: e.campo } : { erro: e.message }, e.status, cors);
    throw e;
  }
  // O que o site mostrou tem de ser o que se cobra: se um preço mudou entretanto, o site redesenha.
  if (pedido.contas.total_cents !== corpo.total_cents) return json({ erro: 'Os preços mudaram. Veja o carrinho outra vez.' }, 409, cors);

  const em = agoraISO();
  const id = await idLivre(env, hoje);
  const enc = criarEncomenda({ id, chave: novaChave(), modo, estado: modo === 'online' ? 'pendente' : 'registada', zona: pedido.zona, contas: pedido.contas, cliente: pedido.cliente, termosPagina: `${siteUrl(env)}/termos-e-condicoes/`, em });

  if (modo === 'online') {
    // A sessão da Stripe primeiro, a encomenda depois: um pedido que a Stripe recuse não gasta
    // escritas do KV. E a pessoa só recebe o endereço da página de pagamento com a encomenda
    // já gravada: não paga uma encomenda que não existe.
    let sessao;
    try {
      sessao = await criarSessao(env, enc, pedido.zona);
    } catch (e) {
      console.error('a Stripe não abriu a sessão', id, e.status, e.codigo, e.message);
      return json({ erro: 'Não foi possível abrir o pagamento. Tente outra vez ou fale connosco pelo WhatsApp.' }, 502, cors);
    }
    enc.stripe = { session_id: sessao.id };
    try {
      await gravarEncomenda(env, enc, { em });
      await env.ORDERS.put(`session:${sessao.id}`, id, { expirationTtl: TTL_ENCOMENDA });
    } catch (e) {
      console.error('ENCOMENDA NÃO GRAVADA (KV)', id, sessao.id, e.message);
      return json({ erro: 'Não foi possível registar a encomenda agora. Tente daqui a pouco ou fale connosco pelo WhatsApp.' }, 503, cors);
    }
    return json({ encomenda: id, chave: enc.chave, url: sessao.url, total_cents: enc.total_cents }, 200, cors);
  }

  try {
    await gravarEncomenda(env, enc, { em });
  } catch (e) {
    console.error('ENCOMENDA NÃO GRAVADA (KV)', id, e.message);
    return json({ erro: 'Não foi possível registar a encomenda agora. Tente daqui a pouco ou fale connosco pelo WhatsApp.' }, 503, cors);
  }
  // Os emails saem antes de responder (num waitUntil um erro não se vê). Uma falha do Resend não
  // apaga a encomenda, que já está gravada: fica registada nela, e só então se grava outra vez.
  const resultado = await avisar(env, 'registada', enc, { cat });
  if (falhou(resultado)) {
    console.error('EMAIL NÃO ENVIADO', id, JSON.stringify(resultado));
    enc.avisos = { registada: resultado };
    try { await gravarEncomenda(env, enc); } catch (e) { console.error('aviso por gravar', id, e.message); }
  }
  return json({ encomenda: id, chave: enc.chave, estado: enc.estado, total_cents: enc.total_cents }, 200, cors);
}

/* ---------------------------------------------------------------- GET /encomenda */

async function encomenda(url, env, cors) {
  const e = url.searchParams.get('e'), c = url.searchParams.get('c') || '', s = url.searchParams.get('s');
  const naoHa = () => json({ erro: 'Encomenda não encontrada.' }, 404, cors);
  if (e) {
    if (!RE_ID.test(e) || !RE_CHAVE.test(c)) return naoHa();
    const enc = await lerEncomenda(env, e);
    if (!enc || !iguais(enc.chave, c)) return naoHa();
    return json(vistaPublica(enc), 200, cors);
  }
  if (s) {
    // Só por sessões que este Worker abriu (o índice session:): não serve de procurador à Stripe.
    if (!/^cs_[A-Za-z0-9_]{10,}$/.test(s)) return naoHa();
    const id = await env.ORDERS.get(`session:${s}`);
    const enc = id ? await lerEncomenda(env, id) : null;
    if (!enc) return naoHa();
    const vista = vistaPublica(enc);
    // A pessoa aterra na página «obrigado» segundos depois de pagar, antes de o webhook chegar: a
    // sessão é a fonte mais fresca. Só promove o que se mostra (o KV é do webhook), e só para a
    // frente: uma encomenda já reembolsada não volta a «paga».
    if (vista.estado === 'pendente' && env.STRIPE_SECRET_KEY) {
      try {
        const sessao = await stripeFetch(env, `/checkout/sessions/${encodeURIComponent(s)}`, { method: 'GET' });
        if (sessao.payment_status && sessao.payment_status !== 'unpaid') vista.estado = 'paga';
      } catch (err) {
        console.error('sessão por ler', s, err.message);
      }
    }
    return json(vista, 200, cors);
  }
  return json({ erro: 'Falta o número da encomenda.' }, 400, cors);
}

/* ---------------------------------------------------------------- POST /stripe/webhook
   Sem CORS, sem Origin, sem travão: a Stripe não é um browser, e um 403/429 provocava
   reentregas sem fim. O estado grava-se ANTES do 200 (num waitUntil, uma falha perdia o
   pagamento), as marcas gravam-se DEPOIS de aplicar e de enviar (antes, uma reentrega
   encontrava a marca e engolia o evento). */
async function webhook(request, env) {
  if (request.method !== 'POST') return new Response('método', { status: 405 });
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('webhook por ligar', { status: 503 });
  const bruto = await request.text();   // UMA vez: a assinatura é sobre os bytes crus
  let evento;
  try {
    evento = await verificarAssinatura(bruto, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
  } catch (e) {
    console.error('webhook rejeitado:', e.message);
    return new Response('assinatura inválida', { status: 400 });
  }
  const marca = `evt:${evento.id}`;
  if (await env.ORDERS.get(marca)) return new Response('repetido');

  const obj = (evento.data && evento.data.object) || {};
  const id = await idDoEvento(env, obj);
  const enc = id ? await lerEncomenda(env, id) : null;
  if (!enc) {
    if (id && RE_ID.test(id)) {
      // Sabemos a encomenda mas o KV ainda não a mostra (é eventualmente consistente, e a Stripe
      // entrega em segundos): pede-se reentrega em vez de deitar fora um pagamento.
      const idade = Math.floor(Date.now() / 1000) - (evento.created || 0);
      if (idade < JANELA_DE_REENTREGA_SEGUNDOS) return new Response('encomenda ainda não visível', { status: 409 });
      console.error('ENCOMENDA NÃO ENCONTRADA', id, evento.type, 'ao fim de', idade, 's');
    } else {
      console.log('evento sem encomenda nossa', evento.type, obj.id);
    }
    return new Response('sem encomenda');
  }

  const em = agoraISO();
  const antes = JSON.stringify(enc);
  const { avisos } = aplicarEvento(enc, evento, em);
  // O índice pi: quando se fica a saber o pagamento (é por ele que um reembolso chega cá).
  const pi = enc.stripe && enc.stripe.payment_intent;
  if (pi && (await env.ORDERS.get(`pi:${pi}`)) !== id) await env.ORDERS.put(`pi:${pi}`, id, { expirationTtl: TTL_ENCOMENDA });
  let mudou = JSON.stringify(enc) !== antes;
  if (mudou) await gravarEncomenda(env, enc, { em });

  // Cada aviso vai uma vez (a marca enc.avisos). Relê-se antes de cada envio: um evento que chegue
  // ao mesmo tempo pode já ter avisado. A janela não fecha de todo (o KV não tem escrita
  // condicional): antes um email repetido, que se vê, do que um que nunca sai.
  let enviou = false;
  for (const aviso of avisos) {
    const actual = (await lerEncomenda(env, id)) || enc;
    const marcas = { ...(enc.avisos || {}), ...(actual.avisos || {}) };
    if (marcas[aviso]) { enc.avisos = marcas; continue; }
    const resultado = await avisar(env, aviso, { ...actual, ...enc, avisos: marcas }, { origem: 'stripe' });
    if (falhou(resultado)) {
      console.error('EMAIL NÃO ENVIADO', aviso, id, JSON.stringify(resultado), '— 500 para a Stripe reentregar');
      return new Response('emails por enviar', { status: 500 });
    }
    enc.avisos = { ...marcas, [aviso]: resultado };
    enviou = true;
  }
  if (enviou) await gravarEncomenda(env, enc);
  // A marca do evento só quando houve efeitos que não se querem repetir: cada escrita conta.
  if (mudou || enviou) await env.ORDERS.put(marca, '1', { expirationTtl: TTL_EVENTO });
  return new Response('ok');
}

/* ---------------------------------------------------------------- o encaminhador */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const caminho = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (caminho === '/stripe/webhook') return await webhook(request, env);
      if (caminho === '/painel' || caminho.startsWith('/painel/')) return await rotaPainel(request, env, url, caminho);

      const cors = corsDe(request, env);
      if (!cors) return json({ erro: 'Origem não autorizada.' }, 403);
      const publica = caminho === '/checkout' || caminho === '/encomenda';
      if (request.method === 'OPTIONS') return publica ? new Response(null, { status: 204, headers: cors }) : json({ erro: 'Rota desconhecida.' }, 404, cors);
      if (caminho === '/checkout') return request.method === 'POST' ? await checkout(request, env, cors) : json({ erro: 'Método não permitido.' }, 405, cors);
      if (caminho === '/encomenda') return request.method === 'GET' ? await encomenda(url, env, cors) : json({ erro: 'Método não permitido.' }, 405, cors);
      if (caminho === '/') return json({ ok: true, servico: 'lfmobile-encomendas' }, 200, cors);
      return json({ erro: 'Rota desconhecida.' }, 404, cors);
    } catch (e) {
      console.error('erro não previsto', caminho, e && e.stack ? e.stack : e);
      return json({ erro: 'Não conseguimos tratar o pedido agora. Tente outra vez daqui a pouco.' }, 500);
    }
  },
};

