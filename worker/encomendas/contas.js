/* AS CONTAS E AS VALIDAÇÕES DO /checkout.
 *
 * O site manda só os artigos (o id, as escolhas, a quantidade), a entrega e o que mostrou como
 * total. O Worker refaz TUDO do seu lado com o catálogo publicado: nunca se cobra o que o browser
 * diz. As regras são as mesmas do carrinho (src/scripts/carrinho.js) e das regras do site
 * (src/lib/regras.mjs: precoDe, opcoesDe, compravel, enviavel, nifValido), para o carrinho e o
 * Worker nunca discordarem — quando discordam (um preço mudou entretanto) o Worker responde 409
 * e o site redesenha.
 *
 * Tudo em CÊNTIMOS INTEIROS: 0.1 + 0.2 !== 0.3 em vírgula flutuante, e um cêntimo a mais num
 * total é uma diferença contabilística. O site soma em euros e arredonda no fim; com preços de
 * duas casas decimais, o resultado é o mesmo (os testes provam-no com o catálogo publicado).
 */

export const MAX_QTD = 20;        // a mesma do carrinho (MAX_QTD)
export const MAX_LINHAS = 50;     // mais do que isto não é um carrinho, é um script

export const centimos = (v) => Math.round(v * 100);

/* A data de hoje em Lisboa («AAAA-MM-DD»), a mesma que o carrinho usa para saber se uma promoção
   ainda vale: o Worker corre em UTC, e à meia-noite de Lisboa a promoção acaba em Lisboa. */
export const hojeLisboa = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/* O preço que vale hoje (regras.mjs, precoDe): acabada a promoção, volta o preço normal. */
export function precoDe(p, hoje) {
  if (typeof p.preco !== 'number') return { atual: null, anterior: null };
  const emPromocao = Boolean(p.precoAnterior) && p.precoAnterior > p.preco && (!p.promocaoAte || hoje <= p.promocaoAte);
  if (emPromocao) return { atual: p.preco, anterior: p.precoAnterior };
  if (p.precoAnterior && p.promocaoAte && hoje > p.promocaoAte) return { atual: p.precoAnterior, anterior: null };
  return { atual: p.preco, anterior: null };
}

/* As escolhas de uma linha (carrinho.js, escolhasDe): o valor escolhido em cada grupo, ou o
   primeiro sem acréscimo quando o índice falta ou já não existe (o artigo mudou no painel).
   Índices a mais ignoram-se. */
export function escolhasDe(p, opcoes) {
  return (p.opcoes || []).map((g, i) => {
    let j = (opcoes || [])[i];
    if (!Number.isInteger(j) || !g.valores[j]) j = Math.max(0, g.valores.findIndex((x) => !x.suplemento));
    return { grupo: g.nome, valor: g.valores[j].nome, suplemento: g.valores[j].suplemento || 0, indice: j };
  });
}

/* Um pedido recusado: a frase em português vai tal e qual para o site, e `campo` diz que campo
   do formulário marcar. */
export class ErroDoPedido extends Error {
  constructor(mensagem, { campo = null, status = 400 } = {}) {
    super(mensagem);
    this.name = 'ErroDoPedido';
    this.campo = campo;
    this.status = status;
  }
}

const nomeDe = (p) => (p && (p.nomeCurto || p.nome)) || '';

/* As linhas da encomenda já com os preços de hoje, e os totais. Lança ErroDoPedido quando um
   artigo não existe, não se compra, não se envia para a entrega escolhida, ou a quantidade
   não presta. `zona` é a zona de entrega escolhida (de cat.zonas). */
