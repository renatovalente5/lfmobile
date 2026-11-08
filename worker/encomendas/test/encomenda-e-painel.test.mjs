/* O GET /encomenda (a resposta pública, sem dados pessoais) e as rotas do painel (o segredo, a
   lista, a ficha, os estados e as transições proibidas, as notas, a saúde). */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { razaoParaNao, TRANSICOES_PAINEL, ESTADOS, metadadosDe } from '../encomenda.js';
import { catalogoBase, envFalso, redeFalsa, pedir, pedidoValido, moradaValida, registar, bearer } from './ajuda.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));
let rede;
afterEach(() => { if (rede) rede.repor(); rede = null; });

test('GET /encomenda: com a chave certa dá só o que a pessoa já sabe; sem ela, ou errada, 404', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  const { encomenda, chave } = await registar(worker, env, { cliente: { ...pedidoValido().cliente, nif: '123456789' } });
  const r = await pedir(worker, env, 'GET', `/encomenda?e=${encomenda}&c=${chave}`, { cabecalhos: { Origin: 'https://renatovalente5.github.io' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://renatovalente5.github.io');
  assert.deepEqual(r.json, {
    encomenda, estado: 'registada', modo: 'encomenda', entrega: 'levantamento', portes_por_confirmar: false,
    linhas: [{ nome: 'Auscultadores P9', qtd: 2, total_cents: 11980, escolhas: ['Cor: Prateado'] }],
    artigos_cents: 11980, portes_cents: 0, total_cents: 11980,
    cliente: { nome: 'Maria' },
  });
  const texto = JSON.stringify(r.json);
  for (const proibido of ['maria@exemplo.pt', '912', '123456789', chave, 'Rua']) assert.equal(texto.includes(proibido), false, `não pode levar ${proibido}`);
  for (const mau of [`/encomenda?e=${encomenda}&c=${'A'.repeat(20)}`, `/encomenda?e=${encomenda}`, `/encomenda?e=LF-20261108-ZZZZZZ&c=${chave}`, `/encomenda?e=${encomenda.toLowerCase()}&c=${chave}`, '/encomenda?e=order:x&c=y']) {
    const m = await pedir(worker, env, 'GET', mau);
    assert.equal(m.status, 404, mau);
    assert.deepEqual(m.json, { erro: 'Encomenda não encontrada.' });
  }
  assert.equal((await pedir(worker, env, 'GET', '/encomenda')).status, 400);
});

test('GET /encomenda?s=: pela sessão da Stripe, e a sessão paga adianta-se ao webhook', async () => {
  const cat = clone(catalogoBase());
  cat.modo = 'online';
  let paga = false;
  rede = redeFalsa({
    catalogo: cat,
    stripe: (url, init) => (init.method === 'GET'
      ? Response.json({ id: 'cs_test_a1b2c3d4e5f6', payment_status: paga ? 'paid' : 'unpaid' })
      : Response.json({ id: 'cs_test_a1b2c3d4e5f6', url: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6' })),
  });
  const env = envFalso({ STRIPE_SECRET_KEY: 'sk_test_x' });
  const { encomenda } = await registar(worker, env);
  const antes = await pedir(worker, env, 'GET', '/encomenda?s=cs_test_a1b2c3d4e5f6');
  assert.equal(antes.status, 200);
  assert.equal(antes.json.encomenda, encomenda);
  assert.equal(antes.json.estado, 'pendente');
  paga = true;
  const depois = await pedir(worker, env, 'GET', '/encomenda?s=cs_test_a1b2c3d4e5f6');
  assert.equal(depois.json.estado, 'paga', 'mostra «paga» pela sessão…');
  assert.equal(JSON.parse(await env.ORDERS.get(`order:${encomenda}`)).estado, 'pendente', '…mas quem grava é o webhook');
  assert.equal((await pedir(worker, env, 'GET', '/encomenda?s=cs_test_outra_sessao')).status, 404);
  assert.equal((await pedir(worker, env, 'GET', '/encomenda?s=lixo')).status, 404);
});

test('o painel: sem o bearer 401, com o bearer errado 401, sem segredo no Worker 503', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  assert.equal((await pedir(worker, env, 'GET', '/painel/saude')).status, 401);
  assert.equal((await pedir(worker, env, 'GET', '/painel/saude', { cabecalhos: bearer('outro') })).status, 401);
  assert.equal((await pedir(worker, env, 'GET', '/painel/encomendas', { cabecalhos: { Authorization: 'Basic abc' } })).status, 401);
  assert.equal((await pedir(worker, env, 'GET', '/painel/saude', { cabecalhos: bearer() })).status, 200);
  assert.equal((await pedir(worker, envFalso({ PAINEL_SEGREDO: '' }), 'GET', '/painel/saude', { cabecalhos: bearer() })).status, 503);
  const semCors = await pedir(worker, env, 'GET', '/painel/saude', { cabecalhos: { ...bearer(), Origin: 'https://renatovalente5.github.io' } });
  assert.equal(semCors.headers.get('Access-Control-Allow-Origin'), null, 'o painel não tem CORS');
});

test('GET /painel/saude diz o modo e o que está ligado', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const r = await pedir(worker, envFalso({ RESEND_API_KEY: 're_x' }), 'GET', '/painel/saude', { cabecalhos: bearer() });
  assert.deepEqual(r.json, { ok: true, modo: 'encomenda', stripe: false, webhook: false, email: true, dono: false, catalogo: 'ok' });
  rede.repor();
  rede = redeFalsa({ catalogo: null });
  const semCat = await pedir(worker, envFalso(), 'GET', '/painel/saude', { cabecalhos: bearer() });
  assert.equal(semCat.json.ok, true);
  assert.equal(semCat.json.modo, null);
  assert.match(semCat.json.catalogo, /HTTP 404/);
});

test('a lista do painel: as mais recentes primeiro, com o resumo, e os filtros por estado, dia e texto', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  const a = await registar(worker, env, { cliente: { nome: 'José Antão', email: 'jose@exemplo.pt', telefone: '911111111' } });
  await new Promise((r) => setTimeout(r, 5));
  const b = await registar(worker, env, { cliente: { nome: 'Maria Conceição', email: 'conceicao@exemplo.pt', telefone: '922 222 222' }, entrega: 'continente', cliente_extra: null, ...{ cliente: { nome: 'Maria Conceição', email: 'conceicao@exemplo.pt', telefone: '922 222 222', ...moradaValida() } } });
  const lista = await pedir(worker, env, 'GET', '/painel/encomendas', { cabecalhos: bearer() });
  assert.equal(lista.status, 200);
  assert.equal(lista.json.total, 2);
  assert.equal(lista.json.pagina, 1);
  assert.equal(lista.json.paginas, 1);
  assert.deepEqual(lista.json.encomendas.map((e) => e.encomenda), [b.encomenda, a.encomenda]);
  const resumo = lista.json.encomendas[1];
  assert.deepEqual(Object.keys(resumo).sort(), ['actualizada_em', 'cliente', 'criada_em', 'encomenda', 'entrega', 'estado', 'linhas', 'modo', 'total_cents']);
  assert.deepEqual(resumo.cliente, { nome: 'José Antão', telefone: '911111111' });
  assert.deepEqual(resumo.linhas, [{ nome: 'Auscultadores P9', qtd: 2 }]);
  assert.equal(resumo.estado, 'registada');
  assert.equal(JSON.stringify(lista.json).includes('jose@exemplo.pt'), false, 'o resumo não leva o email');
  // Os filtros.
  const porNome = await pedir(worker, env, 'GET', '/painel/encomendas?q=conceicao', { cabecalhos: bearer() });
  assert.deepEqual(porNome.json.encomendas.map((e) => e.encomenda), [b.encomenda], 'sem acentos nem maiúsculas');
  const porEmail = await pedir(worker, env, 'GET', '/painel/encomendas?q=JOSE@', { cabecalhos: bearer() });
  assert.deepEqual(porEmail.json.encomendas.map((e) => e.encomenda), [a.encomenda]);
  const porTelefone = await pedir(worker, env, 'GET', '/painel/encomendas?q=922222', { cabecalhos: bearer() });
  assert.deepEqual(porTelefone.json.encomendas.map((e) => e.encomenda), [b.encomenda], 'o telefone compara-se só pelos algarismos');
  const porId = await pedir(worker, env, 'GET', `/painel/encomendas?q=${a.encomenda.slice(-6).toLowerCase()}`, { cabecalhos: bearer() });
  assert.deepEqual(porId.json.encomendas.map((e) => e.encomenda), [a.encomenda]);
  const hoje = a.encomenda.slice(3, 11).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  assert.equal((await pedir(worker, env, 'GET', `/painel/encomendas?desde=${hoje}&ate=${hoje}`, { cabecalhos: bearer() })).json.total, 2);
  assert.equal((await pedir(worker, env, 'GET', '/painel/encomendas?ate=2020-01-01', { cabecalhos: bearer() })).json.total, 0);
  assert.equal((await pedir(worker, env, 'GET', '/painel/encomendas?estado=paga', { cabecalhos: bearer() })).json.total, 0);
  assert.equal((await pedir(worker, env, 'GET', '/painel/encomendas?estado=registada', { cabecalhos: bearer() })).json.total, 2);
  assert.equal((await pedir(worker, env, 'GET', '/painel/encomendas?pagina=2', { cabecalhos: bearer() })).json.encomendas.length, 0);
});

test('os metadados da chave cabem em 1 024 bytes, mesmo com um carrinho enorme', () => {
  const enc = { estado: 'registada', modo: 'encomenda', entrega: 'levantamento', total_cents: 1, criada_em: new Date().toISOString(), actualizada_em: new Date().toISOString(), cliente: { nome: 'N'.repeat(500), telefone: '9'.repeat(50), email: `${'e'.repeat(200)}@x.pt` }, linhas: Array.from({ length: 50 }, (_, i) => ({ nome: `Artigo com um nome comprido número ${i} para encher`, qtd: 1 })) };
  const m = metadadosDe(enc);
  assert.ok(JSON.stringify(m).length <= 1024, `tem ${JSON.stringify(m).length} bytes`);
  assert.ok(m.mais > 0, 'diz quantas linhas ficaram de fora');
  assert.equal(m.linhas.length + m.mais, 50);
});

test('a ficha do painel traz a encomenda inteira; um id que não existe, 404', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  const { encomenda, chave } = await registar(worker, env);
  const r = await pedir(worker, env, 'GET', `/painel/encomendas/${encomenda}`, { cabecalhos: bearer() });
  assert.equal(r.status, 200);
  assert.equal(r.json.chave, chave);
  assert.equal(r.json.cliente.email, 'maria@exemplo.pt');
  assert.equal((await pedir(worker, env, 'GET', '/painel/encomendas/LF-20261108-ZZZZZZ', { cabecalhos: bearer() })).status, 404);
  assert.equal((await pedir(worker, env, 'GET', '/painel/encomendas/lixo', { cabecalhos: bearer() })).status, 404);
  assert.equal((await pedir(worker, env, 'GET', '/painel/outra', { cabecalhos: bearer() })).status, 404);
  assert.equal((await pedir(worker, env, 'POST', `/painel/encomendas/${encomenda}`, { cabecalhos: bearer(), corpo: {} })).status, 405);
});

test('mudar o estado: registada → paga → pronta → levantada, com o histórico, as notas e os emails', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso({ RESEND_API_KEY: 're_x', STORE_EMAIL: 'dono@exemplo.pt' });
  const { encomenda } = await registar(worker, env);
  rede.chamadas.length = 0;
  const paga = await pedir(worker, env, 'POST', `/painel/encomendas/${encomenda}/estado`, { cabecalhos: bearer(), corpo: { estado: 'paga', por: 'dono@exemplo.pt', nota: 'MB WAY recebido' } });
  assert.equal(paga.status, 200, paga.texto);
  assert.equal(paga.json.estado, 'paga');
  assert.equal(paga.json.historico.length, 2);
  assert.deepEqual({ ...paga.json.historico[1], em: 'x' }, { em: 'x', estado: 'paga', por: 'dono@exemplo.pt', nota: 'MB WAY recebido' });
  assert.equal(paga.json.actualizada_em, paga.json.historico[1].em);
  let emails = rede.resend();
  assert.equal(emails.length, 1, 'marcada pelo dono, só o cliente é avisado');
  assert.match(emails[0].subject, /Pagamento recebido/);
  assert.match(emails[0].text, /pronta para levantar/);
  assert.equal(paga.json.avisos.paga.cliente, 'enviado');
  assert.equal(paga.json.avisos.paga.dono, 'não se aplica');

  rede.chamadas.length = 0;
  const pronta = await pedir(worker, env, 'POST', `/painel/encomendas/${encomenda}/estado`, { cabecalhos: bearer(), corpo: { estado: 'pronta', por: 'dono@exemplo.pt' } });
  assert.equal(pronta.status, 200, pronta.texto);
  emails = rede.resend();
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /pronta para levantar/);
  assert.match(emails[0].text, /Rua das Marcadas, 253/, 'a morada vem do catálogo (o texto do levantamento), não do código');
  assert.match(emails[0].text, /lfmobile\/contactos\//);
  assert.equal(JSON.parse(await env.ORDERS.get(`order:${encomenda}`)).estado, 'pronta');
  assert.equal(env.ORDERS.dados.get(`order:${encomenda}`).metadata.estado, 'pronta');

  rede.chamadas.length = 0;
  const levantada = await pedir(worker, env, 'POST', `/painel/encomendas/${encomenda}/estado`, { cabecalhos: bearer(), corpo: { estado: 'levantada', por: 'dono@exemplo.pt' } });
  assert.equal(levantada.status, 200);
  assert.equal(rede.resend().length, 0, '«levantada» não manda email');
  assert.equal('levantada' in (levantada.json.avisos || {}), false);
  // Final: não muda mais.
  const depois = await pedir(worker, env, 'POST', `/painel/encomendas/${encomenda}/estado`, { cabecalhos: bearer(), corpo: { estado: 'anulada', por: 'dono@exemplo.pt' } });
  assert.equal(depois.status, 409);
  assert.match(depois.json.erro, /não muda mais/);
});

