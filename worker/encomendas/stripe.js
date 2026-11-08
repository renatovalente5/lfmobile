/* A STRIPE, sem o SDK: a REST API por fetch() (o Worker não tem dependências), a assinatura dos
 * webhooks com crypto.subtle, a Checkout Session e a aplicação dos eventos à encomenda. A base é
 * o worker/src/stripe.js do Armazém dos Pneus, que corre em produção com esta versão da API.
 *
 * Princípios (herdados do Armazém):
 *   · «Dinheiro recebido» é payment_status !== 'unpaid'. Um checkout.session.completed, por si só,
 *     NÃO é pagamento: com Multibanco chega com payment_status 'unpaid'.
 *   · A Stripe não garante a ordem dos eventos: um evento atrasado nunca desfaz um facto
 *     posterior (uma encomenda paga não volta a «pendente», uma «pronta» não volta a «paga»).
 *   · O NIF, a morada e as notas ficam SÓ no KV e nos emails. Para a Stripe vai o mínimo.
 */

import { mudarEstado } from './encomenda.js';
import { siteUrl } from './catalogo.js';

const API = 'https://api.stripe.com/v1';
const DURACAO_SESSAO_SEGUNDOS = 3600;   // uma hora para pagar; a Stripe pede entre 30 min e 24 h

/* A codificação form-urlencoded aninhada que a Stripe exige (não aceita JSON):
   line_items[0][price_data][unit_amount]=5990, expand[]=payment_intent. */
export function formEncode(obj, prefixo, saida) {
  saida = saida || [];
  for (const chave of Object.keys(obj)) {
    const v = obj[chave];
    if (v === undefined || v === null || v === '') continue;
    const caminho = prefixo ? `${prefixo}[${chave}]` : chave;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (x !== null && typeof x === 'object') formEncode(x, `${caminho}[${i}]`, saida);
        else saida.push(`${encodeURIComponent(`${caminho}[]`)}=${encodeURIComponent(x)}`);
      });
    } else if (typeof v === 'object') {
      formEncode(v, caminho, saida);
    } else {
      saida.push(`${encodeURIComponent(caminho)}=${encodeURIComponent(v)}`);
    }
  }
  return saida.join('&');
}

export async function stripeFetch(env, caminho, { method = 'POST', body, idempotencyKey } = {}) {
  // trim(): um espaço colado à chave dá um 401 igual ao de uma chave revogada.
  const headers = {
    Authorization: `Bearer ${String(env.STRIPE_SECRET_KEY || '').trim()}`,
    'Stripe-Version': env.STRIPE_API_VERSION || '2026-07-29.dahlia',
  };
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const r = await fetch(`${API}${caminho}`, { method, headers, body: body ? formEncode(body) : undefined });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error((dados && dados.error && dados.error.message) || `HTTP ${r.status}`);
    e.status = r.status;
    e.codigo = dados && dados.error && dados.error.code;
    throw e;
  }
  return dados;
}

/* ---------------------------------------------------------------- a assinatura dos webhooks
   Stripe-Signature: t=1699999999,v1=<hex>[,v1=<hex>]; assinado = HMAC-SHA256(`${t}.${corpo}`).
   O corpo TEM de ser o texto cru, byte a byte. */
const TOLERANCIA_SEGUNDOS = 300;

