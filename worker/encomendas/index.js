/* LF MOBILE — O WORKER DAS ENCOMENDAS (lfmobile-encomendas). O contrato está em
 * docs/ENCOMENDAS.md; o site (src/scripts/carrinho.js) e o painel foram escritos contra ele.
 *
 *   POST /checkout            a encomenda do site: refaz as contas com o catálogo publicado e grava-a;
 *                             em modo «encomenda», manda os emails e devolve o número e a chave; em
 *                             modo «online», pede o pagamento à ifthenpay pelo método escolhido (MB
 *                             WAY, Multibanco ou cartão) e devolve para onde o browser segue (`proxima`).
 *   GET  /encomenda?e=&c=     o que as páginas «pagar» e «obrigado» mostram (sem dados pessoais); com
 *                             um pagamento por confirmar, pergunta à ifthenpay (pagamento.js, verNaPagina).
 *   POST /pagar               a página de pagamento pede outra vez, ou por outro método: { e, c, metodo }.
 *   GET  /metodos             os métodos ligados (o finalizar mostra só esses).
 *   POST /cupao               o carrinho confere um código: { codigo, linhas, entrega } → a regra
 *                             pública e o desconto, ou 400 com a frase (cupoes.js).
 *   GET  /ifthenpay/callback  a campainha da ifthenpay (sem assinatura: confirma-se sempre com ela).
 *   /painel/…                 as rotas do painel, com o PAINEL_SEGREDO (painel.js).
 *   cron (10 em 10 min)       a varredura dos pagamentos por confirmar (pagamento.js, varrer).
 *   /conta/api/…              a conta do cliente (conta.js): entrar com um código por email e ver as
 *                             encomendas; chega pelo Worker do site (worker/www.js), no domínio.
 *
 * Os pagamentos pela ifthenpay desde 11 nov 2026 (antes, a Stripe); a base é o Worker da ithos·cathelier.
 * Sem dependências npm: fetch puro.
 *
 * SEGREDOS (wrangler secret put; nunca no repositório): PAINEL_SEGREDO, IFTHENPAY_ACCOUNTS,
 * IFTHENPAY_BACKOFFICE_KEY, IFTHENPAY_ANTIPHISHING_KEY, RESEND_API_KEY. As vars estão no wrangler.toml
 * (§7 do contrato).
 */

