/* AS CORRIDAS (11 nov 2026, as encomendas num objecto durável): o que o KV perdia quando dois caminhos
   escreviam a mesma encomenda — a confirmação do pagamento (o callback da ifthenpay, a página, a varredura)
   e o painel —, e o que a leitura atrasada do KV (eventualmente consistente: até 60 s noutro sítio) gravava
   por cima. O objecto falso (ajuda.mjs) tem o blockConcurrencyWhile em fila, como na Cloudflare. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { gravarCupao, usosDe } from '../cupoes.js';
import { MAX_EMAILS_POR_PAGAR } from '../email.js';
import { varrer } from '../pagamento.js';
import { catalogoBase, envFalso, envIfthenpay, redeFalsa, ifthenpayFalsa, pedir, pedidoValido, bearer, CHAVES } from './ajuda.mjs';

let rede;
afterEach(() => { if (rede) rede.repor(); rede = null; });

const pidDe = (id) => `LF${id.slice(5, 11)}${id.slice(12)}`;
const callback = async (env, id) => {
  const r = await worker.fetch(new Request(`https://lfmobile-encomendas.test/ifthenpay/callback?key=${CHAVES.ANTI}&orderId=${pidDe(id)}`), env, { waitUntil() {} });
  return { status: r.status, texto: await r.text() };
};
const lerKV = async (env, id) => JSON.parse(await env.ORDERS.get(`order:${id}`));
const mudar = (env, id, estado) => pedir(worker, env, 'POST', `/painel/encomendas/${id}/estado`, { corpo: { estado, avisar: false }, cabecalhos: bearer() });
const anotar = (env, id, texto) => pedir(worker, env, 'POST', `/painel/encomendas/${id}/nota`, { corpo: { texto }, cabecalhos: bearer() });

/* Uma encomenda paga no site, pendente (Multibanco, na ifthenpay de faz-de-conta). */
async function pendente({ cupao = null, total_cents = 11980, ifp } = {}) {
  const cat = catalogoBase(); cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat, ifthenpay: ifp });
  const env = envIfthenpay({ RESEND_API_KEY: 're_x', STORE_EMAIL: 'dono@exemplo.pt' });
  if (cupao) await gravarCupao(env, cupao);
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ metodo: 'MB', ...(cupao ? { cupao: cupao.codigo } : {}), total_cents }) });
  assert.equal(r.status, 200, r.texto);
  return { env, id: r.json.encomenda, ler: () => lerKV(env, r.json.encomenda) };
}

test('o pagamento e uma nota do painel ao mesmo tempo: fica paga E com a nota', async () => {
  const { env, id, ler } = await pendente();
  rede.ifp.pagar(pidDe(id), { metodo: 'MB', cents: 11980 });
  const [pago, nota] = await Promise.all([
    callback(env, id),
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
  rede.ifp.pagar(pidDe(id), { metodo: 'MB', cents: 11980 });
  assert.equal((await callback(env, id)).status, 200);
  assert.equal((await ler()).estado, 'paga');
  // o KV de outra localização ainda mostra a versão de antes (eventualmente consistente)
  await env.ORDERS.put(`order:${id}`, antes);
  assert.equal((await anotar(env, id, 'Nota escrita longe.')).status, 200);
  const enc = await ler();
  assert.equal(enc.estado, 'paga', 'a nota juntou-se à encomenda de AGORA (a do objecto), não à cópia atrasada');
  assert.equal(enc.pagamento.metodo_pago, 'MB');
  assert.equal(enc.notas_painel.at(-1).texto, 'Nota escrita longe.');
});

test('anular uma pendente enquanto a ifthenpay confirma o pagamento: fica anulada (sem «Pagamento recebido» ao cliente), o dono é avisado para devolver, e o uso do cupão volta uma vez', async () => {
  // a anulação chega DEPOIS de a confirmação ter lido a encomenda e ANTES de gravar: de dentro da
  // própria leitura dos pagamentos, como no tempo real
  let env = null; let id = null; let anulada = null;
  const ifp = ifthenpayFalsa();
  const responder = ifp.responder.bind(ifp);
  ifp.responder = async (url, init) => {
    if (url.endsWith('/v2/payments/read') && id && !anulada) anulada = await mudar(env, id, 'anulada');
    return responder(url, init);
  };
  ({ env, id } = await pendente({ ifp, cupao: { codigo: 'UMSO', tipo: 'valor', valor: 10, ativo: true, limite: 1 }, total_cents: 10980 }));
  assert.equal(await usosDe(env, 'UMSO'), 1);
  ifp.pagar(pidDe(id), { metodo: 'MB', cents: 10980 });
  rede.chamadas.length = 0;
  const pago = await callback(env, id);
  assert.equal(pago.status, 200, pago.texto);
  assert.equal(anulada && anulada.status, 200, 'a anulação passou a meio da confirmação');
  const enc = await lerKV(env, id);
  assert.equal(enc.estado, 'anulada', 'o pagamento não grava «paga» por cima da anulação');
  assert.match(enc.historico.at(-1).nota, /A ifthenpay recebeu 109,80 € \(Multibanco\) com a encomenda «anulada»/);
  assert.deepEqual(rede.resend().map((e) => e.to[0]), ['dono@exemplo.pt'], 'só o dono, para devolver');
  assert.equal(await usosDe(env, 'UMSO'), 0, 'o uso voltou, e só uma vez');
});

test('a varredura dá por expirada enquanto o dono anula: fica anulada, sem «não se concluiu»', async () => {
  const { env, id, ler } = await pendente();
  const [a] = await Promise.all([mudar(env, id, 'anulada'), varrer(env, Date.now() + 5 * 86400000)]);
  assert.equal(a.status, 200, a.texto);
  const enc = await ler();
  assert.ok(['anulada', 'expirou'].includes(enc.estado), enc.estado);
  if (enc.estado === 'anulada') assert.equal(rede.resend().filter((e) => /não se concluiu/.test(e.subject)).length, 0);
  // uma só mudança de estado (pendente → anulada, ou → expirou): a outra viu a de agora e não fez nada
  const mudancas = enc.historico.filter((h, i, a) => i > 0 && h.estado !== a[i - 1].estado);
  assert.equal(mudancas.length, 1, JSON.stringify(enc.historico));
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

test(`o travão também nos emails sem pagamento («não se concluiu»): no máximo ${MAX_EMAILS_POR_PAGAR} por dia`, async () => {
  const cat = catalogoBase(); cat.modo = 'online';
  rede = redeFalsa({ catalogo: cat });
  const env = envIfthenpay({ RESEND_API_KEY: 're_x', STORE_EMAIL: 'dono@exemplo.pt' });
  const ids = [];
  for (let i = 0; i <= MAX_EMAILS_POR_PAGAR; i++) {
    const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ metodo: 'MBWAY' }) });
    assert.equal(r.status, 200, r.texto);
    ids.push(r.json.encomenda);
  }
  rede.chamadas.length = 0;
  const v = await varrer(env, Date.now() + 2 * 3600000);
  assert.equal(v.expiradas, ids.length);
  const aoCliente = rede.resend().filter((m) => [].concat(m.to).some((x) => x.toLowerCase() === 'maria@exemplo.pt'));
  assert.equal(aoCliente.length, MAX_EMAILS_POR_PAGAR);
  const travadas = await Promise.all(ids.map((id) => lerKV(env, id)));
  assert.ok(travadas.every((e) => e.estado === 'expirou'));
  assert.equal(travadas.filter((e) => /^travado/.test(e.avisos.expirou.cliente)).length, 1);
});