function iguaisHex(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function assinar(corpo, t, segredo) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${t}.${corpo}`)));
}

export async function verificarAssinatura(corpo, cabecalho, segredo, agoraSegundos) {
  if (!cabecalho) throw new Error('assinatura ausente');
  let t = null;
  const v1 = [];
  for (const parte of cabecalho.split(',')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const k = parte.slice(0, i).trim(), v = parte.slice(i + 1).trim();
    if (k === 't') t = v; else if (k === 'v1') v1.push(v);
  }
  if (!t || !v1.length) throw new Error('assinatura malformada');
  const idade = Math.abs(agoraSegundos - parseInt(t, 10));
  if (!Number.isFinite(idade) || idade > TOLERANCIA_SEGUNDOS) throw new Error('timestamp fora da tolerância');
  const mac = await assinar(corpo, t, segredo);
  if (!v1.some((s) => iguaisHex(s, mac))) throw new Error('assinatura inválida');
  return JSON.parse(corpo);
}

/* ---------------------------------------------------------------- a Checkout Session */

/* A página segura da Stripe para esta encomenda. Os artigos vão como line_items com o preço que
   ESTE Worker calculou; os portes, quando os há, são mais uma linha (a morada já foi recolhida
   no site, e a Stripe só restringe por país: Madeira e Açores são Portugal). */
export async function criarSessao(env, enc, zona) {
  const site = siteUrl(env);
  const params = {
    ui_mode: 'hosted_page',
    mode: 'payment',
    locale: 'pt',
    client_reference_id: enc.encomenda,
    customer_email: enc.cliente.email,
    success_url: `${site}/obrigado/?s={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/checkout/?cancelado=1`,
    expires_at: Math.floor(Date.now() / 1000) + DURACAO_SESSAO_SEGUNDOS,
    line_items: enc.linhas.map((l) => ({
      quantity: l.qtd,
      price_data: {
        currency: 'eur',
        unit_amount: l.unidade_cents,
        product_data: {
          name: l.escolhas && l.escolhas.length ? `${l.nome} (${l.escolhas.join(', ')})` : l.nome,
          metadata: { produto: l.produto },
        },
      },
    })),
    metadata: { encomenda: enc.encomenda },
    payment_intent_data: {
      description: `Encomenda ${enc.encomenda} — ${env.STORE_NAME || 'LF Mobile'}`,
      metadata: { encomenda: enc.encomenda },
    },
  };
  if (enc.portes_cents > 0) {
    params.line_items.push({
      quantity: 1,
      price_data: { currency: 'eur', unit_amount: enc.portes_cents, product_data: { name: 'Portes de envio', description: zona && zona.nome ? zona.nome : 'Portugal Continental' } },
    });
  }
  if (zona && zona.nome) params.custom_text = { submit: { message: zona.nome } };
  return stripeFetch(env, '/checkout/sessions', { body: params, idempotencyKey: `chk_${enc.encomenda}` });
}

/* ---------------------------------------------------------------- os eventos */

/* Os eventos a subscrever no endpoint da Stripe (um só por facto: evita os «gémeos» que
   mandariam dois emails de pagamento). */
export const EVENTOS = Object.freeze([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'payment_intent.requires_action',
  'charge.refunded',
]);

/* Os estados que um pagamento ainda pode promover a «paga». Os outros já são posteriores
   (o dono marcou a encomenda, ou a Stripe devolveu o dinheiro). */
const PODE_FICAR_PAGA = ['pendente', 'registada', 'falhou', 'expirou'];

const metodoDe = (obj) => {
  const t = Array.isArray(obj.payment_method_types) ? obj.payment_method_types[0] : null;
  return typeof t === 'string' ? t : null;
};

function marcarPaga(enc, obj, em, avisos) {
  enc.stripe = enc.stripe || {};
  if (PODE_FICAR_PAGA.includes(enc.estado)) mudarEstado(enc, 'paga', { por: 'stripe', em });
  enc.stripe.pago_em = enc.stripe.pago_em || em;
  if (!enc.stripe.metodo && metodoDe(obj)) enc.stripe.metodo = metodoDe(obj);
  avisos.push('paga');
}

/* Aplica um evento à encomenda (muda-a no sítio) e devolve os avisos que ele pede. Quem decide
   se cada aviso ainda vai (já foi mandado por um evento anterior?) é o webhook, pela marca
   enc.avisos. */
export function aplicarEvento(enc, evento, em = new Date().toISOString()) {
  const obj = (evento.data && evento.data.object) || {};
  const avisos = [];
  enc.stripe = enc.stripe || {};
  switch (evento.type) {
    case 'checkout.session.completed':
      enc.stripe.session_id = enc.stripe.session_id || obj.id;
      if (typeof obj.payment_intent === 'string') enc.stripe.payment_intent = enc.stripe.payment_intent || obj.payment_intent;
      if (obj.payment_status && obj.payment_status !== 'unpaid') marcarPaga(enc, obj, em, avisos);
      // Sem pagamento (Multibanco): fica «pendente», que já era; a referência vem no
      // payment_intent.requires_action.
      break;
    case 'checkout.session.async_payment_succeeded':
      if (typeof obj.payment_intent === 'string') enc.stripe.payment_intent = enc.stripe.payment_intent || obj.payment_intent;
      marcarPaga(enc, obj, em, avisos);
      break;
    case 'checkout.session.async_payment_failed':
      if (enc.estado === 'pendente') { mudarEstado(enc, 'falhou', { por: 'stripe', em }); avisos.push('falhou'); }
      break;
    case 'checkout.session.expired':
      if (enc.estado === 'pendente') { mudarEstado(enc, 'expirou', { por: 'stripe', em }); avisos.push('expirou'); }
      break;
    case 'payment_intent.requires_action': {
      // A única via documentada para a entidade e a referência Multibanco.
      const mb = obj.next_action && obj.next_action.multibanco_display_details;
      enc.stripe.payment_intent = enc.stripe.payment_intent || obj.id;
      if (mb) {
        enc.stripe.multibanco = { entidade: mb.entity, referencia: mb.reference, validade: mb.expires_at || null, url: mb.hosted_voucher_url || null };
        // O «falta pagar» só se ainda não pagou: este evento pode chegar depois do pagamento.
        if (enc.estado === 'pendente') avisos.push('multibanco');
      }
      break;
    }
    case 'charge.refunded': {
      const devolvido = Number.isFinite(obj.amount_refunded) ? obj.amount_refunded : 0;
      const total = Number.isFinite(obj.amount) ? obj.amount : enc.total_cents;
      enc.stripe.reembolsado_cents = Math.max(enc.stripe.reembolsado_cents || 0, devolvido);
      if (devolvido >= total && enc.estado !== 'reembolsada') {
        mudarEstado(enc, 'reembolsada', { por: 'stripe', em });
        avisos.push('reembolsada');
      } else if (devolvido < total) {
        // Um reembolso parcial é informação, não um estado: fica no histórico.
        enc.historico = [...(enc.historico || []), { em, estado: enc.estado, por: 'stripe', nota: `Reembolso parcial: ${(devolvido / 100).toFixed(2).replace('.', ',')} €` }];
      }
      break;
    }
    default:
      break;
  }
  return { avisos };
}

/* A encomenda a que um evento pertence: a nossa metadata (a sessão e o PaymentIntent levam
   `encomenda`; a cobrança herda-a do PaymentIntent), ou os índices session:/pi:. */
export async function idDoEvento(env, obj) {
  const md = obj.metadata || {};
  let id = md.encomenda || obj.client_reference_id || null;
  if (!id && obj.object === 'checkout.session' && obj.id) id = await env.ORDERS.get(`session:${obj.id}`);
  if (!id && obj.object === 'payment_intent' && obj.id) id = await env.ORDERS.get(`pi:${obj.id}`);
  if (!id && typeof obj.payment_intent === 'string') id = await env.ORDERS.get(`pi:${obj.payment_intent}`);
  return id || null;
}
