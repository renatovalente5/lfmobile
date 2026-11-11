/* A IFTHENPAY PELA API REST, sem SDK (o Worker não tem dependências). A base é o src/ifthenpay.js da
 * ithos·cathelier (ithos-cathelier-api), que paga por aqui desde set 2026 — os comentários de lá contam
 * como cada armadilha foi encontrada; aqui fica o essencial. Só os três métodos da LF Mobile: MB WAY,
 * Multibanco e cartão (o Payshop, o Google Pay e o Apple Pay ficaram de fora).
 *
 * DUAS COISAS DECIDEM O DESENHO:
 *  1. O CALLBACK NÃO TEM ASSINATURA: é um GET com uma chave anti-phishing (escolhida por nós) na query
 *     string, sem HMAC e sem lista de IPs. Vale como CAMPAINHA: quem decide se uma encomenda está paga é
 *     lerPagamento() (POST /v2/payments/read, com a chave de backoffice), e o valor confere-se lá.
 *  2. OS VALORES VIAJAM EM DECIMAL («33.61»); o resto do Worker conta em cêntimos. A conversão está aqui,
 *     com aritmética de inteiros (Number('33.61') * 100 dá 3360.9999999999995).
 *
 * Cada API da casa diz «correu bem» à sua maneira: MB WAY `Status: "000"`, Multibanco `Status: "0"`,
 * cartão `Status: "0"`, leitura de pagamentos `status: 200` DENTRO do corpo (uma chave errada chega como
 * HTTP 200 com `status: 403`), reembolso `Code: 1` (uma recusa chega como 200 com `Code: 0`). Cada função
 * confere a sua. */

const BASE = 'https://api.ifthenpay.com';
const TEMPO_MS = 15000;   // uma chamada presa não prende o pedido do cliente até ao fim do Worker

/* ---------------------------------------------------------------- valores */

/** Cêntimos → a forma que a ifthenpay quer: decimal, ponto, duas casas. */
export function paraValor(cents) {
  if (!Number.isInteger(cents) || cents < 0) throw new TypeError('valor em cêntimos inválido');
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** O que vem da ifthenpay → cêntimos; null ao que não se reconhece (um valor mal lido compara mal, e
 *  comparar mal é aceitar um pagamento a menos). Aceita vírgula. */
export function paraCentimos(texto) {
  if (typeof texto === 'number' && Number.isFinite(texto)) texto = texto.toFixed(2);
  if (typeof texto !== 'string') return null;
  const m = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(texto.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/* ---------------------------------------------------------------- rede */

export class IfthenpayErro extends Error {
  constructor(estado, corpo) {
    super(`ifthenpay ${estado}: ${typeof corpo === 'string' ? corpo : JSON.stringify(corpo)}`.slice(0, 400));
    this.ifthenpay = true;
    this.estado = estado;
    this.corpo = corpo;
  }
}

async function ler(r) {
  const texto = await r.text();
  try { return texto ? JSON.parse(texto) : null; } catch { return texto; }
}
async function chamar(caminho, corpo, { tempoMs = TEMPO_MS } = {}) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(corpo),
    ...(tempoMs ? { signal: AbortSignal.timeout(tempoMs) } : {}),
  });
  const dados = await ler(r);
  if (!r.ok) throw new IfthenpayErro(r.status, dados);
  return dados;
}
async function chamarGet(caminho, params, { tempoMs = TEMPO_MS } = {}) {
  const r = await fetch(`${BASE}${caminho}?${new URLSearchParams(params)}`, { headers: { accept: 'application/json' }, ...(tempoMs ? { signal: AbortSignal.timeout(tempoMs) } : {}) });
  const dados = await ler(r);
  if (!r.ok) throw new IfthenpayErro(r.status, dados);
  return dados;
}

