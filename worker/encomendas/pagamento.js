/* O PAGAMENTO NO SITE PELA IFTHENPAY (11 nov 2026; antes era a Stripe): o que liga uma encomenda aos
 * pagamentos que a ifthenpay recebe. O cliente fica no site: a referência Multibanco e a espera do MB WAY
 * mostram-se na página /pagar/; só o cartão sai para o formulário alojado da ifthenpay. O mesmo desenho da
 * ithos·cathelier (ithos-cathelier-api/src/index.js: confirmar, callback, varrer).
 *
 * QUEM DECIDE QUE UMA ENCOMENDA ESTÁ PAGA É A IFTHENPAY, perguntada aqui (confirmar → /v2/payments/read
 * pelo id do pagamento, com o valor conferido). Quatro coisas empurram essa pergunta, e todas passam por
 * confirmar(): o callback (uma campainha sem assinatura), a página de pagamento (enquanto o cliente olha),
 * a varredura (de 10 em 10 minutos, para as que ninguém está a ver: a loja não depende dos callbacks
 * estarem activos no backoffice deles) e nada mais. Cada mudança grava-se no objecto da encomenda com a
 * versão (alterarEncomenda): um pagamento nunca apaga uma anulação nem uma nota, e vice-versa.
 *
 * A encomenda leva `pagamento`:
 *   { id: 'LF261111ABCDEF'            o orderId na ifthenpay (ifthenpay.js, idDePagamento)
 *     metodo: 'MBWAY'|'MB'|'CCARD'    o do último pedido
 *     prazo: ISO                      até quando se espera o pagamento (prazos.js); depois, «expirou»
 *     pedidos: [{ metodo, em, requestId?, erro? }]
 *     multibanco: { entidade, referencia, expira, requestId, pedido_em }
 *     mbway: { requestId, pedido_em, estado? }      cartao: { requestId, pedido_em }
 *     pago_em, pago_cents, metodo_pago, requestId_pago, referencia_pago, recebido_cents, pagamentos
 *     reembolsado_cents, reembolsos: [{ em, cents, como, por }], reembolso: { em, cents, estado } }
 */

import { lerEncomenda, alterarEncomenda, mudarEstado, agoraISO } from './encomenda.js';
import { siteUrl } from './catalogo.js';
import { acertarCupao, fazerAcerto } from './cupoes.js';
import { avisar, falhou, podeAvisarCliente, TRAVADO, eur } from './email.js';
import * as I from './ifthenpay.js';
import { PRAZO_MINUTOS, DIAS_MULTIBANCO, MAX_PEDIDOS } from './prazos.js';

/* Os estados que um pagamento ainda pode promover a «paga». Os outros já são posteriores (o dono marcou a
   encomenda, ou anulou-a): um pagamento que chegue fica no histórico e avisa o dono (paga-fora). */
const PODE_FICAR_PAGA = ['pendente', 'registada', 'falhou', 'expirou'];
/* Os avisos ao cliente sem pagamento, com o travão por endereço (email.js, podeAvisarCliente). */
const TRAVADOS = Object.freeze(['expirou', 'falhou', 'multibanco']);

export const nomeDoMetodo = (m) => I.NOMES[m] || m || '—';

/* ---------------------------------------------------------------- criar */

export function novoPagamento(numero, metodo, em = agoraISO()) {
  return { id: I.idDePagamento(numero), metodo, prazo: new Date(Date.parse(em) + PRAZO_MINUTOS * 60000).toISOString(), pedidos: [] };
}

/* Até quando uma referência pode ser paga: até ao fim do dia em que expira (em Lisboa, uma hora à frente
   do UTC no verão) e mais doze horas para o aviso chegar. Sem data, os dias que se pediram mais um. */
export function fimDaReferencia(expira, em) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(expira || ''))) return Date.parse(`${expira}T23:59:59Z`) + 13 * 3600000;
  return Date.parse(em) + (DIAS_MULTIBANCO + 1) * 86400000;
}
export const referenciaViva = (pg, agora = Date.now()) => Boolean(pg && pg.multibanco && pg.multibanco.referencia && agora < fimDaReferencia(pg.multibanco.expira, pg.multibanco.pedido_em));

