/* As contas e as validações (contas.js): o que, se estiver errado, cobra mal ou aceita o que não
   devia. Sem rede: só o catálogo publicado. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contas, validarPedido, validarCliente, ErroDoPedido, precoDe, escolhasDe, nifValido, limpar, hojeLisboa, centimos } from '../contas.js';
import { catalogoBase, pedidoValido, moradaValida } from './ajuda.mjs';

const cat = catalogoBase();
const zona = (id) => cat.zonas.find((z) => z.id === id);
const LEV = zona('levantamento'), CONT = zona('continente');
const HOJE = '2026-11-08';
const recusa = (fn, mensagem, campo) => {
  let e = null;
  try { fn(); } catch (x) { e = x; }
  assert.ok(e instanceof ErroDoPedido, `devia ter recusado${e ? ` (lançou ${e.message})` : ''}`);
  assert.equal(e.status, 400);
  if (mensagem) assert.match(e.message, mensagem);
  if (campo !== undefined) assert.equal(e.campo, campo);
};
const clone = (o) => JSON.parse(JSON.stringify(o));

test('o preço de hoje: normal, em promoção, promoção acabada', () => {
  const p = { preco: 59.9, precoAnterior: null, promocaoAte: '' };
  assert.deepEqual(precoDe(p, HOJE), { atual: 59.9, anterior: null });
  const promo = { preco: 49.9, precoAnterior: 59.9, promocaoAte: '2026-11-08' };
  assert.equal(precoDe(promo, '2026-11-08').atual, 49.9, 'no último dia ainda vale');
  assert.equal(precoDe(promo, '2026-11-09').atual, 59.9, 'acabada, volta o preço normal');
  assert.equal(precoDe({ preco: 49.9, precoAnterior: 59.9, promocaoAte: '' }, '2030-01-01').atual, 49.9, 'sem data, vale sempre');
  assert.equal(precoDe({ preco: 59.9, precoAnterior: 49.9, promocaoAte: '' }, HOJE).atual, 59.9, 'um «anterior» mais baixo não é promoção');
  assert.equal(precoDe({ preco: null }, HOJE).atual, null, 'sem preço, não se compra');
});

test('as contas de uma encomenda simples batem certo em cêntimos', () => {
  const c = contas(cat, [{ produto: 'fones-p9', opcoes: [1], qtd: 2 }], LEV, HOJE);
  assert.equal(c.linhas.length, 1);
  assert.deepEqual(c.linhas[0], { produto: 'fones-p9', nome: 'Auscultadores P9', qtd: 2, opcoes: [1], escolhas: ['Cor: Prateado'], unidade_cents: 5990, total_cents: 11980 });
  assert.equal(c.artigos_cents, 11980);
  assert.equal(c.portes_cents, 0);
  assert.equal(c.portes_por_confirmar, false);
  assert.equal(c.total_cents, 11980);
});

test('os cêntimos do Worker são os euros do carrinho arredondados (todos os artigos, 1 a 20 unidades)', () => {
  // O carrinho soma em euros (vírgula flutuante) e faz Math.round(total*100) no fim; o Worker
  // soma em cêntimos inteiros. Com preços de duas casas, os dois têm de dar o mesmo.
  for (const [id, p] of Object.entries(cat.produtos)) {
    if (!p.compravel) continue;
    for (let qtd = 1; qtd <= 20; qtd++) {
      const c = contas(cat, [{ produto: id, opcoes: [], qtd }], LEV, HOJE);
      assert.equal(c.total_cents, Math.round(p.preco * qtd * 100), `${id} × ${qtd}`);
    }
  }
});

test('as promoções no catálogo: em vigor cobra-se o preço baixo; acabada, o normal', () => {
  const c2 = clone(cat);
  c2.produtos['fones-p9'].precoAnterior = 79.9;
  c2.produtos['fones-p9'].promocaoAte = HOJE;
  assert.equal(contas(c2, [{ produto: 'fones-p9', opcoes: [], qtd: 1 }], LEV, HOJE).total_cents, 5990);
  assert.equal(contas(c2, [{ produto: 'fones-p9', opcoes: [], qtd: 1 }], LEV, '2026-11-09').total_cents, 7990);
});

test('as escolhas: acréscimo, índice em falta (o primeiro sem acréscimo), índice a mais ignorado', () => {
  const c2 = clone(cat);
  c2.produtos['fones-p9'].opcoes = [
    { nome: 'Cor', valores: [{ nome: 'Preto', suplemento: 0 }, { nome: 'Prateado', suplemento: 0 }] },
    { nome: 'Estojo', valores: [{ nome: 'Simples', suplemento: 0 }, { nome: 'Com carregamento sem fios', suplemento: 10 }] },
  ];
  const com = contas(c2, [{ produto: 'fones-p9', opcoes: [1, 1], qtd: 2 }], LEV, HOJE);
  assert.equal(com.linhas[0].unidade_cents, 6990);
  assert.equal(com.total_cents, 13980);
  assert.deepEqual(com.linhas[0].escolhas, ['Cor: Prateado', 'Estojo: Com carregamento sem fios']);
  const falta = contas(c2, [{ produto: 'fones-p9', opcoes: [1], qtd: 1 }], LEV, HOJE);
  assert.deepEqual(falta.linhas[0].opcoes, [1, 0]);
  assert.equal(falta.linhas[0].unidade_cents, 5990);
  const aMais = contas(c2, [{ produto: 'fones-p9', opcoes: [0, 0, 7, 9], qtd: 1 }], LEV, HOJE);
  assert.deepEqual(aMais.linhas[0].opcoes, [0, 0]);
  const semEscolhas = contas(cat, [{ produto: 'huawei-watch-d2', qtd: 1 }], LEV, HOJE);
  assert.deepEqual(semEscolhas.linhas[0].escolhas, []);
  // O primeiro valor SEM acréscimo, mesmo que não seja o primeiro da lista.
  const g = { opcoes: [{ nome: 'Tamanho', valores: [{ nome: 'Grande', suplemento: 5 }, { nome: 'Normal', suplemento: 0 }] }] };
  assert.equal(escolhasDe(g, [])[0].valor, 'Normal');
  recusa(() => contas(cat, [{ produto: 'fones-p9', opcoes: 'preto', qtd: 1 }], LEV, HOJE), /escolhas/);
});

test('os portes: valor, grátis a partir de X, zero no levantamento, null por confirmar', () => {
  const c2 = clone(cat);
  c2.portes = { continente: 5, gratisAPartirDe: 150 };
  const linhas = [{ produto: 'fones-p9', opcoes: [0], qtd: 2 }];
  const envio = contas(c2, linhas, CONT, HOJE);
  assert.equal(envio.portes_cents, 500);
  assert.equal(envio.total_cents, 12480);
  assert.equal(contas(c2, linhas, LEV, HOJE).portes_cents, 0);
  const gratis = contas(c2, [{ produto: 'fones-p9', opcoes: [0], qtd: 3 }], CONT, HOJE);
  assert.equal(gratis.portes_cents, 0, '179,70 € em artigos: a partir de 150 € é grátis');
  assert.equal(contas(c2, [{ produto: 'huawei-watch-d2', qtd: 1 }], CONT, HOJE).portes_cents, 0, 'exactamente no limiar também é grátis quando o limiar é 150 e o artigo 299,90');
  const semPortes = contas(cat, linhas, CONT, HOJE);   // o catálogo publicado ainda não tem portes
  assert.equal(semPortes.portes_por_confirmar, true);
  assert.equal(semPortes.portes_cents, 0);
  assert.equal(semPortes.total_cents, 11980, 'o total é só os artigos, como no site');
});

test('portes por confirmar com envio: segue em modo «encomenda», recusa-se em modo «online»', () => {
  const pedido = pedidoValido({ entrega: 'continente', cliente: { ...pedidoValido().cliente, ...moradaValida() } });
  assert.equal(validarPedido(pedido, cat, 'encomenda', HOJE).contas.portes_por_confirmar, true);
  recusa(() => validarPedido(pedido, cat, 'online', HOJE), /portes para esta entrega ainda não estão definidos/, 'entrega');
});

test('recusa: artigo que não existe, que não se compra, «só na loja» com envio, quantidade fora de 1–20', () => {
  recusa(() => contas(cat, [{ produto: 'nao-existe', qtd: 1 }], LEV, HOJE), /já não está à venda/);
  recusa(() => contas(cat, [{ produto: 'samsung-galaxy-s25-128gb', qtd: 1 }], LEV, HOJE), /«Samsung Galaxy S25 128 GB» já não está disponível/);
  recusa(() => contas(cat, [{ produto: 'capas', qtd: 1 }], LEV, HOJE), /já não está disponível/);   // sem preço
  recusa(() => contas(cat, [{ produto: 'pelicula-hidrogel', qtd: 1 }], CONT, HOJE), /só se levanta na loja/, 'entrega');
  assert.equal(contas(cat, [{ produto: 'pelicula-hidrogel', qtd: 1 }], LEV, HOJE).total_cents, 1250, 'para levantar, a película compra-se');
  recusa(() => contas(cat, [{ produto: 'fones-p9', qtd: 0 }], LEV, HOJE), /1 a 20/);
  recusa(() => contas(cat, [{ produto: 'fones-p9', qtd: 21 }], LEV, HOJE), /1 a 20/);
  recusa(() => contas(cat, [{ produto: 'fones-p9', qtd: 1.5 }], LEV, HOJE), /1 a 20/);
  recusa(() => contas(cat, [], LEV, HOJE), /vazio/);
  recusa(() => contas(cat, 'fones-p9', LEV, HOJE), /vazio/);
  recusa(() => contas(cat, [{ produto: 'constructor', qtd: 1 }], LEV, HOJE), /já não está à venda/);   // o protótipo não é um artigo
});

test('o cliente: email, telefone, NIF com dígito de controlo, código postal, morada só com envio', () => {
  const base = { nome: 'Ana', email: 'ana@exemplo.pt', telefone: '912345678' };
  assert.deepEqual(validarCliente(base, { envio: false }), base);
  recusa(() => validarCliente({ ...base, nome: '' }, { envio: false }), /nome/, 'nome');
  recusa(() => validarCliente({ ...base, nome: '​​' }, { envio: false }), /nome/, 'nome');   // só invisíveis
  recusa(() => validarCliente({ ...base, email: 'ana@exemplo' }, { envio: false }), /email válido/, 'email');
  recusa(() => validarCliente({ ...base, telefone: '91234' }, { envio: false }), /telemóvel/, 'telefone');
  assert.equal(validarCliente({ ...base, telefone: '+351 912 345 678' }, { envio: false }).telefone, '+351 912 345 678');
  assert.equal(validarCliente({ ...base, nif: '123 456 789' }, { envio: false }).nif, '123456789');
  recusa(() => validarCliente({ ...base, nif: '123456788' }, { envio: false }), /NIF/, 'nif');
  recusa(() => validarCliente({ ...base, nif: '12345678' }, { envio: false }), /NIF/, 'nif');
  assert.equal('nif' in validarCliente({ ...base, nif: '' }, { envio: false }), false, 'NIF vazio fica ausente');
  assert.equal(nifValido('501964843'), true);   // um NIF de empresa, válido
  assert.equal(nifValido('023456789'), false);  // começa por 0
  recusa(() => validarCliente(base, { envio: true }), /morada/, 'morada');
  recusa(() => validarCliente({ ...base, ...moradaValida(), codigoPostal: '3720100' }, { envio: true }), /0000-000/, 'codigoPostal');
  recusa(() => validarCliente({ ...base, ...moradaValida(), codigoPostal: '9000-100' }, { envio: true }), /Portugal Continental/, 'codigoPostal');
  recusa(() => validarCliente({ ...base, ...moradaValida(), localidade: ' ' }, { envio: true }), /localidade/, 'localidade');
  const c = validarCliente({ ...base, ...moradaValida(), notas: '  Deixar  na\n\n\n portaria \u0007 ' }, { envio: true });
  assert.equal(c.notas, 'Deixar na\n\nportaria');
  assert.equal(validarCliente({ ...base, email: ' MARIA@Exemplo.PT ' }, { envio: false }).email, 'maria@exemplo.pt');
});

test('o pedido inteiro: a entrega, os termos e o total têm de vir', () => {
  const ok = validarPedido(pedidoValido(), cat, 'encomenda', HOJE);
  assert.equal(ok.zona.id, 'levantamento');
  assert.equal(ok.contas.total_cents, 11980);
  recusa(() => validarPedido(pedidoValido({ entrega: 'lua' }), cat, 'encomenda', HOJE), /forma de entrega/, 'entrega');
  recusa(() => validarPedido(pedidoValido({ termos: 'sim' }), cat, 'encomenda', HOJE), /aceite os termos/, 'termos');
  recusa(() => validarPedido(pedidoValido({ total_cents: '11980' }), cat, 'encomenda', HOJE), /total/);
  recusa(() => validarPedido(pedidoValido({ entrega: 'continente' }), cat, 'encomenda', HOJE), /morada/, 'morada');
  recusa(() => validarPedido(null, cat, 'encomenda', HOJE), /inválido/);
});

test('miudezas: limpar, cêntimos, a data de Lisboa', () => {
  assert.equal(limpar('  a\u0000b   c ', 10), 'a b c');
  assert.equal(limpar('x'.repeat(50), 10), 'xxxxxxxxxx');
  assert.equal(centimos(59.9), 5990);
  assert.equal(centimos(0.1 + 0.2), 30);
  assert.match(hojeLisboa(new Date('2026-07-01T23:30:00Z')), /^2026-07-02$/, 'às 23:30 UTC de verão já é o dia seguinte em Lisboa');
  assert.equal(hojeLisboa(new Date('2026-12-01T23:30:00Z')), '2026-12-01');
});
