/* LF Mobile — a conta do cliente (/conta/; 13 e 14 nov 2026).
   ENTRAR: com o Google (a página do Google e volta; sem o script deles aqui) ou com o email e um código que vai por email.
   LÁ DENTRO: «Olá, nome», o cartão das películas (com o código QR para mostrar na loja), as encomendas, as garantias
   que ainda correm, os meus dados (que preenchem o checkout), e sair em todos os aparelhos ou apagar a conta.
   NA FICHA de cada encomenda (/conta/?e=<número>): em que ponto está e o caminho que fez, a garantia de cada artigo, e
   «Desistir da compra» enquanto o prazo corre.
   Fala com /conta/api/… no próprio domínio (o Worker das encomendas, pelo worker/www.js): a sessão é um cookie que este
   script não lê (HttpOnly); quem diz se há sessão é o /conta/api/eu. «lfmobile:conta» no localStorage só diz que se
   entrou (o checkout pede os dados à conta só então). O pedido do código e o do Google ficam no sessionStorage do
   separador: o código pode escrever-se depois de ir ver o email, e a volta do Google confere o state e o nonce. */
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
  const CHAVE_GOOGLE = 'lfmobile:conta-google';
  const SINAL = 'lfmobile:conta';
  const guardar = (onde, k, v) => { try { if (v === null) window[onde].removeItem(k); else window[onde].setItem(k, v); } catch (_) { /* sem armazenamento: vale enquanto a página estiver aberta */ } };
  const ler = (onde, k) => { try { return window[onde].getItem(k); } catch (_) { return null; } };
  const sinal = (entrou) => guardar('localStorage', SINAL, entrou ? '1' : null);

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
      const d = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
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
    falha.innerHTML = t ? `${esc(t)}${voltar ? ` <a href="${base}conta/">Ver a minha conta</a>` : ''}` : '';
    falha.hidden = !t;
  }
  const icone = (nome) => ($(`[data-icone-${nome}]`) || {}).innerHTML || '';

  /* ---------------------------------------------------------------- a janela (perguntar, o código QR)
     Uma só <dialog> para tudo: o título, o texto (HTML já escapado por quem chama) e os botões. → o valor do botão. */
  const janela = $('[data-conta-janela]');
  function abrirJanela({ titulo, texto, botoes }) {
    $('[data-janela-titulo]', janela).textContent = titulo;
    $('[data-janela-texto]', janela).innerHTML = texto;
    $('[data-janela-botoes]', janela).innerHTML = botoes.map((b) => `<button class="botao ${b.classe || 'botao--contorno'}" value="${esc(b.valor)}"${b.foco ? ' autofocus' : ''}>${esc(b.t)}</button>`).join('');
    return new Promise((resolve) => {
      const fechar = () => { janela.removeEventListener('close', fechar); resolve(janela.returnValue || 'nao'); };
      janela.addEventListener('close', fechar);
      janela.returnValue = '';
      if (typeof janela.showModal === 'function') janela.showModal(); else janela.setAttribute('open', '');
    });
  }
  // tocar fora da janela fecha-a (como «Cancelar»)
  janela.addEventListener('click', (e) => { if (e.target === janela) janela.close('nao'); });

  /* ---------------------------------------------------------------- entrar com o código */
  const formEmail = $('[data-conta-form-email]');
  const formCodigo = $('[data-conta-form-codigo]');
  const campoEmail = $('#conta-email');
  const campoCodigo = $('#conta-codigo');
  const lerPedido = () => { try { return JSON.parse(ler('sessionStorage', CHAVE) || 'null'); } catch (_) { return null; } };
  const guardarPedido = (v) => guardar('sessionStorage', CHAVE, v ? JSON.stringify(v) : null);
  let pedido = null;

  function erroEm(form, t, campo) {
    const p = $('[data-conta-erro]', form);
    p.textContent = t || '';
    p.hidden = !t;
    $$('input', form).forEach((i) => i.removeAttribute('aria-invalid'));
    if (t && campo) { campo.setAttribute('aria-invalid', 'true'); campo.focus(); }
  }
  function ocupado(botao, sim) {
    botao.disabled = sim;
    if (sim) botao.setAttribute('aria-busy', 'true'); else botao.removeAttribute('aria-busy');
  }
  function passoCodigo(foco = true) {
    formEmail.hidden = true;
    formCodigo.hidden = false;
    $('[data-conta-google]').hidden = true;
    $('[data-conta-enviado]', formCodigo).innerHTML = `Enviámos um código para <strong>${esc(pedido.email)}</strong>. Pode demorar um minuto; veja também o spam.`;
    if (foco) campoCodigo.focus();
  }
  function passoEmail() {
    pedido = null;
    guardarPedido(null);
    formCodigo.hidden = true;
    formEmail.hidden = false;
    $('[data-conta-google]').hidden = !google;
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
    const botao = $('button[type="submit"]', formEmail);
    ocupado(botao, true);
    try {
      const r = await pedirCodigo(email);
      if (!r.ok) { erroEm(formEmail, r.j.erro || 'Não conseguimos enviar o código. Tente outra vez.', campoEmail); return; }
      campoCodigo.value = '';
      passoCodigo();
    } catch (_) {
      erroEm(formEmail, 'Sem ligação. Veja a internet e tente outra vez.', campoEmail);
    } finally { ocupado(botao, false); }
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
    const botao = $('button[type="submit"]', formCodigo);
    ocupado(botao, true);
    try {
      const r = await api('/entrar', { email: pedido.email, pedido: pedido.pedido, codigo });
      if (r.ok) { guardarPedido(null); sinal(true); await abrir(); return; }
      erroEm(formCodigo, r.j.erro || 'Não conseguimos entrar. Tente outra vez.', campoCodigo);
      if (r.j.novo) campoCodigo.value = '';
    } catch (_) {
      erroEm(formCodigo, 'Sem ligação. Veja a internet e tente outra vez.', campoCodigo);
    } finally { aEntrar = false; ocupado(botao, false); }
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

  /* ---------------------------------------------------------------- entrar com o Google
     Vai-se à página do Google com um state e um nonce que ficam no sessionStorage deste separador; o Google volta a
     /conta/ com o id_token no fragmento. Aqui confere-se o state (um token que não pedimos não entra) e o token segue
     para o Worker com o nonce, que ele confere dentro do token. O fragmento sai logo do endereço. */
  let google = null;
  const erroGoogle = $('[data-conta-google-erro]');
  const aleatorio = () => { const b = crypto.getRandomValues(new Uint8Array(18)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  $('[data-conta-google-botao]').addEventListener('click', () => {
    if (!google) return;
    const state = aleatorio();
    const nonce = aleatorio();
    guardar('sessionStorage', CHAVE_GOOGLE, JSON.stringify({ state, nonce, em: Date.now(), volta: location.search }));
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.search = new URLSearchParams({ client_id: google, redirect_uri: `${location.origin}${base}conta/`, response_type: 'id_token', scope: 'openid email', nonce, state, prompt: 'select_account' }).toString();
    location.assign(u.toString());
  });
  /* A volta do Google: → true se tratou dela (entrou ou disse porquê). */
  async function voltaDoGoogle() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.get('id_token') && !h.get('error')) return false;
    let g = null;
    try { g = JSON.parse(ler('sessionStorage', CHAVE_GOOGLE) || 'null'); } catch (_) { g = null; }
    guardar('sessionStorage', CHAVE_GOOGLE, null);
    history.replaceState(null, '', `${location.pathname}${g && g.volta ? g.volta : ''}`);
    const dizer = (t) => { erroGoogle.textContent = t; erroGoogle.hidden = !t; };
    if (h.get('error')) { if (h.get('error') !== 'access_denied') dizer('Não conseguimos entrar com o Google. Tente outra vez, ou entre com o email.'); return false; }
    if (!g || g.state !== h.get('state') || Date.now() - g.em > 15 * 60 * 1000) { dizer('A entrada com o Google não se concluiu. Tente outra vez.'); return false; }
    try {
      const r = await api('/google', { id_token: h.get('id_token'), nonce: g.nonce });
      if (r.ok) { sinal(true); return true; }
      dizer(r.j.erro || 'Não conseguimos entrar com o Google. Tente outra vez, ou entre com o email.');
    } catch (_) { dizer('Sem ligação. Veja a internet e tente outra vez.'); }
    return false;
  }

  function mostrarEntrar(clienteGoogle) {
    sinal(false);
    google = clienteGoogle || null;
    mostrar('entrar');
    document.title = document.title.replace(/^[^|]*\|/, 'A minha conta |');
    const guardado = lerPedido();
    // um pedido de há menos de 10 minutos (o prazo do código) continua: a pessoa foi ver o email e voltou
    if (guardado && guardado.pedido && Date.now() - guardado.em < 10 * 60 * 1000) {
      pedido = guardado;
      campoEmail.value = pedido.email;
      passoCodigo(false);
    } else {
      $('[data-conta-google]').hidden = !google;
    }
  }

  /* ---------------------------------------------------------------- o painel da conta */
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
     contam sozinhas; as da loja marca-as a loja, lendo o código QR do cliente («Mostrar o código»). Com uma oferta por
     levantar, as 5 casas ficam cheias e a 6.ª acende-se. */
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
      <p class="cartao-peliculas__frase">${esc(frase)}</p>
      <button class="botao cartao-peliculas__codigo" type="button" data-conta-mostrar-codigo>Mostrar o código</button>`;
    caixa.hidden = false;
  }
  raiz.addEventListener('click', (e) => {
    if (!e.target.closest('[data-conta-mostrar-codigo]')) return;
    abrirJanela({
      titulo: 'O seu cartão',
      texto: `<img class="conta-janela__qr" src="${API}/cartao.svg?v=${Date.now()}" width="240" height="240" alt="Código do seu cartão das películas">
        <p>Mostre este código na loja: marcamos as películas no seu cartão.</p>`,
      botoes: [{ t: 'Fechar', valor: 'nao', classe: 'botao--cheio', foco: true }],
    });
  });

  function pintarGarantias(gs) {
    const caixa = $('[data-conta-garantias]');
    const itens = Array.isArray(gs) ? gs : [];
    $('[data-conta-garantias-lista]').innerHTML = itens.map((g) => `<li><a href="${base}conta/?e=${encodeURIComponent(g.encomenda)}"><span>${esc(g.nome)}</span><span class="conta__ate">até ${esc(dataCurta(g.ate))}</span></a></li>`).join('');
    caixa.hidden = !itens.length;
  }

  /* OS MEUS DADOS: os gravados, ou a sugestão da última encomenda (para gravar). Preenchem o checkout. */
  let dadosAgora = null;
  let sugestaoAgora = null;
  const formDados = $('[data-conta-dados-form]');
  const CAMPOS = [['nome', 'Nome'], ['telefone', 'Telemóvel'], ['nif', 'NIF'], ['morada', 'Morada']];
  function pintarDados() {
    const d = dadosAgora || sugestaoAgora;
    const resumo = $('[data-conta-dados-resumo]');
    const morada = (x) => [x.morada, [x.codigoPostal, x.localidade].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (!d) {
      resumo.innerHTML = '<p class="conta__nota">Ainda sem dados. Grave-os e a próxima encomenda já vem preenchida.</p>';
    } else {
      const linhas = CAMPOS.map(([k, rot]) => [rot, k === 'morada' ? morada(d) : d[k]]).filter(([, v]) => v);
      resumo.innerHTML = `<dl class="conta__dados-lista">${linhas.map(([r, v]) => `<div><dt>${esc(r)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        ${dadosAgora ? '' : '<p class="conta__nota">Da sua última encomenda. Grave-os para a próxima vir preenchida.</p>'}`;
    }
    $('[data-conta-dados-editar]').textContent = dadosAgora ? 'Editar' : (d ? 'Gravar' : 'Preencher');
  }
  function editarDados(sim) {
    formDados.hidden = !sim;
    $('[data-conta-dados-resumo]').hidden = sim;
    $('[data-conta-dados-editar]').hidden = sim;
    if (!sim) return;
    const d = dadosAgora || sugestaoAgora || {};
    ['nome', 'telefone', 'nif', 'morada', 'codigoPostal', 'localidade'].forEach((k) => { formDados.elements[k].value = d[k] || ''; formDados.elements[k].removeAttribute('aria-invalid'); });
    const erro = $('[data-conta-dados-erro]');
    erro.hidden = true;
    formDados.elements.nome.focus();
  }
  $('[data-conta-dados-editar]').addEventListener('click', () => editarDados(true));
  $('[data-conta-dados-cancelar]').addEventListener('click', () => { editarDados(false); $('[data-conta-dados-editar]').focus(); });
  formDados.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = $('[data-conta-dados-erro]');
    const botao = $('button[type="submit"]', formDados);
    const corpo = Object.fromEntries(['nome', 'telefone', 'nif', 'morada', 'codigoPostal', 'localidade'].map((k) => [k, formDados.elements[k].value.trim()]));
    ocupado(botao, true);
    try {
      const r = await api('/dados', corpo);
      if (r.status === 401) { mostrarEntrar(r.j.google); return; }
      if (!r.ok) {
        erro.textContent = r.j.erro || 'Não conseguimos gravar. Tente outra vez.';
        erro.hidden = false;
        const c = r.j.campo && formDados.elements[r.j.campo];
        if (c) { c.setAttribute('aria-invalid', 'true'); c.focus(); }
        return;
      }
      dadosAgora = r.j.dados;
      sugestaoAgora = null;
      pintarDados();
      editarDados(false);
      $('[data-conta-dados-editar]').focus();
    } catch (_) {
      erro.textContent = 'Sem ligação. Veja a internet e tente outra vez.';
      erro.hidden = false;
    } finally { ocupado(botao, false); }
  });

  function pintarLista(d) {
    $('[data-conta-quem]').textContent = d.email || '';
    $('[data-conta-ola]').textContent = d.nome ? `Olá, ${d.nome}` : 'A minha conta';
    pintarCartao(d.cartao);
    const encs = Array.isArray(d.encomendas) ? d.encomendas : [];
    lista.innerHTML = encs.map(cartao).join('');
    lista.hidden = !encs.length;
    $('[data-conta-vazia]').hidden = encs.length > 0;
    pintarGarantias(d.garantias);
    dadosAgora = d.dados || null;
    sugestaoAgora = d.sugestao || null;
    pintarDados();
    editarDados(false);
    document.title = document.title.replace(/^[^|]*\|/, 'A minha conta |');
    mostrar('lista');
  }

  /* SAIR, SAIR EM TODOS OS APARELHOS, APAGAR A CONTA */
  async function sairDaqui(caminho) {
    try { await api(caminho, {}); } catch (_) { /* o cookie acaba sozinho */ }
    sinal(false);
    location.replace(`${base}conta/`);
  }
  $('[data-conta-sair]').addEventListener('click', (e) => { e.currentTarget.disabled = true; sairDaqui('/sair'); });
  $('[data-conta-sair-todos]').addEventListener('click', async () => {
    const r = await abrirJanela({ titulo: 'Sair em todos os aparelhos?', texto: '<p>Termina a sessão neste aparelho e em todos os outros onde entrou. Para voltar, basta entrar outra vez.</p>',
      botoes: [{ t: 'Cancelar', valor: 'nao', foco: true }, { t: 'Sair em todos', valor: 'sim', classe: 'botao--cheio' }] });
    if (r === 'sim') sairDaqui('/sair-todos');
  });
  $('[data-conta-apagar]').addEventListener('click', async () => {
    const r = await abrirJanela({ titulo: 'Apagar a conta?', texto: '<p>Apagamos os seus dados, as sessões e o cartão das películas (as películas marcadas na loja perdem-se). As encomendas ficam: a lei obriga-nos a guardá-las.</p>',
      botoes: [{ t: 'Cancelar', valor: 'nao', foco: true }, { t: 'Apagar a conta', valor: 'sim', classe: 'botao--perigo' }] });
    if (r === 'sim') sairDaqui('/apagar');
  });

  /* ---------------------------------------------------------------- a ficha de uma encomenda */
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
  /* DESISTIR DA COMPRA: enquanto o prazo corre (14 dias depois de receber; antes de receber, sempre). Fica registado na
     encomenda e vai um email ao cliente (a confirmação) e à loja. */
  function blocoDesistir(enc) {
    const d = enc.desistir || {};
    const pedidos = Array.isArray(d.pedidos) ? d.pedidos : [];
    if (pedidos.length) return `<div class="conta__desistir conta__desistir--pedido" data-conta-desistir><p><strong>Pediu para desistir a ${esc(dataLonga(pedidos.at(-1)))}.</strong> Vamos contactá-lo para combinar a devolução.</p></div>`;
    if (!d.pode) return '';
    const prazo = d.ate ? `Pode desistir até ${esc(dataLonga(d.ate))}.` : 'Pode desistir até 14 dias depois de receber a encomenda.';
    return `<div class="conta__desistir" data-conta-desistir>
      <p class="conta__nota">${prazo} <a href="${esc(raiz.dataset.desistirUrl || `${base}desistir/`)}">Como funciona</a></p>
      <button class="botao botao--contorno" type="button" data-conta-desistir-botao>Desistir da compra</button>
    </div>`;
  }
  async function pedirDesistencia(enc) {
    const r = await abrirJanela({
      titulo: 'Desistir da compra?',
      texto: `<p>Encomenda ${esc(enc.encomenda)}. Vamos contactá-lo para combinar a devolução; o reembolso é feito até 14 dias depois do pedido.</p>
        <div class="campo"><label for="desistir-nota">Quer dizer porquê? <span class="campo__opcional">(opcional)</span></label><textarea id="desistir-nota" rows="3" maxlength="500"></textarea></div>`,
      botoes: [{ t: 'Cancelar', valor: 'nao', foco: true }, { t: 'Confirmar a desistência', valor: 'sim', classe: 'botao--cheio' }],
    });
    if (r !== 'sim') return;
    const nota = String(($('#desistir-nota', janela) || {}).value || '').trim();
    const caixa = $('[data-conta-desistir]');
    try {
      const x = await api('/desistir', { e: enc.encomenda, ...(nota ? { nota } : {}) });
      if (x.status === 401) { mostrarEntrar(x.j.google); return; }
      if (!x.ok) { dizerFalha(x.j.erro || 'Não conseguimos registar o pedido. Tente outra vez.'); return; }
      enc.desistir = x.j.desistir;
      caixa.outerHTML = blocoDesistir(enc);
      $('[data-conta-desistir]').setAttribute('tabindex', '-1');
      $('[data-conta-desistir]').focus();
    } catch (_) { dizerFalha('Sem ligação. Veja a internet e tente outra vez.'); }
  }

  let fichaAtual = null;
  raiz.addEventListener('click', (e) => { if (e.target.closest('[data-conta-desistir-botao]') && fichaAtual) pedirDesistencia(fichaAtual); });
  function pintarFicha(enc) {
    fichaAtual = enc;
    const levant = enc.entrega === 'levantamento';
    const gs = Array.isArray(enc.garantias) ? enc.garantias : [];
    const linhas = (enc.linhas || []).map((l, i) => `<p><span>${esc(l.qtd)} × ${esc(l.nome)}${(l.escolhas || []).length ? ` <small>(${esc(l.escolhas.join(', '))})</small>` : ''}${gs[i] ? `<small class="conta__garantia">Garantia até ${esc(dataLonga(gs[i].ate))}</small>` : ''}</span><span>${esc(centimos(l.total_cents))}</span></p>`).join('');
    const portes = levant || enc.portes_cents === 0 ? 'Grátis' : (enc.portes_por_confirmar ? 'a confirmar' : centimos(enc.portes_cents));
    const zap = raiz.dataset.whatsapp;
    const ficha = blocos.ficha;
    ficha.innerHTML = `<a class="conta__voltar" href="${base}conta/"><span aria-hidden="true">‹</span> A minha conta</a>
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
          ${zap ? `<a class="botao botao--whatsapp-suave botao--largo conta__ajuda" href="${esc(zap + encodeURIComponent(enc.encomenda))}" target="_blank" rel="noopener">${icone('whatsapp')}<span>Dúvidas? Falar no WhatsApp</span></a>` : ''}
          ${blocoDesistir(enc)}
        </div>
      </div>`;
    document.title = document.title.replace(/^[^|]*\|/, `Encomenda ${enc.encomenda} |`);
    mostrar('ficha');
  }

  /* ---------------------------------------------------------------- abrir */
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
    if (r.status === 401) { mostrarEntrar(r.j.google); return; }
    if (!r.ok) {
      mostrar('carregar');
      blocos.carregar.hidden = true;
      dizerFalha(r.status === 404 && id ? 'Não encontrámos esta encomenda na sua conta.' : (r.j.erro || 'Não conseguimos abrir a conta agora. Tente daqui a pouco.'), { voltar: Boolean(id) });
      return;
    }
    sinal(true);
    if (id) pintarFicha(r.j); else pintarLista(r.j);
  }
  // voltar a esta página pelo «para trás» (a cache do browser) mostra-a como estava: abre-se outra vez
  window.addEventListener('pageshow', (e) => { if (e.persisted) abrir(); });
  (async () => {
    await voltaDoGoogle();
    abrir();
  })();
})();