/* ---------------------------------------------------------------- as contas (IFTHENPAY_ACCOUNTS)
   `MBWAY|ABC-123456;MB|UND-654321;CCARD|XYZ-111222`: cada entrada traz a chave que a ifthenpay emitiu
   para AQUELE método (o mbWayKey, o mbKey e a CCARD KEY). É um SEGREDO do Worker, não uma var: o
   repositório é público, e com a chave do MB WAY qualquer pessoa mandava pedidos de pagamento em nome da
   loja; e um segredo é o único sítio que o `wrangler deploy` não apaga (memória wrangler-deploy-apaga-vars).
   Uma entrada mal escrita recusa-se em vez de se ignorar: tirava um método do site sem um erro em lado
   nenhum. */
const CONTA = /^[A-Z]+\|[A-Za-z0-9-]+$/;
export const METODOS = Object.freeze(['MBWAY', 'MB', 'CCARD']);
export const NOMES = Object.freeze({ MBWAY: 'MB WAY', MB: 'Multibanco', CCARD: 'cartão' });

export function chavesPorMetodo(env) {
  const fora = {};
  for (const bruta of String(env.IFTHENPAY_ACCOUNTS ?? '').split(';')) {
    const conta = bruta.trim();
    if (!conta) continue;
    if (!CONTA.test(conta)) throw new TypeError(`conta mal formada (tem de ser METODO|CHAVE): ${conta.split('|')[0]}|…`);
    const [metodo, chave] = conta.split('|');
    fora[metodo] = chave;
  }
  return fora;
}

/** Os métodos que se podem oferecer, pela ordem do site. Sem a chave de backoffice nenhum: um pagamento
 *  que não se consegue confirmar não se pede. Uma IFTHENPAY_ACCOUNTS mal escrita dá [] (e a saúde diz
 *  porquê). */
export function metodosLigados(env) {
  if (!env.IFTHENPAY_BACKOFFICE_KEY) return [];
  let chaves;
  try { chaves = chavesPorMetodo(env); } catch { return []; }
  return METODOS.filter((m) => chaves[m]);
}

function chaveDe(env, metodo) {
  const chave = chavesPorMetodo(env)[metodo];
  if (!chave) throw new Error(`método não ligado: ${metodo}`);
  return chave;
}

/* ---------------------------------------------------------------- o identificador do pagamento
   O `orderId` que vai à ifthenpay tem um tecto de 15 caracteres (o das APIs mais apertadas), e o número
   da encomenda tem 18 (LF-20261111-ABCDEF). Vai sem os traços e sem o século: LF261111ABCDEF (14). É o
   único fio que liga um pagamento (e um callback) à encomenda, e volta-se dele ao número sem ler nada. */
export const ID_MAX = 15;
export function idDePagamento(numero) {
  const m = /^LF-20(\d{6})-([23456789A-HJ-NP-Z]{6})$/.exec(String(numero || ''));
  if (!m) throw new TypeError(`número de encomenda inválido: ${numero}`);
  return `LF${m[1]}${m[2]}`;
}
export function numeroDoPagamento(pid) {
  const m = /^LF(\d{6})([23456789A-HJ-NP-Z]{6})$/.exec(String(pid || '').trim().toUpperCase());
  return m ? `LF-20${m[1]}-${m[2]}` : null;
}

/* ---------------------------------------------------------------- MB WAY
   O telemóvel vai como `351#912345678`. Só Portugal (o MB WAY é português). IDEMPOTENTE: normalizar a
   própria saída dá o mesmo (na ithos, o checkout normalizava para validar e o criarMbway outra vez, e o
   `#` da primeira passagem fazia a segunda recusar o número). */
