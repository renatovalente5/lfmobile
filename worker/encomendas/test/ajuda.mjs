/* As peças comuns dos testes: o catálogo (a cópia CONGELADA test/catalogo.json, na forma v3 do
   scripts/build.mjs — nunca o _site/ do conteúdo de agora, que o dono muda no painel: memória
   testes-do-site-com-conteudo-de-ensaio), um KV de faz-de-conta, um env, uma rede de faz-de-conta
   (o catálogo, a ifthenpay e o Resend respondem daqui; tudo o resto é proibido) e um pedido ao Worker. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cupoes } from '../cupoes.js';
import { Encomenda, Contador } from '../objecto.js';
import { Conta } from '../conta.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export function catalogoBase() {
  return JSON.parse(fs.readFileSync(path.join(AQUI, 'catalogo.json'), 'utf8'));
}

/* Um KV com a API que o Worker usa (get, put com metadata, delete, list com prefixo e cursor). */
export function kvFalso() {
  const m = new Map();
  return {
    dados: m,
    escritas: 0,
    async get(k) { const e = m.get(k); return e ? e.valor : null; },
    async put(k, v, o = {}) { this.escritas += 1; m.set(k, { valor: v, metadata: o.metadata || null }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const chaves = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const inicio = cursor ? Number(cursor) : 0;
      const fatia = chaves.slice(inicio, inicio + limit);
      const fim = inicio + fatia.length >= chaves.length;
      return { keys: fatia.map((name) => ({ name, metadata: m.get(name).metadata })), list_complete: fim, cursor: fim ? undefined : String(inicio + limit) };
    },
  };
}

export const SITE = 'https://renatovalente5.github.io/lfmobile';
export const CATALOGO_URL = `${SITE}/assets/catalogo.json`;
export const SEGREDO = 'segredo-do-painel-de-teste';

/* OS OBJECTOS DURÁVEIS DE FAZ-DE-CONTA (objecto.js; o mesmo da Franja Kids): uma instância por nome, com
   um storage em memória e o blockConcurrencyWhile como uma FILA — como na Cloudflare, o que corre lá
   dentro não se mistura com outro pedido. A jurisdição devolve o mesmo espaço (aqui não há sítios).
   `instancias` deixa os testes ver dentro. */
function ctxFalso() {
  const m = new Map();
  let fila = Promise.resolve();
  return {
    dados: m,
    storage: {
      // como o da Cloudflare: uma lista de chaves dá um Map com as que existem
      async get(k) { if (Array.isArray(k)) return new Map(k.filter((x) => m.has(x)).map((x) => [x, structuredClone(m.get(x))])); return m.has(k) ? structuredClone(m.get(k)) : undefined; },
      async put(k, v) { m.set(k, structuredClone(v)); },
      async delete(k) { return m.delete(k); },
      async list({ prefix = '' } = {}) { return new Map([...m.keys()].filter((x) => x.startsWith(prefix)).sort().map((x) => [x, structuredClone(m.get(x))])); },
      async deleteAll() { m.clear(); },
      async setAlarm() { /* o prazo não corre nos testes */ },
    },
    blockConcurrencyWhile(fn) { const p = fila.then(fn); fila = p.catch(() => {}); return p; },
  };
}
export function objectosFalsos(Classe, env) {
  const instancias = new Map();
  const ns = {
    instancias,
    jurisdiction() { return ns; },
    idFromName(n) { return String(n); },
    get(id) {
      if (!instancias.has(id)) instancias.set(id, new Classe(ctxFalso(), env));
      const o = instancias.get(id);
      return { fetch: (url, init) => o.fetch(new Request(url, init)) };
    },
  };
  return ns;
}

export function envFalso(extra = {}) {
  const env = {
    ORDERS: kvFalso(),
    TRAVAO_CHECKOUT: { limit: async () => ({ success: true }) },
    SITE_URL: SITE,
    CATALOGO_URL,
    LOGO_URL: `${SITE}/assets/img/logo-b72d7bbaa1-128.png`,
    ALLOWED_ORIGINS: 'https://renatovalente5.github.io,http://localhost:4870',
    STORE_NAME: 'LF Mobile',
    STORE_PHONE: '916 537 957',
    STORE_EMAIL: '',
    MAIL_FROM: 'LF Mobile <onboarding@resend.dev>',
    PAINEL_SEGREDO: SEGREDO,
    ...extra,
  };
  if (!('CUPOES' in extra)) env.CUPOES = objectosFalsos(Cupoes, env);
  if (!('ENCOMENDA' in extra)) env.ENCOMENDA = objectosFalsos(Encomenda, env);
  if (!('CONTADOR' in extra)) env.CONTADOR = objectosFalsos(Contador, env);
  if (!('CONTA' in extra)) env.CONTA = objectosFalsos(Conta, env);
  return env;
}

/* AS CHAVES DA IFTHENPAY DE FAZ-DE-CONTA: o env de uma loja com os três métodos ligados. */
export const CHAVES = Object.freeze({ MBWAY: 'MBW-111111', MB: 'MBK-222222', CCARD: 'CCK-333333', BO: '1111-2222-3333-4444', ANTI: 'antiphishing-de-teste-0123456789' });
export const envIfthenpay = (extra = {}) => envFalso({
  IFTHENPAY_ACCOUNTS: `MBWAY|${CHAVES.MBWAY};MB|${CHAVES.MB};CCARD|${CHAVES.CCARD}`,
  IFTHENPAY_BACKOFFICE_KEY: CHAVES.BO,
  IFTHENPAY_ANTIPHISHING_KEY: CHAVES.ANTI,
  ...extra,
});

/* A IFTHENPAY DE FAZ-DE-CONTA: as APIs que o Worker usa (ifthenpay.js), com a forma das respostas de lá
   (o MB WAY com «000», o Multibanco com «0» e a data DD-MM-AAAA da conta a sério, a leitura com o
   `status` DENTRO do corpo, o reembolso com `Code`). Confere o que recebe como a de verdade conferiria
   (as chaves de cada método, o orderId até 15 caracteres, o valor «12.34», o telemóvel «351#9…»): um
   pedido mal feito responde 400, e o teste vê-o. O teste paga com `pagar(orderId, { metodo, cents })`,
   recusa um MB WAY com `mbway.set(requestId, '020')`, e muda o resto por `falhar`:
     { criar: { MBWAY|MB|CCARD: Response|true }, ler: Response|true, lista: true, reembolso: 'recusa'|'semSaldo'|'duvida' }. */
export function ifthenpayFalsa() {
  const f = {
    pagos: new Map(),        // orderId → [{ amount, entity, requestId, reference }] (o /v2/payments/read)
    soNaLista: new Set(),    // orderId pagos que o /v2/payments/read não vê (só a lista do Multibanco)
    mbway: new Map(),        // requestId → Status ('123' à espera, '000', '020', '101')
    referencias: new Map(),  // orderId → [{ referencia, amount, requestId }]
    reembolsos: [],
    falhar: {},
    n: 0,
    pagar(orderId, { metodo = 'MBWAY', cents, requestId, soNaLista = false } = {}) {
      const valor = `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
      const rid = requestId || `PAG${++f.n}`;
      const ref = metodo === 'MB' ? ((f.referencias.get(orderId) || []).at(-1) || {}).referencia : null;
      if (soNaLista) f.soNaLista.add(orderId);
      f.pagos.set(orderId, [...(f.pagos.get(orderId) || []), { amount: valor, entity: metodo, requestId: rid, reference: ref, orderId }]);
      if (metodo === 'MBWAY' && requestId) f.mbway.set(requestId, '000');
      return rid;
    },
    async responder(url, init) {
      const u = new URL(url);
      const corpo = init.body ? JSON.parse(String(init.body)) : {};
      const erro = (t) => new Response(JSON.stringify({ erro: t }), { status: 400 });
      const valorBom = (v) => /^\d+\.\d{2}$/.test(String(v));
      const idBom = (id) => typeof id === 'string' && id.length >= 1 && id.length <= 15;
      const falha = (m) => { const x = (f.falhar.criar || {})[m]; return x === true ? new Response('em baixo', { status: 503 }) : x || null; };
      if (u.pathname === '/spg/payment/mbway' && init.method === 'POST') {
        if (corpo.mbWayKey !== CHAVES.MBWAY) return erro('mbWayKey');
        if (!idBom(corpo.orderId) || !valorBom(corpo.amount) || !/^351#9\d{8}$/.test(corpo.mobileNumber)) return erro('campos');
        const x = falha('MBWAY'); if (x) return x;
        const rid = `MBW${++f.n}`;
        f.mbway.set(rid, '123');
        return Response.json({ Amount: corpo.amount, Message: 'Pending', OrderId: corpo.orderId, RequestId: rid, Status: '000' });
      }
      if (u.pathname === '/spg/payment/mbway/status') {
        if (u.searchParams.get('mbWayKey') !== CHAVES.MBWAY) return erro('mbWayKey');
        return Response.json({ Status: f.mbway.get(u.searchParams.get('requestId')) || '123', Message: '' });
      }
      if (u.pathname === '/multibanco/reference/init' && init.method === 'POST') {
        if (corpo.mbKey !== CHAVES.MB) return erro('mbKey');
        if (!idBom(corpo.orderId) || !valorBom(corpo.amount)) return erro('campos');
        const x = falha('MB'); if (x) return x;
        const referencia = String(100000000 + (++f.n) * 7919).slice(0, 9);
        f.referencias.set(corpo.orderId, [...(f.referencias.get(corpo.orderId) || []), { referencia, amount: corpo.amount, requestId: `MBR${f.n}` }]);
        // a data como a conta a sério a devolve (DD-MM-AAAA), não como a especificação mostra
        const d = new Date(Date.now() + (corpo.expiryDays || 0) * 86400000);
        return Response.json({ Amount: corpo.amount, Entity: '12345', ExpiryDate: `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`, Message: 'Success', OrderId: corpo.orderId, Reference: referencia, RequestId: `MBR${f.n}`, Status: '0' });
      }
      if (u.pathname === '/multibanco/reference/list' && init.method === 'POST') {
        if (corpo.mbKey !== CHAVES.MB) return erro('mbKey');
        if (f.falhar.lista) return new Response('não é JSON', { status: 200 });
        const pagos = f.pagos.get(corpo.orderId) || [];
        return Response.json((f.referencias.get(corpo.orderId) || []).map((r) => {
          const pago = pagos.find((p) => p.entity === 'MB' && p.reference === r.referencia);
          return { entity: '12345', reference: r.referencia, amount: pago ? pago.amount : r.amount, requestId: r.requestId, orderId: corpo.orderId, status: pago ? 'PAID' : 'NOT_PAID' };
        }));
      }
      const cartao = /^\/creditcard\/init\/(.+)$/.exec(u.pathname);
      if (cartao && init.method === 'POST') {
        if (cartao[1] !== CHAVES.CCARD) return erro('ccardKey');
        if (!idBom(corpo.orderId) || !valorBom(corpo.amount) || !corpo.successUrl || !corpo.errorUrl || !corpo.cancelUrl) return erro('campos');
        const x = falha('CCARD'); if (x) return x;
        const rid = `CC${++f.n}`;
        return Response.json({ Message: 'Success', PaymentUrl: `https://ifthenpay.test/cartao/${rid}`, RequestId: rid, Status: '0' });
      }
      if (u.pathname === '/v2/payments/read' && init.method === 'POST') {
        if (f.falhar.ler) return f.falhar.ler === true ? new Response('em baixo', { status: 502 }) : f.falhar.ler;
        if (corpo.boKey !== CHAVES.BO) return Response.json({ status: 403, message: 'Forbidden' });
        const lista = f.soNaLista.has(corpo.orderId) ? [] : (f.pagos.get(corpo.orderId) || []);
        return Response.json({ status: 200, payments: lista });
      }
      if (u.pathname === '/v2/payments/refund' && init.method === 'POST') {
        if (corpo.backofficekey !== CHAVES.BO) return Response.json({ Code: '0', Message: 'chave' });
        if (!valorBom(corpo.amount) || !corpo.requestId) return erro('campos');
        f.reembolsos.push(corpo);
        if (f.falhar.reembolso === 'recusa') return Response.json({ Code: '0', Message: 'Pagamento já devolvido' });
        if (f.falhar.reembolso === 'semSaldo') return Response.json({ Code: '-1', Message: 'Saldo insuficiente' });
        if (f.falhar.reembolso === 'duvida') return new Response('gateway timeout', { status: 504 });
        return Response.json({ Code: '1', Message: 'Success' });
      }
      return new Response('não existe', { status: 404 });
    },
  };
  return f;
}

