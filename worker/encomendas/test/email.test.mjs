/* Os emails: todos em texto E HTML, curtos, com o logótipo, o número, o total e os contactos; o
   aviso dos 14 dias onde cabe; e NUNCA a frase proibida (a do botão do DL 24/2014, art. 5.º, que o
   Renato não quer em lado nenhum — nem aqui, por isso o padrão monta-se por pedaços). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mensagens, avisar, eur } from '../email.js';
import { envFalso, catalogoBase, redeFalsa } from './ajuda.mjs';

const env = envFalso({ STORE_EMAIL: 'dono@exemplo.pt' });
const cat = catalogoBase();
const enc = {
  v: 1, encomenda: 'LF-20261108-7K2Q9M', chave: 'ABCDEFGHJKLMNPQRSTUV', modo: 'encomenda', estado: 'registada', entrega: 'continente',
  linhas: [{ produto: 'fones-p9', nome: 'Auscultadores P9', qtd: 2, opcoes: [1], escolhas: ['Cor: Prateado'], unidade_cents: 5990, total_cents: 11980 }, { produto: 'huawei-band-11', nome: 'Huawei Band 11', qtd: 1, opcoes: [], escolhas: [], unidade_cents: 6590, total_cents: 6590 }],
  artigos_cents: 18570, portes_cents: 500, portes_por_confirmar: false, total_cents: 19070,
  cliente: { nome: 'Maria Fernanda Silva', email: 'maria@exemplo.pt', telefone: '912 345 678', nif: '123456789', morada: 'Rua das Flores, 10', codigoPostal: '3720-100', localidade: 'Oliveira de Azeméis', notas: 'Tocar à campainha.' },
  termos: { aceites_em: '2026-11-08T21:02:11.000Z', pagina: 'https://renatovalente5.github.io/lfmobile/termos-e-condicoes/' },
  stripe: { session_id: 'cs_1', payment_intent: 'pi_1', metodo: 'card', pago_em: '2026-11-08T21:05:00.000Z', multibanco: { entidade: '12345', referencia: '123 456 789', validade: 1800600000, url: null }, reembolsado_cents: 19070 },
  historico: [{ em: '2026-11-08T21:02:11.000Z', estado: 'registada', por: 'site' }],
  criada_em: '2026-11-08T21:02:11.000Z', actualizada_em: '2026-11-08T21:02:11.000Z',
};
const MOMENTOS = ['registada', 'paga', 'multibanco', 'pronta', 'enviada', 'anulada', 'reembolsada', 'falhou', 'expirou'];
const semAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

test('cada momento tem o email ao cliente em texto e HTML, com o número, o logótipo e os contactos', () => {
  for (const momento of MOMENTOS) {
    const m = mensagens(env, momento, { ...enc, entrega: momento === 'pronta' ? 'levantamento' : enc.entrega }, { cat, nota: 'CTT RR1', origem: 'stripe' });
    assert.ok(m.cliente, momento);
    assert.ok(m.cliente.assunto.includes('LF-20261108-7K2Q9M'), `${momento}: o assunto leva o número`);
    assert.ok(m.cliente.texto.length > 100 && m.cliente.texto.length < 2500, `${momento}: curto (${m.cliente.texto.length})`);
    assert.match(m.cliente.texto, /^Olá Maria,/);
    assert.match(m.cliente.texto, /916 537 957 \(chamada para a rede móvel nacional\)/);
    assert.match(m.cliente.texto, /LF Mobile/);
    assert.match(m.cliente.html, /^<!DOCTYPE html/);
    assert.match(m.cliente.html, /<html lang="pt-PT"/);
    assert.match(m.cliente.html, /src="https:\/\/renatovalente5\.github\.io\/lfmobile\/assets\/img\/logo-b72d7bbaa1-128\.png"/);
    assert.match(m.cliente.html, /alt="LF Mobile"/);
    assert.match(m.cliente.html, /Encomenda LF-20261108-7K2Q9M · 8 de novembro de 2026/);
    assert.match(m.cliente.html, /obrigado\/\?e=LF-20261108-7K2Q9M&amp;c=ABCDEFGHJKLMNPQRSTUV/, 'o botão «Ver a encomenda»');
    assert.match(m.cliente.texto, /obrigado\/\?e=LF-20261108-7K2Q9M&c=ABCDEFGHJKLMNPQRSTUV/);
    assert.doesNotMatch(m.cliente.html, /<script/i);
    assert.doesNotMatch(m.cliente.texto, /undefined|null|NaN|\[object/);
    assert.doesNotMatch(m.cliente.html, /undefined|NaN|\[object/);
  }
});

const PROIBIDA = new RegExp(['obrigacao', 'de', 'pagar'].join(' '));
test('nunca a frase proibida do botão, em nenhum email, nem sem acentos', () => {
  for (const momento of MOMENTOS) {
    const m = mensagens(env, momento, enc, { cat, nota: 'nota', origem: 'stripe' });
    const tudo = semAcentos([m.cliente && m.cliente.assunto, m.cliente && m.cliente.texto, m.cliente && m.cliente.html, m.dono && m.dono.assunto, m.dono && m.dono.texto].filter(Boolean).join('\n'));
    assert.doesNotMatch(tudo, PROIBIDA, momento);
  }
});

test('os artigos, os portes e o total como o site os mostra; o aviso dos 14 dias com /desistir/ onde cabe', () => {
  const r = mensagens(env, 'registada', enc, { cat }).cliente;
  assert.match(r.texto, /2 × Auscultadores P9 \(Cor: Prateado\) — 119,80 €/);
  assert.match(r.texto, /1 × Huawei Band 11 — 65,90 €/);
  assert.match(r.texto, /Portes: 5,00 €/);
  assert.match(r.texto, /Total: 190,70 €/);
  assert.match(r.texto, /Envio para Rua das Flores, 10, 3720-100 Oliveira de Azeméis\./);
  assert.match(r.texto, new RegExp(cat.prazo.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'o prazo vem do catálogo');
  assert.match(r.texto, /Tem 14 dias depois de receber o artigo para desistir da compra, sem dar justificação/);
  assert.match(r.texto, /https:\/\/renatovalente5\.github\.io\/lfmobile\/desistir\//);
  assert.match(r.texto, /https:\/\/renatovalente5\.github\.io\/lfmobile\/termos-e-condicoes\//);
  assert.match(r.html, /href="https:\/\/renatovalente5\.github\.io\/lfmobile\/desistir\/"/);
  assert.match(r.html, /119,80&nbsp;€/);
  assert.match(r.html, /IVA incluído/);
  const gratis = mensagens(env, 'registada', { ...enc, portes_cents: 0 }, { cat }).cliente;
  assert.match(gratis.texto, /Portes: Grátis/);
  const lev = mensagens(env, 'paga', { ...enc, entrega: 'levantamento', portes_cents: 0, total_cents: 18570 }, {}).cliente;
  assert.match(lev.texto, /Levantamento na loja: Grátis/);
  assert.match(lev.texto, /Total: 185,70 €/);
  for (const momento of ['anulada', 'reembolsada', 'falhou', 'expirou']) {
    assert.doesNotMatch(mensagens(env, momento, enc, {}).cliente.texto, /14 dias/, `${momento} não fala dos 14 dias`);
  }
});

test('os emails ao dono: só nos momentos certos, com tudo o que precisa (NIF, telefone, notas)', () => {
  const comDono = { registada: true, paga: true, multibanco: false, pronta: false, enviada: false, anulada: false, reembolsada: false, falhou: true, expirou: true };
  for (const momento of MOMENTOS) {
    const m = mensagens(env, momento, enc, { cat, origem: 'stripe' });
    assert.equal(Boolean(m.dono), comDono[momento], momento);
  }
  assert.equal(mensagens(env, 'paga', enc, { origem: 'painel' }).dono, null, 'marcada pelo dono no painel, o dono não se avisa a si próprio');
  const d = mensagens(env, 'registada', enc, { cat }).dono;
  assert.equal(d.assunto, 'Nova encomenda LF-20261108-7K2Q9M — 190,70 €');
  assert.match(d.texto, /NIF: 123456789/);
  assert.match(d.texto, /Telemóvel: 912 345 678/);
  assert.match(d.texto, /Email: maria@exemplo\.pt/);
  assert.match(d.texto, /Notas: Tocar à campainha\./);
  assert.match(d.texto, /Envio para: Maria Fernanda Silva, Rua das Flores, 10, 3720-100 Oliveira de Azeméis/);
  assert.match(d.texto, /confirme o pagamento e a entrega/);
  assert.equal('html' in d, false, 'ao dono vai só texto');
  const semNif = mensagens(env, 'registada', { ...enc, cliente: { ...enc.cliente, nif: undefined, notas: undefined } }, { cat }).dono;
  assert.match(semNif.texto, /NIF: \(não indicado\)/);
  assert.doesNotMatch(semNif.texto, /Notas:/);
});

test('o Multibanco leva a entidade, a referência, o valor e a validade; a caixa é texto, não imagem', () => {
  const m = mensagens(env, 'multibanco', enc, {}).cliente;
  assert.match(m.texto, /Entidade: 12345\n  Referência: 123 456 789\n  Valor: 190,70 €\n  Válida até: \d{2}\/\d{2}\/\d{4}/);
  assert.match(m.html, /Courier New/);
  assert.match(m.html, />12345</);
  assert.doesNotMatch(m.html, /<img[^>]*voucher/);
});

test('avisar(): sem chave do Resend não manda e di-lo; com ela manda ao cliente e ao dono; sem STORE_EMAIL só ao cliente', async () => {
  const semChave = await avisar(envFalso(), 'registada', enc, { cat });
  assert.deepEqual({ ...semChave, em: 'x' }, { em: 'x', cliente: 'sem chave', dono: 'sem destinatário' });
  const rede = redeFalsa({});
  try {
    const r = await avisar(envFalso({ RESEND_API_KEY: 're_x', STORE_EMAIL: 'dono@exemplo.pt' }), 'registada', enc, { cat });
    assert.deepEqual({ ...r, em: 'x' }, { em: 'x', cliente: 'enviado', dono: 'enviado' });
    const emails = rede.resend();
    assert.equal(emails.length, 2);
    assert.equal(rede.chamadas[0].init.headers.Authorization, 'Bearer re_x');
    assert.ok(emails.every((e) => typeof e.text === 'string' && e.text.length), 'o texto nunca se omite');
    const so = await avisar(envFalso({ RESEND_API_KEY: 're_x' }), 'pronta', { ...enc, entrega: 'levantamento' }, { cat });
    assert.deepEqual({ ...so, em: 'x' }, { em: 'x', cliente: 'enviado', dono: 'não se aplica' });
    const semEmail = await avisar(envFalso({ RESEND_API_KEY: 're_x' }), 'pronta', { ...enc, cliente: { nome: 'X' } }, {});
    assert.equal(semEmail.cliente, 'sem email');
  } finally { rede.repor(); }
  assert.equal(eur(5), '0,05 €');
  assert.equal(eur(123456), '1234,56 €');
});

/* A CLOUDFLARE (Email Sending, o binding EMAIL) vem antes do Resend: com ele, o email sai por ele, com o
   remetente partido em { email, name } e a resposta para o dono; uma recusa dá «falhou». */
