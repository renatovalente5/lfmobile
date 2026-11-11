/* AS ROTAS DO PAINEL (§5 do contrato): o painel (renatovalente5/lfmobile-painel) nunca lê o KV;
 * fala com estas rotas com `Authorization: Bearer <PAINEL_SEGREDO>` (o mesmo segredo nos dois
 * Workers). Sem o segredo, 401; sem CORS (é servidor a servidor).
 *
 *   GET  /painel/saude                    (?sondar=1: pergunta à ifthenpay se a chave de backoffice serve)
 *   GET  /painel/encomendas?estado=&desde=&ate=&q=&pagina=
 *   GET  /painel/encomendas/<id>
 *   POST /painel/encomendas/<id>/estado   { estado, nota?, por, avisar? }
 *   POST /painel/encomendas/<id>/nota     { texto, por }
 *   POST /painel/encomendas/<id>/reembolso { cents?, por, nota?, manual?, repetir?, avisar? }
 *   GET    /painel/cupoes                 os cupões, com os usos
 *   PUT    /painel/cupoes/<CÓDIGO>        cria ou muda um cupão (a regra: cupoes.js, validarRegra)
 *   DELETE /painel/cupoes/<CÓDIGO>        apaga um cupão (as encomendas que o usaram ficam como estão)
 */

import { json, lerCorpoJson } from './http.js';
import { lerEncomenda, alterarEncomenda, mudarEstado, razaoParaNao, resumoDeMetadados, RE_ID, iguais, agoraISO } from './encomenda.js';
import { lerCatalogo, modoDe } from './catalogo.js';
import { avisar } from './email.js';
import { limpar } from './contas.js';
import { listarCupoes, validarRegra, gravarCupao, apagarCupao, normalizarCodigo, acertarCupao, fazerAcerto } from './cupoes.js';
import { notaAoSairDePendente } from './pagamento.js';
import { chavesPorMetodo, metodosLigados, lerPagamento, reembolsar, REEMBOLSAVEL } from './ifthenpay.js';
import { eur } from './email.js';

const POR_PAGINA = 200;
/* As transições do painel que avisam o cliente (§6). «levantada» não manda nada. */
const AVISAM = ['paga', 'pronta', 'enviada', 'anulada'];

