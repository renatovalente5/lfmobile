/* O PAGAMENTO NO SITE PELA IFTHENPAY (11 nov 2026): o módulo (ifthenpay.js), o /checkout por método, a
   página de pagamento (GET /encomenda e POST /pagar), o callback, a varredura, os pagamentos a mais e os
   reembolsos. Sem rede: a ifthenpay é a de faz-de-conta (test/ajuda.mjs, ifthenpayFalsa), que responde
   com a forma das respostas de lá e recusa um pedido mal feito. */
import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import * as I from '../ifthenpay.js';
import { ULTIMA_PERGUNTA, ESPERA_MBWAY_MS, varrer, fimDaReferencia, expirar } from '../pagamento.js';
import { alterarEncomenda } from '../encomenda.js';
import { gravarCupao, usosDe } from '../cupoes.js';
import { DIAS_MULTIBANCO, MAX_PEDIDOS } from '../prazos.js';
import { catalogoBase, envFalso, envIfthenpay, redeFalsa, pedir, pedidoValido, online, bearer, CHAVES } from './ajuda.mjs';

let rede;
beforeEach(() => { ULTIMA_PERGUNTA.clear(); ESPERA_MBWAY_MS.valor = 0; });
afterEach(() => { if (rede) rede.repor(); rede = null; });
const comecar = async (o) => { const x = await online(o); rede = x.rede; x.rede.chamadas.length = 0; return x; };
const emails = () => rede.resend();
// o ctx guarda o que fica a correr depois da resposta (o waitUntil), e o teste espera por isso
async function callback(env, q) {
  const esperas = [];
  const r = await worker.fetch(new Request(`https://lfmobile-encomendas.test/ifthenpay/callback?${new URLSearchParams(q)}`), env, { waitUntil(p) { esperas.push(p); } });
  await Promise.all(esperas);
  return r;
}
const ver = (x) => pedir(worker, x.env, 'GET', `/encomenda?e=${x.numero}&c=${x.chave}`);
const pagarDeNovo = (x, corpo) => pedir(worker, x.env, 'POST', '/pagar', { corpo: { e: x.numero, c: x.chave, ...corpo } });
const mudarPrazo = (x, iso) => alterarEncomenda(x.env, x.numero, (e) => { e.pagamento.prazo = iso; return {}; });

// ---------------------------------------------------------------- o módulo

test('valores: cêntimos ↔ «12.34» com inteiros (33.61 não perde o cêntimo); o que não se reconhece é null', () => {
  assert.equal(I.paraValor(11980), '119.80');
  assert.equal(I.paraValor(5), '0.05');
  assert.equal(I.paraCentimos('33.61'), 3361);
  assert.equal(I.paraCentimos('33,6'), 3360);
  assert.equal(I.paraCentimos('119'), 11900);
  assert.equal(I.paraCentimos(33.61), 3361);
  assert.equal(I.paraCentimos('[AMOUNT]'), null);
  assert.equal(I.paraCentimos('1e3'), null);
  assert.throws(() => I.paraValor(1.5));
});

test('o id do pagamento: 14 caracteres (o tecto é 15), e volta ao número da encomenda sem ler nada', () => {
  const pid = I.idDePagamento('LF-20261111-ABCDEF');
  assert.equal(pid, 'LF261111ABCDEF');
  assert.ok(pid.length <= I.ID_MAX);
  assert.equal(I.numeroDoPagamento(pid), 'LF-20261111-ABCDEF');
  assert.equal(I.numeroDoPagamento('lf261111abcdef'), 'LF-20261111-ABCDEF');
  assert.equal(I.numeroDoPagamento('IC-123'), null);
  assert.equal(I.numeroDoPagamento('[ORDER_ID]'), null);
  assert.throws(() => I.idDePagamento('LF-2026-X'));
});

test('o telemóvel do MB WAY: «351#9…», idempotente (normalizar a própria saída dá o mesmo), só Portugal', () => {
  for (const t of ['912 345 678', '+351 912345678', '00351912345678', '351912345678', '(91) 234-5678']) {
    assert.equal(I.telemovelMbway(t), t.includes('(91)') ? '351#912345678' : '351#912345678', t);
  }
  assert.equal(I.telemovelMbway(I.telemovelMbway('912345678')), '351#912345678', 'idempotente');
  assert.equal(I.telemovelMbway('212345678'), null, 'um fixo não tem MB WAY');
  assert.equal(I.telemovelMbway('+34 612345678'), null);
});

test('as contas: METODO|CHAVE; uma mal escrita recusa-se; sem a chave de backoffice nenhum método se oferece', () => {
  assert.deepEqual(I.chavesPorMetodo({ IFTHENPAY_ACCOUNTS: 'MB|UND-1; MBWAY|RLX-2 ;' }), { MB: 'UND-1', MBWAY: 'RLX-2' });
  assert.throws(() => I.chavesPorMetodo({ IFTHENPAY_ACCOUNTS: 'MB' }), /mal formada/);
  assert.deepEqual(I.metodosLigados({ IFTHENPAY_ACCOUNTS: 'CCARD|C-1;MB|M-1', IFTHENPAY_BACKOFFICE_KEY: 'x' }), ['MB', 'CCARD'], 'pela ordem do site');
  assert.deepEqual(I.metodosLigados({ IFTHENPAY_ACCOUNTS: 'MB|M-1' }), [], 'sem backoffice não se confirma nada');
  assert.deepEqual(I.metodosLigados({ IFTHENPAY_ACCOUNTS: 'MB', IFTHENPAY_BACKOFFICE_KEY: 'x' }), [], 'mal escrita: nenhum (a saúde diz porquê)');
  assert.deepEqual(I.metodosLigados({ IFTHENPAY_ACCOUNTS: 'PAYSHOP|P-1;MB|M-1', IFTHENPAY_BACKOFFICE_KEY: 'x' }), ['MB'], 'só os três da loja');
});

