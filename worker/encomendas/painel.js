/* AS ROTAS DO PAINEL (§5 do contrato): o painel (renatovalente5/lfmobile-painel) nunca lê o KV;
 * fala com estas rotas com `Authorization: Bearer <PAINEL_SEGREDO>` (o mesmo segredo nos dois
 * Workers). Sem o segredo, 401; sem CORS (é servidor a servidor).
 *
 *   GET  /painel/saude
 *   GET  /painel/encomendas?estado=&desde=&ate=&q=&pagina=
 *   GET  /painel/encomendas/<id>
 *   POST /painel/encomendas/<id>/estado   { estado, nota?, por, avisar? }
 *   POST /painel/encomendas/<id>/nota     { texto, por }
 *   GET    /painel/cupoes                 os cupões, com os usos
 *   PUT    /painel/cupoes/<CÓDIGO>        cria ou muda um cupão (a regra: cupoes.js, validarRegra)
 *   DELETE /painel/cupoes/<CÓDIGO>        apaga um cupão (as encomendas que o usaram ficam como estão)
 */

import { json, lerCorpoJson } from './http.js';
import { lerEncomenda, gravarEncomenda, mudarEstado, razaoParaNao, resumoDeMetadados, RE_ID, iguais, agoraISO } from './encomenda.js';
import { lerCatalogo, modoDe } from './catalogo.js';
import { avisar } from './email.js';
import { limpar } from './contas.js';
import { listarCupoes, validarRegra, gravarCupao, apagarCupao, normalizarCodigo, libertarUso } from './cupoes.js';
import { fecharPagamento } from './stripe.js';

const POR_PAGINA = 200;
/* As transições do painel que avisam o cliente (§6). «levantada» não manda nada. */
const AVISAM = ['paga', 'pronta', 'enviada', 'anulada'];

export async function rotaPainel(request, env, url, caminho) {
  if (!env.PAINEL_SEGREDO) return json({ erro: 'O painel não está ligado: falta o PAINEL_SEGREDO no Worker.' }, 503);
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  if (!m || !iguais(m[1].trim(), env.PAINEL_SEGREDO)) return json({ erro: 'Não autorizado.' }, 401);

  const resto = caminho.slice('/painel'.length);
  if (resto === '/saude') return request.method === 'GET' ? saude(env) : json({ erro: 'Método não permitido.' }, 405);
  if (resto === '/encomendas') return request.method === 'GET' ? listar(env, url) : json({ erro: 'Método não permitido.' }, 405);
  if (resto === '/cupoes') return request.method === 'GET' ? json({ cupoes: await listarCupoes(env) }) : json({ erro: 'Método não permitido.' }, 405);
  const rc = /^\/cupoes\/([^/]+)$/.exec(resto);
  if (rc) return cupao(request, env, decodeURIComponent(rc[1]));
  const r = /^\/encomendas\/([^/]+)(?:\/(estado|nota))?$/.exec(resto);
  if (!r) return json({ erro: 'Rota desconhecida.' }, 404);
  const id = r[1];
  if (!RE_ID.test(id)) return json({ erro: 'Encomenda não encontrada.' }, 404);
  if (!r[2]) {
    if (request.method !== 'GET') return json({ erro: 'Método não permitido.' }, 405);
    const enc = await lerEncomenda(env, id);
    return enc ? json(enc) : json({ erro: 'Encomenda não encontrada.' }, 404);
  }
  if (request.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405);
  return r[2] === 'estado' ? mudar(request, env, id) : anotar(request, env, id);
}

/* ---------------------------------------------------------------- os cupões */

async function cupao(request, env, codigoUrl) {
  const codigo = normalizarCodigo(codigoUrl);
  if (!codigo) return json({ erro: 'Código inválido.' }, 404);
  if (request.method === 'DELETE') return (await apagarCupao(env, codigo)) ? json({ ok: true }) : json({ erro: 'Cupão não encontrado.' }, 404);
  if (request.method !== 'PUT') return json({ erro: 'Método não permitido.' }, 405);
  const { corpo, resposta } = await lerCorpoJson(request);
  if (resposta) return resposta;
  let categorias = null;
  try { const cat = await lerCatalogo(env); if (Array.isArray(cat.categorias)) categorias = cat.categorias.map((k) => k.slug); } catch (_) { /* sem catálogo, não se confere a lista */ }
  const r = validarRegra({ ...corpo, codigo }, { categorias });
  if (r.erro) return json({ erro: r.erro, campo: r.campo }, 400);
  return json(await gravarCupao(env, r.regra));
}

/* ---------------------------------------------------------------- saúde */

async function saude(env) {
  const out = {
    ok: true,
    modo: null,
    stripe: Boolean(env.STRIPE_SECRET_KEY),
    webhook: Boolean(env.STRIPE_WEBHOOK_SECRET),
    email: Boolean(env.RESEND_API_KEY),
    dono: Boolean(env.STORE_EMAIL),
    catalogo: 'ok',
  };
  try {
    out.modo = modoDe(await lerCatalogo(env), env);
  } catch (e) {
    out.catalogo = e.message;
    out.modo = env.MODO === 'encomenda' ? 'encomenda' : null;
  }
  return json(out);
}

/* ---------------------------------------------------------------- a lista */

/* Todas as chaves order:, com os metadados (o list() dá 1 000 de cada vez). A lista do painel
   faz-se SÓ dos metadados: ler cada encomenda esgotava os subpedidos de um pedido. */