/* A rede: `catalogo` é o objecto (ou uma função que o devolve, para o mudar a meio); `ifthenpay` é a
   de faz-de-conta (ifthenpayFalsa, por omissão uma nova); `resend` é uma resposta por omissão ou uma
   função (url, init) → Response. As chamadas ficam em `chamadas` ({ url, init, corpo }). */
export function redeFalsa({ catalogo, ifthenpay, resend } = {}) {
  const chamadas = [];
  const ifp = ifthenpay || ifthenpayFalsa();
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    const corpo = init.body ? String(init.body) : '';
    chamadas.push({ url, init, corpo });
    if (url === CATALOGO_URL || url.endsWith('/assets/catalogo.json')) {
      const cat = typeof catalogo === 'function' ? catalogo() : catalogo;
      if (!cat) return new Response('não há', { status: 404 });
      return Response.json(cat);
    }
    if (url.startsWith('https://api.ifthenpay.com/')) return ifp.responder(url, init);
    if (url.startsWith('https://api.resend.com/')) {
      if (typeof resend === 'function') return resend(url, init);
      return Response.json({ id: `re_${chamadas.length}` });
    }
    throw new Error(`rede proibida nos testes: ${url}`);
  };
  return {
    chamadas,
    ifp,
    ifthenpay: () => chamadas.filter((c) => c.url.startsWith('https://api.ifthenpay.com/')).map((c) => ({ ...c, caminho: new URL(c.url).pathname, json: c.corpo ? JSON.parse(c.corpo) : null })),
    resend: () => chamadas.filter((c) => c.url.startsWith('https://api.resend.com/')).map((c) => JSON.parse(c.corpo)),
    repor() { globalThis.fetch = original; },
  };
}

