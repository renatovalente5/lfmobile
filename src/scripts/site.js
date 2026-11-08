/* LF Mobile — o comportamento das páginas (sem dependências).
   O carrinho e a encomenda estão em carrinho.js; os dois vão no mesmo ficheiro, este primeiro.
   (A base é o site.js da Mimices.) */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const menosMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hojeLisboa = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const ICONE_PAUSA = '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M9 6.5v11M15 6.5v11"/></svg>';
  const ICONE_TOCAR = '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10.5-6.5L8 5.5Z"/></svg>';

  // ---------------------------------------------------------------- o anel do foco
  // Um toque ou um clique escondem o anel do foco (o CSS, em html[data-entrada="ponteiro"]); uma
  // tecla volta a mostrá-lo, para quem navega pelo teclado.
  const raiz = document.documentElement;
  addEventListener('pointerdown', () => { raiz.dataset.entrada = 'ponteiro'; }, { capture: true, passive: true });
  addEventListener('keydown', (e) => { if (!e.metaKey && !e.ctrlKey) delete raiz.dataset.entrada; }, { capture: true });

  // ---------------------------------------------------------------- a barra ao descer
  // No topo a barra não tem chão; ao descer ganha a linha e a sombra (site.css). O estado vive na
  // raiz (html[data-rolado]), onde a linha do <head> já o escreveu antes da primeira pintura. Dois
  // limiares (40 a descer, 8 a subir) só contra a tremura de uma página parada na linha.
  if ($('[data-topo]')) {
    let pedido = false;
    const decidir = () => {
      pedido = false;
      const y = scrollY;
      const agora = raiz.dataset.rolado === 'sim';
      raiz.dataset.rolado = (y >= 40 ? true : y <= 8 ? false : agora) ? 'sim' : 'nao';
    };
    addEventListener('scroll', () => { if (!pedido) { pedido = true; requestAnimationFrame(decidir); } }, { passive: true });
    addEventListener('pageshow', decidir);
    decidir();
  }

  // ---------------------------------------------------------------- aviso do topo com data
  // O site só muda quando se publica; o aviso «até 15 de dezembro» sai sozinho no dia 16.
  $$('.aviso[data-ate]').forEach((a) => { if (hojeLisboa() > a.dataset.ate) a.hidden = true; });

  // ---------------------------------------------------------------- menu e gaveta do carrinho
  // A página por trás fica trancada pelo CSS (html:has(dialog[open])): derivado do próprio
  // diálogo, nunca de uma classe que se põe e tira (um «close» perdido deixava-a presa).
  const dialogos = $$('dialog');
  dialogos.forEach((d) => {
    if (d.open) d.close(); // o Chrome repõe o «open» ao voltar atrás: abre-se outra vez à mão
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // clique no fundo
    // por delegação: o conteúdo da gaveta é desenhado depois, pelo carrinho.js
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
    /* O showModal() põe o foco no primeiro elemento que o aceita, e o Safari do iPhone mostra-o com
       o anel do foco mesmo depois de um toque. O foco vai para o corpo (tabindex=-1, sem anel): quem
       usa o teclado continua a entrar nos links com o Tab. */
    const corpo = d.querySelector('.menu__corpo, .gaveta__corpo');
    if (corpo) corpo.focus({ preventScroll: true });
    d._origem = origem || null;
    if (id === 'carrinho' && window.LFCarrinho) window.LFCarrinho.desenharGaveta();
  }
  dialogos.forEach((d) => d.addEventListener('close', () => { if (d._origem && document.contains(d._origem)) d._origem.focus(); }));
  $$('[data-abrir]').forEach((b) => b.addEventListener('click', (e) => {
    if (b.dataset.abrir === 'carrinho' && /pagina-(carrinho|checkout)/.test(document.body.className)) return; // já está no carrinho
    e.preventDefault();
    abrir(b.dataset.abrir, b);
  }));
  // uma ligação desligada (o «Finalizar» com o carrinho bloqueado) não vai a lado nenhum
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[aria-disabled="true"]');
    if (a) e.preventDefault();
  });

  // ---------------------------------------------------------------- WhatsApp
  /* O número vem da própria página (a ligação do cabeçalho ou do rodapé): o site.json é a única
     fonte, e os formulários não precisam de o repetir. ABRIR: no telemóvel a própria página segue
     para o wa.me, que é uma ligação universal (abre logo a aplicação). No computador, um separador
     novo (o WhatsApp Web ou a aplicação), e o site fica onde estava; se o browser recusar o
     separador, abre-se aqui mesmo. Sem «noopener» nas opções do window.open: com ele o browser
     devolve SEMPRE null. O window.open tem de ser chamado dentro do toque, sem esperas antes. */
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
  window.LFSite = { abrirWhatsApp, numeroWhatsApp };

  // ---------------------------------------------------------------- vídeos
  // Sem som e em ciclo. Começam sozinhos quando aparecem no ecrã — excepto com «reduzir
  // movimento» ou «poupar dados» (ou se o telemóvel recusar); aí ficam na imagem de capa, com o
  // botão de ver à vista. Tocar no vídeo pára-o.
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
    const alternar = () => {
      escolhaDaPessoa = true;
      if (video.paused) video.play().catch(() => {}); else video.pause();
    };
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
  // No telemóvel a fila das categorias desliza: a categoria aberta fica centrada, sem mexer na página.
  const fila = $('.chips ul');
  const aberta = fila && $('[aria-current]', fila);
  if (aberta) {
    const centrar = () => {
      if (fila.scrollWidth <= fila.clientWidth) return;
      const li = aberta.parentElement;
      fila.scrollLeft = li.offsetLeft - (fila.clientWidth - li.offsetWidth) / 2;
    };
    centrar();
    if (document.fonts) document.fonts.ready.then(centrar);
  }

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
  /* A frase do erro aparece junto ao campo que falta: por baixo do botão ficava fora do ecrã,
     porque a página salta para o campo. */
  function errar(erro, campo, texto) {
    erro.textContent = texto;
    const sitio = campo && campo.closest('.campo');
    if (sitio) sitio.append(erro);
    erro.hidden = false;
    if (campo) { campo.setAttribute('aria-invalid', 'true'); campo.focus(); }
  }
  const rotuloDe = (form, campo) => {
    const l = campo.id && $(`label[for="${campo.id}"]`, form);
    const fonte = l || (campo.closest('fieldset') && $('legend', campo.closest('fieldset')));
    return fonte ? fonte.textContent.replace(/\(opcional\)/i, '').replace(/\s+/g, ' ').trim() : 'este campo';
  };
  /* O primeiro campo obrigatório por preencher (um grupo de rádios conta como um). */
  function campoEmFalta(form) {
    for (const c of $$('[required]', form)) {
      if (c.type === 'radio') { if (!$(`input[name="${c.name}"]:checked`, form)) return c; continue; }
      if (c.type === 'checkbox') { if (!c.checked) return c; continue; }
      if (!String(c.value || '').trim()) return c;
    }
    return null;
  }

  // ---------------------------------------------------------------- juntar ao carrinho
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
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      erro.hidden = true;
      $$('[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
      for (const f of $$('[data-escolha]', form)) {
        if (!$('input:checked', f)) { errar(erro, $('input', f), `Escolha: ${$('legend', f).textContent.trim()}.`); return; }
      }
      if (!window.LFCarrinho) { errar(erro, null, 'O carrinho não carregou. Recarregue a página e tente outra vez.'); return; }
      const q = quantidade();
      await window.LFCarrinho.juntar({ produto: slug, opcoes: escolhas(), qtd: q });
      qtdInput.value = 1;
      mostrarTotal();
      abrir('carrinho', $('button[type="submit"]', form));
    });
  });

  // ---------------------------------------------------------------- reparações: um serviço abre o pedido
  /* Tocar num serviço (o cartão inteiro é a ligação para #orcamento) escolhe esse equipamento no pedido
     de orçamento e leva até ele. O foco não vai para o campo: no telemóvel abria logo o teclado. */
  $$('[data-equipamento]').forEach((a) => a.addEventListener('click', (e) => {
    const tipo = $('#o-tipo');
    const alvo = $('#orcamento');
    if (!tipo || !alvo) return;
    e.preventDefault();
    if (Array.from(tipo.options).some((o) => o.value === a.dataset.equipamento)) tipo.value = a.dataset.equipamento;
    tipo.dispatchEvent(new Event('change', { bubbles: true }));
    alvo.scrollIntoView({ behavior: menosMovimento.matches ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', '#orcamento');
  }));

  // ---------------------------------------------------------------- orçamento e retoma pelo WhatsApp
  /* Os dois formulários só escrevem a mensagem e abrem o WhatsApp: nada fica guardado no site
     (a política de privacidade promete isto). */
  const valores = (form, nome) => $$(`input[name="${nome}"]:checked`, form).map((i) => i.value);
  const texto = (form, nome) => String((form.elements[nome] || {}).value || '').trim().replace(/\s+/g, ' ');
  const MENSAGENS = {
    orcamento: (f) => [
      'Olá! Queria um orçamento para uma reparação.', '',
      `Equipamento: ${texto(f, 'tipo')}`,
      `Marca e modelo: ${texto(f, 'modelo')}`,
      `O que se passa: ${texto(f, 'avaria')}`,
      texto(f, 'nome') ? `Nome: ${texto(f, 'nome')}` : '',
    ],
    retoma: (f) => [
      'Olá! Quero vender o meu telemóvel (retoma).', '',
      `Marca: ${texto(f, 'marca')}`,
      `Modelo: ${texto(f, 'modelo')}`,
      `Estado: ${valores(f, 'estado')[0] || ''}`,
      `Problemas: ${valores(f, 'problemas').join(', ') || 'funciona tudo'}`,
      `Acompanha: ${valores(f, 'acompanha').join(', ') || 'só o equipamento'}`,
      texto(f, 'notas') ? `Notas: ${texto(f, 'notas')}` : '',
    ],
  };
  $$('form[data-whatsapp-form]').forEach((form) => {
    const compor = MENSAGENS[form.dataset.whatsappForm];
    const erro = $('[data-erro]', form);
    if (!compor || !erro) return;
    form.addEventListener('input', (e) => { if (e.target.hasAttribute('aria-invalid')) e.target.removeAttribute('aria-invalid'); erro.hidden = true; });
    form.addEventListener('change', () => { erro.hidden = true; });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      erro.hidden = true;
      $$('[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
      const falta = campoEmFalta(form);
      if (falta) { errar(erro, falta, `${falta.type === 'radio' || falta.tagName === 'SELECT' ? 'Escolha' : 'Preencha'}: ${rotuloDe(form, falta)}.`); return; }
      if (!numeroWhatsApp()) { errar(erro, null, 'O número de WhatsApp ainda não está no site.'); return; }
      abrirWhatsApp(compor(form).filter((l, i, arr) => l !== '' || i < arr.length).join('\n').replace(/\n+$/, ''));
    });
  });
})();