test('o callback: os nomes de cada método, os marcadores por substituir deitam-se fora, e duas chaves vazias não são iguais', () => {
  const c = I.lerCallback(new URLSearchParams('key=k&orderId=[ORDER_ID]&id=LF261111ABCDEF&amount=12.30&entity=[entity]'));
  assert.equal(c.orderId, 'LF261111ABCDEF');
  assert.equal(c.valorTexto, '12.30');
  assert.equal(I.lerCallback(new URLSearchParams('anti_phishing_key=k&order_id=X1')).orderId, 'X1');
  assert.equal(I.lerCallback(new URLSearchParams('key=[ANTI_PHISHING_KEY]')).chave, null);
  assert.equal(I.chaveConfere('', ''), false);
  assert.equal(I.chaveConfere('abc', 'abc'), true);
  assert.equal(I.chaveConfere('abd', 'abc'), false);
});

test('conferir: um pagamento a menos não conta; dois pagamentos somam-se (o que está a mais devolve-se)', () => {
  assert.deepEqual(I.conferir([{ cents: 100, metodo: 'MB' }], { cents: 11980 }), { pago: false, recebido_cents: 100, n: 1 });
  const v = I.conferir([{ cents: 11980, metodo: 'MBWAY', requestId: 'R1' }, { cents: 11980, metodo: 'MB' }], { cents: 11980 });
  assert.equal(v.pago, true);
  assert.equal(v.metodo, 'MBWAY');
  assert.equal(v.recebido_cents, 23960);
  assert.equal(v.n, 2);
  assert.equal(I.dataISO('24-09-2026'), '2026-09-24', 'a forma da conta a sério');
  assert.equal(I.dataISO('2026-09-24'), '2026-09-24');
  assert.equal(I.dataISO(''), null);
});

test('a leitura dos pagamentos: uma chave de backoffice errada chega como 200 com status 403 dentro — rebenta, não diz «por pagar»', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  await assert.rejects(I.lerPagamento({ IFTHENPAY_BACKOFFICE_KEY: 'errada' }, { orderId: 'LF261111ABCDEF' }), (e) => e.ifthenpay && Number(e.estado) === 403);
  rede.ifp.pagar('LF261111ABCDEF', { metodo: 'MB', cents: 1234 });
  const lista = await I.lerPagamento({ IFTHENPAY_BACKOFFICE_KEY: CHAVES.BO }, { orderId: 'LF261111ABCDEF' });
  assert.deepEqual(lista.map((p) => [p.cents, p.metodo]), [[1234, 'MB']]);
});

test('reembolsar: o Multibanco (e um método desconhecido) não vai à API; Code 0 é recusa; um Code vazio é dúvida, não recusa', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  const env = { IFTHENPAY_BACKOFFICE_KEY: CHAVES.BO };
  await assert.rejects(I.reembolsar(env, { requestId: 'R', cents: 100, metodo: 'MB' }), /transferência/);
  await assert.rejects(I.reembolsar(env, { requestId: 'R', cents: 100, metodo: null }), /transferência/);
  assert.equal(rede.ifthenpay().length, 0);
  assert.equal(String((await I.reembolsar(env, { requestId: 'R', cents: 100, metodo: 'MBWAY' })).Code), '1');
  rede.ifp.falhar.reembolso = 'recusa';
  await assert.rejects(I.reembolsar(env, { requestId: 'R', cents: 100, metodo: 'CCARD' }), (e) => e.recusado && !e.duvida);
  rede.ifp.falhar.reembolso = 'duvida';
  await assert.rejects(I.reembolsar(env, { requestId: 'R', cents: 100, metodo: 'CCARD' }), (e) => e.duvida && !e.recusado);
});

// ---------------------------------------------------------------- o /checkout por método

test('MB WAY: a encomenda fica «pendente», o pedido vai com o id curto, o valor e o telemóvel, e o browser segue para /pagar/ (sem email ainda)', async () => {
  const x = await online({ metodo: 'MBWAY' });
  rede = x.rede;
  assert.equal(x.resposta.metodo, 'MBWAY');
  assert.equal(x.resposta.sai, false);
  assert.equal(x.resposta.proxima, `https://renatovalente5.github.io/lfmobile/pagar/?e=${x.numero}&c=${x.chave}`);
  const [pedido] = rede.ifthenpay().filter((c) => c.caminho === '/spg/payment/mbway');
  assert.deepEqual({ ...pedido.json, description: undefined }, { mbWayKey: CHAVES.MBWAY, orderId: x.pid, amount: '119.80', mobileNumber: '351#912345678', description: undefined });
  assert.match(pedido.json.description, /^LF Mobile LF-/);
  assert.doesNotMatch(pedido.corpo, /Maria|exemplo\.pt/, 'nem o nome nem o email vão para a ifthenpay');
  const enc = await x.ler();
  assert.equal(enc.estado, 'pendente');
  assert.equal(enc.pagamento.id, x.pid);
  assert.equal(enc.pagamento.metodo, 'MBWAY');
  assert.match(enc.pagamento.mbway.requestId, /^MBW/);
  assert.equal(enc.pagamento.pedidos.length, 1);
  assert.equal(rede.resend().length, 0, 'o MB WAY paga-se ali: o email é o do pagamento (ou o de não se concluir)');
});

