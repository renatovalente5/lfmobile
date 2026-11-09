/* LF Mobile — as reparações.
   1. A ESCOLHA DO APARELHO ([data-seletor], na página das reparações): a marca (Apple ou Samsung)
      mostra as famílias dela; a família e a procura filtram os modelos. Sem JavaScript, tudo à vista.
   2. A PÁGINA DE UM MODELO ([data-reparacoes]): escolher uma ou mais reparações (e o nível do ecrã),
      o resumo com o total ao lado (computador) ou na barra de baixo (telemóvel), e «Marcar pelo
      WhatsApp» com tudo escrito. Um endereço com #ecra já traz essa reparação escolhida. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sem = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const euros = (v) => `${v.toLocaleString('pt-PT', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} €`;

  // ---------------------------------------------------------------- 1. a escolha do aparelho
  $$('[data-seletor]').forEach((s) => {
    const marcas = $$('[data-marca]', $('.seletor__marcas', s));
    const familias = $$('[data-familia]', $('.seletor__familias', s));
    const modelos = $$('[data-seletor-modelos] > li', s);
    const procura = $('[data-seletor-procura]', s);
    const vazio = $('[data-seletor-vazio]', s);
    let marca = (marcas[0] || {}).dataset ? marcas[0].dataset.marca : '';
    let familia = '';
    const pintar = () => {
      marcas.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.marca === marca)));
      familias.forEach((a) => {
        const li = a.parentElement;
        li.hidden = a.dataset.marcaDaFamilia !== marca;
        if (a.dataset.familia === familia) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
      const q = sem(procura.value).trim().split(/\s+/).filter(Boolean);
      let n = 0;
      for (const li of modelos) {
        // a procura procura em todos os modelos (das duas marcas); sem procura, a marca e a família filtram
        const ok = q.length ? q.every((p) => li.dataset.nome.includes(p) || sem(li.dataset.familia).includes(p)) : li.dataset.marca === marca && (!familia || li.dataset.familia === familia);
        li.hidden = !ok;
        if (ok) n++;
      }
      vazio.hidden = n > 0;
    };
    marcas.forEach((b) => b.addEventListener('click', () => { marca = b.dataset.marca; familia = ''; procura.value = ''; pintar(); }));
    familias.forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      familia = familia === a.dataset.familia ? '' : a.dataset.familia;
      procura.value = '';
      pintar();
    }));
    procura.addEventListener('input', pintar);
    procura.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const primeiro = modelos.find((li) => !li.hidden);
      if (primeiro) { e.preventDefault(); location.href = $('a', primeiro).href; }
    });
    pintar();
  });

  // ---------------------------------------------------------------- 2. a página de um modelo
  const pagina = $('[data-modelo]');
  const form = pagina && $('[data-reparacoes]', pagina);
  if (!form) return;
  const nomeModelo = pagina.dataset.nomeModelo;
  const porConfirmar = pagina.dataset.porConfirmar === 'sim';
  const linhasEl = $('[data-resumo-linhas]', pagina);
  const totalEl = $('[data-resumo-total]', pagina);
  const barra = $('[data-barra-rep]', pagina);
  const barraTexto = $('[data-barra-texto]', pagina);
  const marcar = $('[data-marcar]', pagina);
  const nomeEl = $('[data-resumo-nome]', pagina);

  /* O que está escolhido: [{ nome, nivel, preco (null = orçamento), gratis }] */
  function escolhidas() {
    return $$('.rep', form).filter((r) => $('input[name="reparacao"]', r).checked).map((r) => {
      const cx = $('input[name="reparacao"]', r);
      const nivel = $('[data-niveis] input:checked', r);
      const preco = nivel ? (nivel.dataset.preco === '' ? null : Number(nivel.dataset.preco)) : (cx.dataset.preco === '' ? null : Number(cx.dataset.preco));
      return { id: r.dataset.rep, nome: r.dataset.nome, nivel: nivel ? nivel.dataset.nomeNivel : (cx.dataset.nivel || ''), preco, gratis: cx.dataset.gratis === 'sim' };
    });
  }
  function pintar() {
    $$('.rep', form).forEach((r) => {
      const niveis = $('[data-niveis]', r);
      if (niveis) niveis.hidden = !$('input[name="reparacao"]', r).checked;
    });
    const lista = escolhidas();
    if (!lista.length) {
      linhasEl.innerHTML = '<li class="resumo-rep__vazio">Escolha uma ou mais reparações.</li>';
      totalEl.hidden = true;
      if (barra) barra.hidden = true;
      return;
    }
    linhasEl.innerHTML = lista.map((x) => `<li><span>${esc(x.nome)}${x.nivel ? `<small>${esc(x.nivel)}</small>` : ''}</span><span>${x.gratis ? 'Grátis' : x.preco === null ? 'Orçamento' : euros(x.preco)}</span></li>`).join('');
    const comPreco = lista.filter((x) => x.preco !== null);
    const soma = comPreco.reduce((s, x) => s + x.preco, 0);
    const semPreco = lista.some((x) => x.preco === null && !x.gratis);
    totalEl.innerHTML = `<span>Total${semPreco ? ' (sem o orçamento)' : ''}</span><span>${comPreco.length ? euros(Math.round(soma * 100) / 100) : 'Orçamento grátis'}</span>`;
    totalEl.hidden = false;
    if (barra) {
      barra.hidden = false;
      barraTexto.innerHTML = `${lista.length === 1 ? esc(lista[0].nome) : `${lista.length} reparações`}<small>${comPreco.length ? `${euros(Math.round(soma * 100) / 100)}${semPreco ? ' + orçamento' : ''}` : 'Orçamento grátis'}</small>`;
    }
  }
  form.addEventListener('change', pintar);
  /* #ecra (ou outra) no endereço: essa reparação já vem escolhida. */
  const pedido = location.hash.slice(1);
  const alvo = pedido && $(`.rep[data-rep="${CSS.escape(pedido)}"] input[name="reparacao"]`, form);
  if (alvo) alvo.checked = true;
  pintar();

  if (marcar) {
    marcar.addEventListener('click', () => {
      const lista = escolhidas();
      const linhas = [marcar.dataset.mensagem];
      if (lista.length) {
        for (const x of lista) linhas.push(`Reparação: ${x.nome}${x.nivel ? ` (${x.nivel})` : ''}${x.gratis ? ' — grátis' : x.preco === null ? ' — orçamento' : ` — ${euros(x.preco)}`}`);
        const comPreco = lista.filter((x) => x.preco !== null);
        if (comPreco.length > 1) linhas.push(`Total no site: ${euros(Math.round(comPreco.reduce((s, x) => s + x.preco, 0) * 100) / 100)}`);
        if (porConfirmar) linhas.push('(preços de referência do site)');
      } else linhas.push('Reparação: ainda não sei (queria um diagnóstico)');
      const nome = String(nomeEl.value || '').trim().replace(/\s+/g, ' ');
      if (nome) linhas.push(`Nome: ${nome}`);
      linhas.push('', 'Quando posso passar na loja?');
      if (window.LFSite) window.LFSite.abrirWhatsApp(linhas.join('\n'));
    });
  }
  // a barra de baixo leva ao resumo (e ao botão de marcar)
  if (barra) $('a', barra).addEventListener('click', (e) => { e.preventDefault(); $('#marcar').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  void nomeModelo;
})();
