/* OS CUPÕES (o Renato, 9 nov 2026: «Vai ser para criar campanhas, cupões para os clientes usarem na
 * compra, vai ser para integrar com o Stripe»). Nunca no repositório do site (que é público: um código
 * lá escrito via-se). O dono cria-os no painel (/painel/cupoes); o carrinho confere um código (POST
 * /cupao) para mostrar o desconto; o /checkout confere tudo outra vez, RESERVA um uso e grava o
 * desconto na encomenda; em modo «online» a Stripe recebe um cupão de uso único com o valor já
 * calculado (stripe.js), e mostra «Cupão X −5,00 €» na página dela.
 *
 * GUARDADOS NUM OBJECTO DURÁVEL (Cupoes, um só para a loja, na UE — 11 nov 2026; até aí no KV): ler,
 * conferir e contar um uso é um passo só, e dois clientes no mesmo instante nunca passam o limite nem o
 * «um por cliente». O KV não tem escrita condicional: com ele, dois pedidos ao mesmo tempo liam os
 * dois «0 usos» e passavam os dois (memória kv-ler-mudar-gravar-perde-escritas; o desenho é o da
 * Franja Kids). Na primeira vez, o objecto traz do KV os cupões de antes.
 *
 * No objecto: regra:<CÓDIGO> → a regra; usos:<CÓDIGO> → o número; cliente:<CÓDIGO>:<resumo> → a
 * encomenda que o usou, quando é «um por cliente» (o resumo SHA-256 do email, nunca o email).
 *
 * A regra: { codigo, tipo: 'percentagem' | 'valor' | 'portes', valor (% ou €; nada nos portes),
 *   minimo?: € em artigos, desde?: 'AAAA-MM-DD', ate?: 'AAAA-MM-DD', limite?: usos, porCliente?: bool,
 *   categorias?: [slug] (vazio: tudo), ativo: bool, nota?: texto do dono, criado_em, actualizado_em }
 * O uso reserva-se quando a encomenda fica registada (nos dois modos) e volta quando ela não se faz (o
 * pagamento expirou ou falhou, o dono anulou-a); uma que se paga depois de expirar volta a contar, sem
 * limite (o dinheiro entrou).
 */

import { hojeLisboa } from './contas.js';
import { pedirAoObjecto, respostaJson } from './objecto.js';

export const RE_CODIGO = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;
export const TIPOS = Object.freeze({ percentagem: 'Percentagem', valor: 'Valor fixo', portes: 'Portes grátis' });
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
const dia = (d) => d.split('-').reverse().join('/');

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

/* O email como pessoa, para o «um por cliente»: sem invisíveis nem maiúsculas, sem o que vem depois
   de um «+» (ana+1@… é a ana@…), e no Gmail sem os pontos (a.na@gmail.com é a ana@gmail.com). */
export function emailCanonico(email) {
  const e = String(email || '').replace(/[\p{Cc}\p{Cf}\s]/gu, '').toLowerCase();
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

/* Porque é que este cupão não vale agora (a frase para o carrinho), ou null. `usos`: os que já tem;
   `usado`: esta pessoa já o usou (só conta nos «um por cliente»); `artigos_cents` null não confere o
   mínimo. Sem leituras: o objecto (reservar) e o /cupao chamam-na com o que leram. */
export function porQueNaoVale(r, { hoje = hojeLisboa(), artigos_cents = null, usos = 0, usado = false } = {}) {
  if (!r || r.ativo === false) return 'Este cupão não existe ou já não vale.';
  if (r.desde && hoje < r.desde) return `O cupão ${r.codigo} só vale a partir de ${dia(r.desde)}.`;
  if (r.ate && hoje > r.ate) return `O cupão ${r.codigo} acabou a ${dia(r.ate)}.`;
  if (typeof r.minimo === 'number' && r.minimo > 0 && artigos_cents !== null && artigos_cents < Math.round(r.minimo * 100)) return `O cupão ${r.codigo} é para compras a partir de ${eur(r.minimo)}.`;
  if (r.limite && usos >= r.limite) return `O cupão ${r.codigo} já foi usado o número de vezes que podia.`;
  if (r.porCliente && usado) return `O cupão ${r.codigo} só se usa uma vez por cliente, e já foi usado com este email.`;
  return null;
}

/* ---------------------------------------------------------------- o objecto durável */

export class Cupoes {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  /* Uma vez: os cupões que estavam no KV (cupao:, cupao-usos:, cupao-cliente:) passam para cá. */
  async migrar(s) {
    if (await s.get('migrado')) return;
    const kv = this.env && this.env.ORDERS;
    if (kv) {
      for (const prefixo of ['cupao:', 'cupao-cliente:']) {
        let cursor;
        do {
          const r = await kv.list({ prefix: prefixo, cursor });
          for (const k of r.keys || []) {
            const bruto = await kv.get(k.name);
            if (bruto === null) continue;
            const resto = k.name.slice(prefixo.length);
            if (prefixo === 'cupao-cliente:') { await s.put(`cliente:${resto}`, bruto); continue; }
            let regra;
            try { regra = JSON.parse(bruto); } catch (_) { continue; }
            await s.put(`regra:${resto}`, regra);
            const usos = parseInt((await kv.get(`cupao-usos:${resto}`)) || '0', 10);
            if (usos > 0) await s.put(`usos:${resto}`, usos);
          }
          cursor = r.list_complete ? null : r.cursor;
        } while (cursor);
      }
    }
    await s.put('migrado', new Date().toISOString());
  }

  async fetch(request) {
    let c;
    try { c = await request.json(); } catch { return respostaJson({ erro: 'pedido' }, 400); }
    const s = this.ctx.storage;
    let resposta = { erro: 'operação' };
    // tudo num passo: ler, conferir e escrever sem outro pedido a meio
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.migrar(s);
      if (c.op === 'listar') {
        const regras = [...(await s.list({ prefix: 'regra:' })).values()];
        const usos = regras.length ? await s.get(regras.map((r) => `usos:${r.codigo}`)) : new Map();
        resposta = { cupoes: regras.map((r) => ({ ...r, usos: usos.get(`usos:${r.codigo}`) || 0 })) };
        return;
      }
      const codigo = normalizarCodigo(c.codigo);
      if (!codigo) { resposta = { erro: 'código' }; return; }
      const regra = (await s.get(`regra:${codigo}`)) ?? null;
      const usos = (await s.get(`usos:${codigo}`)) || 0;
      if (c.op === 'ler') { resposta = { regra, usos }; return; }
      if (c.op === 'gravar') {
        const agora = typeof c.agora === 'string' ? c.agora : new Date().toISOString();
        const nova = { ...c.regra, codigo, criado_em: regra ? regra.criado_em : agora, actualizado_em: agora };
        await s.put(`regra:${codigo}`, nova);
        resposta = { regra: nova, usos };
        return;
      }
      if (c.op === 'apagar') {
        if (!regra) { resposta = { naoHa: true }; return; }
        await s.delete(`regra:${codigo}`);   // os usos e as marcas ficam: um cupão novo com o mesmo código continua a contar
        resposta = { ok: true };
        return;
      }
      const marca = typeof c.cliente === 'string' && c.cliente ? `cliente:${codigo}:${c.cliente}` : null;
      if (c.op === 'reservar' || c.op === 'contar') {
        // «reservar» confere tudo (as datas, o mínimo, o limite, o «um por cliente»); «contar» é o
        // pagamento que entrou depois de o uso voltar: conta sempre
        if (c.op === 'reservar') {
          const de = marca ? await s.get(marca) : null;
          const erro = porQueNaoVale(regra, { hoje: c.hoje || undefined, artigos_cents: c.artigos_cents ?? null, usos, usado: Boolean(de && de !== c.encomenda) });
          if (erro) { resposta = { erro }; return; }
        }
        await s.put(`usos:${codigo}`, usos + 1);
        if (marca && regra && regra.porCliente) await s.put(marca, c.encomenda || '1');
        resposta = { ok: true, usos: usos + 1 };
        return;
      }
      if (c.op === 'libertar') {
        await s.put(`usos:${codigo}`, Math.max(0, usos - 1));
        const de = marca ? await s.get(marca) : null;
        if (de && (de === c.encomenda || de === '1')) await s.delete(marca);
        resposta = { ok: true, usos: Math.max(0, usos - 1) };
      }
    });
    return respostaJson(resposta, ['pedido', 'operação', 'código'].includes(resposta.erro) ? 400 : 200);
  }
}

