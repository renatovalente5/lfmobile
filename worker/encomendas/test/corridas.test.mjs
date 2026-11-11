/* AS CORRIDAS (11 nov 2026, as encomendas num objecto durável): o que o KV perdia quando dois caminhos
   escreviam a mesma encomenda — o webhook da Stripe e o painel —, e o que a leitura atrasada do KV
   (eventualmente consistente: até 60 s noutro sítio) gravava por cima. O objecto falso (ajuda.mjs) tem o
   blockConcurrencyWhile em fila, como na Cloudflare. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { assinar } from '../stripe.js';
import { gravarCupao, usosDe } from '../cupoes.js';
import { MAX_EMAILS_POR_PAGAR } from '../email.js';
import { catalogoBase, envFalso, redeFalsa, pedir, pedidoValido, bearer } from './ajuda.mjs';

let rede;
afterEach(() => { if (rede) rede.repor(); rede = null; });

const SEGREDO_WEBHOOK = 'whsec_corridas_123456';
async function webhook(env, evento) {
  const corpo = JSON.stringify({ created: Math.floor(Date.now() / 1000), ...evento });
  const t = Math.floor(Date.now() / 1000);
  const r = await worker.fetch(new Request('https://lfmobile-encomendas.test/stripe/webhook', {
    method: 'POST', body: corpo, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${await assinar(corpo, t, SEGREDO_WEBHOOK)}` },
  }), env);
  return { status: r.status, texto: await r.text() };
}
const sessao = (encomenda, sobre = {}) => ({ id: 'cs_test_a1b2c3d4e5f6', object: 'checkout.session', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 11980, currency: 'eur', payment_method_types: ['card'], client_reference_id: encomenda, metadata: { encomenda }, ...sobre });
const lerKV = async (env, id) => JSON.parse(await env.ORDERS.get(`order:${id}`));
const mudar = (env, id, estado) => pedir(worker, env, 'POST', `/painel/encomendas/${id}/estado`, { corpo: { estado, avisar: false }, cabecalhos: bearer() });
const anotar = (env, id, texto) => pedir(worker, env, 'POST', `/painel/encomendas/${id}/nota`, { corpo: { texto }, cabecalhos: bearer() });

/* Uma encomenda online, pendente (a rede de faz-de-conta abre a sessão cs_test_a1b2c3d4e5f6). */
async function pendente({ cupao = null, total_cents = 11980 } = {}) {
  const cat = catalogoBase(); cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat });
  const env = envFalso({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SEGREDO_WEBHOOK, RESEND_API_KEY: 're_x', STORE_EMAIL: 'dono@exemplo.pt' });
  if (cupao) await gravarCupao(env, cupao);
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ ...(cupao ? { cupao: cupao.codigo } : {}), total_cents }) });
  assert.equal(r.status, 200, r.texto);
  return { env, id: r.json.encomenda, ler: () => lerKV(env, r.json.encomenda) };
}

test('o pagamento e uma nota do painel ao mesmo tempo: fica paga E com a nota', async () => {
  const { env, id, ler } = await pendente();
  const [pago, nota] = await Promise.all([
    webhook(env, { id: 'evt_pago', type: 'checkout.session.completed', data: { object: sessao(id) } }),
    anotar(env, id, 'O cliente ligou a perguntar o prazo.'),
  ]);
  assert.equal(pago.status, 200, pago.texto);
  assert.equal(nota.status, 200, nota.texto);
  const enc = await ler();
  assert.equal(enc.estado, 'paga');
  assert.equal(enc.notas_painel.at(-1).texto, 'O cliente ligou a perguntar o prazo.');
  assert.ok(enc.avisos.paga, 'e os emails do pagamento ficaram marcados');
});