export const urlDePagar = (env, enc, extra = '') => `${siteUrl(env)}/pagar/?e=${encodeURIComponent(enc.encomenda)}&c=${encodeURIComponent(enc.chave)}${extra}`;

/* Pede o pagamento à ifthenpay (só rede: não grava). → o pedido, para registarPedido; com `erro` quando a
   ifthenpay não o criou (a encomenda fica à espera, e a página de pagamento deixa tentar outra vez). */
export async function pedirAIfthenpay(env, enc, { metodo, telemovel }) {
  const em = agoraISO();
  const id = enc.pagamento.id;
  const cents = enc.total_cents;
  const descricao = `${env.STORE_NAME || 'LF Mobile'} ${enc.encomenda}`;
  try {
    if (metodo === 'MBWAY') {
      const r = await I.criarMbway(env, { id, cents, telemovel, descricao });
      return { metodo, em, requestId: r.requestId };
    }
    if (metodo === 'MB') {
      const r = await I.criarMultibanco(env, { id, cents, descricao, dias: DIAS_MULTIBANCO });
      return { metodo, em, requestId: r.requestId, multibanco: { entidade: r.entidade, referencia: r.referencia, expira: r.expira } };
    }
    if (metodo === 'CCARD') {
      // a ifthenpay volta a /pagar/ (que pergunta o estado e sabe mostrar as três respostas) e junta id,
      // amount e requestId ao endereço; o `cartao` diz à página como correu
      const r = await I.criarCartao(env, { id, cents, urls: { sucesso: urlDePagar(env, enc, '&cartao=ok'), erro: urlDePagar(env, enc, '&cartao=erro'), cancelado: urlDePagar(env, enc, '&cartao=cancelado') } });
      return { metodo, em, requestId: r.requestId, url: r.url };
    }
    throw new Error(`método desconhecido: ${metodo}`);
  } catch (e) {
    console.error('A IFTHENPAY NÃO CRIOU O PAGAMENTO', enc.encomenda, metodo, e.estado ?? '', e.message);
    return { metodo, em, erro: e && e.ifthenpay ? `ifthenpay ${e.estado}` : 'sem resposta' };
  }
}

/* O pedido na encomenda (puro: repete-se dentro de alterarEncomenda). O prazo só cresce. */
export function registarPedido(x, p) {
  const pg = x.pagamento;
  pg.pedidos = [...(pg.pedidos || []), { metodo: p.metodo, em: p.em, ...(p.requestId ? { requestId: p.requestId } : {}), ...(p.erro ? { erro: p.erro } : {}) }];
  if (p.erro) return;
  pg.metodo = p.metodo;
  const t = Date.parse(p.em);
  let prazo = Date.parse(pg.prazo) || t;
  if (p.metodo === 'MB') {
    pg.multibanco = { ...p.multibanco, requestId: p.requestId || null, pedido_em: p.em };
    prazo = Math.max(prazo, fimDaReferencia(p.multibanco.expira, p.em));
  } else if (p.metodo === 'MBWAY') {
    pg.mbway = { requestId: p.requestId, pedido_em: p.em };
    prazo = Math.max(prazo, t + (I.MBWAY_SEGUNDOS + 120) * 1000);
  } else if (p.metodo === 'CCARD') {
    pg.cartao = { requestId: p.requestId || null, pedido_em: p.em };
    prazo = Math.max(prazo, t + 30 * 60000);
  }
  pg.prazo = new Date(prazo).toISOString();
}

export const pedidosFeitos = (pg) => ((pg && pg.pedidos) || []).length;
export const podePedirMais = (pg) => pedidosFeitos(pg) < MAX_PEDIDOS;

/* Pedir e registar: a rede primeiro, a escrita depois (com a versão). → { enc, pedido }. Uma escrita que
   falhe depois de a ifthenpay criar o pagamento não o perde: o id do pagamento vem do número da encomenda,
   e confirmar() encontra-o na mesma. */
export async function pedirERegistar(env, enc, { metodo, telemovel }) {
  const pedido = await pedirAIfthenpay(env, enc, { metodo, telemovel });
  const r = await alterarEncomenda(env, enc.encomenda, (x) => { registarPedido(x, pedido); return {}; });
  return { enc: r.enc || enc, pedido };
}