test('com o binding EMAIL da Cloudflare: sai por ele, com o remetente e o reply-to certos; uma recusa é «falhou»', async () => {
  const { remetenteDe } = await import('../email.js');
  assert.deepEqual(remetenteDe({ MAIL_FROM: 'LF Mobile <encomendas@lfmobile.pt>' }), { email: 'encomendas@lfmobile.pt', name: 'LF Mobile' });
  assert.deepEqual(remetenteDe({ MAIL_FROM: 'encomendas@lfmobile.pt' }), { email: 'encomendas@lfmobile.pt' });
  const rede = redeFalsa({ catalogo: cat });
  try {
    const enviados = [];
    const EMAIL = { send: async (m) => { enviados.push(m); return { messageId: 'm1' }; } };
    const r = await avisar(envFalso({ EMAIL, MAIL_FROM: 'LF Mobile <encomendas@lfmobile.pt>', STORE_EMAIL: 'dono@exemplo.pt', RESEND_API_KEY: 're_nao_usar' }), 'registada', enc, { cat });
    assert.equal(r.cliente, 'enviado');
    assert.equal(r.dono, 'enviado');
    assert.equal(enviados.length, 2);
    assert.equal(rede.resend().length, 0, 'o Resend não se usa');
    const aoCliente = enviados.find((m) => m.to === 'maria@exemplo.pt');
    assert.deepEqual(aoCliente.from, { email: 'encomendas@lfmobile.pt', name: 'LF Mobile' });
    assert.equal(aoCliente.replyTo, 'dono@exemplo.pt');
    assert.ok(aoCliente.text && aoCliente.html && aoCliente.subject.includes('LF-20261108-7K2Q9M'));
    const recusa = await avisar(envFalso({ EMAIL: { send: async () => { const e = new Error('não'); e.code = 'E_SENDER_NOT_VERIFIED'; throw e; } }, MAIL_FROM: 'x@lfmobile.pt' }), 'pronta', { ...enc, entrega: 'levantamento' }, { cat });
    assert.equal(recusa.cliente, 'falhou');
  } finally {
    rede.repor();
  }
});
