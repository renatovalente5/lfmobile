/* O que o site novo (9 nov 2026) acrescentou às encomendas: os portes da Nacex pelo PESO (escalões),
   o MODELO do telemóvel nas películas, e os CUPÕES (a regra, o /cupao do carrinho, o /checkout com o
   cupão, a Stripe com o desconto, os usos, o painel). Sem rede: tudo de faz-de-conta. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { contas, validarPedido, ErroDoPedido, escaloesDe, escalaoDoPeso, descontoDoCupao } from '../contas.js';
import { validarRegra, descricaoDe, normalizarCodigo, porQueNaoVale, contarUso, usosDe, gravarCupao, lerCupao } from '../cupoes.js';
import { aplicarEvento } from '../stripe.js';
import { catalogoBase, envFalso, redeFalsa, pedir, pedidoValido, moradaValida, bearer, SEGREDO } from './ajuda.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));
const HOJE = '2026-11-09';
const NACEX = [{ ate: 5, preco: 5.9 }, { ate: 30, preco: 14.9 }];
const comNacex = () => { const c = catalogoBase(); c.portes.continente = clone(NACEX); return c; };
const zona = (cat, id) => cat.zonas.find((z) => z.id === id);
let rede;
afterEach(() => { if (rede) rede.repor(); rede = null; });
const recusa = (fn, mensagem, campo) => {
  let e = null;
  try { fn(); } catch (x) { e = x; }
  assert.ok(e instanceof ErroDoPedido, `devia ter recusado${e ? ` (lançou ${e.message})` : ''}`);
  if (mensagem) assert.match(e.message, mensagem);
  if (campo !== undefined) assert.equal(e.campo, campo);
};

// ---------------------------------------------------------------- o peso
test('os escalões da Nacex: até 5 kg 5,90 €, até 30 kg 14,90 €, acima combina-se', () => {
  assert.deepEqual(escaloesDe(NACEX).map((e) => e.ate), [5, 30]);
  assert.equal(escalaoDoPeso(5, NACEX).preco, 5.9, 'exactamente 5 kg ainda é o primeiro');
  assert.equal(escalaoDoPeso(5.01, NACEX).preco, 14.9);
  assert.equal(escalaoDoPeso(30.5, NACEX), null);
  assert.deepEqual(escaloesDe(4.5), [{ ate: Infinity, preco: 4.5 }], 'um catálogo v2 (um número) vale como um escalão só');
  assert.deepEqual(escaloesDe(null), []);
});

test('os portes pelo peso da encomenda: o escalão, o grátis a partir de X, o levantamento a zero', () => {
  const cat = comNacex();
  const CONT = zona(cat, 'continente'), LEV = zona(cat, 'levantamento');
  const leve = contas(cat, [{ produto: 'fones-p9', opcoes: [0], qtd: 2 }], CONT, HOJE);
  assert.equal(leve.peso_kg, 0.6);
  assert.equal(leve.portes_cents, 590);
  assert.equal(leve.escalao_kg, 5);
  assert.equal(leve.total_cents, 11980 + 590);
  const pesada = contas(cat, [{ produto: 'coluna-pesada', qtd: 2 }], CONT, HOJE);   // 8 kg
  assert.equal(pesada.portes_cents, 1490);
  assert.equal(pesada.escalao_kg, 30);
  const demais = contas(cat, [{ produto: 'coluna-pesada', qtd: 8 }], CONT, HOJE);   // 32 kg
  assert.equal(demais.portes_por_confirmar, true);
  assert.equal(contas(cat, [{ produto: 'coluna-pesada', qtd: 2 }], LEV, HOJE).portes_cents, 0);
  const c2 = comNacex(); c2.portes.gratisAPartirDe = 100;
  assert.equal(contas(c2, [{ produto: 'coluna-pesada', qtd: 2 }], CONT, HOJE).portes_cents, 0, '179,80 € em artigos: grátis a partir de 100 €');
});

test('mais de 30 kg em modo «online»: recusa com a frase do peso; em «encomenda» segue por combinar', () => {
  const cat = comNacex();
  const pedido = pedidoValido({ entrega: 'continente', linhas: [{ produto: 'coluna-pesada', qtd: 8 }], cliente: { ...pedidoValido().cliente, ...moradaValida() } });
  recusa(() => validarPedido(pedido, cat, 'online', HOJE), /pesa mais de 30 kg/, 'entrega');
  assert.equal(validarPedido(pedido, cat, 'encomenda', HOJE).contas.portes_por_confirmar, true);
});

// ---------------------------------------------------------------- o modelo
test('o modelo do telemóvel: obrigatório nos artigos que o pedem, limpo, e nas escolhas da linha', () => {
  const cat = comNacex();
  const LEV = zona(cat, 'levantamento');
  recusa(() => contas(cat, [{ produto: 'pelicula-vidro', qtd: 1 }], LEV, HOJE), /modelo do telemóvel/);
  recusa(() => contas(cat, [{ produto: 'pelicula-vidro', qtd: 1, modelo: '   ' }], LEV, HOJE), /modelo do telemóvel/);
  const c = contas(cat, [{ produto: 'pelicula-vidro', qtd: 2, modelo: '  Samsung\tGalaxy  A55 \u0007' }], LEV, HOJE);
  assert.equal(c.linhas[0].modelo, 'Samsung Galaxy A55');
  assert.deepEqual(c.linhas[0].escolhas, ['Modelo: Samsung Galaxy A55']);
  assert.equal(c.total_cents, 1980);
  assert.equal(contas(cat, [{ produto: 'pelicula-vidro', qtd: 1, modelo: 'x'.repeat(200) }], LEV, HOJE).linhas[0].modelo.length, 80);
  const outro = contas(cat, [{ produto: 'fones-p9', opcoes: [0], qtd: 1, modelo: 'iPhone 13' }], LEV, HOJE);
  assert.equal('modelo' in outro.linhas[0], false, 'num artigo que não pede o modelo, ignora-se');
});

// ---------------------------------------------------------------- a regra do cupão
test('a regra do cupão: o código, o tipo, o valor, as datas, o limite, as categorias', () => {
  assert.equal(normalizarCodigo(' natal 10 '), 'NATAL10');
  assert.equal(normalizarCodigo('ab'), '', 'curto de mais');
  assert.equal(normalizarCodigo('olá!'), '');
  const ok = validarRegra({ codigo: 'natal10', tipo: 'percentagem', valor: 10, minimo: 20, desde: '2026-12-01', ate: '2026-12-24', limite: 50, porCliente: true, categorias: ['peliculas'] }, { categorias: ['peliculas', 'audio'] });
  assert.deepEqual(ok.regra, { codigo: 'NATAL10', tipo: 'percentagem', ativo: true, valor: 10, minimo: 20, desde: '2026-12-01', ate: '2026-12-24', limite: 50, porCliente: true, categorias: ['peliculas'] });
  assert.match(validarRegra({ codigo: 'X10', tipo: 'percentagem', valor: 95 }).erro, /1 a 90/);
  assert.match(validarRegra({ codigo: 'X10', tipo: 'valor', valor: 5.555 }).erro, /euros/);
  assert.match(validarRegra({ codigo: 'X10', tipo: 'brinde' }).erro, /tipo/);
  assert.match(validarRegra({ codigo: 'X10', tipo: 'portes', desde: '2026-12-10', ate: '2026-12-01' }).erro, /acaba antes de começar/);
  assert.match(validarRegra({ codigo: 'X10', tipo: 'portes', categorias: ['lua'] }, { categorias: ['audio'] }).erro, /«lua» não existe/);
  assert.equal(validarRegra({ codigo: 'PORTES', tipo: 'portes', valor: 99 }).regra.valor, 0);
  assert.equal(descricaoDe({ tipo: 'percentagem', valor: 10, minimo: 20, categorias: ['peliculas', 'audio'] }, { peliculas: 'Películas', audio: 'Áudio' }), '10% de desconto em Películas e Áudio, nas compras a partir de 20 €');
  assert.equal(descricaoDe({ tipo: 'valor', valor: 7.5 }), '7,50 € de desconto');
  assert.equal(descricaoDe({ tipo: 'portes' }), 'portes grátis');
});

test('o desconto: a percentagem ao cêntimo, o valor fixo nunca acima dos artigos, só nas categorias do cupão', () => {
  const linhas = [{ categoria: 'audio', total_cents: 11980 }, { categorias: 'x', categoria: 'peliculas', total_cents: 990 }];
  assert.deepEqual(descontoDoCupao({ tipo: 'percentagem', valor: 10 }, linhas, 12970), { cents: 1297, portes: false });
  assert.deepEqual(descontoDoCupao({ tipo: 'percentagem', valor: 15, categorias: ['peliculas'] }, linhas, 12970), { cents: 149, portes: false }, '15% de 9,90 € = 1,485 → 1,49');
  assert.deepEqual(descontoDoCupao({ tipo: 'valor', valor: 20, categorias: ['peliculas'] }, linhas, 12970), { cents: 990, portes: false }, 'nunca mais do que os artigos a que se aplica');
  assert.deepEqual(descontoDoCupao({ tipo: 'portes', valor: 0 }, linhas, 12970), { cents: 0, portes: true });
});

test('porque é que um cupão não vale: inactivo, antes, depois, abaixo do mínimo, gasto, já usado por este email', async () => {
  const env = envFalso();
  const r = { codigo: 'NATAL10', tipo: 'percentagem', valor: 10, ativo: true, minimo: 20, desde: '2026-12-01', ate: '2026-12-24', limite: 2, porCliente: true };
  assert.match(await porQueNaoVale(env, { ...r, ativo: false }, { hoje: '2026-12-10' }), /não existe ou já não vale/);
  assert.match(await porQueNaoVale(env, r, { hoje: '2026-11-30' }), /só vale a partir de 01\/12\/2026/);
  assert.match(await porQueNaoVale(env, r, { hoje: '2026-12-25' }), /acabou a 24\/12\/2026/);
  assert.match(await porQueNaoVale(env, r, { hoje: '2026-12-10', artigos_cents: 1999 }), /a partir de 20 €/);
  assert.equal(await porQueNaoVale(env, r, { hoje: '2026-12-10', artigos_cents: 2000 }), null, 'exactamente o mínimo vale');
  await gravarCupao(env, r);
  await contarUso(env, 'NATAL10', 'Ana@Exemplo.pt', 'LF-20261210-AAAAAA');
  assert.equal(await usosDe(env, 'NATAL10'), 1);
  assert.match(await porQueNaoVale(env, r, { hoje: '2026-12-10', email: 'ana@exemplo.pt ' }), /uma vez por cliente/);
  assert.equal(await porQueNaoVale(env, r, { hoje: '2026-12-10', email: 'rui@exemplo.pt' }), null);
  await contarUso(env, 'NATAL10', 'rui@exemplo.pt', 'LF-20261210-BBBBBB');
  assert.match(await porQueNaoVale(env, r, { hoje: '2026-12-10', email: 'joao@exemplo.pt' }), /número de vezes que podia/);
  const chaves = [...env.ORDERS.dados.keys()].filter((k) => k.startsWith('cupao-cliente:'));
  assert.equal(chaves.length, 2);
  assert.ok(chaves.every((k) => !k.includes('@')), 'o email nunca fica no KV, só o resumo');
});

// ---------------------------------------------------------------- o /cupao e o /checkout
const ORIGEM = { Origin: 'https://renatovalente5.github.io' };

test('POST /cupao: o carrinho confere o código e recebe a regra pública e o desconto', async () => {
  rede = redeFalsa({ catalogo: comNacex() });
  const env = envFalso();
  await gravarCupao(env, { codigo: 'BEMVINDO', tipo: 'percentagem', valor: 10, ativo: true, nota: 'Para o Instagram', limite: 100 });
  const ok = await pedir(worker, env, 'POST', '/cupao', { corpo: { codigo: 'bemvindo', entrega: 'levantamento', linhas: [{ produto: 'fones-p9', opcoes: [1], qtd: 2 }] }, cabecalhos: ORIGEM });
  assert.equal(ok.status, 200, ok.texto);
  assert.deepEqual(ok.json.cupao, { codigo: 'BEMVINDO', tipo: 'percentagem', valor: 10, minimo: null, categorias: [], descricao: '10% de desconto' });
  assert.equal(ok.json.desconto_cents, 1198);
  assert.equal('nota' in ok.json.cupao || 'limite' in ok.json.cupao || 'usos' in ok.json.cupao, false, 'a nota e os limites do dono não vão para o browser');
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://renatovalente5.github.io');
  const nao = await pedir(worker, env, 'POST', '/cupao', { corpo: { codigo: 'NAOHA', linhas: [] }, cabecalhos: ORIGEM });
  assert.equal(nao.status, 400);
  assert.match(nao.json.erro, /não existe/);
  const mau = await pedir(worker, env, 'POST', '/cupao', { corpo: { codigo: '<script>' }, cabecalhos: ORIGEM });
  assert.equal(mau.status, 400);
  const pre = await pedir(worker, env, 'OPTIONS', '/cupao', { cabecalhos: { ...ORIGEM, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
});

test('/checkout com cupão em modo «encomenda»: o desconto na encomenda, no total e nos emails, e o uso conta', async () => {
  rede = redeFalsa({ catalogo: comNacex() });
  const env = envFalso({ RESEND_API_KEY: 're_teste', STORE_EMAIL: 'loja@exemplo.pt' });
  await gravarCupao(env, { codigo: 'BEMVINDO', tipo: 'percentagem', valor: 10, ativo: true });
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'bemvindo', total_cents: 11980 - 1198 }), cabecalhos: ORIGEM });
  assert.equal(r.status, 200, r.texto);
  const enc = JSON.parse(await env.ORDERS.get(`order:${r.json.encomenda}`));
  assert.equal(enc.cupao, 'BEMVINDO');
  assert.equal(enc.desconto_cents, 1198);
  assert.equal(enc.total_cents, 10782);
  assert.equal(await usosDe(env, 'BEMVINDO'), 1, 'em modo encomenda, conta logo');
  const [cliente] = rede.resend();
  assert.match(cliente.text, /Cupão BEMVINDO: −11,98 €/);
  assert.match(cliente.html, /Cupão BEMVINDO/);
  const vista = await pedir(worker, env, 'GET', `/encomenda?e=${r.json.encomenda}&c=${r.json.chave}`, { cabecalhos: ORIGEM });
  assert.equal(vista.json.cupao, 'BEMVINDO');
  assert.equal(vista.json.desconto_cents, 1198);
  // o total sem o desconto já não bate: 409 (o carrinho redesenha)
  const sem = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'BEMVINDO' }), cabecalhos: ORIGEM });
  assert.equal(sem.status, 409);
});

test('/checkout com um cupão que deixou de valer: 400 com campo «cupao», e nada se grava', async () => {
  rede = redeFalsa({ catalogo: comNacex() });
  const env = envFalso();
  await gravarCupao(env, { codigo: 'VELHO', tipo: 'valor', valor: 5, ativo: true, ate: '2020-01-01' });
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'VELHO', total_cents: 11480 }), cabecalhos: ORIGEM });
  assert.equal(r.status, 400);
  assert.equal(r.json.campo, 'cupao');
  assert.match(r.json.erro, /acabou/);
  assert.equal([...env.ORDERS.dados.keys()].filter((k) => k.startsWith('order:')).length, 0);
  const inexistente = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'NAOHA', total_cents: 11980 }), cabecalhos: ORIGEM });
  assert.equal(inexistente.status, 400);
  assert.equal(inexistente.json.campo, 'cupao');
});

test('cupão de portes grátis: tira os portes da Nacex, sem desconto nos artigos', async () => {
  rede = redeFalsa({ catalogo: comNacex() });
  const env = envFalso();
  await gravarCupao(env, { codigo: 'PORTES0', tipo: 'portes', valor: 0, ativo: true });
  const corpo = pedidoValido({ entrega: 'continente', cupao: 'PORTES0', total_cents: 11980, cliente: { ...pedidoValido().cliente, ...moradaValida() } });
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo, cabecalhos: ORIGEM });
  assert.equal(r.status, 200, r.texto);
  const enc = JSON.parse(await env.ORDERS.get(`order:${r.json.encomenda}`));
  assert.equal(enc.portes_cents, 0);
  assert.equal(enc.desconto_cents, 0);
  assert.equal(enc.cupao_portes, true);
});

test('modo «online» com cupão: a Stripe recebe um cupão de uso único com o desconto, e o uso conta quando paga', async () => {
  const cat = comNacex(); cat.modo = 'online';
  const pedidosStripe = [];
  rede = redeFalsa({
    catalogo: cat,
    stripe: (url, init) => {
      pedidosStripe.push({ url, corpo: String(init.body || '') });
      if (url.endsWith('/coupons')) return Response.json({ id: 'cup_teste_123' });
      if (url.endsWith('/checkout/sessions')) return Response.json({ id: 'cs_test_a1b2c3d4e5f6', url: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6', payment_status: 'unpaid' });
      return Response.json({});
    },
  });
  const env = envFalso({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
  await gravarCupao(env, { codigo: 'BEMVINDO', tipo: 'percentagem', valor: 10, ativo: true });
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ cupao: 'BEMVINDO', total_cents: 10782 }), cabecalhos: ORIGEM });
  assert.equal(r.status, 200, r.texto);
  const cup = new URLSearchParams(pedidosStripe.find((p) => p.url.endsWith('/coupons')).corpo);
  assert.equal(cup.get('amount_off'), '1198');
  assert.equal(cup.get('currency'), 'eur');
  assert.equal(cup.get('max_redemptions'), '1');
  assert.equal(cup.get('name'), 'Cupão BEMVINDO');
  const sessao = new URLSearchParams(pedidosStripe.find((p) => p.url.endsWith('/checkout/sessions')).corpo);
  assert.equal(sessao.get('discounts[0][coupon]'), 'cup_teste_123');
  assert.equal(sessao.get('line_items[0][price_data][unit_amount]'), '5990', 'os artigos vão ao preço normal; o desconto é o cupão');
  assert.equal(await usosDe(env, 'BEMVINDO'), 0, 'em modo online, ainda não conta: falta pagar');
  // a Stripe diz que foi paga: conta (pelo webhook, ver o index.js); aqui, a regra do evento
  const enc = JSON.parse(await env.ORDERS.get(`order:${r.json.encomenda}`));
  aplicarEvento(enc, { type: 'checkout.session.completed', data: { object: { id: 'cs_test_a1b2c3d4e5f6', payment_status: 'paid', payment_method_types: ['card'] } } });
  assert.equal(enc.estado, 'paga');
});

// ---------------------------------------------------------------- o painel
test('o painel: criar, listar (com os usos e a frase), mudar e apagar um cupão; sem o segredo, 401', async () => {
  rede = redeFalsa({ catalogo: comNacex() });
  const env = envFalso();
  const sem = await pedir(worker, env, 'GET', '/painel/cupoes');
  assert.equal(sem.status, 401);
  const criar = await pedir(worker, env, 'PUT', '/painel/cupoes/natal10', { corpo: { tipo: 'percentagem', valor: 10, categorias: ['peliculas'], nota: 'Natal' }, cabecalhos: bearer() });
  assert.equal(criar.status, 200, criar.texto);
  assert.equal(criar.json.codigo, 'NATAL10');
  assert.match(criar.json.criado_em, /^\d{4}-/);
  const mau = await pedir(worker, env, 'PUT', '/painel/cupoes/natal10', { corpo: { tipo: 'percentagem', valor: 10, categorias: ['lua'] }, cabecalhos: bearer() });
  assert.equal(mau.status, 400);
  assert.equal(mau.json.campo, 'categorias');
  await contarUso(env, 'NATAL10', 'ana@exemplo.pt', 'LF-1');
  const lista = await pedir(worker, env, 'GET', '/painel/cupoes', { cabecalhos: bearer() });
  assert.equal(lista.json.cupoes.length, 1);
  assert.equal(lista.json.cupoes[0].usos, 1);
  assert.equal(lista.json.cupoes[0].descricao, '10% de desconto em peliculas');
  const mudar = await pedir(worker, env, 'PUT', '/painel/cupoes/NATAL10', { corpo: { tipo: 'percentagem', valor: 15, ativo: false }, cabecalhos: bearer() });
  assert.equal(mudar.json.valor, 15);
  assert.equal(mudar.json.ativo, false);
  assert.equal(mudar.json.criado_em, criar.json.criado_em, 'mudar não muda a data de criação');
  assert.equal((await lerCupao(env, 'NATAL10')).valor, 15);
  const apagar = await pedir(worker, env, 'DELETE', '/painel/cupoes/NATAL10', { cabecalhos: bearer() });
  assert.equal(apagar.status, 200);
  assert.equal(await lerCupao(env, 'NATAL10'), null);
  assert.equal((await pedir(worker, env, 'DELETE', '/painel/cupoes/NATAL10', { cabecalhos: bearer() })).status, 404);
  void SEGREDO;
});
