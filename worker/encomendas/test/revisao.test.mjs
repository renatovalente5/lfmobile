/* A revisão do caminho do dinheiro (11 nov 2026): cada achado corrigido, com a sua prova. As
   promoções agendadas, o máximo por artigo, os portes por confirmar, os cupões (portes grátis com
   categorias, os descontos que não se juntam, o «um por cliente», o mínimo, a reserva e a
   devolução do uso), a tentativa repetida, o modo online sem o segredo do webhook, os eventos da
   Stripe que não são da encomenda, o painel a fechar o pagamento, e os metadados em bytes. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { precoDe, contas } from '../contas.js';
import { gravarCupao, usosDe, emailCanonico, lerCupaoComUsos, listarCupoes, resumoDoEmail } from '../cupoes.js';
import { metadadosDe } from '../encomenda.js';
import { assinar } from '../stripe.js';
import { catalogoBase, envFalso, redeFalsa, pedir, pedidoValido, moradaValida, bearer } from './ajuda.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));
const NACEX = [{ ate: 5, preco: 5.9 }, { ate: 30, preco: 14.9 }];
const comNacex = () => { const c = catalogoBase(); c.portes.continente = clone(NACEX); return c; };
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const somar = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const comMorada = () => ({ ...pedidoValido().cliente, ...moradaValida() });
let rede;
afterEach(() => { if (rede) rede.repor(); rede = null; });

const SEGREDO_WEBHOOK = 'whsec_revisao_123456';
async function webhook(env, evento) {
  const corpo = JSON.stringify({ created: Math.floor(Date.now() / 1000), ...evento });
  const t = Math.floor(Date.now() / 1000);
  const r = await worker.fetch(new Request('https://lfmobile-encomendas.test/stripe/webhook', {
    method: 'POST', body: corpo, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${await assinar(corpo, t, SEGREDO_WEBHOOK)}` },
  }), env);
  return { status: r.status, texto: await r.text() };
}
/* Uma encomenda online, pendente, com a sessão cs_test_a1b2c3d4e5f6 (a rede de faz-de-conta). */
async function pendente({ cupao = null, total_cents = 11980 } = {}) {
  const cat = catalogoBase(); cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat });
  const env = envFalso({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SEGREDO_WEBHOOK });
  if (cupao) await gravarCupao(env, cupao);
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ ...(cupao ? { cupao: cupao.codigo } : {}), total_cents }) });
  assert.equal(r.status, 200, r.texto);
  return { env, id: r.json.encomenda, ler: async () => JSON.parse(await env.ORDERS.get(`order:${r.json.encomenda}`)) };
}
const sessao = (encomenda, sobre = {}) => ({ id: 'cs_test_a1b2c3d4e5f6', object: 'checkout.session', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 11980, currency: 'eur', payment_method_types: ['card'], client_reference_id: encomenda, metadata: { encomenda }, ...sobre });

// ---------------------------------------------------------------- as promoções
test('a promoção só vale entre as datas, e um preço anterior esquecido (mais baixo) não manda', () => {
  const p = { preco: 40, precoAnterior: 60, promocaoDesde: '2026-11-27', promocaoAte: '2026-11-30' };
  assert.deepEqual(precoDe(p, '2026-11-11'), { atual: 60, anterior: null }, 'agendada: ainda o preço normal');
  assert.deepEqual(precoDe(p, '2026-11-27'), { atual: 40, anterior: 60 });
  assert.deepEqual(precoDe(p, '2026-11-30'), { atual: 40, anterior: 60 });
  assert.deepEqual(precoDe(p, '2026-12-01'), { atual: 60, anterior: null });
  assert.deepEqual(precoDe({ preco: 60, precoAnterior: 55, promocaoAte: '2026-10-31' }, '2026-11-11'), { atual: 60, anterior: null }, 'acabada e com o preço subido: vale o preço');
  assert.deepEqual(precoDe({ preco: 45, precoAnterior: 55, promocaoAte: '2026-10-31' }, '2026-11-11'), { atual: 55, anterior: null }, 'acabada: volta o normal');
  assert.deepEqual(precoDe({ preco: 45, precoAnterior: 55 }, '2026-11-11'), { atual: 45, anterior: 55 }, 'sem datas: em promoção');
});