test('uma nota escrita sobre uma leitura ATRASADA (o KV ainda dizia «pendente») não apaga o pagamento', async () => {
  const { env, id, ler } = await pendente();
  const antes = JSON.stringify(await ler());   // a cópia de quando estava pendente
  assert.equal((await webhook(env, { id: 'evt_pago', type: 'checkout.session.completed', data: { object: sessao(id) } })).status, 200);
  assert.equal((await ler()).estado, 'paga');
  // o KV de outra localização ainda mostra a versão de antes (eventualmente consistente)
  await env.ORDERS.put(`order:${id}`, antes);
  assert.equal((await anotar(env, id, 'Nota escrita longe.')).status, 200);
  const enc = await ler();
  assert.equal(enc.estado, 'paga', 'a nota juntou-se à encomenda de AGORA (a do objecto), não à cópia atrasada');
  assert.equal(enc.stripe.payment_intent, 'pi_1');
  assert.equal(enc.notas_painel.at(-1).texto, 'Nota escrita longe.');
});

test('anular uma pendente com o «expired» da Stripe a chegar enquanto a página fecha: fica anulada, sem os emails de «não se concluiu», e o uso do cupão volta uma vez', async () => {
  // a Stripe manda o checkout.session.expired logo que a página fecha — aqui, de dentro da própria chamada
  let env = null; let id = null; let expirado = null;
  const cat = catalogoBase(); cat.modo = 'online';
  rede = redeFalsa({
    catalogo: cat,
    stripe: async (url, init) => {
      if (url.endsWith('/checkout/sessions') && init.method === 'POST') return Response.json({ id: 'cs_test_a1b2c3d4e5f6', url: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6', payment_status: 'unpaid' });
      if (url.endsWith('/expire')) { expirado = await webhook(env, { id: 'evt_exp', type: 'checkout.session.expired', data: { object: sessao(id, { payment_status: 'unpaid', amount_total: 10980 }) } }); return Response.json({ id: 'cs_test_a1b2c3d4e5f6', status: 'expired' }); }
      return Response.json({});
    },
  });
  env = envFalso({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SEGREDO_WEBHOOK, RESEND_API_KEY: 're_x', STORE_EMAIL: 'dono@exemplo.pt' });
  await gravarCupao(env, { codigo: 'UMSO', tipo: 'valor', valor: 10, ativo: true, limite: 1 });
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'UMSO', total_cents: 10980 }) });
  assert.equal(r.status, 200, r.texto);
  id = r.json.encomenda;
  assert.equal(await usosDe(env, 'UMSO'), 1);
  const anulada = await mudar(env, id, 'anulada');
  assert.equal(anulada.status, 200, anulada.texto);
  assert.equal(expirado && expirado.status, 200, 'o «expired» chegou enquanto a página fechava');
  const enc = await lerKV(env, id);
  assert.equal(enc.estado, 'anulada', 'o «expirou» não grava por cima da anulação');
  assert.equal(enc.avisos?.expirou, undefined, 'e não manda «o pagamento não se concluiu»');
  assert.equal(rede.resend().filter((e) => /não se concluiu/.test(e.subject)).length, 0);
  assert.equal(await usosDe(env, 'UMSO'), 0, 'o uso voltou, e só uma vez');
});

