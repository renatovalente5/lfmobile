/* LF Mobile — a conta do cliente (/conta/, 13 nov 2026). Entrar com o email e um código que vai por email;
   lá dentro, as encomendas desse email e, na ficha de cada uma (/conta/?e=<número>), em que ponto está e o
   caminho que fez. Fala com /conta/api/… no próprio domínio (o Worker das encomendas, pelo worker/www.js):
   a sessão é um cookie que este script não lê (HttpOnly); quem diz se há sessão é o /conta/api/eu.
   O pedido do código fica no sessionStorage do separador, para o código se poder escrever depois de ir ver
   o email (o Safari do iPhone pode recarregar a página ao voltar). */
(function () {
  'use strict';
  // [data-conta] é o número do carrinho no cabeçalho (carrinho.js): a raiz desta página tem outro nome
  const raiz = document.querySelector('[data-area-cliente]');
  if (!raiz) return;
  const $ = (s, r = raiz) => r.querySelector(s);
  const $$ = (s, r = raiz) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const euros = (v) => `${v.toLocaleString('pt-PT', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} €`;
  const centimos = (c) => (Number.isFinite(c) ? euros(Math.round(c) / 100) : '');
  const base = String(document.body.dataset.base || '/');
  const API = '/conta/api';
  const CHAVE = 'lfmobile:conta-codigo';

  // os estados como o cliente os lê (encomenda.js do Worker: ESTADOS)
  const ROTULOS = {
    registada: 'Recebida', pendente: 'À espera do pagamento', paga: 'Paga', pronta: 'Pronta para levantar', enviada: 'Enviada',
    levantada: 'Levantada', anulada: 'Anulada', reembolsada: 'Reembolsada', falhou: 'Pagamento não concluído', expirou: 'Pagamento não concluído',
  };
  const FRASES = {
    registada: 'Recebemos a sua encomenda. Confirmamos consigo o pagamento e a entrega por email ou WhatsApp.',
    pendente: 'Falta o pagamento. Assim que o recebermos, avisamos por email.',
    paga: 'O pagamento foi recebido. Avisamos por email quando a encomenda seguir ou estiver pronta.',
    pronta: 'Está pronta para levantar na loja, no horário de abertura.',
    enviada: 'Já seguiu pelos correios.',
    levantada: 'Foi levantada na loja.',
    anulada: 'Esta encomenda foi anulada.',
    reembolsada: 'O pagamento foi devolvido.',
    falhou: 'O pagamento não se concluiu e nada foi cobrado.',
    expirou: 'O pagamento não se concluiu e nada foi cobrado.',
  };
  const tom = (estado) => ({ paga: 'ok', pronta: 'ok', enviada: 'ok', levantada: 'fim', anulada: 'parado', reembolsada: 'parado', falhou: 'parado', expirou: 'parado' }[estado] || 'espera');
  const FINAIS = ['levantada', 'anulada', 'reembolsada', 'falhou', 'expirou'];

  /* As datas em Lisboa, com os meses por extenso escritos aqui: o «month: 'short'» do pt-PT dá «13/11/2026» num
     browser e «13 de nov.» noutro. */
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function partes(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      const o = {};
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).forEach((x) => { o[x.type] = x.value; });
      return { dia: Number(o.day), mes: MESES[Number(o.month) - 1], ano: o.year, hora: `${o.hour}:${o.minute}` };
    } catch (_) { return null; }
  }
  const dataCurta = (iso) => { const p = partes(iso); return p ? `${p.dia} ${p.mes.slice(0, 3)} ${p.ano}` : ''; };
  const dataLonga = (iso) => { const p = partes(iso); return p ? `${p.dia} de ${p.mes} de ${p.ano}` : ''; };
  const dataHora = (iso) => { const p = partes(iso); return p ? `${p.dia} ${p.mes.slice(0, 3)}, ${p.hora}` : ''; };

  async function api(caminho, corpo) {
    const init = corpo ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) } : {};
    const r = await fetch(`${API}${caminho}`, { ...init, credentials: 'same-origin', cache: 'no-store' });
    let j = null;
    try { j = await r.json(); } catch (_) { /* sem corpo */ }
    return { ok: r.ok, status: r.status, j: j || {} };
  }

  const blocos = { carregar: $('[data-conta-carregar]'), entrar: $('[data-conta-entrar]'), lista: $('[data-conta-lista]'), ficha: $('[data-conta-ficha]') };
  let vista = 'carregar';
  function mostrar(qual) {
    const mudou = qual !== vista;
    vista = qual;
    Object.entries(blocos).forEach(([nome, el]) => { el.hidden = nome !== qual; });
    raiz.removeAttribute('aria-busy');
    /* Ao mudar de vista (entrar → as encomendas), o teclado do telemóvel fecha-se e a página volta ao topo: no
       iPhone, depois de escrever o código, a lista abria a meio, sem o título nem o «Sair» (o Renato, 13 nov 2026).
       O foco vai para o título, para quem usa um leitor de ecrã. */
    if (mudou && qual !== 'carregar') {
      if (document.activeElement && document.activeElement !== document.body && typeof document.activeElement.blur === 'function') document.activeElement.blur();
      window.scrollTo(0, 0);
      const h = blocos[qual].querySelector('h1');
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    }
  }
  const falha = $('[data-conta-falha]');
  function dizerFalha(t, { voltar = false } = {}) {
    falha.innerHTML = t ? `${esc(t)}${voltar ? ` <a href="${base}conta/">Ver as minhas encomendas</a>` : ''}` : '';
    falha.hidden = !t;
  }

  // ---------------------------------------------------------------- entrar
  const formEmail = $('[data-conta-form-email]');
  const formCodigo = $('[data-conta-form-codigo]');
  const campoEmail = $('#conta-email');
  const campoCodigo = $('#conta-codigo');
  const lerPedido = () => { try { return JSON.parse(sessionStorage.getItem(CHAVE) || 'null'); } catch (_) { return null; } };
  const guardarPedido = (v) => { try { if (v) sessionStorage.setItem(CHAVE, JSON.stringify(v)); else sessionStorage.removeItem(CHAVE); } catch (_) { /* sem armazenamento: vale enquanto a página estiver aberta */ } };
  let pedido = null;

  function erroEm(form, t, campo) {
    const p = $('[data-conta-erro]', form);
    p.textContent = t || '';
    p.hidden = !t;
    $$('input', form).forEach((i) => i.removeAttribute('aria-invalid'));
    if (t && campo) { campo.setAttribute('aria-invalid', 'true'); campo.focus(); }
  }
  function ocupado(form, sim) {
    const b = $('button[type="submit"]', form);
    b.disabled = sim;
    if (sim) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
  }
  function passoCodigo(foco = true) {
    formEmail.hidden = true;
    formCodigo.hidden = false;
    $('[data-conta-enviado]', formCodigo).innerHTML = `Enviámos um código para <strong>${esc(pedido.email)}</strong>. Pode demorar um minuto; veja também o spam.`;
    if (foco) campoCodigo.focus();
  }
  function passoEmail() {
    pedido = null;
    guardarPedido(null);
    formCodigo.hidden = true;
    formEmail.hidden = false;
    campoCodigo.value = '';
    erroEm(formCodigo, '');
    campoEmail.focus();
  }

  async function pedirCodigo(email) {
    const r = await api('/codigo', { email });
    if (!r.ok) return r;
    pedido = { email, pedido: r.j.pedido, em: Date.now() };
    guardarPedido(pedido);
    return r;
  }

  formEmail.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = campoEmail.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { erroEm(formEmail, 'Escreva um email válido.', campoEmail); return; }
    erroEm(formEmail, '');
    ocupado(formEmail, true);
    try {
      const r = await pedirCodigo(email);
      if (!r.ok) { erroEm(formEmail, r.j.erro || 'Não conseguimos enviar o código. Tente outra vez.', campoEmail); return; }
      campoCodigo.value = '';
      passoCodigo();
    } catch (_) {
      erroEm(formEmail, 'Sem ligação. Veja a internet e tente outra vez.', campoEmail);
    } finally { ocupado(formEmail, false); }
  });

  /* O código como a pessoa o escreve ou cola: os 6 algarismos (aceita «123 456», o código colado do email
     e o código em dobro que o iPhone às vezes mete). */
  const algarismos = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length === 12 && d.slice(0, 6) === d.slice(6) ? d.slice(0, 6) : d; };
  let aEntrar = false;
  async function entrar() {
    if (aEntrar || !pedido) return;
    const codigo = algarismos(campoCodigo.value);
    if (codigo.length !== 6) { erroEm(formCodigo, 'O código tem 6 algarismos.', campoCodigo); return; }
    erroEm(formCodigo, '');
    aEntrar = true;
    ocupado(formCodigo, true);
    try {
      const r = await api('/entrar', { email: pedido.email, pedido: pedido.pedido, codigo });
      if (r.ok) { guardarPedido(null); await abrir(); return; }
      erroEm(formCodigo, r.j.erro || 'Não conseguimos entrar. Tente outra vez.', campoCodigo);
      if (r.j.novo) campoCodigo.value = '';
    } catch (_) {
      erroEm(formCodigo, 'Sem ligação. Veja a internet e tente outra vez.', campoCodigo);
    } finally { aEntrar = false; ocupado(formCodigo, false); }
  }
  formCodigo.addEventListener('submit', (e) => { e.preventDefault(); entrar(); });
  // ao 6.º algarismo entra sozinho (escrito, colado ou preenchido pelo telemóvel)
  campoCodigo.addEventListener('input', () => { if (algarismos(campoCodigo.value).length === 6) entrar(); });

  $('[data-conta-reenviar]').addEventListener('click', async (e) => {
    if (!pedido) { passoEmail(); return; }
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const r = await pedirCodigo(pedido.email);
      erroEm(formCodigo, r.ok ? '' : (r.j.erro || 'Não conseguimos enviar o código. Tente outra vez.'));
      if (r.ok) { campoCodigo.value = ''; passoCodigo(); }
    } catch (_) {
      erroEm(formCodigo, 'Sem ligação. Veja a internet e tente outra vez.');
    } finally { setTimeout(() => { b.disabled = false; }, 20000); }
  });
  $('[data-conta-mudar]').addEventListener('click', passoEmail);

  function mostrarEntrar() {
    mostrar('entrar');
    document.title = document.title.replace(/^[^|]*\|/, 'A minha conta |');
    const guardado = lerPedido();
    // um pedido de há menos de 10 minutos (o prazo do código) continua: a pessoa foi ver o email e voltou
    if (guardado && guardado.pedido && Date.now() - guardado.em < 10 * 60 * 1000) {
      pedido = guardado;
      campoEmail.value = pedido.email;
      passoCodigo(false);
    }
  }

  // ---------------------------------------------------------------- a lista
  const lista = $('[data-conta-encomendas]');
  function cartao(x) {
    const artigos = (x.linhas || []).map((l) => `${l.qtd} × ${l.nome}`).join(', ') + (x.linhas_a_mais ? ` e mais ${x.linhas_a_mais}` : '');
    return `<li><a class="conta-encomenda" href="${base}conta/?e=${encodeURIComponent(x.encomenda)}">
      <span class="conta-encomenda__topo"><strong>${esc(x.encomenda)}</strong><span class="estado estado--${tom(x.estado)}">${esc(ROTULOS[x.estado] || x.estado)}</span></span>
      <span class="conta-encomenda__artigos">${esc(artigos)}</span>
      <span class="conta-encomenda__pe"><span>${esc(dataCurta(x.criada_em))}</span><strong>${esc(centimos(x.total_cents))}</strong></span>
    </a></li>`;
  }
  /* O CARTÃO DAS PELÍCULAS (o de papel da loja, «Películas Hidrogel»): 5 casas e, na 6.ª, a oferta. As do site
     contam sozinhas; as da loja marca-as a loja. Com uma oferta por levantar, as 5 casas ficam cheias e a 6.ª
     acende-se. */
  const icone = (nome) => ($(`[data-icone-${nome}]`) || {}).innerHTML || '';
  function pintarCartao(c) {
    const caixa = $('[data-conta-cartao]');
    if (!c || !Number.isInteger(c.atuais)) { caixa.hidden = true; return; }
    const por = c.por_cartao || 5;
    const cheias = c.disponiveis > 0 && c.atuais === 0 ? por : c.atuais;
    const casas = Array.from({ length: por }, (_, i) => `<li class="cartao-peliculas__casa${i < cheias ? ' cartao-peliculas__casa--cheia' : ''}">${i < cheias ? icone('certo') : `<span>${i + 1}</span>`}</li>`).join('');
    const faltam = por - c.atuais;
    const frase = c.disponiveis > 0
      ? `Tem ${c.disponiveis === 1 ? 'uma película' : `${c.disponiveis} películas`} de oferta. Peça-a${c.disponiveis === 1 ? '' : 's'} na loja.`
      : `${faltam === 1 ? 'Falta 1 película' : `Faltam ${faltam} películas`} para a oferta.`;
    caixa.innerHTML = `<div class="cartao-peliculas__cabeca">
        <h2 class="cartao-peliculas__titulo" id="cartao-peliculas-titulo">Cartão das películas</h2>
        <p class="cartao-peliculas__sub">Películas de hidrogel · a ${por + 1}.ª é oferta</p>
      </div>
      <ol class="cartao-peliculas__casas" aria-label="${cheias} de ${por} películas${c.disponiveis > 0 ? ', com oferta' : ''}">${casas}<li class="cartao-peliculas__casa cartao-peliculas__casa--oferta${c.disponiveis > 0 ? ' cartao-peliculas__casa--ganha' : ''}">${icone('presente')}</li></ol>
      <p class="cartao-peliculas__frase">${esc(frase)}</p>`;
    caixa.hidden = false;
  }

  function pintarLista(dados) {
    $('[data-conta-quem]').textContent = dados.email || '';
    pintarCartao(dados.cartao);
    const encs = Array.isArray(dados.encomendas) ? dados.encomendas : [];
    lista.innerHTML = encs.map(cartao).join('');
    lista.hidden = !encs.length;
    $('[data-conta-vazia]').hidden = encs.length > 0;
    mostrar('lista');
  }

  // ---------------------------------------------------------------- a ficha
  /* O caminho: o que já aconteceu (com a data) e, numa encomenda que ainda corre, o que falta. */
  function caminho(enc) {
    const feitos = Array.isArray(enc.historico) && enc.historico.length ? enc.historico : [{ estado: enc.estado, em: enc.criada_em }];
    const passos = feitos.map((h) => ({ estado: h.estado, em: h.em, nota: h.nota, feito: true }));
    if (!FINAIS.includes(enc.estado)) {
      const normal = enc.entrega === 'levantamento' ? ['paga', 'pronta', 'levantada'] : ['paga', 'enviada'];
      const ja = new Set(passos.map((p) => p.estado));
      const i = Math.max(-1, ...passos.map((p) => normal.indexOf(p.estado)));
      normal.slice(i + 1).filter((e) => !ja.has(e)).forEach((e) => passos.push({ estado: e, feito: false }));
    }
    return `<ol class="caminho">${passos.map((p, i) => {
      const atual = p.feito && (i === passos.length - 1 || !passos[i + 1].feito);
      return `<li class="caminho__passo${p.feito ? ' caminho__passo--feito' : ''}${atual ? ' caminho__passo--atual' : ''}"${atual ? ' aria-current="step"' : ''}>
        <span class="caminho__ponto" aria-hidden="true"></span>
        <span class="caminho__texto"><strong>${esc(ROTULOS[p.estado] || p.estado)}</strong>${p.em ? `<time datetime="${esc(p.em)}">${esc(dataHora(p.em))}</time>` : '<span class="caminho__falta">Por fazer</span>'}${p.nota ? `<span class="caminho__nota">${esc(p.nota)}</span>` : ''}</span>
      </li>`;
    }).join('')}</ol>`;
  }
  function pintarFicha(enc) {
    const levant = enc.entrega === 'levantamento';
    const linhas = (enc.linhas || []).map((l) => `<p><span>${esc(l.qtd)} × ${esc(l.nome)}${(l.escolhas || []).length ? ` <small>(${esc(l.escolhas.join(', '))})</small>` : ''}</span><span>${esc(centimos(l.total_cents))}</span></p>`).join('');
    const portes = levant || enc.portes_cents === 0 ? 'Grátis' : (enc.portes_por_confirmar ? 'a confirmar' : centimos(enc.portes_cents));
    const zap = raiz.dataset.whatsapp;
    const ficha = blocos.ficha;
    ficha.innerHTML = `<a class="conta__voltar" href="${base}conta/"><span aria-hidden="true">‹</span> As minhas encomendas</a>
      <div class="conta__cabeca-ficha">
        <h1 class="titulo-pagina" id="conta-titulo-ficha">Encomenda <span class="conta__numero">${esc(enc.encomenda)}</span></h1>
        <p class="conta__data">Feita a ${esc(dataLonga(enc.criada_em))}</p>
      </div>
      <div class="conta__ficha-grelha">
        <div class="conta__bloco conta__bloco--estado">
          <p class="conta__estado"><span class="estado estado--${tom(enc.estado)}">${esc(ROTULOS[enc.estado] || enc.estado)}</span></p>
          <p class="conta__frase">${esc(FRASES[enc.estado] || '')}</p>
          ${caminho(enc)}
        </div>
        <div class="conta__bloco">
          <h2 class="conta__subtitulo">Artigos</h2>
          <div class="totais">${linhas}
            ${enc.desconto_cents ? `<p class="totais__desconto"><span>Cupão ${esc(enc.cupao || '')}</span><span>−${esc(centimos(enc.desconto_cents))}</span></p>` : ''}
            <p><span>${levant ? 'Levantamento na loja' : 'Portes'}</span><span>${esc(portes)}</span></p>
            <p class="totais__total"><span>Total</span><span>${esc(centimos(enc.total_cents))}${enc.portes_por_confirmar ? ' + portes' : ''}</span></p>
          </div>
          <h2 class="conta__subtitulo">Entrega</h2>
          <p class="conta__entrega">${levant ? `Na loja${raiz.dataset.localidade ? `, em ${esc(raiz.dataset.localidade)}` : ''}. <a href="${esc(raiz.dataset.contactosUrl || `${base}contactos/`)}">Morada e horário</a>` : `Envio para ${esc(enc.morada || 'a morada da encomenda')}.`}</p>
          ${zap ? `<a class="botao botao--whatsapp-suave botao--largo conta__ajuda" href="${esc(zap + encodeURIComponent(enc.encomenda))}" target="_blank" rel="noopener">${iconeZap}<span>Dúvidas? Falar no WhatsApp</span></a>` : ''}
        </div>
      </div>`;
    document.title = document.title.replace(/^[^|]*\|/, `Encomenda ${enc.encomenda} |`);
    mostrar('ficha');
  }

  const iconeZap = ($('[data-icone-whatsapp]') || {}).innerHTML || '';

  // ---------------------------------------------------------------- sair
  $('[data-conta-sair]').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { await api('/sair', {}); } catch (_) { /* o cookie acaba sozinho */ }
    location.replace(`${base}conta/`);
  });

  // ---------------------------------------------------------------- abrir
  async function abrir() {
    dizerFalha('');
    const id = new URLSearchParams(location.search).get('e');
    let r;
    try {
      r = id ? await api(`/encomenda?e=${encodeURIComponent(id)}`) : await api('/eu');
    } catch (_) {
      mostrar('carregar');
      blocos.carregar.hidden = true;
      dizerFalha('Sem ligação. Veja a internet e recarregue a página.');
      return;
    }
    if (r.status === 401) { mostrarEntrar(); return; }
    if (!r.ok) {
      mostrar('carregar');
      blocos.carregar.hidden = true;
      dizerFalha(r.status === 404 && id ? 'Não encontrámos esta encomenda na sua conta.' : (r.j.erro || 'Não conseguimos abrir a conta agora. Tente daqui a pouco.'), { voltar: Boolean(id) });
      return;
    }
    if (id) pintarFicha(r.j); else pintarLista(r.j);
  }
  // voltar a esta página pelo «para trás» (a cache do browser) mostra-a como estava: abre-se outra vez
  window.addEventListener('pageshow', (e) => { if (e.persisted) abrir(); });
  abrir();
})();