/* Cada pedido vem de um IP diferente, salvo quando o teste diz o seu: o travão de memória do
   Worker é por IP e vive no módulo, e os testes do mesmo ficheiro partilham-no. */
let ipSeguinte = 1;
export async function pedir(worker, env, metodo, caminho, { corpo, cabecalhos = {} } = {}) {
  const init = { method: metodo, headers: { 'CF-Connecting-IP': `10.0.${Math.floor(ipSeguinte / 256)}.${ipSeguinte++ % 256}`, ...cabecalhos } };
  if (corpo !== undefined) { init.body = typeof corpo === 'string' ? corpo : JSON.stringify(corpo); init.headers['content-type'] = 'application/json'; }
  const r = await worker.fetch(new Request(`https://lfmobile-encomendas.test${caminho}`, init), env);
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* texto simples */ }
  return { status: r.status, json, texto, headers: r.headers };
}

export const bearer = (segredo = SEGREDO) => ({ Authorization: `Bearer ${segredo}` });

/* O pedido-padrão do site: dois pares de auscultadores prateados, para levantar na loja. */
export function pedidoValido(sobre = {}) {
  return {
    linhas: [{ produto: 'fones-p9', opcoes: [1], qtd: 2 }],
    entrega: 'levantamento',
    cliente: { nome: 'Maria Fernanda Silva', email: 'Maria@Exemplo.pt', telefone: '912 345 678' },
    termos: true,
    total_cents: 11980,
    ...sobre,
  };
}
export const moradaValida = () => ({ morada: 'Rua das Flores, 10, 2.º Esq.', codigoPostal: '3720-100', localidade: 'Oliveira de Azeméis' });