import { json, lerCorpoJson } from './http.js';
import { lerCatalogo, modoDe, siteUrl } from './catalogo.js';
import { validarPedido, contas as fazerContas, ErroDoPedido, hojeLisboa } from './contas.js';
import { lerCupaoComUsos, porQueNaoVale, publico, libertarUso, reservarUso, normalizarCodigo, acertarCupao, fazerAcerto } from './cupoes.js';
import { criarEncomenda, idLivre, novaChave, lerEncomenda, gravarEncomenda, alterarEncomenda, vistaPublica, iguais, RE_ID, RE_CHAVE, agoraISO } from './encomenda.js';
import { metodosLigados, telemovelMbway, estadoMbway, MBWAY_SEGUNDOS } from './ifthenpay.js';
import { novoPagamento, pedirERegistar, mandarAvisos, confirmar, verNaPagina, vistaDoPagamento, urlDePagar, referenciaViva, podePedirMais, callback, varrer } from './pagamento.js';
import { avisar, falhou, podeAvisarCliente, TRAVADO } from './email.js';
import { rotaPainel } from './painel.js';
import { rotaConta } from './conta.js';

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
  // Sem um método com chave (e a chave de backoffice, que confirma os pagamentos: ifthenpay.js,
  // metodosLigados), não há pagamento no site.
  const ligados = modo === 'online' ? metodosLigados(env) : [];
  if (modo === 'online' && !ligados.length) return json({ erro: 'O pagamento no site não está ligado. Encomende pelo WhatsApp.' }, 503, cors);

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
  // O método (só no pagamento no site): um dos ligados; o MB WAY pede um telemóvel português, conferido
  // ANTES de gravar (um número mal escrito é o erro mais frequente de um formulário).
  let metodo = null, telemovel = null;
  if (modo === 'online') {
    const r = escolherMetodo(corpo.metodo, corpo.telemovel || (corpo.cliente || {}).telefone, ligados);
    if (r.erro) return json(r.erro, 400, cors);
    ({ metodo, telemovel } = r);
  }

  const em = agoraISO();
  const id = await idLivre(env, hoje);
  // O uso do cupão reserva-se já, num passo só no objecto dos cupões (as datas, o mínimo, o limite e o
  // «um por cliente» conferem-se lá): dois clientes no mesmo instante não passam o limite. Volta se a
  // encomenda não se gravar.
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
    // A encomenda primeiro, o pagamento depois: um MB WAY chega logo ao telemóvel, e uma referência
    // conta logo na ifthenpay — têm de ter uma encomenda à espera (o callback e a varredura encontram-na
    // pelo id do pagamento, que vem do número). Se a ifthenpay não criar o pagamento, a encomenda fica à
    // espera, e a página de pagamento diz porquê e deixa tentar outra vez (o uso do cupão fica com ela).
    enc.pagamento = novoPagamento(id, metodo, em);
    try {
      await gravarEncomenda(env, enc, { em });
    } catch (e) {
      console.error('ENCOMENDA NÃO GRAVADA', id, e.message);
      await devolverUso();
      return json({ erro: 'Não foi possível registar a encomenda agora. Tente daqui a pouco ou fale connosco pelo WhatsApp.' }, 503, cors);
    }
    const { enc: comPedido, pedido: p } = await pedirERegistar(env, enc, { metodo, telemovel });
    // A referência Multibanco também vai por email (é a cópia que o cliente leva; e o aviso de recepção
    // da encomenda), antes de responder: num waitUntil um erro não se vê. Com o travão por endereço.
    if (p.multibanco) await mandarAvisos(env, id, ['multibanco'], comPedido);
    const resp = { encomenda: id, chave: enc.chave, estado: 'pendente', total_cents: enc.total_cents, metodo, proxima: p.url || urlDePagar(env, enc), sai: Boolean(p.url) };
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
  const e = url.searchParams.get('e'), c = url.searchParams.get('c') || '';
  if (!e) return json({ erro: 'Falta o número da encomenda.' }, 400, cors);
  if (!RE_ID.test(e) || !RE_CHAVE.test(c)) return json({ erro: 'Encomenda não encontrada.' }, 404, cors);
  let enc = await lerEncomenda(env, e);
  if (!enc || !iguais(enc.chave, c)) return json({ erro: 'Encomenda não encontrada.' }, 404, cors);
  // Com o pagamento por confirmar, a página pergunta à ifthenpay por aqui (com travão por encomenda).
  enc = await verNaPagina(env, enc);
  return json(vistaComPagamento(enc), 200, cors);
}
const vistaComPagamento = (enc) => ({ ...vistaPublica(enc), ...(enc.pagamento ? { pagamento: vistaDoPagamento(enc) } : {}) });

/* ---------------------------------------------------------------- o método de pagamento
   → { metodo, telemovel } ou { erro: o corpo do 400 }. */
function escolherMetodo(bruto, telefone, ligados) {
  const metodo = typeof bruto === 'string' ? bruto.trim().toUpperCase() : '';
  if (!ligados.includes(metodo)) return { erro: { erro: 'Escolha como quer pagar.', campo: 'metodo', metodos: ligados } };
  if (metodo !== 'MBWAY') return { metodo, telemovel: null };
  const telemovel = telemovelMbway(telefone);
  if (!telemovel) return { erro: { erro: 'Para pagar por MB WAY, escreva o seu número de telemóvel português (9 algarismos, a começar por 9).', campo: 'telefone' } };
  return { metodo, telemovel };
}