test('as transições proibidas dão 409 com a razão; «avisar: false» não manda email', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso({ RESEND_API_KEY: 're_x' });
  const lev = await registar(worker, env);
  const cont = await registar(worker, env, { entrega: 'continente', cliente: { ...pedidoValido().cliente, ...moradaValida() } });
  const muda = (id, estado, extra = {}) => pedir(worker, env, 'POST', `/painel/encomendas/${id}/estado`, { cabecalhos: bearer(), corpo: { estado, por: 'dono@exemplo.pt', ...extra } });
  let r = await muda(lev.encomenda, 'enviada');
  assert.equal(r.status, 409);
  assert.match(r.json.erro, /para levantar na loja não se marca «enviada»/);
  r = await muda(cont.encomenda, 'pronta');
  assert.equal(r.status, 409);
  assert.match(r.json.erro, /uma para enviar marca-se «enviada»/);
  r = await muda(cont.encomenda, 'enviada');
  assert.equal(r.status, 409);
  assert.match(r.json.erro, /De «registada» só se passa a «paga», «anulada»/);
  r = await muda(lev.encomenda, 'registada');
  assert.equal(r.status, 409);
  r = await muda(lev.encomenda, 'reembolsada');
  assert.equal(r.status, 409, 'o reembolso é da Stripe, não do painel');
  r = await muda(lev.encomenda, 'inventado');
  assert.equal(r.status, 409);
  assert.match(r.json.erro, /não existe/);
  r = await muda(lev.encomenda, 'pendente');
  assert.equal(r.status, 409);
  assert.equal((await pedir(worker, env, 'POST', `/painel/encomendas/${lev.encomenda}/estado`, { cabecalhos: bearer(), corpo: 'lixo' })).status, 400);
  assert.equal((await muda('LF-20261108-ZZZZZZ', 'paga')).status, 404);

  rede.chamadas.length = 0;
  r = await muda(cont.encomenda, 'paga', { avisar: false });
  assert.equal(r.status, 200);
  assert.equal(rede.resend().length, 0);
  assert.equal('avisos' in r.json, false);
  r = await muda(cont.encomenda, 'enviada', { nota: 'CTT RR123456789PT' });
  assert.equal(r.status, 200);
  const emails = rede.resend();
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /seguiu/);
  assert.match(emails[0].text, /CTT RR123456789PT/);
  assert.match(emails[0].text, /Rua das Flores/);
  r = await muda(cont.encomenda, 'anulada', { nota: 'Reembolsado por MB WAY.' });
  assert.equal(r.status, 200);
  assert.match(rede.resend().at(-1).subject, /foi anulada/);
  assert.match(rede.resend().at(-1).text, /Reembolsado por MB WAY\./);
  assert.doesNotMatch(rede.resend().at(-1).text, /14 dias/, 'anulada não fala dos 14 dias');
});

