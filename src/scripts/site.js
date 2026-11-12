/* LF Mobile — o comportamento das páginas (sem dependências).
   O carrinho e a encomenda estão em carrinho.js, os filtros da loja em loja.js, as reparações em
   reparacoes.js e o simulador da retoma em retoma.js; vão todos no mesmo ficheiro, este primeiro.
   (A base é o site.js da Mimices.) */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const menosMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hojeLisboa = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sem = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const euros = (v) => `${v.toLocaleString('pt-PT', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} €`;
  const ICONE_PAUSA = '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M9 6.5v11M15 6.5v11"/></svg>';
  const ICONE_TOCAR = '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10.5-6.5L8 5.5Z"/></svg>';
  const ICONE_FERRAMENTA = '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14.5 6.5a3.5 3.5 0 0 0 4.4 4.4L9 20.8a1.8 1.8 0 0 1-2.6-2.6l9.9-9.9a3.5 3.5 0 0 0-1.8-1.8Z"/></svg>';
  const ICONE_PAGINA = '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const raiz = document.documentElement;
  raiz.classList.add('js');

  // ---------------------------------------------------------------- o anel do foco
  // Um toque ou um clique escondem o anel do foco (o CSS, em html[data-entrada="ponteiro"]); uma
  // tecla volta a mostrá-lo, para quem navega pelo teclado.
  addEventListener('pointerdown', () => { raiz.dataset.entrada = 'ponteiro'; }, { capture: true, passive: true });
  addEventListener('keydown', (e) => { if (!e.metaKey && !e.ctrlKey) delete raiz.dataset.entrada; }, { capture: true });

  // ---------------------------------------------------------------- a barra e o WhatsApp ao descer
  // Ao descer (a partir de 12 px: na página inicial o logótipo e o fundo da barra mudam logo; antes eram
  // 40 px, e no telemóvel demorava), a barra ganha a sombra (html[data-rolado]); o botão flutuante do WhatsApp aparece um
  // pouco mais abaixo (html[data-whatsapp], 200 a descer e 120 a subir). Dois limiares contra a
  // tremura de uma página parada na linha.
  const flutuante = $('[data-whatsapp-flutuante]');
  if ($('[data-topo]')) {
    let pedido = false;
    const decidir = () => {
      pedido = false;
      const y = scrollY;
      const agora = raiz.dataset.rolado === 'sim';
      raiz.dataset.rolado = (y >= 12 ? true : y <= 4 ? false : agora) ? 'sim' : 'nao';
      if (flutuante) {
        const visivel = raiz.dataset.whatsapp === 'sim';
        raiz.dataset.whatsapp = (y >= 200 ? true : y <= 120 ? false : visivel) ? 'sim' : 'nao';
      }
    };
    addEventListener('scroll', () => { if (!pedido) { pedido = true; requestAnimationFrame(decidir); } }, { passive: true });
    addEventListener('pageshow', decidir);
    decidir();
    /* Com a linha legal do rodapé à vista, ou o botão principal da página (juntar ao carrinho,
       continuar, enviar a encomenda), o botão sai (html[data-whatsapp-fim]): no telemóvel tapava-lhes
       a ponta. Volta quando nenhum deles se vê. */
    const tapados = [$('.rodape__fim'), ...$$('.comprar button[type="submit"], [data-seguir], [data-botao-checkout]')].filter(Boolean);
    if (flutuante && tapados.length && 'IntersectionObserver' in window) {
      const vistos = new Set();
      const io = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) vistos.add(e.target); else vistos.delete(e.target); });
        raiz.dataset.whatsappFim = vistos.size ? 'sim' : 'nao';
      });
      tapados.forEach((t) => io.observe(t));
    }
  }

  // ---------------------------------------------------------------- o movimento ao descer
  /* Os blocos abaixo do ecrã entram quando lá chegam (o CSS, em «o movimento ao descer»). Quando a
     página abre, o que já se vê (ou está acima) fica como está e o que não se desenha (escondido por um
     filtro) também; um bloco dentro de outro que entra não entra outra vez, e numa fila que desliza de
     lado (as categorias no telemóvel) entra a fila inteira: os de fora do ecrã nunca chegavam a entrar.
     Os que chegam juntos vão uns atrás dos outros (--d, até 6). No fim da entrada as classes saem: o
     bloco fica igual ao que era, com as suas transições de sempre. */
  const ALVOS = [
    '.seccao__cabeca', '.titulo-seccao', '.seccao__texto',
    '.cat-fila li', '.fila__pista', '.faixa-peliculas__texto', '.faixa-peliculas__tipos > li', '.loja-casa__foto', '.loja-casa__texto',
    '.grelha > *', '.modelos-grelha > li', '.seletor__familias > li', '.problemas__grelha > li', '.passos-faixa__lista > li', '.reps__lista > *',
    '.modelo-irmaos li', '.ret-antes__lista > li', '.sobre__foto', '.sobre__factos > li', '.contactos-cartoes > li', '.contactos-loja', '.mapa-loja',
    '.pergunta', '.lista-ficha',
    // as garantias: no telemóvel são uma lista num painel só (entra o painel); a partir dos 640 px, cartões (um a um)
    matchMedia('(min-width: 640px)').matches ? '.garantias__lista > li' : '.garantias__lista',
  ].join(', ');
  if (!menosMovimento.matches && 'IntersectionObserver' in window) {
    const acabou = (e) => {
      const el = e.currentTarget;
      if (e.target !== el || e.animationName !== 'lf-acende') return;
      el.removeEventListener('animationend', acabou);
      el.classList.remove('revelar', 'visivel');
      el.style.removeProperty('--d');
    };
    const entrada = new IntersectionObserver((es) => {
      let d = 0;
      for (const en of es) {
        if (!en.isIntersecting) continue;
        const el = en.target;
        entrada.unobserve(el);
        el.style.setProperty('--d', String(Math.min(d++, 6)));
        el.addEventListener('animationend', acabou);
        el.classList.add('visivel');
      }
    }, { rootMargin: '0px 0px -10% 0px' });
    const deLado = new Map();
    const rolaDeLado = (e) => {
      if (!deLado.has(e)) { const o = getComputedStyle(e).overflowX; deLado.set(e, (o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 2); }
      return deLado.get(e);
    };
    const blocos = new Set();
    $$(ALVOS).forEach((el) => { if (!el.parentElement.closest(ALVOS)) blocos.add(rolaDeLado(el.parentElement) ? el.parentElement : el); });
    const fundo = innerHeight;
    blocos.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || r.top < fundo) return;
      el.classList.add('revelar');
      entrada.observe(el);
    });
  }

  // ---------------------------------------------------------------- a faixa do topo
  // O site só muda quando se publica: o aviso (ou a campanha) «até dia X» sai sozinho no dia seguinte.
  $$('.faixa-topo[data-ate]').forEach((a) => {
    if (hojeLisboa() > a.dataset.ate) { const t = $('.faixa-topo__texto', a); if (t) t.hidden = true; }
  });
  /* A loja aberta agora: junto do horário (na página inicial e nos contactos) e na faixa de cima quando
     há campanha; pelo horário da página (#horario-loja) e a hora de Lisboa. */
  const estadosLoja = $$('[data-estado-loja]');
  const horario = (() => { try { return JSON.parse(($('#horario-loja') || {}).textContent || '[]'); } catch (_) { return []; } })();
  if (estadosLoja.length && horario.length) {
    const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const agoraLisboa = () => {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
      return { dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hora: `${p.hour}:${p.minute}`, data: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) };
    };
    /* Os feriados nacionais (o horário diz «Domingos e feriados: encerrado»): os de data fixa, a
       Sexta-feira Santa e o Corpo de Deus (pela Páscoa). Sem isto, a 1 e a 8 de dezembro dizia «Loja aberta». */
    const DIA_MS = 86400000;
    const pascoa = (y) => {
      const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
      const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
      return Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
    };
    const feriado = (t) => {
      const x = new Date(t);
      const md = `${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
      if (['01-01', '04-25', '05-01', '06-10', '08-15', '10-05', '11-01', '12-01', '12-08', '12-25'].includes(md)) return true;
      const p = pascoa(x.getUTCFullYear());
      return t === p - 2 * DIA_MS || t === p + 60 * DIA_MS;
    };
    const blocos = (d, t) => (feriado(t) ? [] : horario.filter((h) => h.dias.includes(d)).sort((a, b) => a.abre.localeCompare(b.abre)));
    const pintar = () => {
      const { dia, hora, data } = agoraLisboa();
      const hoje = blocos(dia, data);
      const aberto = hoje.find((h) => hora >= h.abre && hora < h.fecha);
      let texto;
      if (aberto) texto = `Loja aberta · fecha às ${aberto.fecha}`;
      else {
        const depois = hoje.find((h) => hora < h.abre);
        if (depois) texto = `Loja fechada · abre às ${depois.abre}`;
        else {
          for (let i = 1; i <= 8; i++) {
            const d = (dia + i) % 7;
            const b = blocos(d, data + i * DIA_MS)[0];
            if (b) { texto = `Loja fechada · abre ${i === 1 ? 'amanhã' : DIAS[d] === 'sábado' || DIAS[d] === 'domingo' ? `no ${DIAS[d]}` : `na ${DIAS[d]}`} às ${b.abre}`; break; }
          }
        }
      }
      if (!texto) return;
      for (const el of estadosLoja) {
        el.textContent = texto;
        el.dataset.aberta = aberto ? 'sim' : 'nao';
        el.hidden = false;
      }
    };
    pintar();
    setInterval(pintar, 60000);
  }

  // ---------------------------------------------------------------- menu, procura e carrinho (folhas)
  // A página por trás fica trancada pelo CSS (html:has(dialog[open])): derivado do próprio
  // diálogo, nunca de uma classe que se põe e tira.
  const dialogos = $$('dialog');
  dialogos.forEach((d) => {
    if (d.open) d.close(); // o Chrome repõe o «open» ao voltar atrás: abre-se outra vez à mão
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // clique no fundo
    d.addEventListener('click', (e) => {
      if (e.target.closest('[data-fechar]')) { d.close(); return; }
      const a = e.target.closest('a[href]');
      if (a && !a.target && a.getAttribute('aria-disabled') !== 'true') d.close();
    });
  });
  function abrir(id, origem) {
    const d = document.getElementById(id);
    if (!d || d.open) return;
    d.showModal();
    /* O foco vai para o corpo (tabindex=-1, sem anel): o Safari do iPhone mostrava o anel no primeiro
       elemento depois de um toque. A procura é a excepção: o campo recebe logo o foco (o teclado). */
    const campo = id === 'procurar' && $('input[type="search"]', d);
    if (campo) campo.focus(); else { const corpo = d.querySelector('.menu__corpo, .gaveta__corpo, .folha-procura__corpo'); if (corpo) corpo.focus({ preventScroll: true }); }
    d._origem = origem || null;
    if (id === 'carrinho' && window.LFCarrinho) window.LFCarrinho.desenharGaveta();
  }
  dialogos.forEach((d) => d.addEventListener('close', () => { if (d._origem && document.contains(d._origem)) d._origem.focus(); }));
  $$('[data-abrir]').forEach((b) => b.addEventListener('click', (e) => {
    if (b.dataset.abrir === 'carrinho' && /pagina-(carrinho|checkout)/.test(document.body.className)) return; // já está no carrinho
    e.preventDefault();
    abrir(b.dataset.abrir, b);
  }));
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[aria-disabled="true"]');
    if (a) e.preventDefault();
  });

  // ---------------------------------------------------------------- a procura
  /* Os resultados vêm do índice (assets/busca-*.json), lido no primeiro toque no campo: artigos,
     modelos para reparar e páginas. Todas as palavras têm de aparecer (sem acentos). As setas
     percorrem os resultados e o Enter abre o escolhido; sem nenhum escolhido, a loja com ?q=. */
  let indiceP = null;
  const indice = (url) => (indiceP = indiceP || fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => { indiceP = null; return null; }));
  const marcar = (texto, palavras) => {
    let h = esc(texto);
    for (const p of palavras.filter((x) => x.length > 1)) {
      const i = sem(h).indexOf(p);
      if (i >= 0) h = `${h.slice(0, i)}<mark>${h.slice(i, i + p.length)}</mark>${h.slice(i + p.length)}`;
    }
    return h;
  };
  $$('form[data-busca]').forEach((form) => {
    const input = $('input', form);
    const caixa = $('[data-busca-resultados]', form);
    const atalhos = form.closest('dialog') && $('[data-busca-atalhos]', form.closest('dialog'));
    let itens = [];
    let atual = -1;
    const fechar = () => { caixa.hidden = true; atual = -1; input.removeAttribute('aria-activedescendant'); };
    const pintarAtual = () => itens.forEach((a, i) => a.setAttribute('aria-selected', String(i === atual)));
    const procurar = async () => {
      const q = sem(input.value).trim();
      if (atalhos) atalhos.hidden = Boolean(q);
      if (q.length < 2) { fechar(); return; }
      const ind = await indice(form.dataset.busca);
      if (!ind) return;
      const palavras = q.split(/\s+/).filter(Boolean);
      const bate = (x) => palavras.every((p) => x.t.includes(p));
      const artigos = ind.artigos.filter(bate).slice(0, 6);
      const modelos = ind.modelos.filter(bate).slice(0, 5);
      const paginas = ind.paginas.filter(bate).slice(0, 3);
      const grupo = (titulo, lista, fazer) => (lista.length ? `<div class="busca__grupo"><p class="busca__titulo">${titulo}</p>${lista.map(fazer).join('')}</div>` : '');
      const html = grupo('Artigos', artigos, (a) => `<a class="busca__item" href="${esc(a.u)}"><span class="busca__img"><img src="${esc(a.f)}" alt="" loading="lazy"></span><span class="busca__nome">${marcar(a.n, palavras)}<small>${esc(a.c)}</small></span>${a.p !== null ? `<span class="busca__preco">${euros(a.p)}</span>` : ''}</a>`)
        + grupo('Reparar', modelos, (m) => `<a class="busca__item" href="${esc(m.u)}"><span class="busca__img">${ICONE_FERRAMENTA}</span><span class="busca__nome">Reparação ${marcar(m.n, palavras)}<small>Ver os preços</small></span></a>`)
        + grupo('Páginas', paginas, (p) => `<a class="busca__item" href="${esc(p.u)}"><span class="busca__img">${ICONE_PAGINA}</span><span class="busca__nome">${esc(p.n)}</span></a>`);
      caixa.innerHTML = html || `<p class="busca__nada">Não encontrámos «${esc(input.value.trim())}». <a href="${esc(form.action)}?q=${encodeURIComponent(input.value.trim())}">Ver a loja toda</a></p>`;
      itens = $$('.busca__item', caixa);
      itens.forEach((a, i) => { a.id = `${input.id}-r${i}`; a.setAttribute('role', 'option'); });
      atual = -1;
      caixa.hidden = false;
    };
    let espera;
    input.addEventListener('focus', () => { indice(form.dataset.busca); if (input.value.trim().length > 1) procurar(); });
    input.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(procurar, 90); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (!caixa.hidden) { e.preventDefault(); fechar(); } return; }
      if (!itens.length || caixa.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        atual = (atual + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
        pintarAtual();
        input.setAttribute('aria-activedescendant', itens[atual].id);
        itens[atual].scrollIntoView({ block: 'nearest' });
      }
    });
    form.addEventListener('submit', (e) => {
      if (atual >= 0 && itens[atual]) { e.preventDefault(); location.href = itens[atual].href; }
    });
    document.addEventListener('click', (e) => { if (!form.contains(e.target)) fechar(); });
  });

  // ---------------------------------------------------------------- WhatsApp
  /* O número vem da própria página (uma ligação do WhatsApp): o site.json é a única fonte. No
     telemóvel a própria página segue para o wa.me (abre logo a aplicação); no computador, um
     separador novo. O window.open tem de ser chamado dentro do toque, sem esperas antes. */
  const numeroWhatsApp = () => {
    const a = $('a[href^="https://wa.me/"]');
    const m = a && /wa\.me\/(\d+)/.exec(a.getAttribute('href'));
    return m ? m[1] : '';
  };
  const telemovel = window.matchMedia('(hover: none) and (pointer: coarse)');
  function abrirWhatsApp(texto) {
    const url = `https://wa.me/${numeroWhatsApp()}?text=${encodeURIComponent(texto)}`;
    if (telemovel.matches) { location.href = url; return; }
    const janela = window.open(url, '_blank');
    if (janela) { try { janela.opener = null; } catch (_) { /* já é de outra origem */ } } else location.href = url;
  }
  window.LFSite = { abrirWhatsApp, numeroWhatsApp, abrir, esc, sem, euros };

  // ---------------------------------------------------------------- vídeos
  const poupar = navigator.connection && navigator.connection.saveData;
  const automatico = !menosMovimento.matches && !poupar;
  $$('[data-video]').forEach((v) => {
    const video = $('video', v);
    const botao = $('[data-video-botao]', v);
    const rotulo = $('.visualmente-escondido', botao);
    let escolhaDaPessoa = false;
    let recusado = false;
    const desenhar = () => {
      const tocar = video.paused;
      botao.setAttribute('aria-pressed', String(!tocar));
      botao.firstElementChild.outerHTML = tocar ? ICONE_TOCAR : ICONE_PAUSA;
      rotulo.textContent = tocar ? 'Ver o vídeo' : 'Parar o vídeo';
      v.classList.toggle('video--parado', tocar && (!automatico || escolhaDaPessoa || recusado));
    };
    const alternar = () => { escolhaDaPessoa = true; if (video.paused) video.play().catch(() => {}); else video.pause(); };
    video.addEventListener('play', desenhar);
    video.addEventListener('pause', desenhar);
    botao.addEventListener('click', alternar);
    video.addEventListener('click', alternar);
    if (automatico) {
      new IntersectionObserver((es) => {
        if (escolhaDaPessoa) return;
        if (es[0].isIntersecting) video.play().catch(() => { recusado = true; desenhar(); }); else video.pause();
      }, { threshold: 0.4 }).observe(v);
    }
    desenhar();
  });

  // ---------------------------------------------------------------- loja: a categoria aberta à vista
  const filaChips = $('.chips ul');
  const aberta = filaChips && $('[aria-current]', filaChips);
  if (aberta) {
    const centrar = () => {
      if (filaChips.scrollWidth <= filaChips.clientWidth) return;
      const li = aberta.parentElement;
      filaChips.scrollLeft = li.offsetLeft - (filaChips.clientWidth - li.offsetWidth) / 2;
    };
    centrar();
    if (document.fonts) document.fonts.ready.then(centrar);
  }

  // ---------------------------------------------------------------- filas de artigos: as setas
  $$('.fila').forEach((f) => {
    const pista = $('[data-fila]', f);
    const ant = $('[data-fila-anterior]', f);
    const seg = $('[data-fila-seguinte]', f);
    if (!pista || !ant || !seg) return;
    const passo = () => pista.clientWidth * 0.85;
    const pintar = () => {
      ant.disabled = pista.scrollLeft <= 4;
      seg.disabled = pista.scrollLeft + pista.clientWidth >= pista.scrollWidth - 4;
    };
    ant.addEventListener('click', () => pista.scrollBy({ left: -passo(), behavior: menosMovimento.matches ? 'auto' : 'smooth' }));
    seg.addEventListener('click', () => pista.scrollBy({ left: passo(), behavior: menosMovimento.matches ? 'auto' : 'smooth' }));
    pista.addEventListener('scroll', pintar, { passive: true });
    addEventListener('resize', pintar);
    pintar();
  });

  // ---------------------------------------------------------------- galeria da ficha
  $$('[data-galeria]').forEach((g) => {
    const pista = $('.galeria__pista', g);
    const minis = $$('[data-foto]', g);
    if (!minis.length) return;
    minis.forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.foto);
      pista.scrollTo({ left: i * pista.clientWidth, behavior: menosMovimento.matches ? 'auto' : 'smooth' });
    }));
    pista.addEventListener('scroll', () => {
      const i = Math.round(pista.scrollLeft / pista.clientWidth);
      minis.forEach((b, n) => (n === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
    }, { passive: true });
  });

  // ---------------------------------------------------------------- quantidades (+ / −)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mais], [data-menos]');
    if (!b) return;
    const q = b.closest('[data-quantidade]');
    if (!q || q.hasAttribute('data-linha')) return; // as do carrinho são do carrinho.js
    const input = $('input', q);
    const minimo = Number(input.min) || 1;
    const maximo = Number(input.max) || 20;
    const n = Math.min(maximo, Math.max(minimo, (parseInt(input.value, 10) || minimo) + (b.hasAttribute('data-mais') ? 1 : -1)));
    input.value = n;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // ---------------------------------------------------------------- erros nos formulários
  /* A frase do erro aparece junto ao campo que falta: por baixo do botão ficava fora do ecrã. */
  function errar(erro, campo, texto) {
    erro.textContent = texto;
    const sitio = campo && campo.closest('.campo');
    if (sitio) sitio.append(erro);
    erro.hidden = false;
    if (campo) { campo.setAttribute('aria-invalid', 'true'); campo.focus(); }
  }
  window.LFSite.errar = errar;

  // ---------------------------------------------------------------- o modelo do telemóvel (películas)
  /* A marca enche a lista dos modelos (agrupados pela família, como na capa), com «Outro modelo» no
     fim, que mostra o campo para o escrever; com «Outra marca» (ou uma marca sem modelos), só o
     campo. O modelo escolhido na lista fica também no campo escrito (escondido): é esse que vai para
     o carrinho. Uma página que chega com ?modelo=Marca|Modelo (das reparações) já o traz escolhido,
     e muda-se como outro qualquer. Sem JavaScript, fica só o campo escrito. */
  const modelosPorMarca = (() => { try { return JSON.parse(($('#dados-modelos') || {}).textContent || '{}'); } catch (_) { return {}; } })();
  const OUTRO_MODELO = '-outro-';
  $$('[data-escolha-modelo]').forEach((f) => {
    const marca = $('[data-modelo-marca]', f);
    const lista = $('[data-modelo-lista]', f);
    const listaCampo = $('[data-modelo-lista-campo]', f);
    const nome = $('[data-modelo-nome]', f);
    const nomeCampo = $('[data-modelo-nome-campo]', f);
    const rotulo = $('[data-modelo-nome-rotulo]', f);
    if (!lista || !listaCampo || !nomeCampo) return;
    const grupos = () => (Array.isArray(modelosPorMarca[marca.value]) ? modelosPorMarca[marca.value] : []);
    const naLista = (n) => grupos().some(([, l]) => l.includes(n));
    /* O que se vê é o que se pede. Sem marca: a lista, desligada, a pedir a marca primeiro. Numa
       marca com modelos: a lista, e o campo escrito só com «Outro modelo». Com «Outra marca» (ou uma
       marca sem modelos): só o campo escrito. */
    const mostrar = () => {
      const semMarca = !marca.value;
      const comLista = !semMarca && marca.value !== 'Outra' && grupos().length > 0;
      const aMao = !semMarca && (!comLista || lista.value === OUTRO_MODELO);
      listaCampo.hidden = !(semMarca || comLista);
      lista.disabled = !comLista;
      lista.required = comLista;
      nomeCampo.hidden = !aMao;
      nome.required = aMao;
      rotulo.textContent = comLista ? 'Escreva o modelo' : 'Modelo';
    };
    const encher = () => {
      const g = grupos();
      lista.innerHTML = g.length
        ? `<option value="">Escolha o modelo…</option>${g.map(([fam, l]) => `<optgroup label="${esc(fam)}">${l.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</optgroup>`).join('')}<option value="${OUTRO_MODELO}">Outro modelo (escrever)</option>`
        : '<option value="">Escolha primeiro a marca</option>';
    };
    marca.addEventListener('change', () => {
      encher();
      // o modelo que estava escolhido fica se for desta marca (fica escolhido na lista); senão apaga-se
      if (nome.value && naLista(nome.value)) lista.value = nome.value;
      else nome.value = '';
      mostrar();
    });
    lista.addEventListener('change', () => {
      if (lista.value === OUTRO_MODELO) { nome.value = ''; mostrar(); nome.focus(); return; }
      nome.value = lista.value;
      mostrar();
    });
    const pedido = new URLSearchParams(location.search).get('modelo');
    if (pedido && pedido.includes('|')) {
      const [m, n] = pedido.split('|');
      const escrito = String(n || '').trim().slice(0, 60);
      if (Array.from(marca.options).some((o) => o.value === m)) {
        marca.value = m;
        encher();
        if (naLista(escrito)) { lista.value = escrito; nome.value = escrito; }
        else if (escrito && grupos().length) { lista.value = OUTRO_MODELO; nome.value = escrito; }
        else nome.value = escrito;
      }
    }
    mostrar();
  });
  /* O modelo como vai para o carrinho: «Samsung Galaxy A55» (a marca só quando o nome não a tem). */
  function modeloEscrito(form) {
    const f = $('[data-escolha-modelo]', form);
    if (!f) return '';
    const marca = $('[data-modelo-marca]', f).value.trim();
    const nome = $('[data-modelo-nome]', f).value.trim().replace(/\s+/g, ' ');
    if (!nome) return '';
    const comMarca = !marca || marca === 'Outra' || sem(nome).startsWith(sem(marca)) || (marca === 'Apple' && /^i(phone|pad)/i.test(nome)) ? nome : `${marca} ${nome}`;
    return comMarca.slice(0, 80);
  }

  // ---------------------------------------------------------------- juntar ao carrinho (a ficha)
  $$('form[data-comprar]').forEach((form) => {
    const slug = form.dataset.comprar;
    const erro = $('[data-erro]', form);
    const total = $('[data-total]', form);
    const qtdInput = form.elements.quantidade;
    const maximo = Number(qtdInput.max) || 20;
    const escolhas = () => $$('[data-escolha]', form).map((f) => Number(($('input:checked', f) || {}).value || 0));
    const quantidade = () => Math.min(maximo, Math.max(1, parseInt(qtdInput.value, 10) || 1));
    const mostrarTotal = async () => {
      if (!window.LFCarrinho || !total) return;
      const t = quantidade() > 1 ? await window.LFCarrinho.totalDe({ produto: slug, opcoes: escolhas(), qtd: quantidade() }) : '';
      total.textContent = t ? `Total: ${t}` : '';
    };
    form.addEventListener('input', mostrarTotal);
    form.addEventListener('change', mostrarTotal);
    form.addEventListener('input', (e) => { if (e.target.hasAttribute('aria-invalid')) e.target.removeAttribute('aria-invalid'); erro.hidden = true; });
    form.addEventListener('change', (e) => { if (e.target.hasAttribute('aria-invalid')) e.target.removeAttribute('aria-invalid'); erro.hidden = true; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erro.hidden = true;
      $$('[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
      for (const f of $$('[data-escolha]', form)) {
        if (!$('input:checked', f)) { errar(erro, $('input', f), `Escolha: ${$('legend', f).textContent.trim()}.`); return; }
      }
      const fm = $('[data-escolha-modelo]', form);
      if (fm) {
        const lista = $('[data-modelo-lista]', fm);
        if (!$('[data-modelo-marca]', fm).value) { errar(erro, $('[data-modelo-marca]', fm), 'Escolha a marca do seu telemóvel.'); return; }
        if (lista && !lista.disabled && !lista.value) { errar(erro, lista, 'Escolha o modelo do seu telemóvel.'); return; }
        if (!$('[data-modelo-nome]', fm).value.trim()) { errar(erro, $('[data-modelo-nome]', fm), 'Escreva o modelo do seu telemóvel.'); return; }
      }
      if (!window.LFCarrinho) { errar(erro, null, 'O carrinho não carregou. Recarregue a página e tente outra vez.'); return; }
      await window.LFCarrinho.juntar({ produto: slug, opcoes: escolhas(), qtd: quantidade(), modelo: modeloEscrito(form) });
      qtdInput.value = 1;
      mostrarTotal();
      abrir('carrinho', $('button[type="submit"]', form));
    });
  });
  /* O botão do cartão (os artigos sem escolhas): junta um ao carrinho e abre a gaveta. */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-juntar]');
    if (!b || !window.LFCarrinho) return;
    e.preventDefault();
    await window.LFCarrinho.juntar({ produto: b.dataset.juntar, opcoes: [], qtd: 1 });
    b.dataset.feito = '';
    setTimeout(() => { delete b.dataset.feito; }, 1200);
    abrir('carrinho', b);
  });

  // ---------------------------------------------------------------- os problemas (separadores)
  /* A grelha dos problemas: tocar num mostra a explicação dele por baixo (os outros escondem-se).
     Um endereço com #problema-ecra (ou #ecra) abre esse. */
  $$('[data-problemas]').forEach((s) => {
    const abas = $$('[data-problema]', s);
    const paineis = $$('[data-painel]', s);
    if (!abas.length) return;
    const escolher = (id, { foco = false, rolar = false } = {}) => {
      abas.forEach((a) => { const sim = a.dataset.problema === id; a.setAttribute('aria-selected', String(sim)); a.tabIndex = sim ? 0 : -1; if (sim && foco) a.focus(); });
      paineis.forEach((p) => { p.hidden = p.dataset.painel !== id; });
      if (rolar) { const p = paineis.find((x) => x.dataset.painel === id); if (p && p.getBoundingClientRect().top > innerHeight * 0.75) p.scrollIntoView({ behavior: menosMovimento.matches ? 'auto' : 'smooth', block: 'nearest' }); }
    };
    abas.forEach((a, i) => {
      a.addEventListener('click', (e) => { e.preventDefault(); escolher(a.dataset.problema, { rolar: true }); history.replaceState(null, '', `#problema-${a.dataset.problema}`); });
      a.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        escolher(abas[(i + d + abas.length) % abas.length].dataset.problema, { foco: true });
      });
    });
    const pedido = (location.hash || '').replace(/^#(problema-)?/, '');
    escolher(abas.some((a) => a.dataset.problema === pedido) ? pedido : abas[0].dataset.problema);
    /* «Ver o preço para o meu modelo» leva à escolha do modelo (na mesma página, quando a há). */
    $$('[data-ir-escolher]', s).forEach((b) => b.addEventListener('click', (e) => {
      const alvo = $('#escolher');
      if (!alvo) return;
      e.preventDefault();
      alvo.scrollIntoView({ behavior: menosMovimento.matches ? 'auto' : 'smooth', block: 'start' });
      const campo = $('[data-seletor-procura]', alvo);
      if (campo && !telemovel.matches) campo.focus({ preventScroll: true });
    }));
  });
})();