/* ---------------------------------------------------------------- POST /pagar
   A página de pagamento pede outra vez (o MB WAY recusado ou expirado, o cartão que não se concluiu) ou
   por outro método, na MESMA encomenda: { e, c, metodo, telemovel? } → { proxima, sai } (ou { estado:
   'paga' }). Só com a encomenda «pendente», dentro do prazo, e até MAX_PEDIDOS pedidos (cada MB WAY chega
   ao telemóvel de alguém). Antes, pergunta-se à ifthenpay se já está paga: um MB WAY aceite à última hora
   não se cobra duas vezes. */
const ERRO_DO_PEDIDO = {
  MBWAY: 'Não conseguimos enviar o pedido MB WAY. Confirme que o número tem MB WAY, ou escolha outra forma de pagar.',
  MB: 'Não conseguimos gerar a referência Multibanco agora. Tente outra vez daqui a um minuto, ou escolha outra forma de pagar.',
  CCARD: 'Não conseguimos abrir o pagamento com cartão agora. Tente outra vez daqui a um minuto, ou escolha outra forma de pagar.',
};
async function pagar(request, env, cors) {
  const ip = request.headers.get('CF-Connecting-IP') || 'desconhecido';
  if (await travado(env, ip)) return json({ erro: 'Demasiadas tentativas. Aguarde um minuto e tente outra vez.' }, 429, cors);
  const { corpo, resposta } = await lerCorpoJson(request, cors);
  if (resposta) return resposta;
  const e = String(corpo.e || ''), c = String(corpo.c || '');
  const naoHa = () => json({ erro: 'Encomenda não encontrada.' }, 404, cors);
  if (!RE_ID.test(e) || !RE_CHAVE.test(c)) return naoHa();
  const enc = await lerEncomenda(env, e);
  if (!enc || !iguais(enc.chave, c)) return naoHa();
  if (enc.modo !== 'online' || !enc.pagamento) return json({ erro: 'Esta encomenda não se paga no site.' }, 409, cors);
  const r = escolherMetodo(corpo.metodo, corpo.telemovel || (enc.cliente || {}).telefone, metodosLigados(env));
  if (r.erro) return json(r.erro, 400, cors);
  if (enc.estado !== 'pendente') return json({ erro: enc.estado === 'paga' ? 'Esta encomenda já está paga.' : 'Esta encomenda já não espera pagamento.', estado: enc.estado }, 409, cors);
  const pg = enc.pagamento;
  if (Date.now() >= Date.parse(pg.prazo)) return json({ erro: 'O prazo para pagar esta encomenda acabou. Faça a encomenda outra vez.', estado: enc.estado }, 409, cors);
  if (!podePedirMais(pg)) return json({ erro: 'Já pediu o pagamento desta encomenda muitas vezes. Fale connosco pelo WhatsApp.' }, 429, cors);
  try {
    const conf = await confirmar(env, e);
    if (conf.pago) return json({ estado: (conf.enc || enc).estado, proxima: urlDePagar(env, enc) }, 200, cors);
  } catch (err) {
    console.warn('/pagar: a confirmação falhou em', e, '—', err && err.message);
    return json({ erro: 'Não conseguimos confirmar o pagamento agora. Tente daqui a um minuto.' }, 503, cors);
  }
  // A referência que ainda vale é a mesma (uma referência nova não anula a outra: o cliente podia pagar
  // as duas).
  if (r.metodo === 'MB' && referenciaViva(pg)) return json({ proxima: urlDePagar(env, enc), sai: false }, 200, cors);
  // Um pedido MB WAY ainda à espera na app: dois ao mesmo tempo podiam ser pagos os dois.
  if (r.metodo === 'MBWAY' && pg.mbway && !pg.mbway.estado && Date.now() - Date.parse(pg.mbway.pedido_em) < MBWAY_SEGUNDOS * 1000) {
    let estado = 'pendente';
    try { estado = (await estadoMbway(env, { requestId: pg.mbway.requestId })).estado; } catch (err) { console.warn('/pagar: o estado do MB WAY falhou em', e, err && err.message); }
    if (estado === 'pendente') return json({ erro: 'O pedido anterior ainda está na app MB WAY: aceite-o ou recuse-o primeiro.' }, 409, cors);
    // aceite na app, mas a lista de pagamentos ainda não o tem: outro pedido seria um segundo pagamento
    if (estado === 'pago') return json({ erro: 'O pagamento MB WAY foi aceite: estamos a confirmá-lo. Aguarde uns segundos.' }, 409, cors);
  }
  const { enc: depois, pedido } = await pedirERegistar(env, enc, r);
  if (pedido.erro) return json({ erro: ERRO_DO_PEDIDO[r.metodo] }, 502, cors);
  if (pedido.multibanco) await mandarAvisos(env, e, ['multibanco'], depois);
  return json({ proxima: pedido.url || urlDePagar(env, enc), sai: Boolean(pedido.url) }, 200, cors);
}

