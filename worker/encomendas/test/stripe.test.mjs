/* A Stripe: a codificação que ela exige, a assinatura dos webhooks, e o webhook conduzido de
   ponta a ponta (pago, Multibanco, expirado, reembolsado, repetido, com o Resend em baixo). */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { formEncode, verificarAssinatura, assinar, aplicarEvento, EVENTOS } from '../stripe.js';
import { catalogoBase, envFalso, redeFalsa, pedir, registar } from './ajuda.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));
let rede;
afterEach(() => { if (rede) rede.repor(); rede = null; });

test('formEncode: a Stripe não aceita JSON, tem de sair aninhado', () => {
  assert.equal(formEncode({ mode: 'payment' }), 'mode=payment');
  assert.equal(formEncode({ a: { b: { c: 1 } } }), 'a%5Bb%5D%5Bc%5D=1');
  assert.equal(formEncode({ line_items: [{ quantity: 2, price_data: { currency: 'eur', unit_amount: 5990 } }] }),
    'line_items%5B0%5D%5Bquantity%5D=2&line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=eur&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=5990');
  assert.equal(formEncode({ expand: ['payment_intent'] }), 'expand%5B%5D=payment_intent');
  assert.equal(formEncode({ a: 1, b: null, c: undefined, d: '' }), 'a=1');
  assert.ok(formEncode({ n: 'Auscultadores "P9" & mais' }).includes('%22'));
});

const SEGREDO = 'whsec_teste_1234567890';
const AGORA = 1_800_000_000;
const corpoDe = (evento) => JSON.stringify(evento);

test('verificarAssinatura: HMAC sobre o corpo cru, com tolerância de 5 minutos', async () => {
  const corpo = corpoDe({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });
  const boa = `t=${AGORA},v1=${await assinar(corpo, AGORA, SEGREDO)}`;
  assert.equal((await verificarAssinatura(corpo, boa, SEGREDO, AGORA)).id, 'evt_1');
  assert.ok(await verificarAssinatura(corpo, boa, SEGREDO, AGORA + 299));
  await assert.rejects(verificarAssinatura(corpo, boa, SEGREDO, AGORA + 301), /tolerância/);
  await assert.rejects(verificarAssinatura(corpo.replace('cs_1', 'cs_2'), boa, SEGREDO, AGORA), /inválida/);
  await assert.rejects(verificarAssinatura(corpo, `t=${AGORA},v1=${await assinar(corpo, AGORA, 'whsec_outro')}`, SEGREDO, AGORA), /inválida/);
  await assert.rejects(verificarAssinatura(corpo, null, SEGREDO, AGORA), /ausente/);
  await assert.rejects(verificarAssinatura(corpo, 'lixo', SEGREDO, AGORA), /malformada/);
  assert.ok(await verificarAssinatura(corpo, `t=${AGORA},v1=${await assinar(corpo, AGORA, 'whsec_velho')},v1=${await assinar(corpo, AGORA, SEGREDO)}`, SEGREDO, AGORA), 'duas v1 na rotação do segredo');
});