export function contas(cat, linhas, zona, hoje = hojeLisboa()) {
  if (!Array.isArray(linhas) || !linhas.length) throw new ErroDoPedido('O carrinho está vazio.');
  if (linhas.length > MAX_LINHAS) throw new ErroDoPedido('O carrinho tem artigos a mais. Divida a encomenda em duas.');
  const envio = Boolean(zona && zona.morada);
  const saida = [];
  let artigos_cents = 0;
  for (const l of linhas) {
    if (!l || typeof l !== 'object' || typeof l.produto !== 'string') throw new ErroDoPedido('Um artigo do carrinho não se reconhece. Veja o carrinho outra vez.');
    const p = Object.prototype.hasOwnProperty.call(cat.produtos || {}, l.produto) ? cat.produtos[l.produto] : null;
    if (!p) throw new ErroDoPedido('Um artigo do carrinho já não está à venda. Tire-o do carrinho para continuar.');
    const base = precoDe(p, hoje).atual;
    if (!p.compravel || base === null) throw new ErroDoPedido(`«${nomeDe(p)}» já não está disponível. Tire-o do carrinho para continuar.`);
    if (envio && p.enviavel === false) throw new ErroDoPedido(`«${nomeDe(p)}» só se levanta na loja: escolha o levantamento ou tire-o do carrinho.`, { campo: 'entrega' });
    if (!Number.isInteger(l.qtd) || l.qtd < 1 || l.qtd > MAX_QTD) throw new ErroDoPedido(`A quantidade de cada artigo vai de 1 a ${MAX_QTD}.`);
    if (l.opcoes !== undefined && (!Array.isArray(l.opcoes) || !l.opcoes.every((x) => Number.isInteger(x) && x >= 0))) throw new ErroDoPedido('As escolhas de um artigo não se reconhecem. Veja o carrinho outra vez.');
    const escolhas = escolhasDe(p, l.opcoes);
    const unidade_cents = centimos(base) + escolhas.reduce((s, x) => s + centimos(x.suplemento), 0);
    const total_cents = unidade_cents * l.qtd;
    artigos_cents += total_cents;
    saida.push({
      produto: l.produto,
      nome: p.nome,
      qtd: l.qtd,
      opcoes: escolhas.map((x) => x.indice),
      escolhas: escolhas.map((x) => `${x.grupo}: ${x.valor}`),
      unidade_cents,
      total_cents,
    });
  }
  // Os portes (carrinho.js, contas): zero no levantamento; grátis a partir de X em artigos;
  // por confirmar (null) quando o dono ainda não os definiu no painel.
  let portes_cents = 0;
  let portes_por_confirmar = false;
  if (envio) {
    const v = (cat.portes || {})[zona.id];
    const gratis = (cat.portes || {}).gratisAPartirDe;
    if (typeof gratis === 'number' && artigos_cents >= centimos(gratis)) portes_cents = 0;
    else if (typeof v === 'number') portes_cents = centimos(v);
    else portes_por_confirmar = true;
  }
  return { linhas: saida, artigos_cents, portes_cents, portes_por_confirmar, total_cents: artigos_cents + portes_cents };
}

/* ---------------------------------------------------------------- os dados do cliente */

/* Tira os caracteres de controlo e os invisíveis (um nome só de espaços de largura zero passava
   num trim(): memória trim-nao-tira-invisiveis), junta os espaços e corta ao tamanho. */
const RE_INVISIVEIS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‍⁠﻿­]/g;
export function limpar(v, max, { linhas = false } = {}) {
  let s = String(v == null ? '' : v).replace(RE_INVISIVEIS, ' ');
  s = linhas ? s.replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max).trim();
}

export const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;          // a mesma do carrinho
export const emailValido = (v) => typeof v === 'string' && v.length <= 160 && RE_EMAIL.test(v);
export const telefoneValido = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length >= 9 && d.length <= 15; };

/* NIF português (regras.mjs, nifValido): 9 algarismos, o primeiro nunca é 0, e o de controlo
   (módulo 11). */
export function nifValido(nif) {
  const s = String(nif ?? '').replace(/\s/g, '');
  if (!/^[1-9][0-9]{8}$/.test(s)) return false;
  let soma = 0;
  for (let i = 0; i < 8; i++) soma += Number(s[i]) * (9 - i);
  const resto = soma % 11;
  return (resto < 2 ? 0 : 11 - resto) === Number(s[8]);
}