test('o /checkout cobra o preço normal de uma promoção agendada (e 409 a quem mostrar o da promoção)', async () => {
  const cat = catalogoBase();
  Object.assign(cat.produtos['fones-p9'], { preco: 40, precoAnterior: 59.9, promocaoDesde: somar(hoje(), 16), promocaoAte: somar(hoje(), 19) });
  rede = redeFalsa({ catalogo: cat });
  const env = envFalso();
  const promo = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ total_cents: 8000 }) });
  assert.equal(promo.status, 409);
  assert.equal(promo.json.campo, 'precos', 'o carrinho vai buscar o catálogo outra vez');
  const normal = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ total_cents: 11980 }) });
  assert.equal(normal.status, 200, normal.texto);
});

// ---------------------------------------------------------------- a quantidade e os portes
test('o máximo de 20 é por artigo: três linhas iguais de 7 não passam', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const linhas = [0, 1, 0].map((o) => ({ produto: 'fones-p9', opcoes: [o], qtd: 7 }));
  const r = await pedir(worker, envFalso(), 'POST', '/checkout', { corpo: pedidoValido({ linhas, total_cents: 125790 }) });
  assert.equal(r.status, 400);
  assert.match(r.json.erro, /No máximo 20 unidades de «.+» por encomenda\./);
});

test('acima do último escalão os portes ficam por confirmar, mesmo com os portes grátis a partir de X', () => {
  const cat = comNacex(); cat.portes.gratisAPartirDe = 50;
  const CONT = cat.zonas.find((z) => z.id === 'continente');
  const pesada = contas(cat, [{ produto: 'coluna-pesada', opcoes: [], qtd: 8 }], CONT, '2026-11-11');
  assert.equal(pesada.peso_kg, 32);
  assert.equal(pesada.portes_por_confirmar, true, '32 kg não segue grátis: combina-se');
  const leve = contas(cat, [{ produto: 'coluna-pesada', opcoes: [], qtd: 1 }], CONT, '2026-11-11');
  assert.equal(leve.portes_por_confirmar, false);
  assert.equal(leve.portes_cents, 0, '4 kg e 89,90 €: grátis a partir de 50 €');
});

// ---------------------------------------------------------------- os cupões
test('o cupão de portes grátis com categorias só vale com a encomenda toda delas, e nunca no levantamento', async () => {
  rede = redeFalsa({ catalogo: comNacex() });
  const env = envFalso();
  await gravarCupao(env, { codigo: 'PELICULAS0', tipo: 'portes', ativo: true, categorias: ['peliculas'] });
  const pel = (qtd) => ({ produto: 'pelicula-vidro', opcoes: [], qtd, modelo: 'iPhone 15' });
  const misto = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ entrega: 'continente', cliente: comMorada(), cupao: 'PELICULAS0', linhas: [pel(1), { produto: 'fones-p9', opcoes: [0], qtd: 1 }], total_cents: 7570 }) });
  assert.equal(misto.status, 400, 'uma película e uns auscultadores: os portes não são grátis');
  assert.equal(misto.json.campo, 'cupao');
  const levantamento = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'PELICULAS0', linhas: [pel(1)], total_cents: 990 }) });
  assert.equal(levantamento.status, 400);
  assert.equal(levantamento.json.campo, 'cupao');
  assert.equal(await usosDe(env, 'PELICULAS0'), 0, 'um cupão recusado não gasta o uso');
  const so = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ entrega: 'continente', cliente: comMorada(), cupao: 'PELICULAS0', linhas: [pel(2)], total_cents: 1980 }) });
  assert.equal(so.status, 200, so.texto);
  assert.equal(await usosDe(env, 'PELICULAS0'), 1);
});