export async function rotaPainel(request, env, url, caminho) {
  if (!env.PAINEL_SEGREDO) return json({ erro: 'O painel não está ligado: falta o PAINEL_SEGREDO no Worker.' }, 503);
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  if (!m || !iguais(m[1].trim(), env.PAINEL_SEGREDO)) return json({ erro: 'Não autorizado.' }, 401);

  const resto = caminho.slice('/painel'.length);
  if (resto === '/saude') return request.method === 'GET' ? saude(env, url.searchParams.get('sondar') === '1') : json({ erro: 'Método não permitido.' }, 405);
  if (resto === '/encomendas') return request.method === 'GET' ? listar(env, url) : json({ erro: 'Método não permitido.' }, 405);
  if (resto === '/cupoes') return request.method === 'GET' ? json({ cupoes: await listarCupoes(env) }) : json({ erro: 'Método não permitido.' }, 405);
  const rc = /^\/cupoes\/([^/]+)$/.exec(resto);
  if (rc) return cupao(request, env, decodeURIComponent(rc[1]));
  const r = /^\/encomendas\/([^/]+)(?:\/(estado|nota|reembolso))?$/.exec(resto);
  if (!r) return json({ erro: 'Rota desconhecida.' }, 404);
  const id = r[1];
  if (!RE_ID.test(id)) return json({ erro: 'Encomenda não encontrada.' }, 404);
  if (!r[2]) {
    if (request.method !== 'GET') return json({ erro: 'Método não permitido.' }, 405);
    const enc = await lerEncomenda(env, id);
    return enc ? json(enc) : json({ erro: 'Encomenda não encontrada.' }, 404);
  }
  if (request.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405);
  return r[2] === 'estado' ? mudar(request, env, id) : r[2] === 'reembolso' ? devolver(request, env, id) : anotar(request, env, id);
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

/* O que está ligado, nunca os valores. `pagamentos`: os métodos com chave (só contam com a chave de
   backoffice, que confirma os pagamentos), se há chave de backoffice, se o callback tem a chave
   anti-phishing, e o erro de uma IFTHENPAY_ACCOUNTS mal escrita. Com ?sondar=1, uma leitura de pagamentos
   de um id que não existe prova que a chave de backoffice serve («configurada» não é «funciona»: uma chave
   errada responde 200 com status 403 dentro). */
async function saude(env, sondar = false) {
  let contas = null;
  try { contas = Object.keys(chavesPorMetodo(env)); } catch (e) { contas = e.message; }
  const out = {
    ok: true,
    modo: null,
    pagamentos: {
      metodos: metodosLigados(env),
      contas: Array.isArray(contas) ? contas : [],
      ...(Array.isArray(contas) ? {} : { erro: contas }),
      backoffice: Boolean(env.IFTHENPAY_BACKOFFICE_KEY),
      callback: Boolean(env.IFTHENPAY_ANTIPHISHING_KEY),
    },
    // Há por onde mandar: pela Cloudflare (o binding EMAIL, desde 11 nov 2026) ou pelo Resend, como
    // no enviar() do email.js. O painel lê isto para dizer ao dono se o cliente recebe os emails.
    email: Boolean((env.EMAIL && typeof env.EMAIL.send === 'function') || env.RESEND_API_KEY),
    dono: Boolean(env.STORE_EMAIL),
    catalogo: 'ok',
  };
  try {
    out.modo = modoDe(await lerCatalogo(env), env);
  } catch (e) {
    out.catalogo = e.message;
    out.modo = env.MODO === 'encomenda' ? 'encomenda' : null;
  }
  if (sondar && env.IFTHENPAY_BACKOFFICE_KEY) {
    try { await lerPagamento(env, { orderId: 'LF000000SONDA2' }); out.pagamentos.sonda = 'ok'; } catch (e) { out.pagamentos.sonda = `falhou: ${String(e && e.estado ? e.estado : '')} ${String(e && e.message ? e.message : e).slice(0, 160)}`.trim(); }
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

/* ---------------------------------------------------------------- mudar o estado
   Sem perder outra escrita (alterarEncomenda), e por esta ordem (a revisão de 11 nov, o mesmo da
   Franja Kids): primeiro GRAVA-SE o estado novo (um pagamento que a ifthenpay confirme a seguir encontra a
   encomenda já anulada, ou paga, e fica só no histórico, com o aviso ao dono); por fim, o email, cujo
   resultado se junta às marcas com outra escrita condicional. Se a encomenda mudou entre a leitura e a
   escrita (outro aparelho, um pagamento que chegou), a mudança não se faz: 409 — quem pediu decidiu sobre
   outro. */
async function mudar(request, env, id) {
  const { corpo, resposta } = await lerCorpoJson(request);
  if (resposta) return resposta;
  const novo = typeof corpo.estado === 'string' ? corpo.estado : '';
  const por = limpar(corpo.por, 160) || 'painel';
  const nota = limpar(corpo.nota, 1000, { linhas: true });
  const em = agoraISO();
  let visto = null;   // o estado da 1.ª leitura: foi sobre esse que se decidiu
  let antes = null;
  const r = await alterarEncomenda(env, id, (enc) => {
    if (visto === null) visto = enc.estado;
    else if (enc.estado !== visto) return { razao: `A encomenda mudou entretanto: está «${enc.estado}». Veja-a outra vez antes de a mudar.`, parar: true };
    const razao = razaoParaNao(enc, novo);
    if (razao) return { razao, parar: true };
    antes = { estado: enc.estado };
    mudarEstado(enc, novo, { por, nota, em });
    // anulada: o uso do cupão volta (na mesma versão; o objecto dos cupões chama-se depois de gravar)
    return { acerto: acertarCupao(enc) };
  }, { em });
  if (!r.enc) return json({ erro: 'Encomenda não encontrada.' }, 404);
  if (r.razao) return json({ erro: r.razao }, 409);
  if (r.acerto) await fazerAcerto(env, r.acerto, r.enc);
  let enc = r.enc;

  // Saiu de «pendente» (anulada, ou paga à mão) com uma referência Multibanco ainda a valer: a
  // ifthenpay não a deixa anular. Fica dito no histórico; a varredura continua a olhar por ela.
  if (antes.estado === 'pendente') {
    const nota2 = notaAoSairDePendente(enc);
    if (nota2) {
      const r2 = await alterarEncomenda(env, id, (x) => { x.historico = [...(x.historico || []), { em: agoraISO(), estado: x.estado, por: 'painel', nota: nota2 }]; return {}; });
      if (r2.enc) enc = r2.enc;
    }
  }
  // O email (com a encomenda já no estado novo). Um email que falhe não desfaz a mudança (o dono
  // pediu-a): fica registado em `avisos`, e o painel mostra-o.
  if (corpo.avisar !== false && AVISAM.includes(novo)) {
    let cat = null;
    if (novo === 'pronta') { try { cat = await lerCatalogo(env); } catch (e) { console.error('catálogo por ler para o email «pronta»:', e.message); } }
    const resultado = await avisar(env, novo, enc, { cat, nota, origem: 'painel' });
    const r3 = await alterarEncomenda(env, id, (x) => { x.avisos = { ...(x.avisos || {}), [novo]: resultado }; return {}; }, { em });
    if (r3.enc) enc = r3.enc;
  }
  return json(enc);
}

/* ---------------------------------------------------------------- uma nota */

async function anotar(request, env, id) {
  const { corpo, resposta } = await lerCorpoJson(request);
  if (resposta) return resposta;
  const texto = limpar(corpo.texto, 1000, { linhas: true });
  if (!texto) return json({ erro: 'Escreva a nota.', campo: 'texto' }, 400);
  const por = limpar(corpo.por, 160) || 'painel';
  const em = agoraISO();
  // a nota junta-se à encomenda de AGORA (com o KV, gravada por cima de uma leitura atrasada, apagava um pagamento)
  const r = await alterarEncomenda(env, id, (enc) => { enc.notas_painel = [...(enc.notas_painel || []), { em, por, texto }]; return {}; }, { em });
  if (!r.enc) return json({ erro: 'Encomenda não encontrada.' }, 404);
  return json(r.enc);
}

/* ---------------------------------------------------------------- devolver um pagamento do site
   POST /painel/encomendas/<id>/reembolso { cents?, por, nota?, manual?, repetir?, avisar? } → a encomenda.
   Só das encomendas pagas no site (pela ifthenpay). `cents` por omissão: o que falta devolver.
   · MB WAY e cartão: pela API da ifthenpay (ifthenpay.js, reembolsar). Antes de pedir, TRANCA-SE (grava-se
     o reembolso «a pedir»): a API não tem chave de idempotência, e dois cliques (ou dois aparelhos)
     devolviam duas vezes. Se não se souber se saiu (a rede caiu a meio), fica «por confirmar» e não se
     repete às cegas: o dono vê na área de cliente da ifthenpay e regista-o à mão (manual) ou manda
     repetir (repetir).
   · Multibanco: a API não o faz. Devolve-se por transferência (pede-se o IBAN ao cliente) e regista-se
     aqui com `manual: true`.
   Devolvido tudo, a encomenda fica «reembolsada» e o cliente recebe o email (salvo avisar: false); uma
   parte fica no histórico. */
const PODE_DEVOLVER = ['paga', 'pronta', 'enviada', 'levantada', 'anulada'];
async function devolver(request, env, id) {
  const { corpo, resposta } = await lerCorpoJson(request);
  if (resposta) return resposta;
  const por = limpar(corpo.por, 160) || 'painel';
  const nota = limpar(corpo.nota, 1000, { linhas: true });
  const manual = corpo.manual === true;
  const enc0 = await lerEncomenda(env, id);
  if (!enc0) return json({ erro: 'Encomenda não encontrada.' }, 404);
  const pg0 = enc0.pagamento;
  if (!pg0 || !pg0.pago_em) return json({ erro: 'Esta encomenda não foi paga no site: a devolução faz-se à parte (e a encomenda anula-se).' }, 409);
  if (!PODE_DEVOLVER.includes(enc0.estado)) return json({ erro: `Uma encomenda «${enc0.estado}» não se devolve.` }, 409);
  const falta = Math.max(0, (pg0.pago_cents || enc0.total_cents) - (pg0.reembolsado_cents || 0));
  const cents = corpo.cents === undefined || corpo.cents === null ? falta : corpo.cents;
  if (!Number.isInteger(cents) || cents <= 0 || cents > falta) return json({ erro: falta ? `O valor tem de ser entre 0,01 € e ${eur(falta)}.` : 'Já foi tudo devolvido.', campo: 'cents' }, 400);
  const metodo = pg0.metodo_pago || pg0.metodo;
  if (!manual && !REEMBOLSAVEL.includes(metodo)) return json({ erro: 'Um pagamento por Multibanco devolve-se por transferência bancária: peça o IBAN ao cliente, faça a transferência e registe-a aqui como feita à mão.' }, 409);
  const em = agoraISO();

  if (!manual) {
    // a tranca, na mesma escrita que confere que não há outro a meio
    const t = await alterarEncomenda(env, id, (x) => {
      const pg = x.pagamento;
      if (pg.reembolso && pg.reembolso.estado === 'a pedir') return { parar: true, erro: 'Já está um reembolso a ser pedido. Veja a encomenda outra vez daqui a um minuto.' };
      if (pg.reembolso && pg.reembolso.estado === 'por confirmar' && corpo.repetir !== true) return { parar: true, erro: `O reembolso de ${eur(pg.reembolso.cents)} pedido a ${new Date(pg.reembolso.em).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })} ficou por confirmar: veja na área de cliente da ifthenpay se saiu. Se saiu, registe-o como feito à mão; se não, peça outra vez.` };
      if (Math.max(0, (pg.pago_cents || x.total_cents) - (pg.reembolsado_cents || 0)) < cents) return { parar: true, erro: 'O valor a devolver mudou entretanto. Veja a encomenda outra vez.' };
      pg.reembolso = { em, cents, estado: 'a pedir', por };
      return {};
    }, { em });
    if (t.erro) return json({ erro: t.erro }, 409);
    try {
      await reembolsar(env, { requestId: pg0.requestId_pago || ultimoRequestId(pg0, metodo), cents, metodo });
    } catch (e) {
      if (e && e.recusado) {
        await alterarEncomenda(env, id, (x) => { delete x.pagamento.reembolso; x.historico = [...(x.historico || []), { em: agoraISO(), estado: x.estado, por, nota: `A ifthenpay recusou o reembolso de ${eur(cents)}${e.motivo ? `: ${e.motivo}` : ''}.` }]; return {}; });
        return json({ erro: e.semSaldo ? 'A ifthenpay ainda não tem saldo para este reembolso (o saldo junta-se a partir das 20h do dia anterior). Tente mais tarde.' : `A ifthenpay recusou o reembolso${e.motivo ? `: ${e.motivo}` : ''}.` }, 409);
      }
      console.error('REEMBOLSO POR CONFIRMAR', id, cents, e && e.message);
      const r = await alterarEncomenda(env, id, (x) => { x.pagamento.reembolso = { em, cents, estado: 'por confirmar', por }; x.historico = [...(x.historico || []), { em: agoraISO(), estado: x.estado, por, nota: `Pedido o reembolso de ${eur(cents)} à ifthenpay, sem resposta: confirme na área de cliente dela antes de pedir outra vez.` }]; return {}; });
      return json({ erro: 'Não sabemos se o reembolso saiu (a ifthenpay não respondeu). Veja na área de cliente da ifthenpay antes de pedir outra vez.', encomenda: r.enc }, 502);
    }
  }

  // devolvido (pela API, ou à mão): soma-se, e com tudo devolvido a encomenda fica «reembolsada»
  const r = await alterarEncomenda(env, id, (x) => {
    const pg = x.pagamento;
    if (manual) {
      // à mão, as mesmas guardas da tranca: nada a meio, e o valor ainda por devolver
      if (pg.reembolso && pg.reembolso.estado === 'a pedir') return { parar: true, erro: 'Está um reembolso a ser pedido à ifthenpay. Veja a encomenda outra vez daqui a um minuto.' };
      if (Math.max(0, (pg.pago_cents || x.total_cents) - (pg.reembolsado_cents || 0)) < cents) return { parar: true, erro: 'O valor a devolver mudou entretanto. Veja a encomenda outra vez.' };
    }
    delete pg.reembolso;
    pg.reembolsado_cents = (pg.reembolsado_cents || 0) + cents;
    pg.reembolsos = [...(pg.reembolsos || []), { em, cents, como: manual ? 'à mão' : 'ifthenpay', por }];
    const tudo = pg.reembolsado_cents >= (pg.pago_cents || x.total_cents);
    const frase = `${manual ? 'Devolvidos à mão' : 'Devolvidos pela ifthenpay'} ${eur(cents)}${tudo ? '' : ` (de ${eur(pg.pago_cents || x.total_cents)})`}.${nota ? ` ${nota}` : ''}`;
    if (tudo && x.estado !== 'reembolsada') mudarEstado(x, 'reembolsada', { por, em, nota: frase });
    else x.historico = [...(x.historico || []), { em, estado: x.estado, por, nota: frase }];
    return { tudo };
  }, { em });
  if (r.erro) return json({ erro: r.erro }, 409);
  let enc = r.enc;
  if (r.tudo && corpo.avisar !== false) {
    const resultado = await avisar(env, 'reembolsada', enc, { origem: 'painel' });
    const r3 = await alterarEncomenda(env, id, (x) => { x.avisos = { ...(x.avisos || {}), reembolsada: resultado }; return {}; });
    if (r3.enc) enc = r3.enc;
  }
  return json(enc);
}

/* O pagamento a devolver: o requestId que a leitura de pagamentos deu (o do pagamento), ou o do último
   pedido desse método (o MB WAY e o cartão dão-no ao criar). */
function ultimoRequestId(pg, metodo) {
  const p = [...(pg.pedidos || [])].reverse().find((x) => x.metodo === metodo && x.requestId && !x.erro);
  return p ? p.requestId : null;
}
