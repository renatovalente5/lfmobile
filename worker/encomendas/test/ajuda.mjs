/* As peças comuns dos testes: o catálogo (a cópia CONGELADA test/catalogo.json, na forma v3 do
   scripts/build.mjs — nunca o _site/ do conteúdo de agora, que o dono muda no painel: memória
   testes-do-site-com-conteudo-de-ensaio), um KV de faz-de-conta, um env, uma rede de faz-de-conta
   (o catálogo, a Stripe e o Resend respondem daqui; tudo o resto é proibido) e um pedido ao Worker. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function envFalso(extra = {}) {
  return {
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
    STRIPE_API_VERSION: '2026-07-29.dahlia',
    PAINEL_SEGREDO: SEGREDO,
    ...extra,
  };
}

/* A rede: `catalogo` é o objecto (ou uma função que o devolve, para o mudar a meio); `stripe` e
   `resend` são respostas por omissão ou funções (url, init) → Response. As chamadas ficam em
   `chamadas` ({ url, init, corpo }). */
export function redeFalsa({ catalogo, stripe, resend } = {}) {
  const chamadas = [];
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
    if (url.startsWith('https://api.stripe.com/')) {
      if (typeof stripe === 'function') return stripe(url, init);
      if (url.endsWith('/checkout/sessions') && init.method === 'POST') return Response.json({ id: 'cs_test_a1b2c3d4e5f6', url: 'https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6', payment_status: 'unpaid' });
      return Response.json(stripe || {});
    }
    if (url.startsWith('https://api.resend.com/')) {
      if (typeof resend === 'function') return resend(url, init);
      return Response.json({ id: `re_${chamadas.length}` });
    }
    throw new Error(`rede proibida nos testes: ${url}`);
  };
  return {
    chamadas,
    stripe: () => chamadas.filter((c) => c.url.startsWith('https://api.stripe.com/')),
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

/* Uma encomenda registada pelo /checkout, pronta para os testes do painel e da Stripe. */
export async function registar(worker, env, sobre = {}) {
  const r = await pedir(worker, env, 'POST', '/checkout', { corpo: pedidoValido(sobre) });
  if (r.status !== 200) throw new Error(`checkout falhou nos testes: ${r.status} ${r.texto}`);
  return r.json;
}