test('Multibanco: a referência fica na encomenda (a data normalizada), o email «Falta pagar» leva-a, e o prazo cobre a validade', async () => {
  const x = await online({ metodo: 'MB' });
  rede = x.rede;
  const enc = await x.ler();
  const mb = enc.pagamento.multibanco;
  assert.equal(mb.entidade, '12345');
  assert.match(mb.referencia, /^\d{9}$/);
  assert.match(mb.expira, /^\d{4}-\d{2}-\d{2}$/, 'DD-MM-AAAA da conta a sério → AAAA-MM-DD');
  const [pedido] = rede.ifthenpay().filter((c) => c.caminho === '/multibanco/reference/init');
  assert.equal(pedido.json.expiryDays, DIAS_MULTIBANCO);
  assert.equal(pedido.json.orderId, x.pid);
  assert.ok(Date.parse(enc.pagamento.prazo) >= fimDaReferencia(mb.expira, mb.pedido_em) - 1000);
  const [email] = rede.resend();
  assert.equal(email.to[0], 'maria@exemplo.pt');
  assert.match(email.subject, /Falta pagar: referência Multibanco/);
  assert.match(email.text, /Entidade: 12345/);
  assert.match(email.text, new RegExp(`Referência: ${mb.referencia.replace(/(\d{3})(?=\d)/g, '$1 ')}`));
  assert.match(email.text, /Valor: 119,80 €/);
  assert.match(email.text, /Válida até: \d+ de \w+ de \d{4}/);
  assert.equal(enc.avisos.multibanco.cliente, 'enviado');
  assert.equal(x.resposta.sai, false);
});

test('cartão: o browser sai para o formulário da ifthenpay, que volta a /pagar/ (ok, erro, cancelado)', async () => {
  const x = await online({ metodo: 'CCARD' });
  rede = x.rede;
  assert.equal(x.resposta.sai, true);
  assert.match(x.resposta.proxima, /^https:\/\/ifthenpay\.test\/cartao\/CC/);
  const [pedido] = rede.ifthenpay().filter((c) => c.caminho.startsWith('/creditcard/init/'));
  assert.equal(pedido.caminho, `/creditcard/init/${CHAVES.CCARD}`);
  const base = `https://renatovalente5.github.io/lfmobile/pagar/?e=${x.numero}&c=${x.chave}`;
  assert.deepEqual([pedido.json.successUrl, pedido.json.errorUrl, pedido.json.cancelUrl], [`${base}&cartao=ok`, `${base}&cartao=erro`, `${base}&cartao=cancelado`]);
  assert.equal(pedido.json.language, 'pt');
});

test('o método: tem de ser um dos ligados (400 com a lista); sem backoffice, 503; o MB WAY pede um telemóvel português', async () => {
  const cat = catalogoBase(); cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat });
  const so = envIfthenpay({ IFTHENPAY_ACCOUNTS: `MB|${CHAVES.MB}` });
  let r = await pedir(worker, so, 'POST', '/checkout', { corpo: pedidoValido({ metodo: 'MBWAY' }) });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { erro: 'Escolha como quer pagar.', campo: 'metodo', metodos: ['MB'] });
  r = await pedir(worker, so, 'POST', '/checkout', { corpo: pedidoValido() });
  assert.equal(r.status, 400, 'sem método');
  r = await pedir(worker, envIfthenpay({ IFTHENPAY_BACKOFFICE_KEY: '' }), 'POST', '/checkout', { corpo: pedidoValido({ metodo: 'MB' }) });
  assert.equal(r.status, 503);
  assert.match(r.json.erro, /não está ligado/);
  r = await pedir(worker, envIfthenpay(), 'POST', '/checkout', { corpo: pedidoValido({ metodo: 'mbway', cliente: { ...pedidoValido().cliente, telefone: '+44 7700 900123' } }) });
  assert.equal(r.status, 400);
  assert.equal(r.json.campo, 'telefone');
  assert.equal(rede.ifthenpay().length, 0, 'nada foi pedido à ifthenpay');
  const env = envIfthenpay();
  r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ metodo: 'mbway', telemovel: '936 000 111' }) });
  assert.equal(r.status, 200, 'o método em minúsculas, e o telemóvel do MB WAY à parte do de contacto');
  assert.equal(rede.ifthenpay().find((c) => c.caminho === '/spg/payment/mbway').json.mobileNumber, '351#936000111');
  // GET /metodos: o que o finalizar mostra
  r = await pedir(worker, so, 'GET', '/metodos', { cabecalhos: { Origin: 'http://localhost:4870' } });
  assert.deepEqual(r.json, { metodos: ['MB'] });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'http://localhost:4870');
});