export function telemovelMbway(texto) {
  const so = String(texto ?? '').replace(/[\s().+-]/g, '');
  const m = /^(?:00351|351#?)?(9\d{8})$/.exec(so);
  return m ? `351#${m[1]}` : null;
}

/** Pede um pagamento MB WAY: o cliente recebe-o na app e tem 4 minutos para o aceitar. */
export async function criarMbway(env, { id, cents, telemovel, descricao }) {
  const mobileNumber = telemovelMbway(telemovel);
  if (!mobileNumber) throw new TypeError('telemóvel inválido para MB WAY');
  const r = await chamar('/spg/payment/mbway', {
    mbWayKey: chaveDe(env, 'MBWAY'),
    orderId: id,
    amount: paraValor(cents),
    mobileNumber,
    ...(descricao ? { description: String(descricao).slice(0, 100) } : {}),
  });
  // «000», três zeros (String(0) !== '000'). 100 e 999: tentar outra vez; 122: recusado.
  if (String(r?.Status) !== '000' || !r?.RequestId) throw new IfthenpayErro(r?.Status ?? 502, r);
  return { requestId: String(r.RequestId) };
}

export const MBWAY_SEGUNDOS = 240;
/* O estado de um pedido MB WAY. «pendente» é o que se conclui quando não é nenhum dos terminais. */
const MBWAY_ESTADOS = { '000': 'pago', '020': 'recusado', '101': 'expirado', '122': 'recusado' };
export async function estadoMbway(env, { requestId }) {
  if (!requestId) throw new TypeError('falta o requestId');
  const r = await chamarGet('/spg/payment/mbway/status', { mbWayKey: chaveDe(env, 'MBWAY'), requestId }, { tempoMs: 8000 });
  const codigo = String(r?.Status ?? '');
  return { codigo, estado: MBWAY_ESTADOS[codigo] ?? 'pendente' };
}

/* ---------------------------------------------------------------- Multibanco */

/** Gera uma referência: a entidade, a referência e o dia em que deixa de valer (AAAA-MM-DD). */
export async function criarMultibanco(env, { id, cents, descricao, dias }) {
  const r = await chamar('/multibanco/reference/init', {
    mbKey: chaveDe(env, 'MB'),
    orderId: id,
    amount: paraValor(cents),
    ...(descricao ? { description: String(descricao).slice(0, 200) } : {}),
    // Omite-se para não ter prazo; 0 NÃO é «sem prazo», é «expira à meia-noite de hoje».
    ...(Number.isInteger(dias) && dias > 0 ? { expiryDays: dias } : {}),
  });
  if (String(r?.Status) !== '0' || !r?.Reference || !r?.Entity) throw new IfthenpayErro(r?.Status ?? 502, r);
  return { entidade: String(r.Entity), referencia: String(r.Reference).replace(/\D/g, ''), expira: dataISO(r?.ExpiryDate), requestId: r?.RequestId ? String(r.RequestId) : null };
}

/* A data que eles devolvem não é a da especificação: o OpenAPI mostra `2026-07-27`, a conta a sério
   devolveu `24-09-2026`. Normaliza-se à entrada; uma terceira forma fica como veio (null se vazia). */
export function dataISO(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const pt = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t);
  return pt ? `${pt[3]}-${pt[2]}-${pt[1]}` : t;
}

/* A SEGUNDA FONTE DO MULTIBANCO (só ele a tem): /multibanco/reference/list filtra por orderId e diz
   PAID/NOT_PAID com a mbKey — outra credencial, outro caminho (camelCase e datas ISO, ao contrário do
   /init). Na ithos não ficou provado que o /v2/payments/read veja as referências criadas por esta API;
   se não vir, isto evita «não pago» para sempre. Testado contra a conta a sério a 22 set 2026. */
export async function listarMultibanco(env, { orderId, deDias = 30 }) {
  if (!orderId) throw new TypeError('falta o orderId');
  const hoje = Date.now();
  const dia = (t) => new Date(t).toISOString().slice(0, 10);
  const r = await chamar('/multibanco/reference/list', { mbKey: chaveDe(env, 'MB'), fromDate: dia(hoje - deDias * 86400000), toDate: dia(hoje + 86400000), orderId });
  return Array.isArray(r) ? r : [];
}
export function pagosDaLista(linhas) {
  return (linhas ?? []).filter((l) => String(l?.status).toUpperCase() === 'PAID').map((l) => ({
    cents: paraCentimos(String(l?.amount ?? '')), metodo: 'MB', requestId: l?.requestId ? String(l.requestId) : null, referencia: l?.reference ? String(l.reference) : null,
  })).filter((p) => Number.isInteger(p.cents));
}

