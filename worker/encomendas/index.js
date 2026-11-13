/* LF MOBILE — O WORKER DAS ENCOMENDAS (lfmobile-encomendas). O contrato está em
 * docs/ENCOMENDAS.md; o site (src/scripts/carrinho.js) e o painel foram escritos contra ele.
 *
 *   POST /checkout            a encomenda do site: refaz as contas com o catálogo publicado,
 *                             grava no KV e, em modo «encomenda», manda os emails e devolve o
 *                             número e a chave; em modo «online», abre a página segura da Stripe.
 *   GET  /encomenda?e=&c=     o que a página «obrigado» mostra (sem dados pessoais); ou ?s=<sessão>.
 *   POST /cupao               o carrinho confere um código: { codigo, linhas, entrega } → a regra
 *                             pública e o desconto, ou 400 com a frase (cupoes.js).
 *   POST /stripe/webhook      os eventos da Stripe (a fonte da verdade do pagamento).
 *   /painel/…                 as rotas do painel, com o PAINEL_SEGREDO (painel.js).
 *   /conta/api/…              a conta do cliente (conta.js): entrar com um código por email e ver as
 *                             encomendas; chega pelo Worker do site (worker/www.js), no domínio.
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
import { validarPedido, contas as fazerContas, ErroDoPedido, hojeLisboa } from './contas.js';
import { lerCupaoComUsos, porQueNaoVale, publico, libertarUso, reservarUso, normalizarCodigo, acertarCupao, fazerAcerto } from './cupoes.js';
import { criarEncomenda, idLivre, novaChave, lerEncomenda, gravarEncomenda, alterarEncomenda, vistaPublica, iguais, RE_ID, RE_CHAVE, TTL_ENCOMENDA, TTL_EVENTO, agoraISO } from './encomenda.js';
import { criarSessao, stripeFetch, verificarAssinatura, aplicarEvento, idDoEvento, eventoNaoBate } from './stripe.js';
import { avisar, falhou, podeAvisarCliente, TRAVADO } from './email.js';
import { rotaPainel } from './painel.js';
import { rotaConta } from './conta.js';

const JANELA_DE_REENTREGA_SEGUNDOS = 3600;   // até quando vale pedir à Stripe que reentregue
// Os avisos ao cliente sem pagamento, com o travão por endereço (email.js, podeAvisarCliente).
const TRAVADOS = Object.freeze(['expirou', 'falhou', 'multibanco']);

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

  // Uma tentativa repetida (a resposta perdeu-se e a pessoa carregou outra vez) devolve a MESMA
  // encomenda: o carrinho manda um identificador por tentativa (carrinho.js, «pedido»), que muda
  // quando o carrinho ou os dados mudam. Sem ele, segue como sempre.
  const idem = corpo && typeof corpo.pedido === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(corpo.pedido) ? `idem:${corpo.pedido}` : null;
  if (idem) {
    const ja = await env.ORDERS.get(idem);
    if (ja) { try { return json(JSON.parse(ja), 200, cors); } catch (_) { /* estragada: segue como nova */ } }
  }

  let cat;
  try {
    cat = await lerCatalogo(env);
  } catch (e) {
    console.error('catálogo por ler:', e.message);
    return json({ erro: 'Não conseguimos confirmar os preços agora. Tente daqui a um minuto.' }, 503, cors);
  }
  const modo = modoDe(cat, env);
  // Sem a chave, não há pagamento; sem o segredo do webhook, a Stripe cobrava e a encomenda nunca
  // sabia (ficava «pendente», sem aviso a ninguém).
  if (modo === 'online' && (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET)) return json({ erro: 'O pagamento no site não está ligado. Encomende pelo WhatsApp.' }, 503, cors);

  const hoje = hojeLisboa();
  // O cupão: tem de existir e valer hoje, para estes artigos e para este email (o «um por cliente»).
  // Um cupão que deixou de valer recusa a encomenda com campo «cupao»: o carrinho tira-o e refaz a conta.
  let cupao = null;
  if (corpo && corpo.cupao !== undefined && corpo.cupao !== null && corpo.cupao !== '') {
    let lido;
    try { lido = await lerCupaoComUsos(env, corpo.cupao); } catch (e) { console.error('cupões por ler', e.message); return json({ erro: 'Não conseguimos confirmar o cupão agora. Tente daqui a um minuto.' }, 503, cors); }
    cupao = lido.regra;
    let razao = cupao ? null : 'Este cupão não existe ou já não vale.';
    if (!razao) {
      // o mínimo confere-se com os artigos de hoje (as contas sem o cupão, que não recusam por causa
      // dos portes: antes, com portes por confirmar em modo online, o mínimo ficava por conferir)
      let previa = null;
      const zonaDoPedido = (Array.isArray(cat.zonas) ? cat.zonas : []).find((z) => z && z.id === corpo.entrega);
      try { previa = zonaDoPedido ? fazerContas(cat, corpo.linhas, zonaDoPedido, hoje) : null; } catch (_) { /* o erro do pedido diz-se a seguir, sem o cupão */ }
      razao = porQueNaoVale(cupao, { hoje, artigos_cents: previa ? previa.artigos_cents : null, usos: lido.usos });
    }
    if (razao) return json({ erro: `${razao} Tirámo-lo do carrinho: veja o total outra vez.`, campo: 'cupao' }, 400, cors);
  }
  let pedido;
  try {
    pedido = validarPedido(corpo, cat, modo, hoje, { cupao });
  } catch (e) {
    if (e instanceof ErroDoPedido) return json(e.campo ? { erro: e.message, campo: e.campo } : { erro: e.message }, e.status, cors);
    throw e;
  }
  // Um cupão que não dá nada nesta encomenda não se aceita: gastava o uso a troco de nada.
  if (cupao && pedido.contas.cupao_sem_efeito) {
    const porque = cupao.tipo === 'portes'
      ? `O cupão ${cupao.codigo} é de portes grátis e não se aplica a esta encomenda.`
      : `O cupão ${cupao.codigo} não dá desconto nestes artigos (os que já estão em promoção ficam de fora).`;
    return json({ erro: `${porque} Tirámo-lo do carrinho: veja o total outra vez.`, campo: 'cupao' }, 400, cors);
  }
  // O que o site mostrou tem de ser o que se cobra: se um preço mudou entretanto, o carrinho vai
  // buscar o catálogo outra vez e redesenha (campo «precos»).
  if (pedido.contas.total_cents !== corpo.total_cents) return json({ erro: 'Os preços mudaram entretanto. Actualizámos o carrinho: veja o total e envie outra vez.', campo: 'precos' }, 409, cors);

  const em = agoraISO();
  const id = await idLivre(env, hoje);
  // O uso do cupão reserva-se já, num passo só no objecto dos cupões (as datas, o mínimo, o limite e o
  // «um por cliente» conferem-se lá): dois clientes no mesmo instante não passam o limite. Volta se a
  // encomenda não se gravar (ou a Stripe não abrir a página).
  if (cupao) {
    let r;
    try { r = await reservarUso(env, { codigo: cupao.codigo, email: pedido.cliente.email, encomenda: id, hoje, artigos_cents: pedido.contas.artigos_cents }); } catch (e) { console.error('cupão por reservar', id, e.message); return json({ erro: 'Não conseguimos confirmar o cupão agora. Tente daqui a um minuto.' }, 503, cors); }
    if (r.erro) return json({ erro: `${r.erro} Tirámo-lo do carrinho: veja o total outra vez.`, campo: 'cupao' }, 400, cors);
  }
  const devolverUso = async () => { if (cupao) { try { await libertarUso(env, cupao.codigo, pedido.cliente.email, id); } catch (e) { console.error('uso do cupão por devolver', id, e.message); } } };
  const enc = criarEncomenda({ id, chave: novaChave(), modo, estado: modo === 'online' ? 'pendente' : 'registada', zona: pedido.zona, contas: pedido.contas, cliente: pedido.cliente, termosPagina: `${siteUrl(env)}/termos-e-condicoes/`, em });
  // O uso do cupão conta já, nos dois modos (é uma reserva: se o pagamento expirar ou falhar, ou o
  // dono anular a encomenda, o uso volta — libertarUso).
  if (enc.cupao) enc.cupao_contado = true;

  if (modo === 'online') {
    // A sessão da Stripe primeiro, a encomenda depois: um pedido que a Stripe recuse não gasta
    // escritas do KV. E a pessoa só recebe o endereço da página de pagamento com a encomenda
    // já gravada: não paga uma encomenda que não existe.
    let sessao;
    try {
      sessao = await criarSessao(env, enc, pedido.zona);
    } catch (e) {
      console.error('a Stripe não abriu a sessão', id, e.status, e.codigo, e.message);
      await devolverUso();
      return json({ erro: 'Não foi possível abrir o pagamento. Tente outra vez ou fale connosco pelo WhatsApp.' }, 502, cors);
    }
    enc.stripe = { session_id: sessao.id };
    try {
      await gravarEncomenda(env, enc, { em });
      await env.ORDERS.put(`session:${sessao.id}`, id, { expirationTtl: TTL_ENCOMENDA });
    } catch (e) {
      console.error('ENCOMENDA NÃO GRAVADA (KV)', id, sessao.id, e.message);
      await devolverUso();
      return json({ erro: 'Não foi possível registar a encomenda agora. Tente daqui a pouco ou fale connosco pelo WhatsApp.' }, 503, cors);
    }
    const resp = { encomenda: id, chave: enc.chave, url: sessao.url, total_cents: enc.total_cents };
    if (idem) { try { await env.ORDERS.put(idem, JSON.stringify(resp), { expirationTtl: 86400 }); } catch (e) { console.error('tentativa por gravar', id, e.message); } }
    return json(resp, 200, cors);
  }

  try {
    await gravarEncomenda(env, enc, { em });
  } catch (e) {
    console.error('ENCOMENDA NÃO GRAVADA (KV)', id, e.message);
    await devolverUso();
    return json({ erro: 'Não foi possível registar a encomenda agora. Tente daqui a pouco ou fale connosco pelo WhatsApp.' }, 503, cors);
  }
  if (idem) { try { await env.ORDERS.put(idem, JSON.stringify({ encomenda: id, chave: enc.chave, estado: enc.estado, total_cents: enc.total_cents }), { expirationTtl: 86400 }); } catch (e) { console.error('tentativa por gravar', id, e.message); } }
  // Os emails saem antes de responder (num waitUntil um erro não se vê). Uma falha do envio não
  // apaga a encomenda, que já está gravada: fica registada nela, e só então se grava outra vez. O
  // email ao cliente tem travão por endereço (qualquer pessoa pode encomendar com o email de outra):
  // o do dono sai sempre.
  const extras = { cat };
  if (!(await podeAvisarCliente(env, enc.cliente.email))) extras.semCliente = TRAVADO;
  const resultado = await avisar(env, 'registada', enc, extras);
  if (falhou(resultado) || extras.semCliente) {
    if (falhou(resultado)) console.error('EMAIL NÃO ENVIADO', id, JSON.stringify(resultado));
    // o resultado junta-se à encomenda de agora (outra escrita pode ter passado entretanto: o painel)
    try { await alterarEncomenda(env, id, (x) => { x.avisos = { ...(x.avisos || {}), registada: resultado }; return {}; }); } catch (e) { console.error('aviso por gravar', id, e.message); }
  }
  return json({ encomenda: id, chave: enc.chave, estado: enc.estado, total_cents: enc.total_cents }, 200, cors);
}