test('a ifthenpay não cria o pagamento: a encomenda fica à espera, a página diz qual falhou, e outro método resolve na mesma encomenda', async () => {
  const ifp = (await import('./ajuda.mjs')).ifthenpayFalsa();
  ifp.falhar.criar = { MBWAY: true };
  const x = await comecar({ metodo: 'MBWAY', rede: { ifthenpay: ifp } });
  assert.equal(x.resposta.proxima, `https://renatovalente5.github.io/lfmobile/pagar/?e=${x.numero}&c=${x.chave}`);
  let enc = await x.ler();
  assert.equal(enc.estado, 'pendente');
  assert.equal(enc.pagamento.pedidos[0].erro, 'ifthenpay 503');
  let r = await ver(x);
  assert.equal(r.json.pagamento.ultimo_falhou, 'MBWAY');
  assert.equal(r.json.pagamento.pode_pedir, true);
  r = await pagarDeNovo(x, { metodo: 'MBWAY' });
  assert.equal(r.status, 502);
  assert.match(r.json.erro, /Não conseguimos enviar o pedido MB WAY/);
  r = await pagarDeNovo(x, { metodo: 'MB' });
  assert.equal(r.status, 200, r.texto);
  enc = await x.ler();
  assert.equal(enc.pagamento.metodo, 'MB');
  assert.match(enc.pagamento.multibanco.referencia, /^\d{9}$/);
  assert.equal(enc.pagamento.pedidos.length, 3);
  assert.match(emails()[0].subject, /Falta pagar/);
  r = await ver(x);
  assert.equal(r.json.pagamento.multibanco.entidade, '12345');
  assert.equal('ultimo_falhou' in r.json.pagamento, false);
  assert.equal(JSON.stringify(r.json).includes('MBR'), false, 'os requestId não saem para o site');
});

// ---------------------------------------------------------------- o callback

test('o callback: uma chave errada 403; o valor do endereço não conta (a ifthenpay não confirma: 409, fica pendente); confirmado, «paga» com os emails uma vez', async () => {
  const x = await comecar({ metodo: 'MB' });
  rede.chamadas.length = 0;
  assert.equal((await callback(x.env, { key: 'errada', orderId: x.pid, amount: '119.80' })).status, 403);
  assert.equal((await callback(x.env, { key: '[ANTI_PHISHING_KEY]', orderId: x.pid })).status, 403);
  assert.equal((await callback(envIfthenpay({ IFTHENPAY_ANTIPHISHING_KEY: '' }), { key: '', orderId: x.pid })).status, 403, 'sem a chave no Worker, nem a vazia passa');
  let r = await callback(x.env, { key: CHAVES.ANTI, orderId: x.pid, amount: '119.80' });
  assert.equal(r.status, 409, 'o callback é uma campainha: quem decide é a leitura');
  assert.equal((await x.ler()).estado, 'pendente');
  // pago a menos (um MB WAY de 1 € com o mesmo id): não conta
  x.ifp.pagar(x.pid, { metodo: 'MBWAY', cents: 100 });
  assert.equal((await callback(x.env, { key: CHAVES.ANTI, orderId: x.pid, amount: '119.80' })).status, 409);
  x.ifp.pagos.delete(x.pid);
  x.ifp.pagar(x.pid, { metodo: 'MB', cents: 11980 });
  r = await callback(x.env, { key: CHAVES.ANTI, orderId: x.pid, amount: '119.80' });
  assert.equal(r.status, 200);
  const enc = await x.ler();
  assert.equal(enc.estado, 'paga');
  assert.equal(enc.historico.at(-1).por, 'ifthenpay');
  assert.equal(enc.historico.at(-1).nota, 'Multibanco');
  assert.equal(enc.pagamento.metodo_pago, 'MB');
  assert.equal(enc.pagamento.pago_cents, 11980);
  assert.match(enc.pagamento.referencia_pago, /^\d{9}$/);
  const e = emails();
  assert.deepEqual(e.map((m) => m.to[0]).sort(), ['dono@exemplo.pt', 'maria@exemplo.pt']);
  assert.match(e.find((m) => m.to[0] === 'dono@exemplo.pt').text, /Pago por Multibanco \(ifthenpay, pagamento LF\d{6}[A-Z0-9]{6}\)\./);
  // as 13 repetições deles: nada se repete
  rede.chamadas.length = 0;
  assert.equal((await callback(x.env, { key: CHAVES.ANTI, orderId: x.pid })).status, 200);
  assert.equal(emails().length, 0);
});

test('o callback sem identificador (o modelo registado não serve o método): a chave conferiu, corre a varredura e responde 200', async () => {
  const x = await comecar({ metodo: 'MB' });
  x.ifp.pagar(x.pid, { metodo: 'MB', cents: 11980 });
  const r = await callback(x.env, { key: CHAVES.ANTI, orderId: '[ORDER_ID]', id: '[ID]' });
  assert.equal(r.status, 200);
  assert.equal((await x.ler()).estado, 'paga', 'a varredura encontrou-a pela lista');
  assert.equal((await callback(x.env, { key: CHAVES.ANTI, orderId: 'IC-OUTRALOJA' })).status, 200, 'um id que não é desta loja: 200 (repetir não ajuda)');
});