test('os descontos não se juntam: o cupão deixa de fora os artigos em promoção (e recusa-se se só houver esses)', async () => {
  const cat = catalogoBase();
  Object.assign(cat.produtos['inpods-3'], { preco: 39.9, precoAnterior: 44.9 });
  rede = redeFalsa({ catalogo: cat });
  const env = envFalso();
  await gravarCupao(env, { codigo: 'DEZ', tipo: 'percentagem', valor: 10, ativo: true });
  const so = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'DEZ', linhas: [{ produto: 'inpods-3', opcoes: [], qtd: 1 }], total_cents: 3990 }) });
  assert.equal(so.status, 400);
  assert.equal(so.json.campo, 'cupao');
  assert.match(so.json.erro, /em promoção ficam de fora/);
  const misto = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'DEZ', linhas: [{ produto: 'inpods-3', opcoes: [], qtd: 1 }, { produto: 'fones-p9', opcoes: [0], qtd: 1 }], total_cents: 3990 + 5990 - 599 }) });
  assert.equal(misto.status, 200, misto.texto);
  const enc = JSON.parse(await env.ORDERS.get(`order:${misto.json.encomenda}`));
  assert.equal(enc.desconto_cents, 599, '10 % só dos 59,90 € a preço normal');
});

test('«um por cliente»: o mesmo email com «+etiqueta», maiúsculas ou um invisível não passa outra vez', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  await gravarCupao(env, { codigo: 'UMAVEZ', tipo: 'valor', valor: 5, ativo: true, porCliente: true });
  const com = (email) => pedidoValido({ cupao: 'UMAVEZ', cliente: { ...pedidoValido().cliente, email }, total_cents: 11480 });
  const primeira = await pedir(worker, env, 'POST', '/checkout', { corpo: com('ana@exemplo.pt') });
  assert.equal(primeira.status, 200, primeira.texto);
  for (const outro of ['ana+loja@exemplo.pt', 'ANA@exemplo.pt', 'ana@exemplo.pt​']) {
    const r = await pedir(worker, env, 'POST', '/checkout', { corpo: com(outro) });
    assert.equal(r.status, 400, outro);
    assert.equal(r.json.campo, 'cupao', outro);
  }
  assert.equal(emailCanonico('A.Na+x@GMail.com'), 'ana@gmail.com');
  assert.equal(emailCanonico('a.na@exemplo.pt'), 'a.na@exemplo.pt', 'os pontos só saem no Gmail');
});

test('o mínimo do cupão confere-se mesmo com os portes por confirmar (modo online)', async () => {
  const cat = comNacex(); cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat });
  const env = envFalso({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
  await gravarCupao(env, { codigo: 'MIL', tipo: 'portes', ativo: true, minimo: 1000 });
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ entrega: 'continente', cliente: comMorada(), cupao: 'MIL', linhas: [{ produto: 'coluna-pesada', opcoes: [], qtd: 8 }], total_cents: 71920 }) });
  assert.equal(r.status, 400);
  assert.equal(r.json.campo, 'cupao');
  assert.match(r.json.erro, /compras a partir de/);
});

// ---------------------------------------------------------------- a tentativa repetida e o modo online
test('a mesma tentativa duas vezes (a resposta perdeu-se) dá a mesma encomenda', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  const corpo = pedidoValido({ pedido: 'tentativa-abc123def456ghi' });
  const a = await pedir(worker, env, 'POST', '/checkout', { corpo });
  const b = await pedir(worker, env, 'POST', '/checkout', { corpo });
  assert.equal(a.status, 200, a.texto);
  assert.equal(b.status, 200, b.texto);
  assert.equal(b.json.encomenda, a.json.encomenda);
  assert.equal(b.json.chave, a.json.chave);
  assert.equal([...env.ORDERS.dados.keys()].filter((k) => k.startsWith('order:')).length, 1);
  const c = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ pedido: 'outra-tentativa-123456789' }) });
  assert.notEqual(c.json.encomenda, a.json.encomenda, 'outra tentativa, outra encomenda');
});

test('modo online sem o segredo do webhook: 503 (a Stripe cobrava e ninguém sabia)', async () => {
  const cat = catalogoBase(); cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat });
  const r = await pedir(worker, envFalso({ STRIPE_SECRET_KEY: 'sk_test_x' }), 'POST', '/checkout', { corpo: pedidoValido() });
  assert.equal(r.status, 503);
});