/* ---------------------------------------------------------------- POST /cupao
   O carrinho confere um código: as contas com os artigos que lá estão (para o mínimo e as
   categorias) e as regras do cupão (as datas, o limite de usos; o «um por cliente» só no
   /checkout, que tem o email). Responde a regra pública e o desconto, para o carrinho fazer a conta.
   O travão é o mesmo do /checkout: adivinhar códigos à força não passa de 5 por minuto. */
async function conferirCupao(request, env, cors) {
  const ip = request.headers.get('CF-Connecting-IP') || 'desconhecido';
  if (await travado(env, ip)) return json({ erro: 'Demasiadas tentativas. Aguarde um minuto e tente outra vez.' }, 429, cors);
  const { corpo, resposta } = await lerCorpoJson(request, cors);
  if (resposta) return resposta;
  const codigo = normalizarCodigo(corpo.codigo);
  if (!codigo) return json({ erro: 'Escreva o código do cupão como está (letras e algarismos).', campo: 'cupao' }, 400, cors);
  let lido;
  try { lido = await lerCupaoComUsos(env, codigo); } catch (e) { console.error('cupões por ler', e.message); return json({ erro: 'Não conseguimos confirmar o cupão agora. Tente daqui a um minuto.' }, 503, cors); }
  const regra = lido.regra;
  if (!regra) return json({ erro: 'Este cupão não existe ou já não vale.', campo: 'cupao' }, 400, cors);
  let cat;
  try { cat = await lerCatalogo(env); } catch (e) { return json({ erro: 'Não conseguimos confirmar o cupão agora. Tente daqui a um minuto.' }, 503, cors); }
  const hoje = hojeLisboa();
  const zona = (Array.isArray(cat.zonas) ? cat.zonas : []).find((z) => z && z.id === corpo.entrega) || (cat.zonas || [])[0];
  let c = null;
  try { c = fazerContas(cat, Array.isArray(corpo.linhas) && corpo.linhas.length ? corpo.linhas : [], zona, hoje, { cupao: regra }); } catch (_) { c = null; }
  const razao = porQueNaoVale(regra, { hoje, artigos_cents: c ? c.artigos_cents : null, usos: lido.usos });
  if (razao) return json({ erro: razao, campo: 'cupao' }, 400, cors);
  const nomes = Object.fromEntries((Array.isArray(cat.categorias) ? cat.categorias : []).map((k) => [k.slug, k.nome]));
  return json({ cupao: publico(regra, nomes), desconto_cents: c ? c.desconto_cents : 0 }, 200, cors);
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
  const primeira = id ? await lerEncomenda(env, id) : null;
  if (!primeira) {
    if (id && RE_ID.test(id)) {
      // Sabemos a encomenda mas ainda não a encontramos (uma de antes do objecto, no KV, que é
      // eventualmente consistente): pede-se reentrega em vez de deitar fora um pagamento.
      const idade = Math.floor(Date.now() / 1000) - (evento.created || 0);
      if (idade < JANELA_DE_REENTREGA_SEGUNDOS) return new Response('encomenda ainda não visível', { status: 409 });
      console.error('ENCOMENDA NÃO ENCONTRADA', id, evento.type, 'ao fim de', idade, 's');
    } else {
      console.log('evento sem encomenda nossa', evento.type, obj.id);
    }
    return new Response('sem encomenda');
  }

  const em = agoraISO();
  // Só os eventos da sessão e do pagamento DESTA encomenda (com o valor dela) mexem nela; os outros
  // ficam no histórico, para o dono ver, e não se repetem.
  const naoBate = eventoNaoBate(primeira, evento);
  if (naoBate) {
    console.error('EVENTO DA STRIPE QUE NÃO BATE COM A ENCOMENDA', id, evento.type, naoBate);
    await alterarEncomenda(env, id, (x) => { x.historico = [...(x.historico || []), { em, estado: x.estado, por: 'stripe', nota: `Evento da Stripe ignorado (${evento.type}): ${naoBate}. Confirme na Stripe.` }]; return {}; }, { em });
    await env.ORDERS.put(marca, '1', { expirationTtl: TTL_EVENTO });
    return new Response('não é desta encomenda');
  }
  /* O evento aplica-se à encomenda como está AGORA (a do objecto dela), e grava-se sem perder outra
     escrita (alterarEncomenda: se outra passou entretanto — o painel, outro evento —, relê-se e
     aplica-se outra vez; o aplicarEvento só depende do estado e do evento). O uso do cupão acerta-se
     na mesma versão (acertarCupao) e chama-se o objecto dos cupões só depois de gravar. */
  const r = await alterarEncomenda(env, id, (x) => {
    const antes = JSON.stringify(x);
    const { avisos } = aplicarEvento(x, evento, em);
    const acerto = acertarCupao(x);
    const mudou = JSON.stringify(x) !== antes;
    return mudou ? { avisos, mudou, acerto } : { avisos, mudou, parar: true };
  }, { em });
  if (!r.enc) return new Response('sem encomenda');
  if (r.acerto) await fazerAcerto(env, r.acerto, r.enc);
  // O índice pi: quando se fica a saber o pagamento (é por ele que um reembolso chega cá).
  const pi = r.enc.stripe && r.enc.stripe.payment_intent;
  if (pi && (await env.ORDERS.get(`pi:${pi}`)) !== id) await env.ORDERS.put(`pi:${pi}`, id, { expirationTtl: TTL_ENCOMENDA });

  // Cada aviso vai uma vez (a marca enc.avisos, lida da encomenda de agora). O resultado junta-se às
  // marcas com outra escrita condicional: nada se perde, e um evento repetido não repete o email. Os
  // emails ao cliente sem pagamento (o «expirou», o «falta pagar» do Multibanco e o «falhou») têm o
  // travão por endereço.
  let enviou = false;
  for (const aviso of r.avisos) {
    const actual = (await lerEncomenda(env, id)) || r.enc;
    if (actual.avisos && actual.avisos[aviso]) continue;
    const extras = { origem: 'stripe' };
    if (TRAVADOS.includes(aviso) && !(await podeAvisarCliente(env, actual.cliente && actual.cliente.email))) extras.semCliente = TRAVADO;
    const resultado = await avisar(env, aviso, actual, extras);
    if (falhou(resultado)) {
      console.error('EMAIL NÃO ENVIADO', aviso, id, JSON.stringify(resultado), '— 500 para a Stripe reentregar');
      return new Response('emails por enviar', { status: 500 });
    }
    await alterarEncomenda(env, id, (x) => { x.avisos = { ...(x.avisos || {}), [aviso]: resultado }; return {}; });
    enviou = true;
  }
  // A marca do evento só quando houve efeitos que não se querem repetir: cada escrita conta.
  if (r.mudou || enviou) await env.ORDERS.put(marca, '1', { expirationTtl: TTL_EVENTO });
  return new Response('ok');
}