test('o callback com o email em baixo: 500 (a ifthenpay repete), e a repetição manda só o que falhou', async () => {
  let emBaixo = true;
  const x = await comecar({ metodo: 'MB', rede: { resend: (url, init) => (emBaixo && JSON.parse(init.body).to[0] === 'dono@exemplo.pt' ? new Response('x', { status: 503 }) : Response.json({ id: 're_1' })) } });
  x.ifp.pagar(x.pid, { metodo: 'MB', cents: 11980 });
  rede.chamadas.length = 0;
  assert.equal((await callback(x.env, { key: CHAVES.ANTI, orderId: x.pid })).status, 500);
  let enc = await x.ler();
  assert.equal(enc.estado, 'paga', 'o dinheiro entrou: o estado grava-se antes dos emails');
  assert.deepEqual([enc.avisos.paga.cliente, enc.avisos.paga.dono], ['enviado', 'falhou']);
  emBaixo = false;
  rede.chamadas.length = 0;
  assert.equal((await callback(x.env, { key: CHAVES.ANTI, orderId: x.pid })).status, 200);
  assert.deepEqual(emails().map((m) => m.to[0]), ['dono@exemplo.pt'], 'o cliente não recebe o segundo «Pagamento recebido»');
  enc = await x.ler();
  assert.deepEqual([enc.avisos.paga.cliente, enc.avisos.paga.dono], ['enviado', 'enviado']);
});

// ---------------------------------------------------------------- a página de pagamento

test('a página, MB WAY: à espera; aceite na app → confirma-se pela leitura e fica «paga» (o carrinho da página vê-o)', async () => {
  const x = await comecar({ metodo: 'MBWAY' });
  let r = await ver(x);
  assert.equal(r.json.estado, 'pendente');
  assert.equal(r.json.pagamento.metodo, 'MBWAY');
  assert.match(r.json.pagamento.mbway.pedido_em, /^\d{4}-/);
  assert.equal(r.json.pagamento.mbway.estado, null);
  const enc = await x.ler();
  x.ifp.pagar(x.pid, { metodo: 'MBWAY', cents: 11980, requestId: enc.pagamento.mbway.requestId });
  ULTIMA_PERGUNTA.clear();
  r = await ver(x);
  assert.equal(r.json.estado, 'paga');
  assert.equal(r.json.pagamento.metodo_pago, 'MBWAY');
  assert.equal(emails().length, 2);
});

test('a página, MB WAY recusado na app: grava-se, a página mostra-o, e pede-se outro na mesma encomenda', async () => {
  const x = await comecar({ metodo: 'MBWAY' });
  const enc = await x.ler();
  // ainda à espera na app: outro pedido não sai (dois ao mesmo tempo podiam ser pagos os dois)
  let r = await pagarDeNovo(x, { metodo: 'MBWAY' });
  assert.equal(r.status, 409);
  assert.match(r.json.erro, /ainda está na app MB WAY/);
  x.ifp.mbway.set(enc.pagamento.mbway.requestId, '020');
  r = await ver(x);
  assert.equal(r.json.pagamento.mbway.estado, 'recusado');
  assert.equal((await x.ler()).pagamento.mbway.estado, 'recusado', 'gravado (uma vez)');
  r = await pagarDeNovo(x, { metodo: 'MBWAY' });
  assert.equal(r.status, 200, r.texto);
  const depois = await x.ler();
  assert.notEqual(depois.pagamento.mbway.requestId, enc.pagamento.mbway.requestId);
  assert.equal(depois.pagamento.mbway.estado, undefined);
  assert.equal(depois.pagamento.pedidos.length, 2);
});

test('a página, o travão: a ifthenpay é perguntada no máximo a cada 1,5 s (MB WAY) e 15 s (os outros), por encomenda', async () => {
  const x = await comecar({ metodo: 'MB' });
  rede.chamadas.length = 0;
  await ver(x); await ver(x); await ver(x);
  assert.equal(rede.ifthenpay().filter((c) => c.caminho === '/v2/payments/read').length, 1);
});

test('/pagar: a referência que vale é a mesma; já paga diz «paga»; fora do prazo 409; e no máximo MAX_PEDIDOS pedidos', async () => {
  const x = await comecar({ metodo: 'MB' });
  const ref = (await x.ler()).pagamento.multibanco.referencia;
  let r = await pagarDeNovo(x, { metodo: 'MB' });
  assert.equal(r.status, 200);
  assert.equal((await x.ler()).pagamento.multibanco.referencia, ref, 'uma segunda referência podia ser paga também');
  assert.equal(rede.ifthenpay().filter((c) => c.caminho === '/multibanco/reference/init').length, 0);
  // muitas vezes
  for (let i = 0; i < MAX_PEDIDOS - 1; i++) {
    r = await pagarDeNovo(x, { metodo: 'CCARD' });
    assert.equal(r.status, 200, `${i}: ${r.texto}`);
    assert.equal(r.json.sai, true);
  }
  r = await pagarDeNovo(x, { metodo: 'CCARD' });
  assert.equal(r.status, 429);
  // fora do prazo
  await mudarPrazo(x, new Date(Date.now() - 1000).toISOString());
  r = await pagarDeNovo(x, { metodo: 'CCARD' });
  assert.equal(r.status, 409);
  assert.match(r.json.erro, /prazo/);
  // a chave errada: 404, como numa encomenda que não existe
  r = await pedir(worker, x.env, 'POST', '/pagar', { corpo: { e: x.numero, c: 'A'.repeat(20), metodo: 'MB' } });
  assert.equal(r.status, 404);
});