// ---------------------------------------------------------------- os eventos da Stripe
test('o webhook só aceita a sessão e o valor desta encomenda (um Payment Link de 1 € não a marca paga)', async () => {
  const { env, id, ler } = await pendente();
  const link = await webhook(env, { id: 'evt_link', type: 'checkout.session.completed', data: { object: sessao(id, { id: 'cs_link_9999999999', amount_total: 100 }) } });
  assert.equal(link.status, 200);
  let enc = await ler();
  assert.equal(enc.estado, 'pendente');
  assert.match(enc.historico.at(-1).nota, /Evento da Stripe ignorado \(checkout\.session\.completed\): a sessão cs_link_9999999999 não é a desta encomenda/);
  const pouco = await webhook(env, { id: 'evt_pouco', type: 'checkout.session.completed', data: { object: sessao(id, { amount_total: 100 }) } });
  assert.equal(pouco.status, 200);
  enc = await ler();
  assert.equal(enc.estado, 'pendente', 'a sessão certa com outro valor também não');
  assert.match(enc.historico.at(-1).nota, /o valor \(100 eur\) não é o da encomenda \(11980 eur\)/);
  const certo = await webhook(env, { id: 'evt_certo', type: 'checkout.session.completed', data: { object: sessao(id) } });
  assert.equal(certo.status, 200);
  assert.equal((await ler()).estado, 'paga');
  const alheio = await webhook(env, { id: 'evt_ch', type: 'charge.refunded', data: { object: { id: 'ch_x', object: 'charge', payment_intent: 'pi_outro', amount: 11980, amount_refunded: 11980, metadata: { encomenda: id } } } });
  assert.equal(alheio.status, 200);
  assert.equal((await ler()).estado, 'paga', 'um reembolso de outro pagamento não mexe nela');
});

test('o cupão reserva-se na encomenda online e volta se o pagamento expirar; pago depois, conta outra vez', async () => {
  const { env, id, ler } = await pendente({ cupao: { codigo: 'UMSO', tipo: 'valor', valor: 10, ativo: true, limite: 1, porCliente: true }, total_cents: 10980 });
  assert.equal(await usosDe(env, 'UMSO'), 1, 'reservado logo');
  assert.equal((await ler()).cupao_contado, true);
  // uma segunda encomenda com o mesmo cupão de um uso já não passa (antes, passavam todas até pagar)
  const segunda = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'UMSO', total_cents: 10980, cliente: { ...pedidoValido().cliente, email: 'outra@exemplo.pt' } }) });
  assert.equal(segunda.status, 400);
  assert.equal(segunda.json.campo, 'cupao');
  // expirou: o uso volta
  assert.equal((await webhook(env, { id: 'evt_exp', type: 'checkout.session.expired', data: { object: sessao(id, { payment_status: 'unpaid' }) } })).status, 200);
  assert.equal((await ler()).estado, 'expirou');
  assert.equal(await usosDe(env, 'UMSO'), 0);
  assert.equal((await ler()).cupao_contado, false);
  // pagou depois (um Multibanco atrasado): fica paga e conta outra vez
  assert.equal((await webhook(env, { id: 'evt_tarde', type: 'checkout.session.async_payment_succeeded', data: { object: sessao(id, { amount_total: 10980 }) } })).status, 200);
  assert.equal((await ler()).estado, 'paga');
  assert.equal(await usosDe(env, 'UMSO'), 1);
});

test('o painel: anular uma encomenda pendente fecha a página da Stripe e devolve o uso do cupão', async () => {
  const { env, id, ler } = await pendente({ cupao: { codigo: 'UMSO', tipo: 'valor', valor: 10, ativo: true, limite: 1 }, total_cents: 10980 });
  rede.chamadas.length = 0;
  const r = await pedir(worker, env, 'POST', `/painel/encomendas/${id}/estado`, { corpo: { estado: 'anulada', avisar: false }, cabecalhos: bearer() });
  assert.equal(r.status, 200, r.texto);
  const enc = await ler();
  assert.equal(enc.estado, 'anulada');
  assert.ok(rede.stripe().some((c) => c.url.endsWith('/checkout/sessions/cs_test_a1b2c3d4e5f6/expire')), 'a sessão expirou na Stripe');
  assert.match(enc.historico.at(-1).nota, /Fechámos a página de pagamento da Stripe\./);
  assert.equal(await usosDe(env, 'UMSO'), 0);
  // e se o cliente pagasse na mesma (a página já aberta): só o dono é avisado, para reembolsar
  assert.equal((await webhook(env, { id: 'evt_fora', type: 'checkout.session.completed', data: { object: sessao(id, { amount_total: 10980 }) } })).status, 200);
  const depois = await ler();
  assert.equal(depois.estado, 'anulada');
  assert.ok(depois.avisos['paga-fora']);
  assert.equal(depois.avisos.paga, undefined, 'nada de «Pagamento recebido» numa encomenda anulada');
});