async function todasAsChaves(env) {
  const chaves = [];
  let cursor;
  do {
    const r = await env.ORDERS.list({ prefix: 'order:', cursor, limit: 1000 });
    chaves.push(...(r.keys || []));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return chaves;
}

/* Sem acentos nem maiúsculas, para a procura. */
export const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const soAlgarismos = (s) => String(s || '').replace(/\D/g, '');

export function corresponde(nome, m, texto) {
  const id = nome.replace(/^order:/, '');
  if (normalizar(id).includes(texto)) return true;
  if (!m) return false;
  if (normalizar(m.nome).includes(texto) || normalizar(m.email).includes(texto)) return true;
  const algarismos = soAlgarismos(texto);
  return algarismos.length >= 3 && soAlgarismos(m.telefone).includes(algarismos);
}

/* O dia (de Lisboa) de uma encomenda está no id: LF-AAAAMMDD-…. */
const diaDe = (nome) => { const r = /^order:LF-(\d{4})(\d{2})(\d{2})-/.exec(nome); return r ? `${r[1]}-${r[2]}-${r[3]}` : ''; };
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

async function listar(env, url) {
  const q = url.searchParams;
  const estado = q.get('estado') || '';
  const desde = RE_DIA.test(q.get('desde') || '') ? q.get('desde') : '';
  const ate = RE_DIA.test(q.get('ate') || '') ? q.get('ate') : '';
  const texto = normalizar(q.get('q'));
  const pagina = Math.max(1, parseInt(q.get('pagina') || '1', 10) || 1);

  let itens = (await todasAsChaves(env)).map((k) => ({ nome: k.name, m: k.metadata || null }));
  if (estado) itens = itens.filter((x) => x.m && x.m.estado === estado);
  if (desde) itens = itens.filter((x) => diaDe(x.nome) >= desde);
  if (ate) itens = itens.filter((x) => diaDe(x.nome) <= ate);
  if (texto) itens = itens.filter((x) => corresponde(x.nome, x.m, texto));
  // As mais recentes primeiro: pela hora de criação (o id só ordena por dia).
  itens.sort((a, b) => {
    const ca = (a.m && a.m.criada_em) || diaDe(a.nome), cb = (b.m && b.m.criada_em) || diaDe(b.nome);
    return cb < ca ? -1 : cb > ca ? 1 : (b.nome < a.nome ? -1 : 1);
  });
  const total = itens.length;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const fatia = itens.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  return json({ encomendas: fatia.map((x) => resumoDeMetadados(x.nome, x.m)), pagina, paginas, total });
}

/* ---------------------------------------------------------------- mudar o estado */

async function mudar(request, env, id) {
  const { corpo, resposta } = await lerCorpoJson(request);
  if (resposta) return resposta;
  const novo = typeof corpo.estado === 'string' ? corpo.estado : '';
  const por = limpar(corpo.por, 160) || 'painel';
  const nota = limpar(corpo.nota, 1000, { linhas: true });
  const enc = await lerEncomenda(env, id);
  if (!enc) return json({ erro: 'Encomenda não encontrada.' }, 404);
  const razao = razaoParaNao(enc, novo);
  if (razao) return json({ erro: razao }, 409);

  const em = agoraISO();
  // O email vai primeiro, com a encomenda já no estado novo, e o resultado grava-se com ela:
  // uma escrita só. Um email que falhe não impede a mudança (o dono pediu-a); fica registado
  // em `avisos` para o painel o mostrar.
  let resultado = null;
  if (corpo.avisar !== false && AVISAM.includes(novo)) {
    let cat = null;
    if (novo === 'pronta') { try { cat = await lerCatalogo(env); } catch (e) { console.error('catálogo por ler para o email «pronta»:', e.message); } }
    resultado = await avisar(env, novo, { ...enc, estado: novo }, { cat, nota, origem: 'painel' });
  }
  // Saiu de «pendente» pelo painel (anulada, ou paga à mão): a página de pagamento da Stripe fecha-se,
  // para o cliente não pagar uma encomenda anulada nem pagar duas vezes. Fica dito no histórico.
  const fechou = enc.estado === 'pendente' && novo !== 'pendente' ? await fecharPagamento(env, enc) : null;
  mudarEstado(enc, novo, { por, nota, em });
  if (fechou) enc.historico = [...(enc.historico || []), { em, estado: novo, por: 'painel', nota: fechou }];
  // Anulada: o uso do cupão volta (uma vez: a marca cupao_contado).
  if (novo === 'anulada' && enc.cupao && enc.cupao_contado) {
    try { await libertarUso(env, enc.cupao, (enc.cliente || {}).email, id); enc.cupao_contado = false; } catch (e) { console.error('uso do cupão por devolver', id, e.message); }
  }
  if (resultado) enc.avisos = { ...(enc.avisos || {}), [novo]: resultado };
  await gravarEncomenda(env, enc, { em });
  return json(enc);
}

/* ---------------------------------------------------------------- uma nota */

async function anotar(request, env, id) {
  const { corpo, resposta } = await lerCorpoJson(request);
  if (resposta) return resposta;
  const texto = limpar(corpo.texto, 1000, { linhas: true });
  if (!texto) return json({ erro: 'Escreva a nota.', campo: 'texto' }, 400);
  const por = limpar(corpo.por, 160) || 'painel';
  const enc = await lerEncomenda(env, id);
  if (!enc) return json({ erro: 'Encomenda não encontrada.' }, 404);
  const em = agoraISO();
  enc.notas_painel = [...(enc.notas_painel || []), { em, por, texto }];
  await gravarEncomenda(env, enc, { em });
  return json(enc);
}
