/* O POST /checkout conduzido de ponta a ponta: a forma no KV, as respostas, os emails, o CORS,
   o travão, os dois modos. Sem rede: o catálogo, a Stripe e o Resend são de faz-de-conta. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { RE_ID, RE_CHAVE } from '../encomenda.js';
import { catalogoBase, envFalso, redeFalsa, pedir, pedidoValido, moradaValida } from './ajuda.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));
let rede;
afterEach(() => { if (rede) rede.repor(); rede = null; });

test('modo «encomenda»: regista, devolve o número e a chave, grava a encomenda com a forma do contrato', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cliente: { ...pedidoValido().cliente, nif: '123456789', notas: 'Ligar antes.' } }) });
  assert.equal(r.status, 200, r.texto);
  assert.match(r.json.encomenda, RE_ID);
  assert.match(r.json.chave, RE_CHAVE);
  assert.equal(r.json.estado, 'registada');
  assert.equal(r.json.total_cents, 11980);
  assert.equal(Object.keys(r.json).sort().join(), 'chave,encomenda,estado,total_cents');

  const enc = JSON.parse(await env.ORDERS.get(`order:${r.json.encomenda}`));
  assert.equal(enc.v, 1);
  assert.equal(enc.chave, r.json.chave);
  assert.equal(enc.modo, 'encomenda');
  assert.equal(enc.estado, 'registada');
  assert.equal(enc.entrega, 'levantamento');
  assert.deepEqual(enc.linhas, [{ produto: 'fones-p9', nome: 'Auscultadores P9', qtd: 2, opcoes: [1], escolhas: ['Cor: Prateado'], categoria: 'audio', unidade_cents: 5990, total_cents: 11980 }]);
  assert.equal(enc.artigos_cents, 11980);
  assert.equal(enc.peso_kg, 0.6, 'dois auscultadores de 0,3 kg');
  assert.equal('cupao' in enc, false, 'sem cupão, sem os campos do cupão');
  assert.equal(enc.portes_cents, 0);
  assert.equal(enc.portes_por_confirmar, false);
  assert.equal(enc.total_cents, 11980);
  assert.deepEqual(enc.cliente, { nome: 'Maria Fernanda Silva', email: 'maria@exemplo.pt', telefone: '912 345 678', nif: '123456789', notas: 'Ligar antes.' });
  assert.equal(enc.termos.pagina, 'https://renatovalente5.github.io/lfmobile/termos-e-condicoes/');
  assert.match(enc.termos.aceites_em, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(enc.historico.length, 1);
  assert.equal(enc.historico[0].estado, 'registada');
  assert.equal(enc.historico[0].por, 'site');
  assert.equal(enc.criada_em, enc.historico[0].em);
  assert.equal(enc.actualizada_em, enc.criada_em);
  assert.equal('stripe' in enc, false, 'sem Stripe em modo encomenda');
  assert.equal('avisos' in enc, false, 'sem falhas de email não há nada a registar');
  // Os metadados da chave, de que a lista do painel vive.
  const m = env.ORDERS.dados.get(`order:${r.json.encomenda}`).metadata;
  assert.equal(m.estado, 'registada');
  assert.equal(m.nome, 'Maria Fernanda Silva');
  assert.deepEqual(m.linhas, [['Auscultadores P9', 2]]);
  assert.equal(env.ORDERS.escritas, 1, 'uma escrita só');
  assert.equal(rede.resend().length, 0, 'sem RESEND_API_KEY não se manda nada');
});

test('com envio: a morada fica, os portes por confirmar seguem em modo encomenda e o email di-lo', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso({ RESEND_API_KEY: 're_teste', STORE_EMAIL: 'dono@exemplo.pt' });
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ entrega: 'continente', cliente: { ...pedidoValido().cliente, ...moradaValida() } }) });
  assert.equal(r.status, 200, r.texto);
  const enc = JSON.parse(await env.ORDERS.get(`order:${r.json.encomenda}`));
  assert.equal(enc.entrega, 'continente');
  assert.equal(enc.portes_por_confirmar, true);
  assert.equal(enc.cliente.codigoPostal, '3720-100');
  const emails = rede.resend();
  assert.equal(emails.length, 2, 'um ao cliente, um ao dono');
  const cliente = emails.find((e) => e.to[0] === 'maria@exemplo.pt');
  const dono = emails.find((e) => e.to[0] === 'dono@exemplo.pt');
  assert.ok(cliente && dono);
  assert.match(cliente.subject, new RegExp(`Recebemos a sua encomenda ${r.json.encomenda}`));
  assert.match(cliente.text, /Portes: a confirmar/);
  assert.match(cliente.text, /Total: 119,80 € \+ portes/);
  assert.match(cliente.text, /Envio para Rua das Flores, 10, 2\.º Esq\., 3720-100 Oliveira de Azeméis/);
  assert.match(cliente.text, /dizemos-lhe o valor antes de enviar/);
  assert.match(cliente.text, /14 dias/);
  assert.match(cliente.text, /lfmobile\/desistir\//);
  assert.match(cliente.html, /logo-b72d7bbaa1-128\.png/);
  assert.match(cliente.html, /<html lang="pt-PT"/);
  assert.equal(cliente.from, 'LF Mobile <onboarding@resend.dev>');
  assert.equal(cliente.reply_to, 'dono@exemplo.pt');
  assert.match(dono.subject, /^Nova encomenda LF-\d{8}-[A-Z0-9]{6} — 119,80 € \+ portes$/);
  assert.match(dono.text, /PORTES POR CONFIRMAR/);
  assert.match(dono.text, /Telemóvel: 912 345 678/);
  assert.equal(dono.reply_to, 'maria@exemplo.pt');
  const proibida = new RegExp(['obriga[cç][aã]o', 'de', 'pagar'].join(' '), 'i');
  for (const e of emails) assert.doesNotMatch(`${e.subject}\n${e.text}\n${e.html || ''}`, proibida);
  assert.equal(env.ORDERS.escritas, 1);
});

test('só o email ao cliente quando STORE_EMAIL está vazio; e uma falha do Resend não apaga a encomenda', async () => {
  rede = redeFalsa({ catalogo: catalogoBase(), resend: () => new Response('{"message":"em baixo"}', { status: 500 }) });
  const env = envFalso({ RESEND_API_KEY: 're_teste' });
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido() });
  assert.equal(r.status, 200);
  assert.equal(rede.resend().length, 1, 'sem STORE_EMAIL o dono não recebe');
  const enc = JSON.parse(await env.ORDERS.get(`order:${r.json.encomenda}`));
  assert.equal(enc.estado, 'registada');
  assert.equal(enc.avisos.registada.cliente, 'falhou');
  assert.equal(enc.avisos.registada.dono, 'sem destinatário');
  assert.equal(env.ORDERS.escritas, 2, 'a encomenda, e depois a falha registada');
});

test('409 quando o total do site não bate com as contas do Worker', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ total_cents: 11979 }) });
  assert.equal(r.status, 409);
  assert.deepEqual(r.json, { erro: 'Os preços mudaram. Veja o carrinho outra vez.' });
  assert.equal(env.ORDERS.escritas, 0, 'um pedido recusado não gasta escritas');
});

test('400 com a frase e o campo: email, só na loja com envio, quantidade, termos, NIF', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  const casos = [
    [pedidoValido({ cliente: { ...pedidoValido().cliente, email: 'maria' } }), /email válido/, 'email'],
    [pedidoValido({ entrega: 'continente', linhas: [{ produto: 'pelicula-hidrogel', opcoes: [], qtd: 1 }], total_cents: 1250, cliente: { ...pedidoValido().cliente, ...moradaValida() } }), /só se levanta na loja/, 'entrega'],
    [pedidoValido({ linhas: [{ produto: 'fones-p9', opcoes: [1], qtd: 21 }], total_cents: 125790 }), /1 a 20/, undefined],
    [pedidoValido({ termos: false }), /aceite os termos/, 'termos'],
    [pedidoValido({ cliente: { ...pedidoValido().cliente, nif: '111111111' } }), /NIF/, 'nif'],
    [pedidoValido({ linhas: [{ produto: 'samsung-galaxy-s25-128gb', opcoes: [], qtd: 1 }], total_cents: 58990 }), /já não está disponível/, undefined],
  ];
  for (const [corpo, re, campo] of casos) {
    const r = await pedir(worker, env, 'POST', '/checkout', { corpo });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.match(r.json.erro, re);
    assert.equal(r.json.campo, campo);
  }
  const lixo = await pedir(worker, env, 'POST', '/checkout', { corpo: '{nao é json' });
  assert.equal(lixo.status, 400);
  const grande = await pedir(worker, env, 'POST', '/checkout', { corpo: { x: 'a'.repeat(20000) } });
  assert.equal(grande.status, 413);
  assert.equal(env.ORDERS.escritas, 0);
});

test('o catálogo em baixo dá 503, sem gastar o KV', async () => {
  rede = redeFalsa({ catalogo: null });
  const env = envFalso();
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido() });
  assert.equal(r.status, 503);
  assert.match(r.json.erro, /confirmar os preços/);
  assert.equal(env.ORDERS.escritas, 0);
});

test('modo «online» sem chave da Stripe: 503 com a frase do contrato', async () => {
  const cat = clone(catalogoBase());
  cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat });
  const r = await pedir(worker, envFalso(), 'POST', '/checkout', { corpo: pedidoValido() });
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { erro: 'O pagamento no site não está ligado. Encomende pelo WhatsApp.' });
});

test('modo «online»: abre a sessão da Stripe em português, grava «pendente» e o índice da sessão', async () => {
  const cat = clone(catalogoBase());
  cat.modo = 'online';
  cat.portes = { continente: 4.5, gratisAPartirDe: null };
  rede = redeFalsa({ catalogo: cat });
  const env = envFalso({ STRIPE_SECRET_KEY: 'sk_test_x' });
  const corpo = pedidoValido({ entrega: 'continente', total_cents: 12430, cliente: { ...pedidoValido().cliente, ...moradaValida() } });
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.url, 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6');
  assert.match(r.json.encomenda, RE_ID);
  assert.equal(r.json.total_cents, 12430);
  const [chamada] = rede.stripe();
  assert.equal(chamada.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(chamada.init.headers.Authorization, 'Bearer sk_test_x');
  assert.equal(chamada.init.headers['Stripe-Version'], '2026-07-29.dahlia');
  assert.equal(chamada.init.headers['Idempotency-Key'], `chk_${r.json.encomenda}`);
  const params = new URLSearchParams(chamada.corpo);
  assert.equal(params.get('ui_mode'), 'hosted_page');
  assert.equal(params.get('locale'), 'pt');
  assert.equal(params.get('mode'), 'payment');
  assert.equal(params.get('client_reference_id'), r.json.encomenda);
  assert.equal(params.get('customer_email'), 'maria@exemplo.pt');
  assert.equal(params.get('success_url'), 'https://renatovalente5.github.io/lfmobile/obrigado/?s={CHECKOUT_SESSION_ID}');
  assert.equal(params.get('cancel_url'), 'https://renatovalente5.github.io/lfmobile/checkout/?cancelado=1');
  assert.equal(params.get('line_items[0][quantity]'), '2');
  assert.equal(params.get('line_items[0][price_data][unit_amount]'), '5990');
  assert.equal(params.get('line_items[0][price_data][currency]'), 'eur');
  assert.equal(params.get('line_items[0][price_data][product_data][name]'), 'Auscultadores P9 (Cor: Prateado)');
  assert.equal(params.get('line_items[1][price_data][unit_amount]'), '450', 'os portes são uma linha');
  assert.equal(params.get('metadata[encomenda]'), r.json.encomenda);
  assert.equal(params.get('payment_intent_data[metadata][encomenda]'), r.json.encomenda);
  assert.equal(params.has('line_items[0][price_data][product_data][metadata][nif]'), false, 'o NIF nunca vai para a Stripe');
  assert.ok(!chamada.corpo.includes('Rua+das+Flores') && !chamada.corpo.includes('Rua%20das%20Flores'), 'a morada fica cá');
  const enc = JSON.parse(await env.ORDERS.get(`order:${r.json.encomenda}`));
  assert.equal(enc.modo, 'online');
  assert.equal(enc.estado, 'pendente');
  assert.equal(enc.historico[0].estado, 'pendente');
  assert.equal(enc.stripe.session_id, 'cs_test_a1b2c3d4e5f6');
  assert.equal(await env.ORDERS.get('session:cs_test_a1b2c3d4e5f6'), r.json.encomenda);
  assert.equal(env.ORDERS.escritas, 2);
  assert.equal(rede.resend().length, 0, 'em modo online os emails vêm com o pagamento');
});

test('modo «online»: a Stripe a recusar dá 502 e não gasta o KV; portes null com envio dá 400', async () => {
  const cat = clone(catalogoBase());
  cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat, stripe: () => new Response('{"error":{"message":"Invalid API Key"}}', { status: 401 }) });
  const env = envFalso({ STRIPE_SECRET_KEY: 'sk_test_x' });
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido() });
  assert.equal(r.status, 502);
  assert.equal(env.ORDERS.escritas, 0);
  const semPortes = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ entrega: 'continente', cliente: { ...pedidoValido().cliente, ...moradaValida() } }) });
  assert.equal(semPortes.status, 400);
  assert.match(semPortes.json.erro, /portes para esta entrega ainda não estão definidos/);
});

test('MODO=encomenda força o modo «encomenda» mesmo com o catálogo em «online»', async () => {
  const cat = clone(catalogoBase());
  cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat });
  const r = await pedir(worker, envFalso({ MODO: 'encomenda' }), 'POST', '/checkout', { corpo: pedidoValido() });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.estado, 'registada');
});

test('CORS: a pré-visualização passa, uma origem estranha leva 403, o OPTIONS responde às duas rotas', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  const boa = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido(), cabecalhos: { Origin: 'https://renatovalente5.github.io' } });
  assert.equal(boa.status, 200);
  assert.equal(boa.headers.get('Access-Control-Allow-Origin'), 'https://renatovalente5.github.io');
  assert.equal(boa.headers.get('Vary'), 'Origin');
  const local = await pedir(worker, env, 'OPTIONS', '/checkout', { cabecalhos: { Origin: 'http://localhost:4870', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(local.status, 204);
  assert.equal(local.headers.get('Access-Control-Allow-Origin'), 'http://localhost:4870');
  assert.match(local.headers.get('Access-Control-Allow-Methods'), /POST/);
  const enc = await pedir(worker, env, 'OPTIONS', '/encomenda', { cabecalhos: { Origin: 'https://renatovalente5.github.io' } });
  assert.equal(enc.status, 204);
  const ma = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido(), cabecalhos: { Origin: 'https://malandro.example' } });
  assert.equal(ma.status, 403);
  assert.equal(ma.headers.get('Access-Control-Allow-Origin'), null);
  const semOrigem = await pedir(worker, env, 'GET', '/');
  assert.equal(semOrigem.status, 200);
  assert.equal(semOrigem.headers.get('Access-Control-Allow-Origin'), null, 'sem Origin não há cabeçalhos CORS');
  assert.equal((await pedir(worker, env, 'GET', '/checkout')).status, 405);
  assert.equal((await pedir(worker, env, 'GET', '/nada')).status, 404);
});

test('o travão da Cloudflare: 429 quando o binding diz que chega', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  let n = 0;
  const env = envFalso({ TRAVAO_CHECKOUT: { limit: async ({ key }) => { assert.equal(key, 'checkout:1.2.3.4'); n += 1; return { success: n <= 2 }; } } });
  const cab = { 'CF-Connecting-IP': '1.2.3.4' };
  assert.equal((await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido(), cabecalhos: cab })).status, 200);
  assert.equal((await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido(), cabecalhos: cab })).status, 200);
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido(), cabecalhos: cab });
  assert.equal(r.status, 429);
  assert.match(r.json.erro, /Demasiadas tentativas/);
});

test('o travão de memória vale quando o binding falta: 10 por minuto por IP', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso({ TRAVAO_CHECKOUT: undefined });
  const cab = { 'CF-Connecting-IP': '9.9.9.9' };
  let ultimo = 0;
  for (let i = 0; i < 11; i++) ultimo = (await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido(), cabecalhos: cab })).status;
  assert.equal(ultimo, 429);
});