test('/pagar com o MB WAY aceite na app mas ainda fora da lista de pagamentos: não sai outro pedido (seria um segundo pagamento)', async () => {
  const x = await comecar({ metodo: 'MBWAY' });
  x.ifp.mbway.set((await x.ler()).pagamento.mbway.requestId, '000');
  rede.chamadas.length = 0;
  const r = await pagarDeNovo(x, { metodo: 'MBWAY' });
  assert.equal(r.status, 409);
  assert.match(r.json.erro, /foi aceite: estamos a confirmá-lo/);
  assert.equal(rede.ifthenpay().filter((c) => c.caminho === '/spg/payment/mbway').length, 0);
});

test('/pagar com a encomenda já paga (o MB WAY aceite à última hora): não pede outro, diz «paga»', async () => {
  const x = await comecar({ metodo: 'MBWAY' });
  const enc = await x.ler();
  x.ifp.mbway.set(enc.pagamento.mbway.requestId, '101');
  x.ifp.pagar(x.pid, { metodo: 'MBWAY', cents: 11980, requestId: enc.pagamento.mbway.requestId });
  x.ifp.mbway.set(enc.pagamento.mbway.requestId, '101');
  rede.chamadas.length = 0;
  const r = await pagarDeNovo(x, { metodo: 'MBWAY' });
  assert.equal(r.status, 200);
  assert.equal(r.json.estado, 'paga');
  assert.equal(rede.ifthenpay().filter((c) => c.caminho === '/spg/payment/mbway').length, 0);
});

// ---------------------------------------------------------------- a varredura

test('a varredura: confirma o Multibanco que ninguém está a ver; passado o prazo, «expirou» com o email e o uso do cupão de volta', async () => {
  const cat = catalogoBase(); cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat });
  const env = envIfthenpay({ RESEND_API_KEY: 're_x', STORE_EMAIL: 'dono@exemplo.pt' });
  await gravarCupao(env, { codigo: 'UMAVEZ', tipo: 'valor', valor: 5, limite: 1, ativo: true });
  const a = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ metodo: 'MB' }) });
  const b = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ metodo: 'MBWAY', cupao: 'UMAVEZ', total_cents: 11480 }) });
  assert.equal(b.status, 200, b.texto);
  const pidA = `LF${a.json.encomenda.slice(5, 11)}${a.json.encomenda.slice(12)}`;
  rede.ifp.pagar(pidA, { metodo: 'MB', cents: 11980 });
  rede.chamadas.length = 0;
  let r = await varrer(env);
  assert.deepEqual({ ...r }, { candidatas: 2, visitadas: 2, pagas: 1, expiradas: 0, falhas: 0 });
  const ler = async (n) => JSON.parse(await env.ORDERS.get(`order:${n}`));
  assert.equal((await ler(a.json.encomenda)).estado, 'paga');
  assert.equal((await ler(b.json.encomenda)).estado, 'pendente', 'dentro do prazo, espera');
  const usos = () => usosDe(env, 'UMAVEZ');
  assert.equal(await usos(), 1);
  // uma hora depois
  rede.chamadas.length = 0;
  r = await varrer(env, Date.now() + 61 * 60000);
  assert.deepEqual({ ...r }, { candidatas: 1, visitadas: 1, pagas: 0, expiradas: 1, falhas: 0 }, 'a paga já não é candidata');
  const exp = await ler(b.json.encomenda);
  assert.equal(exp.estado, 'expirou');
  assert.equal(exp.historico.at(-1).nota, 'O prazo para pagar acabou sem pagamento.');
  assert.equal(await usos(), 0, 'o uso do cupão voltou');
  assert.deepEqual(emails().map((m) => [m.to[0], m.subject]), [['maria@exemplo.pt', `O pagamento da encomenda ${b.json.encomenda} não se concluiu`]]);
  assert.match(emails()[0].text, /O prazo para pagar acabou sem o pagamento\. Nada foi cobrado\./);
  // pago depois de expirar (o aviso chegou atrasado): fica paga, e o cupão conta outra vez
  const pidB = `LF${b.json.encomenda.slice(5, 11)}${b.json.encomenda.slice(12)}`;
  rede.ifp.pagar(pidB, { metodo: 'MBWAY', cents: 11480 });
  assert.equal((await callback(env, { key: CHAVES.ANTI, orderId: pidB })).status, 200);
  assert.equal((await ler(b.json.encomenda)).estado, 'paga');
  assert.equal(await usos(), 1);
});

test('a varredura: a segunda fonte do Multibanco (a lista) reconhece o que a leitura de pagamentos não vê; sem backoffice não faz nada', async () => {
  const x = await comecar({ metodo: 'MB' });
  x.ifp.pagar(x.pid, { metodo: 'MB', cents: 11980, soNaLista: true });
  const r = await varrer(x.env);
  assert.equal(r.pagas, 1);
  assert.equal((await x.ler()).estado, 'paga');
  assert.deepEqual(await varrer(envFalso()), { visitadas: 0, motivo: 'sem a chave de backoffice' });
});