/* ---------------------------------------------------------------- cartão
   Devolve o endereço de um formulário de cartão alojado pela ifthenpay: o número do cartão nunca passa
   pelo site nem por este Worker. Três endereços de regresso, obrigatórios. */
export async function criarCartao(env, { id, cents, urls }) {
  if (!urls?.sucesso || !urls?.erro || !urls?.cancelado) throw new TypeError('o cartão exige os três endereços de regresso');
  const r = await chamar(`/creditcard/init/${chaveDe(env, 'CCARD')}`, {
    orderId: id,
    amount: paraValor(cents),
    successUrl: urls.sucesso,
    errorUrl: urls.erro,
    cancelUrl: urls.cancelado,
    language: 'pt',
  });
  if (String(r?.Status) !== '0' || !r?.PaymentUrl) throw new IfthenpayErro(r?.Status ?? 502, r);
  return { url: String(r.PaymentUrl), requestId: r?.RequestId ? String(r.RequestId) : null };
}

/* ---------------------------------------------------------------- confirmar
   É ISTO que decide se uma encomenda está paga, nunca o callback nem o regresso do cartão. */
export async function lerPagamento(env, { orderId, tempoMs = TEMPO_MS }) {
  if (!env.IFTHENPAY_BACKOFFICE_KEY) throw new Error('falta IFTHENPAY_BACKOFFICE_KEY');
  if (!orderId) throw new TypeError('falta o orderId');
  const r = await chamar('/v2/payments/read', { boKey: env.IFTHENPAY_BACKOFFICE_KEY, orderId }, { tempoMs });
  // O estado vem DENTRO do corpo: uma chave errada ou revogada é HTTP 200 com `status: 403` e sem lista,
  // que se leria como «não há pagamentos» — a loja deixava de reconhecer dinheiro sem um erro.
  if (Number(r?.status) !== 200) throw new IfthenpayErro(r?.status ?? 502, r);
  // `payments`, minúsculo (na ithos esteve `r.Data`, que não existe: nenhuma encomenda ficava paga).
  return (Array.isArray(r?.payments) ? r.payments : []).map((p) => ({
    cents: paraCentimos(String(p?.amount ?? '')),
    // `entity` é como a lista nomeia o método (MB, MBWAY, CCARD…): com o nome errado vinha null, e null
    // passava ao lado da guarda dos reembolsos.
    metodo: p?.entity ? String(p.entity).toUpperCase() : null,
    requestId: p?.requestId ? String(p.requestId) : null,
    referencia: p?.reference ? String(p.reference) : null,
    orderId: p?.orderId ? String(p.orderId) : null,
  })).filter((p) => Number.isInteger(p.cents) && (!p.orderId || p.orderId === orderId));
}

/** Pago, e pago QUANTO: um pagamento a menos não conta (a fraude óbvia contra um gateway sem
 *  assinatura). → { pago, cents, metodo, requestId, referencia, recebido_cents, n } ou { pago: false }.
 *  `recebido_cents` e `n` somam TODOS os pagamentos deste id (dois pagamentos — o MB WAY e depois a
 *  referência — são dinheiro a devolver). */
export function conferir(pagamentos, { cents }) {
  const todos = (pagamentos ?? []).filter((p) => Number.isInteger(p?.cents) && p.cents > 0);
  const bom = todos.find((p) => p.cents >= cents);
  if (!bom) return { pago: false, recebido_cents: todos.reduce((s, p) => s + p.cents, 0), n: todos.length };
  return { pago: true, cents: bom.cents, metodo: bom.metodo ?? null, requestId: bom.requestId ?? null, referencia: bom.referencia ?? null, recebido_cents: todos.reduce((s, p) => s + p.cents, 0), n: todos.length };
}

