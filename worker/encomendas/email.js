/* OS EMAILS DAS ENCOMENDAS (pela Cloudflare, o binding EMAIL; ou pelo Resend, RESEND_API_KEY: ver
 * enviar()). Texto E HTML, curtos, em português, com o logótipo do site no topo, o número da
 * encomenda, as linhas, o total, a entrega e os contactos da loja; e, ao cliente, o aviso dos 14 dias
 * com a ligação a /desistir/ (DL 24/2014, art. 4.º e 5.º: a confirmação em suporte duradouro leva as
 * condições).
 *
 * Sem o binding nem RESEND_API_KEY não se manda nada e a encomenda fica gravada na mesma. Sem
 * STORE_EMAIL, o email ao dono não se manda. O `text` nunca se omite: a versão de texto de um email
 * que é documento é deliberada, não um subproduto do HTML.
 *
 * Cada momento (§6 do contrato) é uma entrada de AVISOS: quem a chama é o /checkout (registada),
 * o webhook da Stripe (paga, multibanco, reembolsada, falhou, expirou) e o painel (paga, pronta,
 * enviada, anulada). `avisar()` manda e devolve o que aconteceu a cada destinatário.
 *
 * Ao dono só vai o que lhe pede alguma coisa: a encomenda nova (confirmar com o cliente), a paga
 * (faturar, preparar) e um pagamento que chega a uma encomenda anulada (reembolsar). O «expirou» e o
 * «falhou» não lhe pedem nada — a encomenda não se fez e o painel mostra-a —: só o cliente é avisado
 * (o Renato, 11 nov 2026, como na Franja Kids).
 */

import { documento, tabelaArtigos, caixaMultibanco, botao, separador, bloco, h2, p, pequeno, ligacao, esc } from './email-html.js';
import { primeiroNome } from './encomenda.js';
import { pedirAoObjecto } from './objecto.js';
import { siteUrl } from './catalogo.js';

const RESEND = 'https://api.resend.com/emails';