/* Um pedido ao objecto dos cupões (um só para a loja toda). */
export const pedirCupoes = (env, corpo) => pedirAoObjecto(env, 'CUPOES', 'cupoes', corpo);

/* A regra e os usos de um código (sem a regra: null). */
export async function lerCupaoComUsos(env, codigo) {
  const c = normalizarCodigo(codigo);
  if (!c) return { regra: null, usos: 0 };
  const r = await pedirCupoes(env, { op: 'ler', codigo: c });
  return { regra: r.regra || null, usos: r.usos || 0 };
}
export const lerCupao = async (env, codigo) => (await lerCupaoComUsos(env, codigo)).regra;
export const usosDe = async (env, codigo) => (await lerCupaoComUsos(env, codigo)).usos;

/* Reserva um uso para uma encomenda: num passo só, confere as datas, o mínimo, o limite e o «um por
   cliente», e conta. → { ok, usos } ou { erro } (a frase para o carrinho). */
export async function reservarUso(env, { codigo, email, encomenda, hoje = hojeLisboa(), artigos_cents = null }) {
  return pedirCupoes(env, { op: 'reservar', codigo: normalizarCodigo(codigo), cliente: email ? await resumoDoEmail(email) : '', encomenda, hoje, artigos_cents });
}

/* Conta um uso sem conferir (um pagamento que entrou depois de o uso ter voltado: o dinheiro entrou). */
export async function contarUso(env, codigo, email, id) {
  const c = normalizarCodigo(codigo);
  if (!c) return;
  await pedirCupoes(env, { op: 'contar', codigo: c, cliente: email ? await resumoDoEmail(email) : '', encomenda: id || '' });
}

/* Devolve o uso de uma encomenda que não se fez (o pagamento expirou ou falhou, ou o dono anulou-a):
   o contador desce um, e a marca do «um por cliente» sai se for desta encomenda. */
export async function libertarUso(env, codigo, email, id) {
  const c = normalizarCodigo(codigo);
  if (!c) return;
  await pedirCupoes(env, { op: 'libertar', codigo: c, cliente: email ? await resumoDoEmail(email) : '', encomenda: id || '' });
}

/* ---------------------------------------------------------------- o painel */

export async function listarCupoes(env) {
  const { cupoes } = await pedirCupoes(env, { op: 'listar' });
  return (cupoes || []).map((r) => ({ ...r, descricao: descricaoDe(r) }))
    .sort((a, b) => String(b.actualizado_em || '').localeCompare(String(a.actualizado_em || '')));
}

export async function gravarCupao(env, regra, { agora } = {}) {
  const r = await pedirCupoes(env, { op: 'gravar', codigo: regra.codigo, regra, ...(agora ? { agora } : {}) });
  return r.regra;
}

export async function apagarCupao(env, codigo) {
  const c = normalizarCodigo(codigo);
  if (!c) return false;
  return Boolean((await pedirCupoes(env, { op: 'apagar', codigo: c })).ok);
}