/* ---------------------------------------------------------------- reembolsar
   Só MB WAY e cartão. O Multibanco devolve-se por transferência bancária, à mão: a API não o cobre, e
   por isso isto recusa em vez de fingir que tentou. A guarda falha FECHADA (na ithos esteve `if (metodo
   && …)`, saltada quando o método vinha null). Três desfechos:
     · Code 1: devolvido;
     · Code 0 (recusado; a Message diz porquê) ou -1 (sem saldo): nada saiu — `e.recusado`;
     · o resto (rede, tempo, 5xx, sem Code): NÃO SE SABE se saiu — `e.duvida`. A API não tem chave de
       idempotência: repetir às cegas podia devolver duas vezes. Quem chama tranca. */
export const REEMBOLSAVEL = Object.freeze(['MBWAY', 'CCARD']);
export async function reembolsar(env, { requestId, cents, metodo, tempoMs = 20000 }) {
  if (!env.IFTHENPAY_BACKOFFICE_KEY) throw new Error('falta IFTHENPAY_BACKOFFICE_KEY');
  if (!REEMBOLSAVEL.includes(metodo)) throw new Error(`${metodo ?? 'método desconhecido'} não se reembolsa pela API: faz-se por transferência bancária`);
  if (!requestId) throw new TypeError('falta o requestId do pagamento');
  if (!Number.isInteger(cents) || cents <= 0) throw new TypeError('valor do reembolso inválido');
  let r;
  try {
    r = await chamar('/v2/payments/refund', { backofficekey: env.IFTHENPAY_BACKOFFICE_KEY, requestId, amount: paraValor(cents) }, { tempoMs });
  } catch (e) {
    if (e?.ifthenpay && e.estado >= 400 && e.estado < 500) { e.recusado = true; throw e; }
    const d = e?.ifthenpay ? e : new IfthenpayErro(0, String(e?.message ?? e));
    d.duvida = true;
    throw d;
  }
  const bruto = r?.Code;
  // um Code vazio NÃO é 0 (Number('') dava 0, e uma resposta desconhecida passava por recusa)
  const codigo = bruto === undefined || bruto === null || bruto === '' ? NaN : Number(bruto);
  if (codigo === 1) return r;
  const e = new IfthenpayErro(200, r);
  if (codigo === 0 || codigo === -1) { e.recusado = true; e.semSaldo = codigo === -1; e.motivo = typeof r?.Message === 'string' ? r.Message : null; } else e.duvida = true;
  throw e;
}

/* ---------------------------------------------------------------- o callback
   Os nomes dos parâmetros mudam por método (Multibanco e MB WAY: key/orderId; Pay by Link: id; Payshop:
   anti_phishing_key/order_id): lê-se por todos. E um marcador que a conta não substitua chega tal e qual,
   entre parênteses rectos (`[ORDER_ID]`, e a própria documentação escreve `[entity]` em minúsculas):
   deita-se fora e passa-se ao nome seguinte. */
const MARCADOR = /^\[[a-zA-Z_]+\]$/;
export function lerCallback(params) {
  const p = (...nomes) => {
    for (const n of nomes) {
      const v = params.get(n);
      if (v !== null && v !== '' && !MARCADOR.test(v)) return v;
    }
    return null;
  };
  return {
    chave: p('key', 'anti_phishing_key'),
    orderId: p('orderId', 'order_id', 'id'),
    requestId: p('requestId'),
    valorTexto: p('amount'),
    metodo: p('payment_method'),
  };
}

/** A chave anti-phishing, em tempo constante. Duas vazias não são iguais: são duas ausências (um Worker
 *  sem o segredo aceitava qualquer callback sem chave). */
export function chaveConfere(dada, esperada) {
  if (typeof dada !== 'string' || typeof esperada !== 'string' || !dada || !esperada) return false;
  if (dada.length !== esperada.length) return false;
  let d = 0;
  for (let i = 0; i < dada.length; i++) d |= dada.charCodeAt(i) ^ esperada.charCodeAt(i);
  return d === 0;
}