test('a varredura depois do prazo, com o MB WAY pago e ninguém a ver: pergunta ANTES de expirar — fica «paga», sem o «não se concluiu»', async () => {
  const x = await comecar({ metodo: 'MBWAY' });
  x.ifp.pagar(x.pid, { metodo: 'MBWAY', cents: 11980 });
  const r = await varrer(x.env, Date.now() + 2 * 3600000);
  assert.deepEqual([r.pagas, r.expiradas], [1, 0]);
  assert.equal((await x.ler()).estado, 'paga');
  assert.equal(emails().filter((m) => /não se concluiu/.test(m.subject)).length, 0);
});

test('expirar confere o prazo na encomenda de AGORA: um pedido novo na página (que alarga o prazo) entre a leitura e a escrita não a deixa expirar', async () => {
  const x = await comecar({ metodo: 'MBWAY' });
  // a varredura leu-a com o prazo passado; entretanto o cliente pediu uma referência (o prazo cresceu)
  assert.equal((await expirar(x.env, x.numero, { agora: Date.now() })).estado, 'pendente', 'dentro do prazo não expira');
  await mudarPrazo(x, new Date(Date.now() - 1000).toISOString());
  assert.equal((await expirar(x.env, x.numero)).estado, 'expirou');
});

test('a varredura com a ifthenpay em baixo: não dá nada por expirado (não se sabe se foi pago)', async () => {
  const x = await comecar({ metodo: 'MBWAY' });
  x.ifp.falhar.ler = true;
  const r = await varrer(x.env, Date.now() + 2 * 3600000);
  assert.equal(r.falhas, 1);
  assert.equal(r.expiradas, 0);
  assert.equal((await x.ler()).estado, 'pendente');
});

// ---------------------------------------------------------------- o dono, os pagamentos fora de tempo e a mais

test('anular uma pendente com a referência a valer: fica dito no histórico; se o cliente a pagar, o dono recebe o aviso para devolver', async () => {
  const x = await comecar({ metodo: 'MB' });
  let r = await pedir(worker, x.env, 'POST', `/painel/encomendas/${x.numero}/estado`, { corpo: { estado: 'anulada', por: 'dono@exemplo.pt', avisar: false }, cabecalhos: bearer() });
  assert.equal(r.status, 200, r.texto);
  assert.match(r.json.historico.at(-1).nota, /A referência Multibanco continua a valer até \d{2}\/\d{2}\/\d{4} \(a ifthenpay não a deixa anular\)/);
  x.ifp.pagar(x.pid, { metodo: 'MB', cents: 11980 });
  rede.chamadas.length = 0;
  const v = await varrer(x.env);
  assert.equal(v.visitadas, 1, 'a anulada com a referência viva é candidata');
  const enc = await x.ler();
  assert.equal(enc.estado, 'anulada', 'um pagamento fora de tempo não a desanula');
  assert.match(enc.historico.at(-1).nota, /A ifthenpay recebeu 119,80 € \(Multibanco\) com a encomenda «anulada»/);
  assert.deepEqual(emails().map((m) => m.to[0]), ['dono@exemplo.pt']);
  assert.match(emails()[0].subject, /Pagamento recebido numa encomenda «anulada»/);
  // passado o fim da referência, deixa de ser candidata
  r = await varrer(x.env, Date.parse(enc.pagamento.prazo) + 1000);
  assert.equal(r.candidatas, 0);
});

test('dois pagamentos para a mesma encomenda: fica «paga» uma vez, e o dono é avisado do que está a mais', async () => {
  const x = await comecar({ metodo: 'MB' });
  x.ifp.pagar(x.pid, { metodo: 'MB', cents: 11980 });
  assert.equal((await callback(x.env, { key: CHAVES.ANTI, orderId: x.pid })).status, 200);
  rede.chamadas.length = 0;
  x.ifp.pagar(x.pid, { metodo: 'MBWAY', cents: 11980 });
  assert.equal((await callback(x.env, { key: CHAVES.ANTI, orderId: x.pid })).status, 200);
  const enc = await x.ler();
  assert.equal(enc.estado, 'paga');
  assert.equal(enc.pagamento.recebido_cents, 23960);
  assert.match(enc.historico.at(-1).nota, /Recebidos 2 pagamentos \(239,60 €\) para uma encomenda de 119,80 €: devolva 119,80 €/);
  assert.deepEqual(emails().map((m) => m.to[0]), ['dono@exemplo.pt']);
  assert.match(emails()[0].subject, /Pagamento a mais na encomenda LF-.*: 119,80 €/);
});

// ---------------------------------------------------------------- os reembolsos (rota do painel)

const reembolso = (x, corpo) => pedir(worker, x.env, 'POST', `/painel/encomendas/${x.numero}/reembolso`, { corpo: { por: 'dono@exemplo.pt', ...corpo }, cabecalhos: bearer() });
async function paga(metodo) {
  const x = await comecar({ metodo });
  const enc = await x.ler();
  const rid = metodo === 'MBWAY' ? enc.pagamento.mbway.requestId : undefined;
  x.ifp.pagar(x.pid, { metodo, cents: 11980, requestId: rid });
  assert.equal((await callback(x.env, { key: CHAVES.ANTI, orderId: x.pid })).status, 200);
  rede.chamadas.length = 0;
  return x;
}

