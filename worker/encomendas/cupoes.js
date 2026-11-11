/* OS CUPÕES (o Renato, 9 nov 2026: «Vai ser para criar campanhas, cupões para os clientes usarem na
 * compra, vai ser para integrar com o Stripe»). Vivem no KV deste Worker, nunca no repositório do
 * site (que é público: um código lá escrito via-se). O dono cria-os no painel (/painel/cupoes); o
 * carrinho confere um código (POST /cupao) para mostrar o desconto; o /checkout confere tudo outra
 * vez e grava o desconto na encomenda; em modo «online» a Stripe recebe um cupão de uso único com o
 * valor já calculado (stripe.js), e mostra «Cupão X −5,00 €» na página dela.
 *
 * Chaves no KV (ORDERS):
 *   cupao:<CÓDIGO>                     a regra (JSON), sem prazo
 *   cupao-usos:<CÓDIGO>                quantas vezes foi usado (texto com o número)
 *   cupao-cliente:<CÓDIGO>:<resumo>    o email (resumo SHA-256) de quem já o usou, quando é «um por
 *                                      cliente»; 400 dias, como as encomendas
 *
 * A regra: { codigo, tipo: 'percentagem' | 'valor' | 'portes', valor (% ou €; nada nos portes),
 *   minimo?: € em artigos, desde?: 'AAAA-MM-DD', ate?: 'AAAA-MM-DD', limite?: usos, porCliente?: bool,
 *   categorias?: [slug] (vazio: tudo), ativo: bool, nota?: texto do dono, criado_em, actualizado_em }
 * Os usos contam-se quando a encomenda fica registada (modo «encomenda») ou paga (modo «online»).
 * O KV não tem escrita condicional: dois pedidos ao mesmo tempo podem passar um uso acima do limite.
 * Para uma loja pequena chega, e o painel mostra os usos.
 */

import { TTL_ENCOMENDA } from './encomenda.js';
import { hojeLisboa } from './contas.js';

export const RE_CODIGO = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;
export const TIPOS = Object.freeze({ percentagem: 'Percentagem', valor: 'Valor fixo', portes: 'Portes grátis' });
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
const chave = (c) => `cupao:${c}`;
const chaveUsos = (c) => `cupao-usos:${c}`;

/* O código como se guarda: maiúsculas, sem espaços. Inválido: ''. */
export function normalizarCodigo(c) {
  const s = String(c == null ? '' : c).trim().toUpperCase().replace(/\s+/g, '');
  return RE_CODIGO.test(s) ? s : '';
}

const eur = (v) => `${Number(v).toLocaleString('pt-PT', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} €`;

/* A frase do cupão, para o carrinho e para o painel: «10% de desconto em Películas, nas compras a
   partir de 20 €». `nomes`: { slug: nome } das categorias (do catálogo). */
export function descricaoDe(r, nomes = {}) {
  const base = r.tipo === 'portes' ? 'portes grátis' : r.tipo === 'percentagem' ? `${r.valor}% de desconto` : `${eur(r.valor)} de desconto`;
  const cats = (r.categorias || []).map((c) => nomes[c] || c);
  const onde = cats.length ? ` em ${cats.length > 1 ? `${cats.slice(0, -1).join(', ')} e ${cats[cats.length - 1]}` : cats[0]}` : '';
  const minimo = typeof r.minimo === 'number' && r.minimo > 0 ? `, nas compras a partir de ${eur(r.minimo)}` : '';
  return `${base}${onde}${minimo}`;
}

/* O que o carrinho pode saber (sem os usos nem a nota do dono). */
export function publico(r, nomes = {}) {
  return {
    codigo: r.codigo, tipo: r.tipo, valor: r.tipo === 'portes' ? 0 : r.valor,
    minimo: typeof r.minimo === 'number' && r.minimo > 0 ? r.minimo : null,
    categorias: Array.isArray(r.categorias) ? r.categorias : [],
    descricao: descricaoDe(r, nomes),
  };
}