test('a tabela das transições do painel está fechada sobre os estados do contrato', () => {
  for (const [de, para] of Object.entries(TRANSICOES_PAINEL)) {
    assert.ok(ESTADOS.includes(de), de);
    for (const p of para) assert.ok(ESTADOS.includes(p), p);
    assert.equal(para.includes(de), false, 'nunca para o mesmo');
  }
  for (const e of ESTADOS) assert.ok(e in TRANSICOES_PAINEL, `${e} sem linha na tabela`);
  for (const e of ESTADOS) assert.equal(razaoParaNao({ estado: 'paga', entrega: 'levantamento' }, e) === null, ['pronta', 'levantada', 'anulada'].includes(e), `paga → ${e}`);
  for (const e of ESTADOS) assert.equal(razaoParaNao({ estado: 'paga', entrega: 'continente' }, e) === null, ['enviada', 'anulada'].includes(e), `paga (envio) → ${e}`);
  assert.equal(razaoParaNao({ estado: 'falhou', entrega: 'continente' }, 'paga'), null, 'um pagamento falhado pode ser pago de outra forma');
  assert.equal(razaoParaNao({ estado: 'pendente', entrega: 'continente' }, 'paga'), null);
});

test('as notas do painel acrescentam-se e ficam na ficha', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = envFalso();
  const { encomenda } = await registar(worker, env);
  const r = await pedir(worker, env, 'POST', `/painel/encomendas/${encomenda}/nota`, { cabecalhos: bearer(), corpo: { texto: 'Ligou a perguntar pela cor.', por: 'dono@exemplo.pt' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.notas_painel.length, 1);
  assert.equal(r.json.notas_painel[0].texto, 'Ligou a perguntar pela cor.');
  assert.equal(r.json.notas_painel[0].por, 'dono@exemplo.pt');
  await pedir(worker, env, 'POST', `/painel/encomendas/${encomenda}/nota`, { cabecalhos: bearer(), corpo: { texto: 'Segunda nota' } });
  const ficha = await pedir(worker, env, 'GET', `/painel/encomendas/${encomenda}`, { cabecalhos: bearer() });
  assert.equal(ficha.json.notas_painel.length, 2);
  assert.equal(ficha.json.notas_painel[1].por, 'painel');
  const vazia = await pedir(worker, env, 'POST', `/painel/encomendas/${encomenda}/nota`, { cabecalhos: bearer(), corpo: { texto: '   ' } });
  assert.equal(vazia.status, 400);
  assert.equal(vazia.json.campo, 'texto');
});
