/* LF Mobile — o simulador da retoma (a página /retoma/), como o da Fnac e melhor.
   Os dados vêm da página (#dados-retoma: as marcas, as famílias, os modelos com as capacidades, os
   valores máximos, as perguntas e o desconto de cada resposta). Um passo de cada vez: a marca, o
   modelo, a capacidade e as perguntas; o valor aparece desde a capacidade («até X €») e muda a cada
   resposta. No fim, o valor estimado com o porquê de cada desconto, como entregar e como receber, e
   o pedido pelo WhatsApp com tudo escrito. Nada vai para o site: só a mensagem, que a pessoa envia
   se quiser. O botão «voltar» do telemóvel recua um passo (history.pushState).
   A CONTA é a de src/lib/regras.mjs (valorDaRetoma): o máximo × o fator de cada resposta,
   arredondado aos 5 € para baixo; uma resposta «avaliar» (não liga, molhou) ou um valor abaixo do
   mínimo dão «avaliamos na loja». */
(function () {
  'use strict';
  const raiz = document.querySelector('[data-simulador]');
  const fonte = document.getElementById('dados-retoma');
  if (!raiz || !fonte) return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sem = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const euros = (v) => `${v.toLocaleString('pt-PT', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} €`;
  const D = JSON.parse(fonte.textContent);
  const palco = $('[data-palco]', raiz);
  const lado = $('[data-lado]', raiz);
  const SETA = '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const VOLTAR = '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
  const LUPA = '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/></svg>';
  const WHATSAPP = '<svg class="icone" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 2.2A9.8 9.8 0 0 0 3.6 17l-1.3 4.8 4.9-1.3A9.8 9.8 0 1 0 12 2.2Zm0 17.8a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 20Zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8.9c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 5 5 0 0 0 1 2.6 11.3 11.3 0 0 0 4.3 3.8c1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.2.2-.6.2-1 .1-1.2l-.3-.1Z"/></svg>';
  const desenho = (d, classe = '') => `<svg class="aparelho${classe ? ` ${classe}` : ''}" viewBox="${['iphone-duo', 'galaxy-fold'].includes(d) ? '0 0 200 180' : d === 'tablet' ? '0 0 160 210' : d === 'relogio' ? '0 0 120 180' : '0 0 120 200'}" aria-hidden="true" focusable="false"><use href="#ap-${esc(d)}"/></svg>`;
  const porId = new Map(D.modelos.map((m) => [m.id, m]));

  // ---------------------------------------------------------------- o estado e a conta
  const novo = () => ({ passo: 'marca', marca: '', familia: '', modelo: '', capacidade: null, i: 0, respostas: {}, entregar: 0, receber: 0 });
  let s = novo();
  function valor(st = s) {
    const m = porId.get(st.modelo);
    const maximo = m && st.capacidade !== null && D.valores[m.id] ? D.valores[m.id][String(st.capacidade)] : undefined;
    if (typeof maximo !== 'number') return { maximo: null, valor: null, avaliar: true, descontos: [] };
    let fator = 1;
    let avaliar = false;
    const descontos = [];
    for (const q of D.perguntas) {
      const r = q.respostas[st.respostas[q.id]];
      if (!r) continue;
      if (r.avaliar) avaliar = true;
      else if (r.fator < 1) { fator *= r.fator; descontos.push({ pergunta: q.texto, resposta: r.texto, fator: r.fator }); }
    }
    // ao cêntimo antes de descer aos 5 € (regras.mjs, valorDaRetoma): 400 × 0,95 × 0,75 dá 284,999… em vírgula flutuante
    let v = avaliar ? null : Math.floor(Math.round(maximo * fator * 100) / 500) * 5;
    if (v !== null && v < D.minimo) { v = null; avaliar = true; }
    return { maximo, valor: v, avaliar, descontos };
  }
  // os passos pela ordem (para o progresso e para recuar): a capacidade só quando o modelo as tem
  const passos = (st = s) => {
    const m = porId.get(st.modelo);
    const temCap = !m || m.capacidades.length > 0; // antes de escolher o modelo, conta-se com ela
    return ['marca', 'modelo', ...(temCap ? ['capacidade'] : []), ...D.perguntas.map((_, i) => `p${i}`), 'resultado'];
  };
  const chaveDoPasso = (st = s) => (st.passo === 'pergunta' ? `p${st.i}` : st.passo);

  // ---------------------------------------------------------------- navegação (com o «voltar» do browser)
  function ir(alteracao) {
    s = { ...s, ...alteracao };
    history.pushState({ retoma: s }, '');
    pintar(true);
  }
  addEventListener('popstate', (e) => {
    if (e.state && e.state.retoma) { s = e.state.retoma; pintar(true); } else { s = novo(); pintar(true); }
  });
  history.replaceState({ retoma: s }, '');
  function recuar() { history.back(); }

  // ---------------------------------------------------------------- os passos
  function topo(titulo, ajuda = '') {
    const lista = passos();
    const i = Math.max(0, lista.indexOf(chaveDoPasso()));
    const pct = Math.round(((i + 1) / lista.length) * 100);
    return `<div class="sim-topo">
      ${s.passo !== 'marca' ? `<button class="sim-voltar" type="button" data-sim-voltar aria-label="Voltar">${VOLTAR}</button>` : ''}
      <div class="sim-progresso" role="progressbar" aria-label="Progresso da simulação" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      <span class="sim-contador">${i + 1} de ${lista.length}</span>
    </div>
    <h2 class="sim-pergunta" tabindex="-1" data-sim-titulo>${esc(titulo)}</h2>
    ${ajuda ? `<p class="sim-ajuda">${esc(ajuda)}</p>` : ''}`;
  }
  const PASSOS = {
    marca() {
      return `${topo('Que telemóvel quer vender?')}
      <div class="sim-marcas">${D.marcas.map((m) => `<button class="sim-marca" type="button" data-sim-marca="${esc(m.id)}">${desenho(m.id === 'apple' ? 'iphone-ilha' : 'galaxy')}<span>${esc(m.nome)}</span></button>`).join('')}</div>`;
    },
    modelo() {
      const fams = D.familias.filter((f) => f.marca === s.marca);
      return `${topo('Qual é o modelo?', 'No iPhone vê-se em Definições › Geral › Informações; no Samsung, em Definições › Acerca do telemóvel.')}
      ${fams.length > 1 ? `<div class="sim-familias">${fams.map((f) => `<button class="sim-familia" type="button" data-sim-familia="${esc(f.id)}" aria-pressed="${s.familia === f.id}">${esc(f.nome)}</button>`).join('')}</div>` : ''}
      <label class="sim-procura">${LUPA}<span class="visualmente-escondido">Procurar o modelo</span><input type="search" placeholder="Modelo (ex.: 13 Pro, S23)" autocomplete="off" data-sim-procura></label>
      <div class="sim-modelos" data-sim-modelos></div>
      <p class="sim-ajuda" data-sim-nada hidden>Não encontramos esse modelo. <a href="${esc(whatsappDe('Olá! Quero vender o meu telemóvel (retoma) e não o encontrei no simulador: '))}" target="_blank" rel="noopener">Pergunte-nos pelo WhatsApp</a>.</p>`;
    },
    capacidade() {
      const m = porId.get(s.modelo);
      return `${topo(`Que capacidade tem o ${m.nome}?`, 'Vê-se em Definições › Geral › Informações (iPhone) ou em Definições › Assistência do dispositivo › Armazenamento (Samsung).')}
      <div class="sim-capacidades">${m.capacidades.map((c) => {
        const v = D.valores[m.id] && D.valores[m.id][String(c.gb)];
        return `<button class="sim-capacidade" type="button" data-sim-cap="${c.gb}">${esc(c.texto)}${typeof v === 'number' ? `<small>até ${euros(v)}</small>` : ''}</button>`;
      }).join('')}</div>`;
    },
    pergunta() {
      const q = D.perguntas[s.i];
      const duas = q.respostas.length === 2 && q.respostas.every((r) => !r.ajuda);
      return `${topo(q.texto, q.ajuda)}
      <div class="sim-opcoes${duas ? ' sim-opcoes--2' : ''}">${q.respostas.map((r, j) => `<button class="sim-opcao" type="button" data-sim-resposta="${j}" aria-pressed="${s.respostas[q.id] === j}"><span><strong>${esc(r.texto)}</strong>${r.ajuda ? `<small>${esc(r.ajuda)}</small>` : ''}</span>${SETA}</button>`).join('')}</div>`;
    },
    resultado() {
      const m = porId.get(s.modelo);
      const v = valor();
      const cap = m.capacidades.find((c) => c.gb === s.capacidade);
      const cartao = v.avaliar
        ? `<div class="sim-valor sim-valor--avaliar"><p class="sim-valor__rotulo">O seu ${esc(m.nome)}</p><p class="sim-valor__numero" style="font-size:2rem">Avaliamos na loja</p><p class="sim-valor__nota">${v.maximo === null ? 'Ainda não temos um valor para este modelo no site.' : 'Com estas respostas, o valor só se diz depois de o vermos (é rápido).'} Mande-nos o pedido e dizemos-lhe quanto vale.</p></div>`
        : `<div class="sim-valor"><p class="sim-valor__rotulo">Valor estimado${D.porConfirmar ? ' (referência, por confirmar)' : ''}</p><p class="sim-valor__numero">${euros(v.valor)}</p><p class="sim-valor__nota">Pelo seu ${esc(m.nome)}${cap ? ` de ${esc(cap.texto)}` : ''}. Confirmamos na loja, com o telemóvel à frente.</p></div>`;
      const descontos = !v.avaliar && v.descontos.length ? `<div><p class="sim-ajuda" style="margin:0 0 8px">Do máximo de ${euros(v.maximo)}:</p><ul class="sim-descontos">${v.descontos.map((d) => `<li><span>${esc(d.pergunta)} ${esc(d.resposta)}</span><span>−${Math.round((1 - d.fator) * 100)}%</span></li>`).join('')}</ul></div>` : '';
      const radios = (nome, lista, atual) => `<div class="sim-radios">${lista.map((t, i) => `<label class="sim-radio"><input type="radio" name="${nome}" value="${i}"${i === atual ? ' checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>`;
      return `${topo(v.avaliar ? 'Quase pronto' : 'O seu telemóvel vale')}
      <div class="sim-resultado">
        ${cartao}
        ${descontos}
        <form class="formulario" data-sim-pedido novalidate>
          ${D.entregar.length ? `<fieldset class="sim-grupo"><legend>Como o entrega?</legend>${radios('entregar', D.entregar, s.entregar)}</fieldset>` : ''}
          ${!v.avaliar && D.receber.length ? `<fieldset class="sim-grupo"><legend>Como quer receber?</legend>${radios('receber', D.receber, s.receber)}</fieldset>` : ''}
          <div class="campo"><label for="sim-nome">O seu nome <span class="campo__opcional">(opcional)</span></label><input id="sim-nome" name="nome" type="text" maxlength="60" autocomplete="name"></div>
          <label class="caixa"><input type="checkbox" name="confirmo" required><span>Antes de entregar, desligo o «Encontrar» (ou a conta Samsung e Google) e apago os dados.</span></label>
          <p class="comprar__erro" data-sim-erro role="alert" hidden></p>
          <button class="botao botao--whatsapp botao--largo" type="submit">${WHATSAPP}<span>Enviar o pedido pelo WhatsApp</span></button>
          <button class="botao botao--texto" type="button" data-sim-reiniciar>Fazer outra simulação</button>
        </form>
      </div>`;
    },
  };

  function whatsappDe(texto) {
    const n = window.LFSite ? window.LFSite.numeroWhatsApp() : '';
    return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
  }

  // ---------------------------------------------------------------- desenhar
  function pintarModelos() {
    const caixa = $('[data-sim-modelos]', palco);
    if (!caixa) return;
    const q = sem(($('[data-sim-procura]', palco) || {}).value || '').trim().split(/\s+/).filter(Boolean);
    const lista = D.modelos.filter((m) => m.marca === s.marca && (!s.familia || m.familia === s.familia) && (!q.length || q.every((p) => sem(m.nome).includes(p))));
    caixa.innerHTML = lista.map((m) => `<button class="sim-modelo" type="button" data-sim-modelo="${esc(m.id)}">${desenho(m.desenho)}<span>${esc(m.nome)}</span></button>`).join('');
    $('[data-sim-nada]', palco).hidden = lista.length > 0;
  }
  function pintarLado() {
    const m = porId.get(s.modelo);
    const v = valor();
    const nome = $('[data-lado-nome]', lado);
    const det = $('[data-lado-detalhe]', lado);
    const caixaAp = $('[data-lado-aparelho]', lado);
    const cap = m && m.capacidades.find((c) => c.gb === s.capacidade);
    if (m) {
      const vazio = $('.simulador__aparelho-vazio', caixaAp);
      const atual = $('svg.aparelho', caixaAp);
      const novoD = desenho(m.desenho);
      if (vazio) vazio.outerHTML = novoD; else if (atual) atual.outerHTML = novoD;
      nome.textContent = m.nome;
      det.textContent = cap ? cap.texto : 'Escolha a capacidade.';
    } else {
      nome.textContent = s.marca ? (D.marcas.find((x) => x.id === s.marca) || {}).nome || 'O seu telemóvel' : 'O seu telemóvel';
      det.textContent = s.marca ? 'Escolha o modelo.' : 'Escolha a marca e o modelo.';
    }
    const caixaV = $('[data-lado-valor]', lado);
    const respondidas = D.perguntas.some((q) => q.id in s.respostas);
    if (m && s.capacidade !== null && (v.maximo !== null || v.avaliar)) {
      caixaV.hidden = false;
      $('[data-lado-rotulo]', lado).textContent = v.avaliar ? 'Valor' : respondidas ? 'Valor estimado' : 'Valor máximo';
      $('[data-lado-numero]', lado).textContent = v.avaliar ? 'Na loja' : respondidas ? euros(v.valor) : `até ${euros(v.maximo)}`;
    } else caixaV.hidden = true;
    const etapa = s.passo === 'resultado' ? 'valor' : s.passo === 'pergunta' ? 'estado' : 'aparelho';
    const ordem = ['aparelho', 'estado', 'valor'];
    $$('[data-etapa]', lado).forEach((li) => {
      const i = ordem.indexOf(li.dataset.etapa);
      li.dataset.estado = i < ordem.indexOf(etapa) ? 'feita' : i === ordem.indexOf(etapa) ? 'agora' : '';
    });
    // a barra de baixo (telemóvel)
    let barra = $('.barra-sim');
    if (!barra) { barra = document.createElement('div'); barra.className = 'barra-sim'; barra.hidden = true; document.body.append(barra); }
    if (m && s.capacidade !== null && s.passo !== 'resultado') {
      barra.innerHTML = `<span class="barra-sim__aparelho">${esc(m.nome)}${cap ? ` · ${esc(cap.texto)}` : ''}</span><span class="barra-sim__valor"><small>${v.avaliar ? 'Valor' : respondidas ? 'Estimado' : 'Até'}</small>${v.avaliar ? 'Na loja' : euros(respondidas ? v.valor : v.maximo)}</span>`;
      barra.hidden = false;
    } else barra.hidden = true;
  }
  function pintar(focar = false) {
    palco.innerHTML = PASSOS[s.passo]();
    if (s.passo === 'modelo') pintarModelos();
    pintarLado();
    if (focar) {
      const t = $('[data-sim-titulo]', palco);
      if (t) t.focus({ preventScroll: true });
      const r = raiz.getBoundingClientRect();
      if (r.top < 0 || r.top > innerHeight * 0.4) raiz.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  // ---------------------------------------------------------------- os toques
  palco.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-sim-voltar]')) { recuar(); return; }
    if (t.matches('[data-sim-reiniciar]')) { ir(novo()); return; }
    if (t.dataset.simMarca) { ir({ passo: 'modelo', marca: t.dataset.simMarca, familia: '', modelo: '', capacidade: null, respostas: {}, i: 0 }); return; }
    if (t.dataset.simFamilia) { s.familia = s.familia === t.dataset.simFamilia ? '' : t.dataset.simFamilia; $$('[data-sim-familia]', palco).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.simFamilia === s.familia))); pintarModelos(); return; }
    if (t.dataset.simModelo) {
      const m = porId.get(t.dataset.simModelo);
      ir(m.capacidades.length ? { passo: 'capacidade', modelo: m.id, capacidade: null } : { passo: D.perguntas.length ? 'pergunta' : 'resultado', modelo: m.id, capacidade: null, i: 0 });
      return;
    }
    if (t.dataset.simCap) { ir({ passo: D.perguntas.length ? 'pergunta' : 'resultado', capacidade: Number(t.dataset.simCap), i: 0 }); return; }
    if (t.dataset.simResposta !== undefined) {
      const q = D.perguntas[s.i];
      const j = Number(t.dataset.simResposta);
      const respostas = { ...s.respostas, [q.id]: j };
      // «não liga» ou «molhou»: o resto das perguntas já não muda nada — salta para o fim
      const avaliar = q.respostas[j].avaliar;
      if (avaliar || s.i >= D.perguntas.length - 1) ir({ respostas, passo: 'resultado' });
      else ir({ respostas, i: s.i + 1 });
    }
  });
  palco.addEventListener('input', (e) => { if (e.target.matches('[data-sim-procura]')) pintarModelos(); });
  palco.addEventListener('change', (e) => {
    if (e.target.name === 'entregar') s.entregar = Number(e.target.value);
    if (e.target.name === 'receber') s.receber = Number(e.target.value);
    const erro = $('[data-sim-erro]', palco);
    if (erro) erro.hidden = true;
  });
  palco.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-sim-pedido]');
    if (!form) return;
    e.preventDefault();
    const erro = $('[data-sim-erro]', form);
    if (!form.elements.confirmo.checked) {
      erro.textContent = 'Confirme que desliga o «Encontrar» e apaga os dados antes de o entregar: sem isso não o podemos aceitar.';
      erro.hidden = false;
      form.elements.confirmo.focus();
      return;
    }
    const m = porId.get(s.modelo);
    const cap = m.capacidades.find((c) => c.gb === s.capacidade);
    const v = valor();
    const linhas = ['Olá! Fiz a simulação da retoma no site.', '', `Telemóvel: ${m.nome}${cap ? `, ${cap.texto}` : ''}`];
    for (const q of D.perguntas) {
      const r = q.respostas[s.respostas[q.id]];
      if (r) linhas.push(`${q.texto} ${r.texto}`);
    }
    linhas.push(v.avaliar ? 'Valor: a avaliar na loja' : `Valor estimado: ${euros(v.valor)}${D.porConfirmar ? ' (referência do site)' : ''}`);
    if (D.entregar.length) linhas.push(`Entrego: ${D.entregar[s.entregar] || D.entregar[0]}`);
    if (!v.avaliar && D.receber.length) linhas.push(`Recebo: ${D.receber[s.receber] || D.receber[0]}`);
    const nome = String(form.elements.nome.value || '').trim().replace(/\s+/g, ' ');
    if (nome) linhas.push(`Nome: ${nome}`);
    if (window.LFSite) window.LFSite.abrirWhatsApp(linhas.join('\n'));
  });

  pintar(false);
})();