/* Confere a regra que o painel manda gravar. → { regra } ou { erro, campo } */
export function validarRegra(bruto, { categorias = null } = {}) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  const codigo = normalizarCodigo(b.codigo);
  if (!codigo) return { erro: 'O código tem de 3 a 30 letras ou algarismos (pode ter - e _), sem espaços.', campo: 'codigo' };
  if (!Object.prototype.hasOwnProperty.call(TIPOS, b.tipo)) return { erro: 'Escolha o tipo do cupão: percentagem, valor fixo ou portes grátis.', campo: 'tipo' };
  const r = { codigo, tipo: b.tipo, ativo: b.ativo !== false };
  if (b.tipo === 'percentagem') {
    if (!Number.isInteger(b.valor) || b.valor < 1 || b.valor > 90) return { erro: 'A percentagem é um número inteiro de 1 a 90.', campo: 'valor' };
    r.valor = b.valor;
  } else if (b.tipo === 'valor') {
    if (typeof b.valor !== 'number' || !Number.isFinite(b.valor) || b.valor < 0.5 || b.valor > 1000 || Math.abs(Math.round(b.valor * 100) - b.valor * 100) > 1e-6) return { erro: 'O desconto é um valor em euros, de 0,50 a 1000 (ex.: 5 ou 7,50).', campo: 'valor' };
    r.valor = b.valor;
  } else r.valor = 0;
  if (b.minimo !== undefined && b.minimo !== null && b.minimo !== '') {
    if (typeof b.minimo !== 'number' || !Number.isFinite(b.minimo) || b.minimo < 0 || b.minimo > 100000) return { erro: 'A compra mínima é um valor em euros (ou fica vazia).', campo: 'minimo' };
    if (b.minimo > 0) r.minimo = b.minimo;
  }
  for (const k of ['desde', 'ate']) {
    if (b[k] === undefined || b[k] === null || b[k] === '') continue;
    if (typeof b[k] !== 'string' || !RE_DIA.test(b[k])) return { erro: `A data ${k === 'desde' ? 'de início' : 'de fim'} não é uma data válida.`, campo: k };
    r[k] = b[k];
  }
  if (r.desde && r.ate && r.desde > r.ate) return { erro: 'O cupão acaba antes de começar: confira as datas.', campo: 'ate' };
  if (b.limite !== undefined && b.limite !== null && b.limite !== '') {
    if (!Number.isInteger(b.limite) || b.limite < 1 || b.limite > 100000) return { erro: 'O limite de usos é um número inteiro (ou fica vazio: sem limite).', campo: 'limite' };
    r.limite = b.limite;
  }
  if (b.porCliente === true) r.porCliente = true;
  if (b.categorias !== undefined && b.categorias !== null) {
    if (!Array.isArray(b.categorias) || !b.categorias.every((c) => typeof c === 'string' && /^[a-z0-9-]{1,60}$/.test(c))) return { erro: 'As categorias do cupão não se reconhecem.', campo: 'categorias' };
    if (categorias) { const fora = b.categorias.find((c) => !categorias.includes(c)); if (fora) return { erro: `A categoria «${fora}» não existe na loja.`, campo: 'categorias' }; }
    if (b.categorias.length) r.categorias = [...new Set(b.categorias)];
  }
  if (typeof b.nota === 'string' && b.nota.trim()) r.nota = b.nota.trim().replace(/\s+/g, ' ').slice(0, 200);
  return { regra: r };
}

