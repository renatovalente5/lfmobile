/* LF Mobile — o carrinho e a encomenda.
   O carrinho junta os artigos (com a escolha de cada um), soma os portes da entrega escolhida e,
   no fim, envia a encomenda ao Worker (worker/): em modo «online» o Worker devolve a página segura
   da Stripe; em modo «encomenda» regista a encomenda, manda os emails e devolve o número. No
   armazenamento local fica só o carrinho (artigos, escolhas, quantidades, entrega) — nunca o nome,
   o email ou a morada (a política de privacidade promete isto). Os preços nunca se guardam: lêem-se
   sempre do catálogo publicado (assets/catalogo-*.json), para um preço mudado no painel valer logo;
   e o Worker volta a calcular tudo do seu lado. (A base é o carrinho da Mimices.) */
(function () {
  'use strict';
  const CHAVE = 'lfmobile:carrinho';
  const MAX_QTD = 20;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hojeLisboa = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const euros = (v) => `${v.toLocaleString('pt-PT', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} €`;
  const centimos = (c) => euros(Math.round(c) / 100);
  const ICONES = {
    certo: '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    mais: '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>',
    menos: '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/></svg>',
    lixo: '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12.2a1 1 0 0 0 1 .8h9a1 1 0 0 0 1-.8l1-12.2M9 7V4.5h6V7"/></svg>',
  };

  // ---------------------------------------------------------------- estado
  const linhaValida = (l) => l && typeof l.produto === 'string' && Number.isInteger(l.qtd) && l.qtd > 0;
  function ler() {
    try {
      const e = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      if (e && e.v === 1 && Array.isArray(e.linhas)) {
        e.linhas = e.linhas.filter(linhaValida).map((l) => ({ produto: l.produto, opcoes: Array.isArray(l.opcoes) ? l.opcoes.map(Number) : [], qtd: Math.min(MAX_QTD, l.qtd) }));
        if (typeof e.zona !== 'string') e.zona = 'levantamento';
        return e;
      }
    } catch (_) { /* armazenamento bloqueado ou estragado: começa vazio */ }
    return { v: 1, linhas: [], zona: 'levantamento' };
  }
  let estado = ler();
  let anuncio = ''; // o que o leitor de ecrã diz depois de uma acção; nunca vai para o armazenamento
  const chaveLinha = (l) => JSON.stringify([l.produto, l.opcoes || []]);
  function guardar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (_) { /* modo privado sem armazenamento: o carrinho vive só nesta página */ }
    return desenharTudo();
  }
  function esvaziar() {
    estado = { v: 1, linhas: [], zona: estado.zona };
    try { localStorage.removeItem(CHAVE); } catch (_) { /* idem */ }
    return desenharTudo();
  }
  window.addEventListener('storage', (e) => { if (e.key === CHAVE) { estado = ler(); desenharTudo(); } });
  // A página volta da memória do browser (o «voltar» depois da Stripe): lê-se outra vez o
  // carrinho, que pode ter mudado noutro separador entretanto.
  window.addEventListener('pageshow', (e) => { if (e.persisted) { estado = ler(); desenharTudo(); } });

  let catalogoP = null;
  let catalogoPronto = null; // o catálogo já carregado: o envio usa-o sem esperar
  function catalogo() {
    if (!catalogoP) {
      catalogoP = fetch(document.body.dataset.catalogo).then((r) => {
        if (!r.ok) throw new Error(`catálogo ${r.status}`);
        return r.json();
      }).then((cat) => { catalogoPronto = cat; return cat; });
      catalogoP.catch(() => { catalogoP = null; });
    }
    return catalogoP;
  }
  const api = () => String(document.body.dataset.api || '').replace(/\/$/, '');

  // ---------------------------------------------------------------- contas
  // A mesma regra do site (src/lib/regras.mjs, precoDe): acabada a promoção, volta o preço normal.
  function precoDe(p, hoje) {
    if (typeof p.preco !== 'number') return { atual: null, anterior: null };
    const emPromocao = Boolean(p.precoAnterior) && p.precoAnterior > p.preco && (!p.promocaoAte || hoje <= p.promocaoAte);
    if (emPromocao) return { atual: p.preco, anterior: p.precoAnterior };
    if (p.precoAnterior && p.promocaoAte && hoje > p.promocaoAte) return { atual: p.precoAnterior, anterior: null };
    return { atual: p.preco, anterior: null };
  }
  /* As escolhas de uma linha, com o valor escolhido em cada grupo (ou o primeiro sem acréscimo,
     se a escolha já não existe: o artigo mudou no painel). */
  function escolhasDe(p, l) {
    return (p.opcoes || []).map((g, i) => {
      let j = (l.opcoes || [])[i];
      if (!Number.isInteger(j) || !g.valores[j]) j = Math.max(0, g.valores.findIndex((x) => !x.suplemento));
      return { grupo: g.nome, valor: g.valores[j].nome, suplemento: g.valores[j].suplemento || 0, indice: j };
    });
  }
  function contas(cat, linhas, zona) {
    const hoje = hojeLisboa();
    let artigos = 0;
    const detalhe = linhas.map((l) => {
      const p = cat.produtos[l.produto];
      if (!p) return { linha: l, p: null, ok: false };
      const escolhas = escolhasDe(p, l);
      const base = precoDe(p, hoje).atual;
      const unidade = base === null ? null : base + escolhas.reduce((s, x) => s + x.suplemento, 0);
      const total = unidade === null ? null : unidade * l.qtd;
      const ok = Boolean(p.compravel) && unidade !== null;
      if (ok) artigos += total;
      return { linha: l, p, escolhas, unidade, total, ok, soLoja: p.enviavel === false };
    });
    const validas = detalhe.filter((d) => d.ok);
    const indisponiveis = detalhe.filter((d) => !d.ok);
    const soLoja = zona !== 'levantamento' ? validas.filter((d) => d.soLoja) : [];
    let portes = 0;
    let portesPorConfirmar = false;
    if (zona !== 'levantamento' && validas.length) {
      const v = (cat.portes || {})[zona];
      const gratis = (cat.portes || {}).gratisAPartirDe;
      if (typeof gratis === 'number' && artigos >= gratis) portes = 0;
      else if (typeof v === 'number') portes = v; else portesPorConfirmar = true;
    }
    return { detalhe, validas, indisponiveis, soLoja, artigos, portes, portesPorConfirmar, total: artigos + portes, unidades: validas.reduce((s, d) => s + d.linha.qtd, 0) };
  }
  /* O que impede de seguir para a encomenda (ou nada). */
  function bloqueio(cat, c, zona) {
    if (!c.validas.length) return c.indisponiveis.length ? 'Os artigos do carrinho já não estão disponíveis. Tire-os para continuar.' : 'O carrinho está vazio.';
    if (c.indisponiveis.length) return `${c.indisponiveis[0].p ? `«${c.indisponiveis[0].p.nomeCurto}»` : 'Um artigo'} já não está disponível. Tire-o do carrinho para continuar.`;
    if (c.soLoja.length) return `«${c.soLoja[0].p.nomeCurto}» só se levanta na loja: escolha o levantamento ou tire-o do carrinho.`;
    if (zona !== 'levantamento' && c.portesPorConfirmar && cat.modo === 'online') return 'Os portes para esta entrega ainda não estão definidos. Escolha o levantamento na loja ou fale connosco pelo WhatsApp.';
    return '';
  }
  const zonaValida = (cat) => {
    if (!cat.zonas.some((z) => z.id === estado.zona)) estado.zona = cat.zonas[0].id;
    return estado.zona;
  };

  // ---------------------------------------------------------------- API para o site.js
  async function juntar({ produto, opcoes = [], qtd = 1 }) {
    const nova = { produto, opcoes: opcoes.map(Number), qtd: Math.max(1, Math.min(MAX_QTD, qtd)) };
    const igual = estado.linhas.find((l) => chaveLinha(l) === chaveLinha(nova));
    if (igual) igual.qtd = Math.min(MAX_QTD, igual.qtd + nova.qtd);
    else estado.linhas.push(nova);
    anuncio = 'Artigo adicionado ao carrinho.';
    return guardar();
  }
  async function totalDe({ produto, opcoes = [], qtd = 1 }) {
    try {
      const cat = await catalogo();
      const c = contas(cat, [{ produto, opcoes, qtd }], 'levantamento');
      return c.validas.length ? euros(c.artigos) : '';
    } catch (_) { return ''; }
  }

  // ---------------------------------------------------------------- desenho das linhas
  const pormenores = (d) => d.escolhas.map((x) => `${x.grupo}: ${x.valor}${x.suplemento ? ` (+ ${euros(x.suplemento)})` : ''}`);
  function linhaHtml(d, { editavel = true } = {}) {
    const l = d.linha;
    const i = estado.linhas.indexOf(l);
    const tirar = `<button class="linha__tirar" type="button" data-tirar="${i}">${ICONES.lixo}<span class="visualmente-escondido">Tirar ${esc(d.p ? d.p.nomeCurto : 'o artigo')} do carrinho</span></button>`;
    if (!d.p) {
      return `<li class="linha"><div></div><div><p class="linha__nome">Artigo que já não está à venda</p><p class="linha__indisponivel">Saiu da loja e não entra na encomenda.</p><div class="linha__fundo"><span></span>${tirar}</div></div></li>`;
    }
    const extras = pormenores(d).map((t) => `<p class="linha__extra">${esc(t)}</p>`).join('');
    const aviso = !d.ok ? '<p class="linha__indisponivel">Já não está disponível.</p>' : (d.soLoja ? '<p class="linha__extra">Só para levantar na loja.</p>' : '');
    const preco = d.total === null ? '' : euros(d.total);
    if (!editavel) {
      return `<li class="linha">
      <a class="linha__foto" href="${esc(d.p.url)}" tabindex="-1" aria-hidden="true"><img src="${esc(d.p.foto)}" alt="" width="56" height="56" loading="lazy"></a>
      <div>
        <p class="linha__nome"><a href="${esc(d.p.url)}">${esc(d.p.nome)}</a></p>
        ${extras}${aviso}
        <div class="linha__fundo"><span class="linha__extra">${l.qtd} × ${d.unidade === null ? '' : euros(d.unidade)}</span><span class="linha__preco">${preco}</span></div>
      </div>
    </li>`;
    }
    return `<li class="linha">
      <a class="linha__foto" href="${esc(d.p.url)}" tabindex="-1" aria-hidden="true"><img src="${esc(d.p.foto)}" alt="" width="84" height="84" loading="lazy"></a>
      <div>
        <p class="linha__nome"><a href="${esc(d.p.url)}">${esc(d.p.nome)}</a></p>
        ${extras}${aviso}
        <div class="linha__fundo">
          ${d.ok ? `<div class="quantidade" data-quantidade data-linha="${i}">
            <button type="button" data-menos${l.qtd <= 1 ? ' disabled' : ''}>${ICONES.menos}<span class="visualmente-escondido">Menos um de ${esc(d.p.nomeCurto)}</span></button>
            <span aria-live="polite"><span class="visualmente-escondido">Quantidade: </span>${l.qtd}</span>
            <button type="button" data-mais${l.qtd >= MAX_QTD ? ' disabled' : ''}>${ICONES.mais}<span class="visualmente-escondido">Mais um de ${esc(d.p.nomeCurto)}</span></button>
          </div>
          <span class="linha__preco">${preco}</span>` : '<span></span>'}
          ${tirar}
        </div>
      </div>
    </li>`;
  }
  function totaisHtml(c, zona) {
    const portes = zona === 'levantamento' || (c.portes === 0 && !c.portesPorConfirmar) ? 'Grátis' : (c.portesPorConfirmar ? 'a confirmar' : euros(c.portes));
    const total = zona !== 'levantamento' && c.portesPorConfirmar ? `${euros(c.artigos)} + portes` : euros(c.total);
    return `<p><span>${c.unidades === 1 ? '1 artigo' : `${c.unidades} artigos`}</span><span>${euros(c.artigos)}</span></p>
      <p><span>${zona === 'levantamento' ? 'Levantamento na loja' : 'Portes'}</span><span>${portes}</span></p>
      <p class="totais__total"><span>Total</span><span>${total}</span></p>`;
  }
  // o preço dos portes ao lado de cada opção de entrega, para comparar antes de escolher
  function pintarPrecosDasZonas(raiz, cat, c) {
    $$('[data-preco-zona]', raiz).forEach((s) => {
      const z = s.dataset.precoZona;
      if (z === 'levantamento') { s.textContent = 'Grátis'; return; }
      const v = (cat.portes || {})[z];
      const gratis = (cat.portes || {}).gratisAPartirDe;
      if (typeof gratis === 'number' && c.artigos >= gratis && c.validas.length) { s.textContent = 'Grátis'; return; }
      s.textContent = typeof v === 'number' ? euros(v) : 'a confirmar';
    });
  }
  const rotuloSeguir = (cat) => (cat.modo === 'online' ? 'Finalizar e pagar' : 'Finalizar a encomenda');

  // ---------------------------------------------------------------- gaveta
  async function desenharGaveta() {
    const alvo = $('[data-carrinho-gaveta]');
    if (!alvo) return;
    let cat;
    try { cat = await catalogo(); } catch (_) { alvo.innerHTML = '<p class="gaveta__vazio">Não conseguimos carregar o carrinho. Verifique a ligação e tente outra vez.</p>'; return; }
    const aviso = anuncio ? `<p class="visualmente-escondido" role="status">${esc(anuncio)}</p>` : '';
    anuncio = '';
    if (!estado.linhas.length) {
      alvo.innerHTML = `${aviso}<p class="gaveta__vazio">O carrinho está vazio.</p><div class="gaveta__acoes"><a class="botao botao--cheio" href="${esc(cat.loja)}">Ver a loja</a></div>`;
      return;
    }
    const zona = zonaValida(cat);
    const c = contas(cat, estado.linhas, zona);
    const b = bloqueio(cat, c, zona);
    alvo.innerHTML = `${aviso}
      <ul class="linhas">${c.detalhe.map((d) => linhaHtml(d)).join('')}</ul>
      <div class="gaveta__zonas">
        <label for="gaveta-zona">Entrega</label>
        <select id="gaveta-zona" data-zona>${cat.zonas.map((z) => `<option value="${esc(z.id)}"${z.id === zona ? ' selected' : ''}>${esc(z.curto)}</option>`).join('')}</select>
      </div>
      <div class="totais" aria-live="polite">${totaisHtml(c, zona)}</div>
      ${b ? `<p class="comprar__erro" role="alert">${esc(b)}</p>` : ''}
      <div class="gaveta__acoes">
        <a class="botao botao--cheio" href="${esc(cat.checkout)}"${b ? ' aria-disabled="true"' : ''}>${rotuloSeguir(cat)}</a>
        <button class="botao botao--contorno" type="button" data-fechar>Continuar a ver</button>
      </div>`;
  }

  // ---------------------------------------------------------------- página do carrinho
  const pagina = $('[data-carrinho-pagina]');
  async function desenharPagina() {
    if (!pagina) return;
    const lista = $('[data-carrinho-lista]', pagina);
    const resumo = $('[data-carrinho-resumo]', pagina);
    let cat;
    try { cat = await catalogo(); } catch (_) { lista.innerHTML = '<p class="carrinho-vazio">Não conseguimos carregar o carrinho. Verifique a ligação e recarregue a página.</p>'; return; }
    const aviso = anuncio ? `<p class="visualmente-escondido" role="status">${esc(anuncio)}</p>` : '';
    anuncio = '';
    if (!estado.linhas.length) {
      resumo.hidden = true;
      lista.innerHTML = `${aviso}<p class="carrinho-vazio">O carrinho está vazio. <a href="${esc(cat.loja)}">Ver a loja</a></p>`;
      return;
    }
    const zona = zonaValida(cat);
    const c = contas(cat, estado.linhas, zona);
    const b = bloqueio(cat, c, zona);
    lista.innerHTML = `${aviso}<ul class="linhas">${c.detalhe.map((d) => linhaHtml(d)).join('')}</ul>`;
    resumo.hidden = false;
    $$('input[name="entrega"]', resumo).forEach((r) => { r.checked = r.value === zona; });
    pintarPrecosDasZonas(resumo, cat, c);
    $('[data-totais]', resumo).innerHTML = totaisHtml(c, zona);
    const erro = $('[data-erro-carrinho]', resumo);
    erro.textContent = b;
    erro.hidden = !b;
    const seguir = $('[data-seguir]', resumo);
    seguir.textContent = rotuloSeguir(cat);
    if (b) seguir.setAttribute('aria-disabled', 'true'); else seguir.removeAttribute('aria-disabled');
  }

  // ---------------------------------------------------------------- checkout
  const checkout = $('[data-checkout-pagina]');
  const form = checkout && $('form[data-checkout]', checkout);
  async function desenharCheckout() {
    if (!checkout) return;
    const resumo = $('[data-checkout-resumo]', checkout);
    let cat;
    try { cat = await catalogo(); } catch (_) { resumo.innerHTML = '<p class="carrinho-vazio">Não conseguimos carregar o carrinho. Verifique a ligação e recarregue a página.</p>'; form.hidden = true; return; }
    if (!estado.linhas.length) {
      form.hidden = true;
      resumo.innerHTML = `<p class="carrinho-vazio">O carrinho está vazio. <a href="${esc(cat.loja)}">Ver a loja</a></p>`;
      return;
    }
    const zona = zonaValida(cat);
    const c = contas(cat, estado.linhas, zona);
    const b = bloqueio(cat, c, zona);
    form.hidden = false;
    resumo.innerHTML = `<ul class="linhas">${c.detalhe.map((d) => linhaHtml(d, { editavel: false })).join('')}</ul>
      <div class="totais" aria-live="polite">${totaisHtml(c, zona)}</div>
      <p><a class="botao botao--texto" href="${esc(cat.carrinho)}">Alterar o carrinho</a></p>`;
    $$('input[name="entrega"]', form).forEach((r) => { r.checked = r.value === zona; });
    pintarPrecosDasZonas(form, cat, c);
    const comMorada = Boolean((cat.zonas.find((z) => z.id === zona) || {}).morada);
    $$('[data-so-envio]', form).forEach((e) => { e.hidden = !comMorada; });
    $$('[data-obrigatorio-envio]', form).forEach((i) => { i.required = comMorada; });
    const erro = $('[data-erro-checkout]', form);
    if (b) { erro.textContent = b; erro.hidden = false; } else if (erro.dataset.doCarrinho === 'sim') { erro.hidden = true; }
    erro.dataset.doCarrinho = b ? 'sim' : '';
    $('[data-botao-checkout]', form).disabled = Boolean(b);
  }

  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const telefoneValido = (t) => { const d = t.replace(/\D/g, ''); return d.length >= 9 && d.length <= 15; };
  // o algarismo de controlo do NIF (a mesma conta de regras.mjs, nifValido)
  function nifValido(n) {
    if (!/^\d{9}$/.test(n)) return false;
    const d = n.split('').map(Number);
    const r = d.slice(0, 8).reduce((s, x, i) => s + x * (9 - i), 0) % 11;
    return (r < 2 ? 0 : 11 - r) === d[8];
  }
  if (form) {
    const erro = $('[data-erro-checkout]', form);
    const botao = $('[data-botao-checkout]', form);
    const textoBotao = botao.lastElementChild.textContent;
    const mostrarErro = (t) => { erro.textContent = t; erro.hidden = false; erro.dataset.doCarrinho = ''; };
    form.addEventListener('input', (e) => { if (e.target.hasAttribute('aria-invalid')) e.target.removeAttribute('aria-invalid'); if (erro.dataset.doCarrinho !== 'sim') erro.hidden = true; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      $$('[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
      let cat = catalogoPronto;
      if (!cat) {
        try { cat = await catalogo(); } catch (_) { mostrarErro('Não conseguimos carregar o catálogo. Verifique a ligação e tente outra vez.'); return; }
      }
      const zona = zonaValida(cat);
      const c = contas(cat, estado.linhas, zona);
      const b = bloqueio(cat, c, zona);
      if (b) { mostrarErro(b); return; }
      const v = (n) => String((form.elements[n] || {}).value || '').trim().replace(/\s+/g, ' ');
      const envio = Boolean((cat.zonas.find((z) => z.id === zona) || {}).morada);
      const cliente = { nome: v('nome'), email: v('email'), telefone: v('telefone'), nif: v('nif').replace(/\s/g, '') };
      if (envio) Object.assign(cliente, { morada: v('morada'), codigoPostal: v('codigoPostal'), localidade: v('localidade') });
      const notas = String(form.elements.notas.value || '').trim();
      if (notas) cliente.notas = notas;
      if (!cliente.nif) delete cliente.nif;
      const falhas = [];
      if (!cliente.nome) falhas.push(['nome', 'Escreva o seu nome.']);
      if (!RE_EMAIL.test(cliente.email)) falhas.push(['email', 'Escreva um email válido: é para onde enviamos a confirmação.']);
      if (!telefoneValido(cliente.telefone)) falhas.push(['telefone', 'Escreva o seu número de telemóvel.']);
      if (cliente.nif && !nifValido(cliente.nif)) falhas.push(['nif', 'O NIF tem 9 algarismos. Verifique-o ou deixe em branco.']);
      if (envio) {
        if (!cliente.morada) falhas.push(['morada', 'Escreva a morada de entrega.']);
        if (!/^\d{4}-\d{3}$/.test(cliente.codigoPostal)) falhas.push(['codigoPostal', 'Escreva o código postal no formato 0000-000.']);
        if (!cliente.localidade) falhas.push(['localidade', 'Escreva a localidade.']);
      }
      if (!form.elements.termos.checked) falhas.push(['termos', 'Para continuar, aceite os termos e condições.']);
      if (falhas.length) {
        falhas.forEach(([n]) => form.elements[n].setAttribute('aria-invalid', 'true'));
        mostrarErro(falhas[0][1]);
        form.elements[falhas[0][0]].focus();
        return;
      }
      if (!api()) { mostrarErro('A encomenda no site ainda não está ligada. Envie-nos a encomenda pelo WhatsApp.'); return; }
      botao.disabled = true;
      botao.lastElementChild.textContent = cat.modo === 'online' ? 'A abrir o pagamento…' : 'A enviar…';
      let resposta = null;
      let ok = false;
      try {
        const r = await fetch(`${api()}/checkout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            linhas: c.validas.map((d) => ({ produto: d.linha.produto, opcoes: d.escolhas.map((x) => x.indice), qtd: d.linha.qtd })),
            entrega: zona,
            cliente,
            termos: true,
            total_cents: Math.round(c.total * 100),
          }),
        });
        resposta = await r.json().catch(() => ({}));
        ok = r.ok;
      } catch (_) { resposta = null; }
      if (ok && resposta && resposta.url) { location.href = resposta.url; return; } // a página segura da Stripe
      if (ok && resposta && resposta.encomenda) {
        await esvaziar();
        location.href = `${cat.obrigado}?e=${encodeURIComponent(resposta.encomenda)}&c=${encodeURIComponent(resposta.chave || '')}`;
        return;
      }
      botao.disabled = false;
      botao.lastElementChild.textContent = textoBotao;
      mostrarErro(resposta && typeof resposta.erro === 'string' && resposta.erro ? resposta.erro : 'Não conseguimos registar a encomenda. Tente outra vez ou fale connosco pelo WhatsApp.');
      if (resposta && resposta.campo && form.elements[resposta.campo]) { form.elements[resposta.campo].setAttribute('aria-invalid', 'true'); form.elements[resposta.campo].focus(); }
    });
  }

  // ---------------------------------------------------------------- página «obrigado»
  /* Chega-se aqui depois de a encomenda seguir (?e=número&c=chave, em modo encomenda) ou depois de
     pagar na Stripe (?s=sessão). O carrinho esvazia-se, e o Worker diz o que foi encomendado. */
  const obrigado = $('[data-obrigado]');
  if (obrigado) {
    const q = new URLSearchParams(location.search);
    const e = q.get('e');
    const s = q.get('s');
    if (e || s) {
      esvaziar();
      const detalhe = $('[data-obrigado-detalhe]', obrigado);
      const titulo = $('[data-obrigado-titulo]', obrigado);
      const texto = $('[data-obrigado-texto]', obrigado);
      if (e) { detalhe.innerHTML = `<p class="obrigado__numero"><span>Encomenda</span> <strong>${esc(e)}</strong></p>`; detalhe.hidden = false; }
      const TEXTOS = {
        registada: 'A sua encomenda ficou registada. Confirmamos consigo o pagamento e a entrega por email ou WhatsApp.',
        pendente: 'Falta o pagamento. Assim que o recebermos, enviamos-lhe um email a confirmar.',
        paga: 'O pagamento foi recebido. Enviámos-lhe um email com o resumo e avisamos quando a encomenda seguir ou estiver pronta.',
        enviada: 'A sua encomenda já seguiu.',
        pronta: 'A sua encomenda está pronta para levantar na loja.',
        levantada: 'A sua encomenda já foi levantada.',
        anulada: 'Esta encomenda foi anulada.',
      };
      const pintar = (enc) => {
        if (!enc || !enc.encomenda) return;
        const nome = enc.cliente && enc.cliente.nome ? String(enc.cliente.nome).split(' ')[0] : '';
        if (nome) titulo.textContent = `Obrigado, ${nome}!`;
        if (TEXTOS[enc.estado]) texto.textContent = TEXTOS[enc.estado];
        const linhas = (enc.linhas || []).map((l) => `<p><span>${l.qtd} × ${esc(l.nome)}${(l.escolhas || []).length ? ` <small>(${esc(l.escolhas.join(', '))})</small>` : ''}</span><span>${Number.isFinite(l.total_cents) ? centimos(l.total_cents) : ''}</span></p>`).join('');
        const levant = enc.entrega === 'levantamento';
        detalhe.innerHTML = `<p class="obrigado__numero"><span>Encomenda</span> <strong>${esc(enc.encomenda)}</strong></p>
          <div class="totais">${linhas}
            <p><span>${levant ? 'Levantamento na loja' : 'Portes'}</span><span>${levant || enc.portes_cents === 0 ? 'Grátis' : (Number.isFinite(enc.portes_cents) ? centimos(enc.portes_cents) : 'a confirmar')}</span></p>
            <p class="totais__total"><span>Total</span><span>${Number.isFinite(enc.total_cents) ? centimos(enc.total_cents) : ''}</span></p>
          </div>`;
        detalhe.hidden = false;
      };
      if (api()) {
        fetch(`${api()}/encomenda?${e ? `e=${encodeURIComponent(e)}&c=${encodeURIComponent(q.get('c') || '')}` : `s=${encodeURIComponent(s)}`}`)
          .then((r) => (r.ok ? r.json() : null)).then(pintar).catch(() => {});
      }
    }
  }

  // ---------------------------------------------------------------- contador e redesenho
  function desenharConta() {
    const n = estado.linhas.reduce((s, l) => s + l.qtd, 0);
    $$('[data-conta]').forEach((b) => {
      b.hidden = n === 0;
      b.textContent = n > 99 ? '99+' : String(n);
      const rotulo = b.parentElement && $('.visualmente-escondido', b.parentElement);
      if (rotulo) rotulo.textContent = n ? `Carrinho, ${n} ${n === 1 ? 'artigo' : 'artigos'}` : 'Carrinho';
    });
  }
  function desenharTudo() {
    desenharConta();
    const g = document.getElementById('carrinho');
    return Promise.all([g && g.open ? desenharGaveta() : null, desenharPagina(), desenharCheckout()]);
  }

  // ---------------------------------------------------------------- acções nas linhas
  // As linhas redesenham-se por inteiro: o botão onde estava o foco deixa de existir. Depois de
  // redesenhar, o foco volta ao botão equivalente (o mesmo «+» da mesma linha), e quando a linha
  // sai vai para o título — nunca fica perdido no <body>.
  document.addEventListener('click', async (e) => {
    const onde = e.target.closest('dialog') ? '#carrinho' : '[data-carrinho-pagina]';
    const tirar = e.target.closest('[data-tirar]');
    if (tirar) {
      estado.linhas.splice(Number(tirar.dataset.tirar), 1);
      anuncio = 'Artigo tirado do carrinho.';
      await guardar();
      const titulo = document.querySelector(onde === '#carrinho' ? '#carrinho-titulo' : '.carrinho-pagina h1');
      if (titulo) { titulo.tabIndex = -1; titulo.focus(); }
      return;
    }
    const b = e.target.closest('[data-linha] [data-mais], [data-linha] [data-menos]');
    if (b) {
      const l = estado.linhas[Number(b.closest('[data-linha]').dataset.linha)];
      if (!l) return;
      const accao = b.hasAttribute('data-mais') ? 'data-mais' : 'data-menos';
      l.qtd = Math.max(1, Math.min(MAX_QTD, l.qtd + (accao === 'data-mais' ? 1 : -1)));
      await guardar();
      const novo = document.querySelector(`${onde} [data-linha="${estado.linhas.indexOf(l)}"] [${accao}]`);
      if (novo && !novo.disabled) novo.focus();
      else { const outro = document.querySelector(`${onde} [data-linha="${estado.linhas.indexOf(l)}"] [${accao === 'data-mais' ? 'data-menos' : 'data-mais'}]`); if (outro) outro.focus(); }
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-zona], input[name="entrega"]')) {
      estado.zona = e.target.value;
      guardar();
    }
  });

  window.LFCarrinho = { juntar, totalDe, desenharGaveta };
  catalogo().catch(() => {});
  desenharConta();
  desenharPagina();
  desenharCheckout();
})();