/* Um webhook assinado como a Stripe o manda. */
async function webhook(env, evento, { segredo = SEGREDO } = {}) {
  const corpo = corpoDe({ created: Math.floor(Date.now() / 1000), ...evento });
  const t = Math.floor(Date.now() / 1000);
  const r = await worker.fetch(new Request('https://lfmobile-encomendas.test/stripe/webhook', {
    method: 'POST', body: corpo, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${await assinar(corpo, t, segredo)}` },
  }), env);
  return { status: r.status, texto: await r.text() };
}

/* Uma encomenda em modo online, pendente, com a sessão cs_test_a1b2c3d4e5f6. */
async function pendente(extra = {}) {
  const cat = clone(catalogoBase());
  cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat, ...extra.rede });
  const env = envFalso({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SEGREDO, RESEND_API_KEY: 're_x', STORE_EMAIL: 'dono@exemplo.pt', ...extra.env });
  const { encomenda } = await registar(worker, env);
  rede.chamadas.length = 0;
  env.ORDERS.escritas = 0;
  return { env, encomenda, ler: async () => JSON.parse(await env.ORDERS.get(`order:${encomenda}`)) };
}
const sessaoPaga = (encomenda, id = 'evt_pago') => ({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_test_a1b2c3d4e5f6', object: 'checkout.session', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 11980, currency: 'eur', payment_method_types: ['card'], client_reference_id: encomenda, metadata: { encomenda } } } });

test('o webhook: a sessão paga marca «paga», avisa o cliente e o dono uma vez, e o evento repetido não repete nada', async () => {
  const { env, encomenda, ler } = await pendente();
  const r = await webhook(env, sessaoPaga(encomenda));
  assert.equal(r.status, 200, r.texto);
  const enc = await ler();
  assert.equal(enc.estado, 'paga');
  assert.equal(enc.historico.at(-1).estado, 'paga');
  assert.equal(enc.historico.at(-1).por, 'stripe');
  assert.equal(enc.stripe.payment_intent, 'pi_1');
  assert.equal(enc.stripe.metodo, 'card');
  assert.match(enc.stripe.pago_em, /^\d{4}-/);
  assert.equal(enc.avisos.paga.cliente, 'enviado');
  assert.equal(enc.avisos.paga.dono, 'enviado');
  assert.equal(await env.ORDERS.get('pi:pi_1'), encomenda);
  assert.equal(await env.ORDERS.get('evt:evt_pago'), '1');
  const emails = rede.resend();
  assert.equal(emails.length, 2);
  assert.match(emails.find((e) => e.to[0] === 'maria@exemplo.pt').subject, /Pagamento recebido/);
  const dono = emails.find((e) => e.to[0] === 'dono@exemplo.pt');
  assert.match(dono.subject, /^Encomenda paga LF-/);
  assert.match(dono.text, /Stripe: pi_1/);
  assert.match(dono.text, /Emita a factura/);
  // O mesmo evento outra vez: nada.
  rede.chamadas.length = 0;
  const escritas = env.ORDERS.escritas;
  const r2 = await webhook(env, sessaoPaga(encomenda));
  assert.equal(r2.status, 200);
  assert.equal(r2.texto, 'repetido');
  assert.equal(rede.resend().length, 0);
  assert.equal(env.ORDERS.escritas, escritas);
  // Um evento NOVO que também diz «pago» (uma reentrega com outro id, por exemplo): sem emails.
  const r3 = await webhook(env, sessaoPaga(encomenda, 'evt_pago_2'));
  assert.equal(r3.status, 200);
  assert.equal(rede.resend().length, 0, 'a marca enc.avisos.paga evita o segundo email');
});

test('o webhook: Multibanco — a sessão fica «pendente», a referência chega e o email «falta pagar» sai uma vez', async () => {
  const { env, encomenda, ler } = await pendente();
  const semPagar = { id: 'evt_mb_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_a1b2c3d4e5f6', object: 'checkout.session', payment_status: 'unpaid', payment_intent: 'pi_mb', metadata: { encomenda } } } };
  assert.equal((await webhook(env, semPagar)).status, 200);
  assert.equal((await ler()).estado, 'pendente');
  assert.equal(rede.resend().length, 0);
  const referencia = { id: 'evt_mb_2', type: 'payment_intent.requires_action', data: { object: { id: 'pi_mb', object: 'payment_intent', metadata: { encomenda }, next_action: { type: 'multibanco_display_details', multibanco_display_details: { entity: '12345', reference: '123 456 789', expires_at: 1800600000, hosted_voucher_url: 'https://payments.stripe.com/multibanco/voucher/x' } } } } };
  assert.equal((await webhook(env, referencia)).status, 200);
  let enc = await ler();
  assert.equal(enc.estado, 'pendente');
  assert.deepEqual(enc.stripe.multibanco, { entidade: '12345', referencia: '123 456 789', validade: 1800600000, url: 'https://payments.stripe.com/multibanco/voucher/x' });
  const emails = rede.resend();
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /Falta pagar: referência Multibanco/);
  assert.match(emails[0].text, /Entidade: 12345/);
  assert.match(emails[0].text, /Referência: 123 456 789/);
  assert.match(emails[0].text, /Valor: 119,80 €/);
  assert.match(emails[0].html, /123 456 789/);
  // Pagou: async_payment_succeeded → paga.
  rede.chamadas.length = 0;
  const pagou = { id: 'evt_mb_3', type: 'checkout.session.async_payment_succeeded', data: { object: { id: 'cs_test_a1b2c3d4e5f6', object: 'checkout.session', payment_status: 'paid', payment_intent: 'pi_mb', amount_total: 11980, currency: 'eur', payment_method_types: ['multibanco'], metadata: { encomenda } } } };
  assert.equal((await webhook(env, pagou)).status, 200);
  enc = await ler();
  assert.equal(enc.estado, 'paga');
  assert.equal(enc.stripe.metodo, 'multibanco');
  assert.equal(rede.resend().length, 2);
  // Uma referência atrasada depois de pago: não manda «falta pagar».
  rede.chamadas.length = 0;
  assert.equal((await webhook(env, { ...referencia, id: 'evt_mb_4' })).status, 200);
  assert.equal(rede.resend().length, 0);
  assert.equal((await ler()).estado, 'paga');
});

test('o webhook: a sessão expirada e o pagamento falhado avisam; depois de paga, não desfazem nada', async () => {
  const { env, encomenda, ler } = await pendente();
  const expirou = { id: 'evt_exp', type: 'checkout.session.expired', data: { object: { id: 'cs_test_a1b2c3d4e5f6', object: 'checkout.session', payment_status: 'unpaid', metadata: { encomenda } } } };
  assert.equal((await webhook(env, expirou)).status, 200);
  assert.equal((await ler()).estado, 'expirou');
  const emails = rede.resend();
  assert.equal(emails.length, 2);
  assert.match(emails.find((e) => e.to[0] === 'maria@exemplo.pt').text, /Nada foi cobrado/);
  assert.match(emails.find((e) => e.to[0] === 'dono@exemplo.pt').subject, /expirou$/);
  // Pagou afinal (de outra forma, na Stripe): fica paga.
  rede.chamadas.length = 0;
  assert.equal((await webhook(env, sessaoPaga(encomenda))).status, 200);
  assert.equal((await ler()).estado, 'paga');
  // Uma falha atrasada não a desfaz.
  const falhou = { id: 'evt_falha', type: 'checkout.session.async_payment_failed', data: { object: { id: 'cs_test_a1b2c3d4e5f6', object: 'checkout.session', metadata: { encomenda } } } };
  rede.chamadas.length = 0;
  assert.equal((await webhook(env, falhou)).status, 200);
  assert.equal((await ler()).estado, 'paga');
  assert.equal(rede.resend().length, 0);
});

test('o webhook: o reembolso total marca «reembolsada» e avisa; o parcial fica no histórico', async () => {
  const { env, encomenda, ler } = await pendente();
  await webhook(env, sessaoPaga(encomenda));
  rede.chamadas.length = 0;
  const parcial = { id: 'evt_r1', type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', amount: 11980, amount_refunded: 2000, refunded: false, metadata: { encomenda } } } };
  assert.equal((await webhook(env, parcial)).status, 200);
  let enc = await ler();
  assert.equal(enc.estado, 'paga');
  assert.equal(enc.stripe.reembolsado_cents, 2000);
  assert.match(enc.historico.at(-1).nota, /Reembolso parcial: 20,00 €/);
  assert.equal(rede.resend().length, 0);
  const total = { id: 'evt_r2', type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', amount: 11980, amount_refunded: 11980, refunded: true, metadata: {} } } };
  assert.equal((await webhook(env, total)).status, 200, 'sem metadata, chega pelo índice pi:');
  enc = await ler();
  assert.equal(enc.estado, 'reembolsada');
  assert.equal(rede.resend().length, 1);
  assert.match(rede.resend()[0].subject, /Reembolso feito/);
  assert.match(rede.resend()[0].text, /Devolvemos 119,80 €/);
});

test('o webhook: assinatura errada 400, sem segredo 503, evento sem encomenda nossa 200, encomenda ainda invisível 409', async () => {
  const { env, encomenda } = await pendente();
  assert.equal((await webhook(env, sessaoPaga(encomenda), { segredo: 'whsec_errado' })).status, 400);
  assert.equal((await webhook(envFalso({ STRIPE_WEBHOOK_SECRET: '' }), sessaoPaga(encomenda))).status, 503);
  const alheio = await webhook(env, { id: 'evt_x', type: 'checkout.session.completed', data: { object: { id: 'cs_outra', object: 'checkout.session', payment_status: 'paid', metadata: {} } } });
  assert.equal(alheio.status, 200);
  assert.equal(alheio.texto, 'sem encomenda');
  const invisivel = await webhook(env, sessaoPaga('LF-20261108-ABCDEF', 'evt_inv'));
  assert.equal(invisivel.status, 409, 'pede reentrega: o KV pode ainda não a mostrar');
  const velho = await webhook(env, { ...sessaoPaga('LF-20261108-ABCDEF', 'evt_velho'), created: Math.floor(Date.now() / 1000) - 7200 });
  assert.equal(velho.status, 200, 'ao fim de uma hora desiste');
  assert.equal((await worker.fetch(new Request('https://x.test/stripe/webhook', { method: 'GET' }), env)).status, 405);
});

test('o webhook: com o Resend em baixo responde 500 (a Stripe reentrega) e o estado já ficou gravado', async () => {
  let emBaixo = true;
  const { env, encomenda, ler } = await pendente({ rede: { resend: () => (emBaixo ? new Response('x', { status: 503 }) : Response.json({ id: 're_1' })) } });
  const r = await webhook(env, sessaoPaga(encomenda));
  assert.equal(r.status, 500);
  let enc = await ler();
  assert.equal(enc.estado, 'paga', 'o dinheiro entrou: o estado grava-se antes dos emails');
  assert.equal('avisos' in enc, false);
  assert.equal(await env.ORDERS.get('evt:evt_pago'), null, 'sem marca: a reentrega volta a aplicar');
  emBaixo = false;
  rede.chamadas.length = 0;
  const r2 = await webhook(env, sessaoPaga(encomenda));
  assert.equal(r2.status, 200);
  assert.equal(rede.resend().length, 2, 'na reentrega os emails saem');
  enc = await ler();
  assert.equal(enc.avisos.paga.cliente, 'enviado');
  assert.equal(await env.ORDERS.get('evt:evt_pago'), '1');
});

test('aplicarEvento: um estado do painel nunca recua por um evento atrasado', () => {
  // paga pela Stripe, e depois «pronta» no painel: um evento atrasado não a faz recuar
  const base = () => ({ encomenda: 'LF-20261108-ABCDEF', estado: 'pronta', entrega: 'levantamento', total_cents: 100, historico: [], stripe: { session_id: 'cs_1', pago_em: '2026-11-08T10:00:00.000Z' } });
  for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) {
    const enc = base();
    const { avisos } = aplicarEvento(enc, { type, data: { object: { id: 'cs_1', payment_status: 'paid' } } });
    assert.equal(enc.estado, 'pronta', type);
    assert.deepEqual(avisos, ['paga'], 'o aviso pede-se na mesma: a marca decide se já foi');
  }
  // anulada, ou marcada paga à mão, sem a Stripe ter recebido antes: o pagamento chega fora de
  // tempo — só o dono é avisado (reembolsar?), e fica no histórico; o estado não muda
  for (const estado of ['anulada', 'paga']) {
    const enc = { ...base(), estado, stripe: { session_id: 'cs_1' } };
    const { avisos } = aplicarEvento(enc, { type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid' } } });
    assert.equal(enc.estado, estado);
    assert.deepEqual(avisos, ['paga-fora'], estado);
    assert.match(enc.historico.at(-1).nota, /A Stripe recebeu 1,00 € com a encomenda «(anulada|paga)»: confirme na Stripe e, se não segue, reembolse\./);
  }
  for (const type of ['checkout.session.expired', 'checkout.session.async_payment_failed']) {
    const enc = base();
    assert.deepEqual(aplicarEvento(enc, { type, data: { object: { id: 'cs_1' } } }).avisos, []);
    assert.equal(enc.estado, 'pronta');
  }
  assert.deepEqual(EVENTOS, ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired', 'payment_intent.requires_action', 'charge.refunded']);
});