/* Código postal no formato 0000-000 E do continente: os começados por 9 são a Madeira (9000–9399)
   e os Açores (9500–9980), e o site promete envios só para Portugal Continental (os portes são os
   do continente). */
export const RE_CODIGO_POSTAL = /^\d{4}-\d{3}$/;
export const RE_CODIGO_POSTAL_CONTINENTE = /^[1-8]\d{3}-\d{3}$/;

/* Os dados do cliente, limpos e conferidos. As frases são as do carrinho (campo a campo), para
   a pessoa ler o mesmo quer o browser quer o Worker recusem. */
export function validarCliente(bruto, { envio }) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  const c = {
    nome: limpar(b.nome, 120),
    email: limpar(b.email, 160).toLowerCase(),
    telefone: limpar(b.telefone, 40),
  };
  if (!c.nome) throw new ErroDoPedido('Escreva o seu nome.', { campo: 'nome' });
  if (!emailValido(c.email)) throw new ErroDoPedido('Escreva um email válido: é para onde enviamos a confirmação.', { campo: 'email' });
  if (!telefoneValido(c.telefone)) throw new ErroDoPedido('Escreva o seu número de telemóvel.', { campo: 'telefone' });
  const nif = limpar(b.nif, 20).replace(/\s/g, '');
  if (nif) {
    if (!nifValido(nif)) throw new ErroDoPedido('O NIF tem 9 algarismos. Verifique-o ou deixe em branco.', { campo: 'nif' });
    c.nif = nif;
  }
  if (envio) {
    c.morada = limpar(b.morada, 200);
    c.codigoPostal = limpar(b.codigoPostal, 12);
    c.localidade = limpar(b.localidade, 100);
    if (!c.morada) throw new ErroDoPedido('Escreva a morada de entrega.', { campo: 'morada' });
    if (!RE_CODIGO_POSTAL.test(c.codigoPostal)) throw new ErroDoPedido('Escreva o código postal no formato 0000-000.', { campo: 'codigoPostal' });
    if (!RE_CODIGO_POSTAL_CONTINENTE.test(c.codigoPostal)) throw new ErroDoPedido('Só enviamos para Portugal Continental. Para a Madeira ou os Açores, fale connosco pelo WhatsApp.', { campo: 'codigoPostal' });
    if (!c.localidade) throw new ErroDoPedido('Escreva a localidade.', { campo: 'localidade' });
  }
  const notas = limpar(b.notas, 1000, { linhas: true });
  if (notas) c.notas = notas;
  return c;
}

/* O pedido inteiro do /checkout: a zona, as contas, o cliente, os termos. Devolve o que a
   encomenda vai levar; lança ErroDoPedido com a frase para o site. */
export function validarPedido(corpo, cat, modo, hoje = hojeLisboa()) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroDoPedido('Pedido inválido.');
  const zonas = Array.isArray(cat.zonas) ? cat.zonas : [];
  const zona = zonas.find((z) => z && z.id === corpo.entrega);
  if (!zona) throw new ErroDoPedido('Escolha a forma de entrega.', { campo: 'entrega' });
  const c = contas(cat, corpo.linhas, zona, hoje);
  // Portes por definir com envio: em modo «online» não há como cobrá-los, por isso não se segue;
  // em modo «encomenda» a encomenda segue com portes_por_confirmar e o email di-lo.
  if (c.portes_por_confirmar && modo === 'online') {
    throw new ErroDoPedido('Os portes para esta entrega ainda não estão definidos. Escolha o levantamento na loja ou fale connosco pelo WhatsApp.', { campo: 'entrega' });
  }
  const cliente = validarCliente(corpo.cliente, { envio: Boolean(zona.morada) });
  if (corpo.termos !== true) throw new ErroDoPedido('Para continuar, aceite os termos e condições.', { campo: 'termos' });
  if (!Number.isInteger(corpo.total_cents)) throw new ErroDoPedido('Pedido inválido: falta o total.');
  return { zona, contas: c, cliente };
}