/* Uma encomenda registada pelo /checkout, pronta para os testes do painel e dos pagamentos. */
export async function registar(worker, env, sobre = {}) {
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido(sobre) });
  if (r.status !== 200) throw new Error(`checkout falhou nos testes: ${r.status} ${r.texto}`);
  return r.json;
}

/* Uma encomenda paga no site, pendente: o catálogo em modo «online», a ifthenpay de faz-de-conta, e o
   /checkout com o método. → { env, rede, ifp, numero, chave, pid, resposta, ler } */
export async function online({ metodo = 'MBWAY', sobre = {}, env: extraEnv = {}, cat: mudarCat, rede: extraRede = {} } = {}) {
  const cat = catalogoBase();
  cat.modo = 'online';
  if (mudarCat) mudarCat(cat);
  const rede = redeFalsa({ catalogo: cat, ...extraRede });
  const env = envIfthenpay({ RESEND_API_KEY: 're_x', STORE_EMAIL: 'dono@exemplo.pt', ...extraEnv });
  const worker = (await import('../index.js')).default;
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido({ metodo, ...sobre }) });
  if (r.status !== 200) { rede.repor(); throw new Error(`checkout online falhou nos testes: ${r.status} ${r.texto}`); }
  const numero = r.json.encomenda;
  return {
    env, rede, ifp: rede.ifp, numero, chave: r.json.chave, pid: `LF${numero.slice(5, 11)}${numero.slice(12)}`, resposta: r.json,
    ler: async () => { const x = await env.ENCOMENDA.get(numero).fetch('https://o/', { method: 'POST', body: JSON.stringify({ op: 'ler' }) }); return (await x.json()).enc; },
  };
}