// ---------------------------------------------------------------- o objecto dos cupões (11 nov, a seguir à revisão)
test('dois clientes no MESMO instante com um cupão de um uso: só um passa (o objecto dos cupões conta num passo)', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  await gravarCupao(env, { codigo: 'SO1', tipo: 'valor', valor: 5, ativo: true, limite: 1 });
  const de = (email) => pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'SO1', cliente: { ...pedidoValido().cliente, email }, total_cents: 11480 }) });
  const respostas = await Promise.all([de('ana@exemplo.pt'), de('rui@exemplo.pt'), de('joao@exemplo.pt')]);
  assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 400, 400], respostas.map((r) => r.texto).join(' | '));
  assert.ok(respostas.filter((r) => r.status === 400).every((r) => r.json.campo === 'cupao' && /número de vezes que podia/.test(r.json.erro)));
  assert.equal(await usosDe(env, 'SO1'), 1);
  assert.equal([...env.ORDERS.dados.keys()].filter((k) => k.startsWith('order:')).length, 1, 'uma encomenda só');
});

test('os cupões que estavam no KV passam para o objecto na primeira vez (a regra, os usos, quem já o usou)', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  await env.ORDERS.put('cupao:ANTIGO', JSON.stringify({ codigo: 'ANTIGO', tipo: 'valor', valor: 5, ativo: true, limite: 10, porCliente: true, criado_em: '2026-11-09T10:00:00.000Z', actualizado_em: '2026-11-09T10:00:00.000Z' }));
  await env.ORDERS.put('cupao-usos:ANTIGO', '3');
  await env.ORDERS.put(`cupao-cliente:ANTIGO:${await resumoDoEmail('ana@exemplo.pt')}`, 'LF-20261109-AAAAAA');
  const lido = await lerCupaoComUsos(env, 'antigo');
  assert.equal(lido.regra.valor, 5);
  assert.equal(lido.usos, 3);
  assert.equal((await listarCupoes(env)).length, 1);
  const ana = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'ANTIGO', cliente: { ...pedidoValido().cliente, email: 'ana@exemplo.pt' }, total_cents: 11480 }) });
  assert.equal(ana.status, 400, 'a Ana já o tinha usado (a marca veio do KV)');
  const rui = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'ANTIGO', cliente: { ...pedidoValido().cliente, email: 'rui@exemplo.pt' }, total_cents: 11480 }) });
  assert.equal(rui.status, 200, rui.texto);
  assert.equal(await usosDe(env, 'ANTIGO'), 4);
});

test('a Stripe não abre a página: a encomenda não se faz e o uso do cupão volta', async () => {
  const cat = catalogoBase(); cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat, stripe: () => new Response(JSON.stringify({ error: { message: 'em baixo' } }), { status: 500 }) });
  const env = envFalso({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
  await gravarCupao(env, { codigo: 'SO1', tipo: 'valor', valor: 5, ativo: true, limite: 1 });
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'SO1', total_cents: 11480 }) });
  assert.equal(r.status, 502);
  assert.equal(await usosDe(env, 'SO1'), 0, 'o uso voltou');
});

// ---------------------------------------------------------------- os metadados do KV
test('os metadados da encomenda cabem em 1024 BYTES, mesmo com nomes noutra escrita e emojis', () => {
  const nome = '王小明 😀 Ação Çãéíóú '.repeat(10);
  const enc = { estado: 'registada', modo: 'encomenda', entrega: 'levantamento', total_cents: 100, criada_em: 'x', actualizada_em: 'x', cliente: { nome, telefone: '912345678', email: `${'ç'.repeat(70)}@exemplo.pt` }, linhas: Array.from({ length: 30 }, (_, i) => ({ nome: `${nome} ${i}`, qtd: 1 })) };
  const m = metadadosDe(enc);
  assert.ok(new TextEncoder().encode(JSON.stringify(m)).length <= 1024, `${new TextEncoder().encode(JSON.stringify(m)).length} bytes`);
  assert.ok(m.mais > 0, 'diz quantas linhas ficaram de fora');
});