/* ---------------------------------------------------------------- o encaminhador */

// os objectos duráveis (wrangler.toml): as encomendas (ENCOMENDA, Encomenda), os cupões (CUPOES, Cupoes),
// o travão dos emails (CONTADOR, Contador) e as contas dos clientes (CONTA, Conta)
export { Encomenda, Contador } from './objecto.js';
export { Cupoes } from './cupoes.js';
export { Conta } from './conta.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const caminho = url.pathname.replace(/\/+$/, '') || '/';
    try {
      // a ifthenpay não é um browser: sem CORS, sem Origin, sem travão (um 403/429 provocava as 13
      // repetições deles sem proveito)
      if (caminho === '/ifthenpay/callback') return request.method === 'GET' ? await callback(url, env, ctx) : new Response('método', { status: 405 });
      if (caminho === '/painel' || caminho.startsWith('/painel/')) return await rotaPainel(request, env, url, caminho);
      if (caminho.startsWith('/conta/api/')) return await rotaConta(request, env, url, caminho);

      const cors = corsDe(request, env);
      if (!cors) return json({ erro: 'Origem não autorizada.' }, 403);
      const publica = ['/checkout', '/encomenda', '/cupao', '/pagar', '/metodos'].includes(caminho);
      if (request.method === 'OPTIONS') return publica ? new Response(null, { status: 204, headers: cors }) : json({ erro: 'Rota desconhecida.' }, 404, cors);
      if (caminho === '/checkout') return request.method === 'POST' ? await checkout(request, env, cors) : json({ erro: 'Método não permitido.' }, 405, cors);
      if (caminho === '/encomenda') return request.method === 'GET' ? await encomenda(url, env, cors) : json({ erro: 'Método não permitido.' }, 405, cors);
      if (caminho === '/pagar') return request.method === 'POST' ? await pagar(request, env, cors) : json({ erro: 'Método não permitido.' }, 405, cors);
      if (caminho === '/metodos') return request.method === 'GET' ? json({ metodos: metodosLigados(env) }, 200, cors) : json({ erro: 'Método não permitido.' }, 405, cors);
      if (caminho === '/cupao') return request.method === 'POST' ? await conferirCupao(request, env, cors) : json({ erro: 'Método não permitido.' }, 405, cors);
      if (caminho === '/') return json({ ok: true, servico: 'lfmobile-encomendas' }, 200, cors);
      return json({ erro: 'Rota desconhecida.' }, 404, cors);
    } catch (e) {
      console.error('erro não previsto', caminho, e && e.stack ? e.stack : e);
      return json({ erro: 'Não conseguimos tratar o pedido agora. Tente outra vez daqui a pouco.' }, 500);
    }
  },

  // A varredura dos pagamentos por confirmar (wrangler.toml, crons): para as encomendas que ninguém
  // está a ver. Um erro aqui não se vê em lado nenhum a não ser no registo: diz-se alto.
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(varrer(env).then((r) => console.log('varredura:', JSON.stringify(r))).catch((e) => console.error('A VARREDURA REBENTOU:', e && e.stack ? e.stack : e)));
  },
};