test('duas mudanças de estado ao mesmo tempo (dois aparelhos): uma passa, a outra recebe 409 com o estado de agora', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido() });
  const id = r.json.encomenda;
  assert.equal((await mudar(env, id, 'paga')).status, 200);
  const [a, b] = await Promise.all([mudar(env, id, 'pronta'), mudar(env, id, 'anulada')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.texto} | ${b.texto}`);
  const recusada = a.status === 409 ? a : b;
  assert.match(recusada.json.erro, /A encomenda mudou entretanto: está «(pronta|anulada)»/);
  const enc = await lerKV(env, id);
  assert.ok(['pronta', 'anulada'].includes(enc.estado));
  assert.equal(enc.historico.filter((h) => h.estado === 'pronta' || h.estado === 'anulada').length, 1, 'uma mudança só no histórico');
});

test('o KV fica com a cópia da última versão (a lista do painel lê-a), e uma encomenda de antes do objecto lê-se do KV e passa para lá na primeira escrita', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido() });
  const id = r.json.encomenda;
  await mudar(env, id, 'paga');
  const copia = await lerKV(env, id);
  assert.equal(copia.estado, 'paga');
  assert.equal(copia.versao, 2, 'criada (1) e paga (2)');
  assert.equal(env.ORDERS.dados.get(`order:${id}`).metadata.estado, 'paga', 'os metadados da lista também');
  // uma encomenda gravada só no KV (de antes do objecto)
  const velha = { ...copia, encomenda: 'LF-20261101-ABCDEF', chave: 'ABCDEFGHJKLMNPQRSTUV', versao: undefined, estado: 'registada' };
  delete velha.versao;
  await env.ORDERS.put('order:LF-20261101-ABCDEF', JSON.stringify(velha));
  const ficha = await pedir(worker, env, 'GET', '/painel/encomendas/LF-20261101-ABCDEF', { cabecalhos: bearer() });
  assert.equal(ficha.status, 200);
  assert.equal(ficha.json.estado, 'registada');
  assert.equal((await mudar(env, 'LF-20261101-ABCDEF', 'paga')).status, 200);
  assert.equal(env.ENCOMENDA.instancias.get('LF-20261101-ABCDEF').ctx.dados.get('enc').estado, 'paga', 'passou para o objecto');
});

test(`o travão dos emails: a mesma pessoa recebe no máximo ${MAX_EMAILS_POR_PAGAR} emails de encomendas por registar por dia; o dono recebe sempre`, async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso({ RESEND_API_KEY: 're_x', STORE_EMAIL: 'dono@exemplo.pt' });
  const ids = [];
  for (let i = 0; i <= MAX_EMAILS_POR_PAGAR; i++) {
    const cliente = { nome: 'Alguém', email: i % 2 ? 'VITIMA@exemplo.pt' : 'vitima@exemplo.pt', telefone: '912 345 678' };
    const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cliente }) });
    assert.equal(r.status, 200, r.texto);
    ids.push(r.json.encomenda);
  }
  const para = (quem) => rede.resend().filter((m) => [].concat(m.to).some((x) => x.toLowerCase() === quem));
  assert.equal(para('vitima@exemplo.pt').length, MAX_EMAILS_POR_PAGAR, 'maiúsculas ou não, é o mesmo endereço');
  assert.equal(para('dono@exemplo.pt').length, MAX_EMAILS_POR_PAGAR + 1);
  const ultima = await lerKV(env, ids.at(-1));
  assert.match(ultima.avisos.registada.cliente, /^travado/);
  assert.equal(ultima.estado, 'registada', 'a encomenda grava-se na mesma');
  assert.ok(![...env.CONTADOR.instancias.keys()].some((k) => k.includes('@')), 'o contador guarda o resumo, nunca o email');
});

test(`o travão também nos emails da Stripe sem pagamento («não se concluiu»): no máximo ${MAX_EMAILS_POR_PAGAR} por dia`, async () => {
  const cat = catalogoBase(); cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat });
  const env = envFalso({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SEGREDO_WEBHOOK, RESEND_API_KEY: 're_x', STORE_EMAIL: 'dono@exemplo.pt' });
  const ids = [];
  for (let i = 0; i <= MAX_EMAILS_POR_PAGAR; i++) {
    const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido() });
    assert.equal(r.status, 200, r.texto);
    ids.push(r.json.encomenda);
  }
  rede.chamadas.length = 0;
  for (const [i, id] of ids.entries()) {
    const r = await webhook(env, { id: `evt_exp_${i}`, type: 'checkout.session.expired', data: { object: sessao(id, { payment_status: 'unpaid' }) } });
    assert.equal(r.status, 200, r.texto);
  }
  const aoCliente = rede.resend().filter((m) => [].concat(m.to).includes('Maria@Exemplo.pt') || [].concat(m.to).includes('maria@exemplo.pt'));
  assert.equal(aoCliente.length, MAX_EMAILS_POR_PAGAR);
  const ultima = await lerKV(env, ids.at(-1));
  assert.equal(ultima.estado, 'expirou');
  assert.match(ultima.avisos.expirou.cliente, /^travado/);
});