/* ---------------------------------------------------------------- confirmar */

/* O pagamento confirmado na encomenda (puro). → os avisos que ele pede (quem decide se cada um ainda vai é
   mandarAvisos, pela marca enc.avisos). */
export function aplicarPagamento(x, v, em) {
  const pg = x.pagamento;
  const avisos = [];
  if (!pg.pago_em) {
    if (PODE_FICAR_PAGA.includes(x.estado)) {
      mudarEstado(x, 'paga', { por: 'ifthenpay', em, nota: nomeDoMetodo(v.metodo || pg.metodo) });
      pg.aviso = 'paga';
    } else {
      // já não se esperava (o dono anulou-a, ou marcou-a paga à mão): nada de «Pagamento recebido» ao
      // cliente nem de «prepare a encomenda» ao dono; o dono é avisado para devolver, se não segue
      x.historico = [...(x.historico || []), { em, estado: x.estado, por: 'ifthenpay', nota: `A ifthenpay recebeu ${eur(v.cents)} (${nomeDoMetodo(v.metodo)}) com a encomenda «${x.estado}»: confirme e, se não segue, devolva o dinheiro.` }];
      pg.aviso = 'paga-fora';
    }
    pg.pago_em = em;
    pg.pago_cents = v.cents;
    pg.metodo_pago = v.metodo || pg.metodo;
    if (v.requestId) pg.requestId_pago = v.requestId;
    if (v.referencia) pg.referencia_pago = v.referencia;
  }
  avisos.push(pg.aviso || 'paga');
  // Dois pagamentos para a mesma encomenda (pagou o MB WAY e depois a referência): o que está a mais
  // devolve-se. Diz-se no histórico a cada pagamento novo, e o dono é avisado uma vez.
  const antes = pg.recebido_cents || 0;
  if (v.recebido_cents > antes) {
    pg.recebido_cents = v.recebido_cents;
    pg.pagamentos = v.n;
    if (v.recebido_cents > x.total_cents) {
      x.historico = [...(x.historico || []), { em, estado: x.estado, por: 'ifthenpay', nota: `Recebidos ${v.n} pagamentos (${eur(v.recebido_cents)}) para uma encomenda de ${eur(x.total_cents)}: devolva ${eur(v.recebido_cents - x.total_cents)} ao cliente.` }];
      avisos.push('pago-a-mais');
    }
  }
  return avisos;
}

/* Manda os avisos que ainda não foram (a marca enc.avisos), cada um uma vez, e junta o resultado com uma
   escrita condicional. Com `reenviarFalhados` (o callback, que a ifthenpay repete), um aviso que falhou
   volta a ir — só a quem falhou. → { enc, falhou } */
export async function mandarAvisos(env, numero, avisos, enc, { origem = 'ifthenpay', reenviarFalhados = false } = {}) {
  let actual = enc;
  let algumFalhou = false;
  for (const aviso of avisos) {
    actual = (await lerEncomenda(env, numero)) || actual;
    const feito = actual.avisos && actual.avisos[aviso];
    let apenas = null;
    if (feito) {
      if (!reenviarFalhados || !falhou(feito)) continue;
      apenas = feito.cliente === 'falhou' && feito.dono !== 'falhou' ? 'cliente' : feito.dono === 'falhou' && feito.cliente !== 'falhou' ? 'dono' : null;
    }
    const extras = { origem, ...(apenas ? { apenas } : {}) };
    if (TRAVADOS.includes(aviso) && !(await podeAvisarCliente(env, actual.cliente && actual.cliente.email))) extras.semCliente = TRAVADO;
    const resultado = await avisar(env, aviso, actual, extras);
    const junto = feito && apenas ? { ...feito, em: resultado.em, [apenas]: resultado[apenas] } : resultado;
    if (falhou(junto)) { algumFalhou = true; console.error('EMAIL NÃO ENVIADO', aviso, numero, JSON.stringify(junto)); }
    const r = await alterarEncomenda(env, numero, (x) => { x.avisos = { ...(x.avisos || {}), [aviso]: junto }; return {}; });
    if (r.enc) actual = r.enc;
  }
  return { enc: actual, falhou: algumFalhou };
}