export async function lerCupao(env, codigo) {
  const c = normalizarCodigo(codigo);
  if (!c) return null;
  const bruto = await env.ORDERS.get(chave(c));
  if (!bruto) return null;
  try { return JSON.parse(bruto); } catch (_) { return null; }
}
export async function usosDe(env, codigo) {
  const n = parseInt((await env.ORDERS.get(chaveUsos(codigo))) || '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* O email como pessoa, para o «um por cliente»: sem invisíveis nem maiúsculas, sem o que vem depois
   de um «+» (ana+1@… é a ana@…), e no Gmail sem os pontos (a.na@gmail.com é a ana@gmail.com). */
export function emailCanonico(email) {
  const e = String(email || '').replace(/[\u0000-\u001F\u007F­​-‍⁠﻿\s]/g, '').toLowerCase();
  const i = e.lastIndexOf('@');
  if (i < 1) return e;
  const local = e.slice(0, i).split('+')[0];
  const dominio = e.slice(i + 1);
  if (dominio === 'gmail.com' || dominio === 'googlemail.com') return `${local.replace(/\./g, '')}@gmail.com`;
  return `${local}@${dominio}`;
}

/* O resumo do email de um cliente (para o «um por cliente», sem guardar o email). */
export async function resumoDoEmail(email) {
  const dados = new TextEncoder().encode(`lfmobile-cupao:${emailCanonico(email)}`);
  const h = await crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/* Porque é que este cupão não vale agora (a frase para o carrinho), ou null. `email` só no
   /checkout (o «um por cliente» confere-se aí). */
export async function porQueNaoVale(env, r, { hoje = hojeLisboa(), artigos_cents = null, email = '' } = {}) {
  if (!r || r.ativo === false) return 'Este cupão não existe ou já não vale.';
  if (r.desde && hoje < r.desde) return `O cupão ${r.codigo} só vale a partir de ${r.desde.split('-').reverse().join('/')}.`;
  if (r.ate && hoje > r.ate) return `O cupão ${r.codigo} acabou a ${r.ate.split('-').reverse().join('/')}.`;
  if (typeof r.minimo === 'number' && r.minimo > 0 && artigos_cents !== null && artigos_cents < Math.round(r.minimo * 100)) return `O cupão ${r.codigo} é para compras a partir de ${eur(r.minimo)}.`;
  if (r.limite && (await usosDe(env, r.codigo)) >= r.limite) return `O cupão ${r.codigo} já foi usado o número de vezes que podia.`;
  if (r.porCliente && email && (await env.ORDERS.get(`cupao-cliente:${r.codigo}:${await resumoDoEmail(email)}`))) return `O cupão ${r.codigo} só se usa uma vez por cliente, e já foi usado com este email.`;
  return null;
}

/* Conta um uso: logo que a encomenda fica registada, também em modo «online» (é uma reserva: antes,
   só contava quando o pagamento entrava, e um cupão de um uso servia a várias encomendas abertas ao
   mesmo tempo). Lê e escreve: ver a nota do topo (dois pedidos no MESMO instante ainda passam os
   dois; fechar isso de todo pede um Durable Object). */
export async function contarUso(env, codigo, email, id) {
  const c = normalizarCodigo(codigo);
  if (!c) return;
  await env.ORDERS.put(chaveUsos(c), String((await usosDe(env, c)) + 1));
  const r = await lerCupao(env, c);
  if (r && r.porCliente && email) await env.ORDERS.put(`cupao-cliente:${c}:${await resumoDoEmail(email)}`, id || '1', { expirationTtl: TTL_ENCOMENDA });
}

/* Devolve o uso de uma encomenda que não se fez (o pagamento expirou ou falhou, ou o dono anulou-a):
   o contador desce um, e a marca do «um por cliente» sai se for desta encomenda. */
export async function libertarUso(env, codigo, email, id) {
  const c = normalizarCodigo(codigo);
  if (!c) return;
  await env.ORDERS.put(chaveUsos(c), String(Math.max(0, (await usosDe(env, c)) - 1)));
  if (email) {
    const k = `cupao-cliente:${c}:${await resumoDoEmail(email)}`;
    const de = await env.ORDERS.get(k);
    if (de && (de === id || de === '1')) await env.ORDERS.delete(k);
  }
}

/* ---------------------------------------------------------------- o painel */

export async function listarCupoes(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.ORDERS.list({ prefix: 'cupao:', cursor, limit: 1000 });
    for (const k of r.keys || []) {
      const bruto = await env.ORDERS.get(k.name);
      if (!bruto) continue;
      try {
        const regra = JSON.parse(bruto);
        out.push({ ...regra, usos: await usosDe(env, regra.codigo), descricao: descricaoDe(regra) });
      } catch (_) { /* uma regra estragada não pára a lista */ }
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out.sort((a, b) => String(b.actualizado_em || '').localeCompare(String(a.actualizado_em || '')));
}

export async function gravarCupao(env, regra, { agora = new Date().toISOString() } = {}) {
  const antes = await lerCupao(env, regra.codigo);
  const r = { ...regra, criado_em: (antes && antes.criado_em) || agora, actualizado_em: agora };
  await env.ORDERS.put(chave(regra.codigo), JSON.stringify(r));
  return r;
}

export async function apagarCupao(env, codigo) {
  const c = normalizarCodigo(codigo);
  if (!c) return false;
  if (!(await env.ORDERS.get(chave(c)))) return false;
  await env.ORDERS.delete(chave(c));
  return true;
}