test('reembolso MB WAY pela API: uma parte fica no histórico; o resto deixa-a «reembolsada» e avisa o cliente', async () => {
  const x = await paga('MBWAY');
  let r = await reembolso(x, { cents: 2000 });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.estado, 'paga');
  assert.equal(r.json.pagamento.reembolsado_cents, 2000);
  assert.match(r.json.historico.at(-1).nota, /Devolvidos pela ifthenpay 20,00 € \(de 119,80 €\)\./);
  const [pedido] = rede.ifthenpay().filter((c) => c.caminho === '/v2/payments/refund');
  assert.deepEqual(pedido.json, { backofficekey: CHAVES.BO, requestId: (await x.ler()).pagamento.requestId_pago, amount: '20.00' });
  assert.equal(emails().length, 0);
  r = await reembolso(x, { cents: 10000 });
  assert.equal(r.status, 400, 'mais do que falta');
  r = await reembolso(x, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.estado, 'reembolsada');
  assert.equal(r.json.pagamento.reembolsado_cents, 11980);
  assert.equal(emails().length, 1);
  assert.match(emails()[0].text, /Devolvemos 119,80 € à conta do MB WAY com que pagou/);
  assert.equal((await reembolso(x, {})).status, 409, 'reembolsada não se devolve outra vez');
});

test('reembolso Multibanco: a API não o faz (409, sem chamada); registado à mão, fica «reembolsada» com a frase da transferência', async () => {
  const x = await paga('MB');
  let r = await reembolso(x, {});
  assert.equal(r.status, 409);
  assert.match(r.json.erro, /transferência bancária: peça o IBAN/);
  assert.equal(rede.ifthenpay().length, 0);
  r = await reembolso(x, { manual: true, nota: 'Transferido para o IBAN do cliente.' });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.estado, 'reembolsada');
  assert.match(r.json.historico.at(-1).nota, /Devolvidos à mão 119,80 €\. Transferido para o IBAN do cliente\./);
  assert.match(emails()[0].text, /por transferência bancária, para o IBAN que nos indicou/);
});

test('reembolso recusado: a tranca solta-se e diz porquê; sem resposta: fica «por confirmar» e não se repete às cegas', async () => {
  const x = await paga('CCARD');
  x.ifp.falhar.reembolso = 'semSaldo';
  let r = await reembolso(x, {});
  assert.equal(r.status, 409);
  assert.match(r.json.erro, /ainda não tem saldo/);
  assert.equal((await x.ler()).pagamento.reembolso, undefined, 'a tranca soltou-se');
  x.ifp.falhar.reembolso = 'duvida';
  r = await reembolso(x, {});
  assert.equal(r.status, 502);
  assert.match(r.json.erro, /Não sabemos se o reembolso saiu/);
  assert.equal((await x.ler()).pagamento.reembolso.estado, 'por confirmar');
  x.ifp.falhar.reembolso = null;
  const antes = x.ifp.reembolsos.length;
  r = await reembolso(x, {});
  assert.equal(r.status, 409, 'não se repete às cegas');
  assert.match(r.json.erro, /ficou por confirmar/);
  assert.equal(x.ifp.reembolsos.length, antes);
  // o dono viu na ifthenpay que saiu: regista à mão
  r = await reembolso(x, { manual: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.estado, 'reembolsada');
  assert.equal(r.json.pagamento.reembolso, undefined);
});

test('reembolso: só das encomendas pagas no site; dois pedidos ao mesmo tempo não devolvem duas vezes', async () => {
  const cat = catalogoBase();
  rede = redeFalsa({ catalogo: cat });
  const env = envIfthenpay();
  const enc = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido() });
  const r0 = await pedir(worker, env, 'POST', `/painel/encomendas/${enc.json.encomenda}/reembolso`, { corpo: { por: 'x' }, cabecalhos: bearer() });
  assert.equal(r0.status, 409);
  assert.match(r0.json.erro, /não foi paga no site/);
  rede.repor();
  const x = await paga('MBWAY');
  const [a, b] = await Promise.all([reembolso(x, {}), reembolso(x, {})]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(x.ifp.reembolsos.length, 1);
});

// ---------------------------------------------------------------- a saúde

test('a saúde diz o que está ligado (nunca os valores), e ?sondar=1 prova a chave de backoffice', async () => {
  rede = redeFalsa({ catalogo: catalogoBase() });
  let r = await pedir(worker, envIfthenpay({ IFTHENPAY_ACCOUNTS: `MB|${CHAVES.MB};MBWAY|${CHAVES.MBWAY}` }), 'GET', '/painel/saude?sondar=1', { cabecalhos: bearer() });
  assert.deepEqual(r.json.pagamentos, { metodos: ['MBWAY', 'MB'], contas: ['MB', 'MBWAY'], backoffice: true, callback: true, sonda: 'ok' });
  assert.equal(r.texto.includes(CHAVES.MB) || r.texto.includes(CHAVES.BO) || r.texto.includes(CHAVES.ANTI), false, 'nenhum valor sai');
  r = await pedir(worker, envIfthenpay({ IFTHENPAY_BACKOFFICE_KEY: 'errada' }), 'GET', '/painel/saude?sondar=1', { cabecalhos: bearer() });
  assert.match(r.json.pagamentos.sonda, /^falhou: 403/);
  r = await pedir(worker, envFalso({ IFTHENPAY_ACCOUNTS: 'MB' }), 'GET', '/painel/saude', { cabecalhos: bearer() });
  assert.deepEqual(r.json.pagamentos, { metodos: [], contas: [], erro: 'conta mal formada (tem de ser METODO|CHAVE): MB|…', backoffice: false, callback: false });
});