/* PERGUNTAR À IFTHENPAY SE ESTA ENCOMENDA ESTÁ PAGA, e gravar o que ela disser. Nunca lança por não estar
   paga («ainda não pagou» é o normal de um Multibanco); lança se não se conseguir perguntar (quem chama
   decide: o callback pede que repitam, a varredura tenta na passagem seguinte). → { enc, pago, falhou }
   `mbwayAceite`: o requestId de um pedido MB WAY cujo estado quem chama ACABOU de perguntar à ifthenpay e veio
   «pago» (estadoMbway, com a nossa chave MB WAY). */
export async function confirmar(env, numero, { origem = 'ifthenpay', reenviarFalhados = false, mbwayAceite = null } = {}) {
  const enc = await lerEncomenda(env, numero);
  if (!enc || !enc.pagamento || !enc.pagamento.id) return { enc, pago: false };
  const pg = enc.pagamento;
  let v = I.conferir(await I.lerPagamento(env, { orderId: pg.id }), { cents: enc.total_cents });
  // a segunda fonte, só do Multibanco (ifthenpay.js, listarMultibanco): uma falha a perguntar não derruba
  // a resposta que já temos
  if (!v.pago && pg.multibanco) {
    try {
      const v2 = I.conferir(I.pagosDaLista(await I.listarMultibanco(env, { orderId: pg.id })), { cents: enc.total_cents });
      if (v2.pago) { console.warn('pagamento visto pelo /multibanco/reference/list e NÃO pelo /v2/payments/read:', numero); v = v2; }
    } catch (e) { console.warn('a lista do Multibanco falhou em', numero, e.message); }
  }
  // O MB WAY ACEITE NA APP, antes de a lista de pagamentos o ter (20 nov 2026, o pagamento de prova: o estado do
  // pedido disse «pago» às 19:13:45 e a lista só às 19:13:54; o cliente ficou à espera, e o callback das 19:13:52
  // levou um 409, que a ifthenpay só repete 5 minutos depois). O estado vem da ifthenpay, pedido com a nossa chave,
  // e o pedido é desta encomenda e deste valor (pedirAIfthenpay pede o total): vale como pago. Quando a lista o
  // tiver, a varredura e o callback já não mudam nada (aplicarPagamento só junta o que faltar).
  if (!v.pago && mbwayAceite && pedidoMbwayDaEncomenda(pg, mbwayAceite)) {
    v = { pago: true, cents: enc.total_cents, metodo: 'MBWAY', requestId: mbwayAceite, referencia: pg.id, recebido_cents: enc.total_cents, n: 1 };
    console.log('MB WAY aceite na app, ainda fora da lista de pagamentos:', numero);
  }
  if (!v.pago) return { enc, pago: false };
  const em = agoraISO();
  const r = await alterarEncomenda(env, numero, (x) => {
    if (!x.pagamento) return { parar: true, avisos: [] };
    const antes = JSON.stringify(x);
    const avisos = aplicarPagamento(x, v, em);
    // o uso do cupão acerta-se na mesma versão (uma «expirou» que afinal foi paga volta a contá-lo); o
    // objecto dos cupões chama-se depois de gravar
    const acerto = acertarCupao(x);
    return JSON.stringify(x) !== antes ? { avisos, acerto } : { avisos, parar: true };
  }, { em });
  if (!r.enc) return { enc: null, pago: true };
  if (r.acerto) await fazerAcerto(env, r.acerto, r.enc);
  const envio = await mandarAvisos(env, numero, r.avisos || [], r.enc, { origem, reenviarFalhados });
  return { enc: envio.enc, pago: true, falhou: envio.falhou };
}

/* O PRAZO ACABOU SEM PAGAMENTO: «expirou», o uso do cupão volta, e o cliente é avisado (com o travão). Só
   se ainda estiver «pendente» e o prazo tiver passado (a de agora, no objecto). */