/* ---------------------------------------------------------------- o encaminhador */

// os objectos duráveis (wrangler.toml): as encomendas (ENCOMENDA, Encomenda), os cupões (CUPOES, Cupoes),
// o travão dos emails (CONTADOR, Contador) e as contas dos clientes (CONTA, Conta)
export { Encomenda, Contador } from './objecto.js';
export { Cupoes } from './cupoes.js';
export { Conta } from './conta.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const caminho = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (caminho === '/stripe/webhook') return await webhook(request, env);
      if (caminho === '/painel' || caminho.startsWith('/painel/')) return await rotaPainel(request, env, url, caminho);
      if (caminho.startsWith('/conta/api/')) return await rotaConta(request, env, url, caminho);

      const cors = corsDe(request, env);
      if (!cors) return json({ erro: 'Origem não autorizada.' }, 403);
      const publica = caminho === '/checkout' || caminho === '/encomenda' || caminho === '/cupao';
      if (request.method === 'OPTIONS') return publica ? new Response(null, { status: 204, headers: cors }) : json({ erro: 'Rota desconhecida.' }, 404, cors);
      if (caminho === '/checkout') return request.method === 'POST' ? await checkout(request, env, cors) : json({ erro: 'Método não permitido.' }, 405, cors);
      if (caminho === '/encomenda') return request.method === 'GET' ? await encomenda(url, env, cors) : json({ erro: 'Método não permitido.' }, 405, cors);
      if (caminho === '/cupao') return request.method === 'POST' ? await conferirCupao(request, env, cors) : json({ erro: 'Método não permitido.' }, 405, cors);
      if (caminho === '/') return json({ ok: true, servico: 'lfmobile-encomendas' }, 200, cors);
      return json({ erro: 'Rota desconhecida.' }, 404, cors);
    } catch (e) {
      console.error('erro não previsto', caminho, e && e.stack ? e.stack : e);
      return json({ erro: 'Não conseguimos tratar o pedido agora. Tente outra vez daqui a pouco.' }, 500);
    }
  },
};