export const eur = (c) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
const dataPT = (iso) => {
  try { return new Date(iso).toLocaleDateString('pt-PT', { timeZone: 'Europe/Lisbon', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; }
};

/* A nota do custo da chamada junto do número (DL 59/2021, art. 3.º, n.º 3), como no site. */
const telefoneComNota = (n) => (n ? `${n} (chamada para a rede móvel nacional)` : '');
const logoDe = (env) => env.LOGO_URL || `${siteUrl(env)}/assets/img/logo-b72d7bbaa1-128.png`;
const marcaDe = (env) => env.STORE_NAME || 'LF Mobile';

/* ---------------------------------------------------------------- as peças comuns */

const linhaTexto = (l) => `  ${l.qtd} × ${l.nome}${l.escolhas && l.escolhas.length ? ` (${l.escolhas.join(', ')})` : ''} — ${eur(l.total_cents)}`;

/* Os portes e o total, como o site os mostra: «grátis», «a confirmar», ou o valor. */
function totais(enc) {
  const levantamento = enc.entrega === 'levantamento';
  const portes = levantamento
    ? { rotulo: 'Levantamento na loja', valor: 'Grátis' }
    : { rotulo: 'Portes', valor: enc.portes_por_confirmar ? 'a confirmar' : (enc.portes_cents ? eur(enc.portes_cents) : 'Grátis') };
  const total = enc.portes_por_confirmar ? `${eur(enc.total_cents)} + portes` : eur(enc.total_cents);
  const desconto = enc.cupao && enc.desconto_cents ? { rotulo: `Cupão ${enc.cupao}`, valor: `−${eur(enc.desconto_cents)}` } : null;
  return { portes, total, desconto };
}
function artigosTexto(enc) {
  const { portes, total, desconto } = totais(enc);
  return ['ARTIGOS', ...(enc.linhas || []).map(linhaTexto), ...(desconto ? [`  ${desconto.rotulo}: ${desconto.valor}`] : []), `  ${portes.rotulo}: ${portes.valor}`, `  Total: ${total}`];
}

const moradaDe = (c) => [c.morada, [c.codigoPostal, c.localidade].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/* A entrega: o levantamento com o texto do site (a morada e o horário vêm do painel, não daqui),
   ou o envio para a morada que a pessoa escreveu, com o prazo que o site anuncia. */
function entregaFrase(enc, cat) {
  if (enc.entrega === 'levantamento') return ['Levantamento na loja.', cat && cat.levantamento].filter(Boolean).join(' ');
  const partes = [`Envio para ${moradaDe(enc.cliente || {})}.`];
  if (enc.portes_por_confirmar) partes.push('Os portes ainda não estão definidos: dizemos-lhe o valor antes de enviar.');
  if (cat && cat.prazo) partes.push(cat.prazo);
  return partes.join(' ');
}

const ligacaoDaEncomenda = (env, enc) => (enc.chave ? `${siteUrl(env)}/obrigado/?e=${encodeURIComponent(enc.encomenda)}&c=${encodeURIComponent(enc.chave)}` : null);

function desistenciaTexto(env) {
  const site = siteUrl(env);
  return `Tem 14 dias depois de receber o artigo para desistir da compra, sem dar justificação: veja como em ${site}/desistir/. Os termos e condições estão em ${site}/termos-e-condicoes/.`;
}
function desistenciaHtml(env) {
  const site = siteUrl(env);
  return `Tem 14 dias depois de receber o artigo para desistir da compra, sem dar justificação: ${ligacao(`${site}/desistir/`, 'veja como')}. Leia os ${ligacao(`${site}/termos-e-condicoes/`, 'termos e condições')}.`;
}
function contactosTexto(env) {
  return [marcaDe(env), telefoneComNota(env.STORE_PHONE), env.STORE_EMAIL].filter(Boolean).join(' · ');
}
function contactosHtml(env) {
  return [esc(marcaDe(env)), esc(telefoneComNota(env.STORE_PHONE)), env.STORE_EMAIL ? ligacao(`mailto:${env.STORE_EMAIL}`, env.STORE_EMAIL) : ''].filter(Boolean).join(' · ');
}

/* O email ao cliente, inteiro: a saudação, a frase do momento, os artigos, a entrega (se a
   houver), a caixa Multibanco (se a houver), o botão, e o rodapé com os 14 dias e os contactos. */
function emailCliente(env, enc, { assunto, titulo, frase, entrega = null, multibanco = null, semArtigos = false, semDesistencia = false, cat = null }) {
  const nome = primeiroNome((enc.cliente || {}).nome);
  const subtitulo = `Encomenda ${enc.encomenda} · ${dataPT(enc.criada_em)}`;
  const ver = ligacaoDaEncomenda(env, enc);
  const texto = [
    `Olá${nome ? ` ${nome}` : ''},`,
    '',
    frase,
    '',
    ...(semArtigos ? [] : [...artigosTexto(enc), '']),
    ...(entrega ? ['ENTREGA', `  ${entrega}`, ''] : []),
    ...(multibanco ? ['PAGAR POR MULTIBANCO', `  Entidade: ${multibanco.entidade}`, `  Referência: ${multibanco.referencia}`, `  Valor: ${eur(enc.total_cents)}`, ...(multibanco.validade ? [`  Válida até: ${new Date(multibanco.validade * 1000).toLocaleDateString('pt-PT', { timeZone: 'Europe/Lisbon' })}`] : []), ''] : []),
    ...(ver ? [`Ver a encomenda: ${ver}`, ''] : []),
    ...(semDesistencia ? [] : [desistenciaTexto(env), '']),
    contactosTexto(env),
  ].join('\n');
  const corpo = [
    bloco(p(`Olá${nome ? ` ${esc(nome)}` : ''},`) + p(esc(frase), true)),
    semArtigos ? '' : tabelaArtigos(enc, totais(enc)),
    entrega ? bloco(h2('Entrega') + p(esc(entrega), true)) : '',
    multibanco ? caixaMultibanco(multibanco, enc.total_cents) : '',
    ver ? botao(ver, 'Ver a encomenda') : '',
    separador(),
    bloco((semDesistencia ? '' : pequeno(desistenciaHtml(env))) + pequeno(contactosHtml(env), true), '14px 40px 0 40px'),
  ].join('');
  const html = documento({ assunto, preheader: frase, titulo, subtitulo, corpo, logo: logoDe(env), marca: marcaDe(env), site: siteUrl(env) });
  return { assunto, texto, html };
}

/* O email ao dono: tudo o que ele precisa, em texto. */
function emailDono(env, enc, { assunto, cabecalho, rodape = [] }) {
  const c = enc.cliente || {};
  const texto = [
    cabecalho,
    '',
    ...artigosTexto(enc),
    '',
    'ENTREGA',
    `  ${enc.entrega === 'levantamento' ? 'Levantamento na loja' : `Envio para: ${c.nome}, ${moradaDe(c)}`}${enc.portes_por_confirmar ? ' — PORTES POR CONFIRMAR com o cliente' : ''}`,
    '',
    'CLIENTE',
    `  Nome: ${c.nome || '—'}`,
    `  Telemóvel: ${c.telefone || '—'}`,
    `  Email: ${c.email || '—'}`,
    `  NIF: ${c.nif || '(não indicado)'}`,
    ...(c.notas ? [`  Notas: ${c.notas.replace(/\n/g, '\n         ')}`] : []),
    ...(rodape.length ? ['', ...rodape] : []),
  ].join('\n');
  return { assunto, texto };
}

/* ---------------------------------------------------------------- os momentos */

const AVISOS = {
  registada: (env, enc, { cat }) => ({
    cliente: emailCliente(env, enc, {
      assunto: `Recebemos a sua encomenda ${enc.encomenda}`,
      titulo: 'Recebemos a sua encomenda',
      frase: 'A sua encomenda ficou registada. Confirmamos consigo o pagamento e a entrega por email ou WhatsApp.',
      entrega: entregaFrase(enc, cat),
      cat,
    }),
    dono: emailDono(env, enc, {
      assunto: `Nova encomenda ${enc.encomenda} — ${eur(enc.total_cents)}${enc.portes_por_confirmar ? ' + portes' : ''}`,
      cabecalho: `NOVA ENCOMENDA ${enc.encomenda} — ${eur(enc.total_cents)}${enc.portes_por_confirmar ? ' + portes' : ''}`,
      rodape: ['O cliente espera que confirme o pagamento e a entrega (por email ou WhatsApp).'],
    }),
  }),
  paga: (env, enc, { origem }) => ({
    cliente: emailCliente(env, enc, {
      assunto: `Pagamento recebido — encomenda ${enc.encomenda}`,
      titulo: 'Pagamento recebido',
      frase: enc.entrega === 'levantamento'
        ? 'Recebemos o seu pagamento. Avisamos quando a encomenda estiver pronta para levantar na loja.'
        : 'Recebemos o seu pagamento. Avisamos quando a encomenda seguir.',
    }),
    // Pela Stripe, o dono tem de saber (facturar, preparar); pelo painel foi ele que marcou.
    dono: origem === 'stripe' ? emailDono(env, enc, {
      assunto: `Encomenda paga ${enc.encomenda} — ${eur(enc.total_cents)}`,
      cabecalho: `ENCOMENDA PAGA ${enc.encomenda} — ${eur(enc.total_cents)}`,
      rodape: [`Método: ${(enc.stripe || {}).metodo || '—'} · Stripe: ${(enc.stripe || {}).payment_intent || '—'}`, 'Emita a factura e prepare a encomenda.'],
    }) : null,
  }),
  // Um pagamento que chegou com a encomenda já anulada, ou já marcada como paga à mão: só ao dono.
  'paga-fora': (env, enc) => ({
    cliente: null,
    dono: emailDono(env, enc, {
      assunto: `Pagamento recebido numa encomenda «${enc.estado}»: ${enc.encomenda} — ${eur(enc.total_cents)}`,
      cabecalho: `A STRIPE RECEBEU O PAGAMENTO DA ENCOMENDA ${enc.encomenda} (${eur(enc.total_cents)}), mas a encomenda está «${enc.estado}» no painel.`,
      rodape: [`Stripe: ${(enc.stripe || {}).payment_intent || (enc.stripe || {}).session_id || '—'}`, 'Confirme na Stripe e, se a encomenda não segue, reembolse o cliente.'],
    }),
  }),
  multibanco: (env, enc) => ({
    cliente: emailCliente(env, enc, {
      assunto: `Falta pagar: referência Multibanco da encomenda ${enc.encomenda}`,
      titulo: 'Falta pagar',
      frase: 'Para concluir a encomenda, pague a referência Multibanco abaixo. A encomenda segue depois de o pagamento entrar.',
      multibanco: (enc.stripe || {}).multibanco,
    }),
    dono: null,
  }),
  pronta: (env, enc, { cat }) => ({
    cliente: emailCliente(env, enc, {
      assunto: `A sua encomenda ${enc.encomenda} está pronta para levantar`,
      titulo: 'Pronta para levantar',
      frase: 'A sua encomenda está pronta. Pode levantá-la na loja no horário de abertura.',
      entrega: [cat && cat.levantamento, `Horário e morada: ${siteUrl(env)}/contactos/`].filter(Boolean).join(' '),
    }),
    dono: null,
  }),
  enviada: (env, enc, { nota }) => ({
    cliente: emailCliente(env, enc, {
      assunto: `A sua encomenda ${enc.encomenda} seguiu`,
      titulo: 'A sua encomenda seguiu',
      frase: `A sua encomenda já seguiu pelos correios para ${moradaDe(enc.cliente || {})}.${nota ? ` ${nota}` : ''}`,
    }),
    dono: null,
  }),
  anulada: (env, enc, { nota }) => ({
    cliente: emailCliente(env, enc, {
      assunto: `A sua encomenda ${enc.encomenda} foi anulada`,
      titulo: 'Encomenda anulada',
      frase: `A sua encomenda foi anulada.${nota ? ` ${nota}` : ''} Se tiver dúvidas, fale connosco.`,
      semDesistencia: true,
    }),
    dono: null,
  }),
  reembolsada: (env, enc) => ({
    cliente: emailCliente(env, enc, {
      assunto: `Reembolso feito — encomenda ${enc.encomenda}`,
      titulo: 'Reembolso feito',
      frase: `Devolvemos ${eur((enc.stripe || {}).reembolsado_cents || enc.total_cents)} ao meio de pagamento que usou. O banco pode demorar alguns dias a mostrá-lo.`,
      semDesistencia: true,
    }),
    dono: null,
  }),
  falhou: (env, enc) => naoConcluido(env, enc, 'O pagamento não se concluiu.'),
  expirou: (env, enc) => naoConcluido(env, enc, 'A página de pagamento expirou sem o pagamento.'),
};

/* O pagamento que não se fez: só ao cliente (ao dono não pede nada; o painel mostra a encomenda). */
function naoConcluido(env, enc, razao) {
  return {
    cliente: emailCliente(env, enc, {
      assunto: `O pagamento da encomenda ${enc.encomenda} não se concluiu`,
      titulo: 'O pagamento não se concluiu',
      frase: `${razao} Nada foi cobrado. Pode voltar a encomendar no site ou falar connosco pelo WhatsApp.`,
      semDesistencia: true,
    }),
    dono: null,
  };
}

/* As mensagens de um momento, sem as mandar (os testes lêem-nas). */
export function mensagens(env, aviso, enc, extras = {}) {
  const f = AVISOS[aviso];
  return f ? f(env, enc, extras) : { cliente: null, dono: null };
}

/* ---------------------------------------------------------------- o envio */

/* O remetente do MAIL_FROM («LF Mobile <encomendas@lfmobile.pt>»), na forma do binding EMAIL. */
export function remetenteDe(env) {
  const v = String(env.MAIL_FROM || '').trim();
  const m = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(v);
  return m ? { email: m[2], name: m[1].replace(/^"|"$/g, '').trim() || undefined } : { email: v };
}

/* POR ONDE SAI UM EMAIL: pela Cloudflare (Email Sending, o binding EMAIL do wrangler.toml; o domínio
   lfmobile.pt está nele desde 11 nov 2026, e o plano Workers Paid da conta deixa mandar a qualquer
   pessoa), e só sem ele pelo Resend (RESEND_API_KEY). Sem nenhum dos dois não se manda nada. */
export async function enviar(env, { para, assunto, texto, html, responderA }) {
  if (env.EMAIL && typeof env.EMAIL.send === 'function') {
    try {
      await env.EMAIL.send({ from: remetenteDe(env), to: para, subject: assunto, text: texto, html: html || undefined, replyTo: responderA || undefined });
      return 'enviado';
    } catch (e) {
      console.error('a Cloudflare recusou o email', e && e.code, assunto, e && e.message);
      return 'falhou';
    }
  }
  if (!env.RESEND_API_KEY) { console.log('email não enviado (sem o EMAIL da Cloudflare nem RESEND_API_KEY):', assunto); return 'sem chave'; }
  try {
    const r = await fetch(RESEND, {
      method: 'POST',
      headers: { Authorization: `Bearer ${String(env.RESEND_API_KEY).trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [para], subject: assunto, text: texto, html: html || undefined, reply_to: responderA || undefined }),
    });
    if (!r.ok) { console.error('Resend recusou', r.status, assunto, await r.text().catch(() => '')); return 'falhou'; }
    return 'enviado';
  } catch (e) {
    console.error('Resend não respondeu', assunto, e.message);
    return 'falhou';
  }
}

/* Manda os emails de um momento e diz o que aconteceu a cada um:
   'enviado' | 'falhou' | 'sem chave' | 'sem email' (o cliente) | 'sem destinatário' (o dono) |
   'não se aplica' (o momento não tem esse email) | 'travado: …' (extras.semCliente: o travão por
   endereço não deixou o do cliente). */
export async function avisar(env, aviso, enc, extras = {}) {
  const m = mensagens(env, aviso, enc, extras);
  const email = (enc.cliente || {}).email;
  const [cliente, dono] = await Promise.all([
    !m.cliente ? 'não se aplica' : !email ? 'sem email' : extras.semCliente ? String(extras.semCliente) : enviar(env, { para: email, ...m.cliente, responderA: env.STORE_EMAIL || undefined }),
    !m.dono ? 'não se aplica' : !env.STORE_EMAIL ? 'sem destinatário' : enviar(env, { para: env.STORE_EMAIL, ...m.dono, responderA: email || undefined }),
  ]);
  return { em: new Date().toISOString(), cliente, dono };
}

export const falhou = (r) => Boolean(r) && (r.cliente === 'falhou' || r.dono === 'falhou');

/* O TRAVÃO DOS EMAILS DE ENCOMENDAS POR PAGAR (11 nov 2026, ao ligar o envio pelo domínio; o mesmo da
   Franja Kids). Qualquer pessoa pode encomendar com o email de outra, e a «registada» (modo encomenda),
   o «falta pagar» do Multibanco, o «falhou» e o «expirou» levam a essa pessoa o nome, a morada e as
   notas que quem encomendou escreveu, a partir de lfmobile.pt. Por endereço, no máximo
   MAX_EMAILS_POR_PAGAR por dia; o do dono sai sempre, e o «paga» não tem travão (houve pagamento).
   Conta-se num objecto durável por endereço (o resumo SHA-256, nunca o email); se o contador falhar,
   o email segue (antes um a mais do que uma encomenda sem aviso). */
export const MAX_EMAILS_POR_PAGAR = 3;
export const TRAVADO = 'travado: emails de mais para este endereço hoje';
async function resumoDe(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export async function podeAvisarCliente(env, email) {
  if (!email || !env.CONTADOR) return true;
  try {
    const { ok } = await pedirAoObjecto(env, 'CONTADOR', `email:${await resumoDe(String(email).trim().toLowerCase())}`, { max: MAX_EMAILS_POR_PAGAR });
    return ok !== false;
  } catch (e) {
    console.error('o contador dos emails falhou (o email segue):', e.message);
    return true;
  }
}