export async function expirar(env, numero, { agora = Date.now() } = {}) {
  const em = new Date(agora).toISOString();
  const r = await alterarEncomenda(env, numero, (x) => {
    if (x.estado !== 'pendente' || !x.pagamento || agora < Date.parse(x.pagamento.prazo)) return { parar: true };
    mudarEstado(x, 'expirou', { por: 'ifthenpay', em, nota: 'O prazo para pagar acabou sem pagamento.' });
    return { acerto: acertarCupao(x), mudou: true };
  }, { em });
  if (!r.mudou) return r.enc;
  if (r.acerto) await fazerAcerto(env, r.acerto, r.enc);
  return (await mandarAvisos(env, numero, ['expirou'], r.enc)).enc;
}

/* ---------------------------------------------------------------- a varredura (cron, de 10 em 10 min)
   Para as encomendas que ninguém está a ver: um Multibanco pago às duas da manhã, três dias depois, sem a
   página aberta e com o callback por activar. As candidatas saem dos metadados da lista (encomenda.js,
   metadadosDe: `prazo` só existe enquanto se espera um pagamento no site): as «pendente», e as anuladas
   (ou marcadas pagas à mão) com uma referência ainda a valer — essas, para o dono saber se o cliente
   pagou na mesma. As mais recentes primeiro, VARRER_MAX por passagem (cada uma custa uma ou duas
   perguntas à ifthenpay). Passado o prazo, uma última pergunta e depois «expirou». */
export const VARRER_MAX = 25;
export async function varrer(env, agora = Date.now()) {
  if (!env.IFTHENPAY_BACKOFFICE_KEY) return { visitadas: 0, motivo: 'sem a chave de backoffice' };
  const chaves = [];
  let cursor;
  do {
    const r = await env.ORDERS.list({ prefix: 'order:', cursor, limit: 1000 });
    chaves.push(...(r.keys || []));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  const candidatas = chaves.filter((k) => {
    const m = k.metadata;
    if (!m || m.modo !== 'online' || !m.prazo) return false;
    return m.estado === 'pendente' || agora < Date.parse(m.prazo);
  }).sort((a, b) => String(b.metadata.criada_em || '').localeCompare(String(a.metadata.criada_em || '')));
  const fatia = candidatas.slice(0, VARRER_MAX);
  let pagas = 0, expiradas = 0, falhas = 0;
  for (const k of fatia) {
    const numero = k.name.replace(/^order:/, '');
    try {
      const r = await confirmar(env, numero);
      if (r.pago) { pagas++; continue; }
      if (r.enc && r.enc.estado === 'pendente' && r.enc.pagamento && agora >= Date.parse(r.enc.pagamento.prazo)) {
        const depois = await expirar(env, numero, { agora });
        if (depois && depois.estado === 'expirou') expiradas++;
      }
    } catch (e) {
      falhas++;
      console.warn('varredura: falhou em', numero, '—', e && e.message);
    }
  }
  if (candidatas.length > VARRER_MAX) console.warn(`varredura: ${candidatas.length} candidatas e só ${VARRER_MAX} por passagem`);
  return { candidatas: candidatas.length, visitadas: fatia.length, pagas, expiradas, falhas };
}

/* ---------------------------------------------------------------- o callback
   GET /ifthenpay/callback?key=[ANTI_PHISHING_KEY]&orderId=[ORDER_ID]&amount=[AMOUNT]&requestId=[REQUEST_ID]
   (o mesmo endereço para o Multibanco, o MB WAY e o cartão; registado POR MÉTODO no backoffice deles).
   Uma campainha: confere-se a chave e depois pergunta-se à ifthenpay (confirmar). Só um 200 pára as 13
   tentativas deles: 200 a tudo o que está tratado; 409 quando ela ainda não confirma (que repitam); 500
   quando um email ficou por mandar; 503 quando não se conseguiu perguntar. */
export async function callback(url, env, ctx) {
  const c = I.lerCallback(url.searchParams);
  if (!I.chaveConfere(c.chave, env.IFTHENPAY_ANTIPHISHING_KEY || '')) {
    const bruta = url.searchParams.get('key') ?? url.searchParams.get('anti_phishing_key');
    // a causa no registo (nunca a chave): é isto que se lê para saber o que corrigir
    console.warn('callback recusado:', !env.IFTHENPAY_ANTIPHISHING_KEY ? 'o Worker não tem a chave anti-phishing'
      : bruta === null ? 'sem chave' : /^\[[A-Za-z_]+\]$/.test(bruta) ? `a ifthenpay não substituiu o marcador ${bruta}` : 'a chave não confere');
    return new Response('no', { status: 403 });
  }
  if (!c.orderId) {
    // a chave conferiu (alguém que a sabe diz que ALGUMA coisa foi paga), mas o modelo registado não serve
    // este método: corre-se a varredura agora, e o aviso fica alto para o modelo ser corrigido
    console.error('CALLBACK SEM IDENTIFICADOR — o endereço registado na ifthenpay não serve este método:', ['orderId', 'order_id', 'id'].map((n) => `${n}=${url.searchParams.get(n) ?? '(ausente)'}`).join(' '));
    const v = varrer(env).then((r) => console.log('varredura pelo callback:', JSON.stringify(r))).catch((e) => console.error('varredura pelo callback falhou:', e && e.message));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(v); else await v;
    return new Response('ok');
  }
  const numero = I.numeroDoPagamento(c.orderId);
  if (!numero) { console.warn('callback de um pagamento que não é desta loja:', c.orderId); return new Response('ok'); }
  const enc = await lerEncomenda(env, numero);
  if (!enc || !enc.pagamento) { console.warn('callback para uma encomenda desconhecida:', numero); return new Response('ok'); }
  let r;
  try {
    r = await confirmar(env, numero, { reenviarFalhados: true });
    // Um MB WAY que a lista ainda não tem: pergunta-se o estado DESTE pedido (o requestId do callback só serve para
    // perguntar, e só se for um pedido MB WAY desta encomenda; quem diz «pago» é a ifthenpay). Sem isto, o 409 fazia
    // a ifthenpay repetir 5 minutos depois, e quem fechou a página esperava por ela (ou pela varredura).
    if (!r.pago && c.requestId && pedidoMbwayDaEncomenda(enc.pagamento, c.requestId) && (await I.estadoMbway(env, { requestId: c.requestId })).estado === 'pago') {
      r = await confirmar(env, numero, { reenviarFalhados: true, mbwayAceite: c.requestId });
    }
  } catch (e) {
    console.error('callback: a ifthenpay não respondeu à confirmação de', numero, '—', e && e.message);
    return new Response('por confirmar', { status: 503 });
  }
  if (!r.pago) { console.warn('callback diz pago, a ifthenpay não confirma:', numero); return new Response('por confirmar', { status: 409 }); }
  if (r.falhou) return new Response('emails por enviar', { status: 500 });
  return new Response('ok');
}

/* ---------------------------------------------------------------- a página de pagamento
   O que a página /pagar/ pergunta (GET /encomenda), de 1,5 em 1,5 s no MB WAY e de 20 em 20 s no
   Multibanco: aqui pergunta-se à ifthenpay no máximo a esse ritmo, por encomenda (o travão vive em memória,
   não no KV; a documentação deles avisa que o abuso da API pode trancar a conta). O MB WAY tem uma pergunta
   própria e mais barata (o estado do pedido: aceite, recusado, expirado); com «pago», a encomenda fica paga
   logo (confirmar, mbwayAceite), sem esperar pela lista de pagamentos. */
export const ULTIMA_PERGUNTA = new Map();
function podePerguntar(chave, ms, agora = Date.now()) {
  if (agora - (ULTIMA_PERGUNTA.get(chave) || 0) < ms) return false;
  ULTIMA_PERGUNTA.set(chave, agora);
  if (ULTIMA_PERGUNTA.size > 500) for (const [k, t] of ULTIMA_PERGUNTA) if (agora - t > 3600000) ULTIMA_PERGUNTA.delete(k);
  return true;
}
/** Um pedido MB WAY feito para esta encomenda (o último ou um anterior: cada um pediu o total dela). */
export function pedidoMbwayDaEncomenda(pg, requestId) {
  if (!pg || !requestId) return false;
  return (pg.mbway && pg.mbway.requestId === requestId) || (pg.pedidos || []).some((p) => p && p.metodo === 'MBWAY' && p.requestId === requestId);
}

export async function verNaPagina(env, enc) {
  if (!enc || enc.modo !== 'online' || enc.estado !== 'pendente' || !enc.pagamento || !env.IFTHENPAY_BACKOFFICE_KEY) return enc;
  const pg = enc.pagamento;
  const numero = enc.encomenda;
  try {
    if (pg.metodo === 'MBWAY' && pg.mbway && pg.mbway.requestId && !pg.mbway.estado) {
      if (!podePerguntar(`mbway:${numero}`, 1500)) return enc;
      const s = await I.estadoMbway(env, { requestId: pg.mbway.requestId });
      if (s.estado === 'pago') {
        const r = await confirmar(env, numero, { mbwayAceite: pg.mbway.requestId });
        if (r.enc) enc = r.enc;
      } else if (s.estado === 'recusado' || s.estado === 'expirado') {
        // o fim deste pedido grava-se (uma vez): a página mostra-o, e um pedido novo pode sair
        const pedido = pg.mbway.requestId;
        const r = await alterarEncomenda(env, numero, (x) => {
          if (!x.pagamento || !x.pagamento.mbway || x.pagamento.mbway.requestId !== pedido || x.pagamento.mbway.estado) return { parar: true };
          x.pagamento.mbway = { ...x.pagamento.mbway, estado: s.estado };
          return {};
        });
        if (r.enc) enc = r.enc;
      }
      return enc;
    }
    const cartaoRecente = pg.metodo === 'CCARD' && pg.cartao && Date.now() - Date.parse(pg.cartao.pedido_em) < 15 * 60000;
    if (!podePerguntar(`pag:${numero}`, cartaoRecente ? 3000 : 15000)) return enc;
    const r = await confirmar(env, numero);
    return r.enc || enc;
  } catch (e) {
    // uma falha a perguntar não parte a página: a confirmação chega pela varredura
    console.warn('página de pagamento: a pergunta à ifthenpay falhou em', numero, '—', e && e.message);
    return enc;
  }
}

/* ---------------------------------------------------------------- o dono tira a encomenda de «pendente»
   (anula-a, ou marca-a paga à mão). A ifthenpay não tem como anular uma referência nem um pedido MB WAY
   (este expira sozinho em 4 minutos): diz-se no histórico até quando a referência vale, e a varredura
   continua a olhar por ela — se o cliente a pagar, o dono recebe o aviso para devolver. → a frase, ou null. */
export function notaAoSairDePendente(enc, agora = Date.now()) {
  const pg = enc.pagamento;
  if (!referenciaViva(pg, agora)) return null;
  const ate = pg.multibanco.expira ? new Date(`${pg.multibanco.expira}T12:00:00Z`).toLocaleDateString('pt-PT', { timeZone: 'Europe/Lisbon' }) : null;
  return `A referência Multibanco continua a valer${ate ? ` até ${ate}` : ''} (a ifthenpay não a deixa anular): se o cliente a pagar, recebe um email para lhe devolver o dinheiro.`;
}

/* ---------------------------------------------------------------- o que a página mostra (sem segredos)
   Sem os requestId (é com eles que se pergunta à ifthenpay e se reembolsa). */
export function vistaDoPagamento(enc, agora = Date.now()) {
  const pg = enc.pagamento;
  if (!pg) return null;
  return {
    metodo: pg.metodo || null,
    prazo: pg.prazo || null,
    pode_pedir: enc.estado === 'pendente' && agora < Date.parse(pg.prazo) && podePedirMais(pg),
    ...(referenciaViva(pg, agora) ? { multibanco: { entidade: pg.multibanco.entidade, referencia: pg.multibanco.referencia, expira: pg.multibanco.expira || null } } : {}),
    ...(pg.mbway ? { mbway: { pedido_em: pg.mbway.pedido_em, estado: pg.mbway.estado || null } } : {}),
    ...(pg.pedidos && pg.pedidos.length && pg.pedidos[pg.pedidos.length - 1].erro ? { ultimo_falhou: pg.pedidos[pg.pedidos.length - 1].metodo } : {}),
    ...(pg.pago_em ? { metodo_pago: pg.metodo_pago || null } : {}),
  };
}
