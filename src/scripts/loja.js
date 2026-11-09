/* LF Mobile — os filtros, a ordem e a procura da loja (a página /loja/ e as das categorias).
   Os cartões trazem o que é preciso nos data-* (a marca, o estado, o preço de hoje, a ordem do
   painel, se se compra no site e o texto para procurar): os filtros só os mostram ou escondem, e a
   ordem só os reordena — nada vai à rede. Um endereço com ?q= (a procura do topo sem JavaScript, ou o
   «Ver a loja toda» dela) filtra pelas palavras. */
(function () {
  'use strict';
  const loja = document.querySelector('[data-loja]');
  if (!loja) return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sem = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const grelha = $('[data-grelha-loja]', loja);
  if (!grelha) return;
  const cartoes = $$('.cartao', grelha);
  const ordemOriginal = cartoes.slice();
  const filtros = $('[data-filtros]', loja);
  const form = $('[data-filtros-form]', loja);
  const conta = $('[data-conta-artigos]', loja);
  const vazia = $('[data-loja-vazia]', loja);
  const ordenar = $('[data-ordenar]', loja);
  const procuraEl = $('[data-loja-procura]', loja);
  const q = new URLSearchParams(location.search).get('q') || '';
  const palavras = sem(q).split(/\s+/).filter((p) => p.length > 1);

  function aplicar() {
    const marcados = (nome) => (form ? $$(`input[name="${nome}"]:checked`, form).map((i) => i.value) : []);
    const marcas = marcados('marca');
    const estados = marcados('estado');
    const precos = marcados('preco').map((v) => v.split('-').map(Number));
    const soCompravel = marcados('compravel').length > 0;
    let n = 0;
    for (const c of cartoes) {
      const d = c.dataset;
      const preco = d.preco === '' ? null : Number(d.preco);
      const ok = (!marcas.length || marcas.includes(d.marca))
        && (!estados.length || estados.includes(d.estado))
        && (!precos.length || (preco !== null && precos.some(([a, b]) => preco >= a && preco < b)))
        && (!soCompravel || d.compravel === 'sim')
        && (!palavras.length || palavras.every((p) => sem(d.texto).includes(p)));
      c.hidden = !ok;
      if (ok) n++;
    }
    conta.textContent = `${n} ${n === 1 ? 'artigo' : 'artigos'}`;
    if (vazia) vazia.hidden = n > 0;
  }
  function reordenar() {
    const modo = ordenar ? ordenar.value : '';
    const preco = (c) => (c.dataset.preco === '' ? Infinity : Number(c.dataset.preco));
    const lista = ordemOriginal.slice();
    if (modo === 'preco-asc') lista.sort((a, b) => preco(a) - preco(b));
    else if (modo === 'preco-desc') lista.sort((a, b) => (preco(b) === Infinity ? -1 : preco(b)) - (preco(a) === Infinity ? -1 : preco(a)));
    else if (modo === 'nome') lista.sort((a, b) => $('.cartao__nome', a).textContent.localeCompare($('.cartao__nome', b).textContent, 'pt'));
    for (const c of lista) grelha.append(c);
  }
  if (form) form.addEventListener('change', aplicar);
  if (ordenar) ordenar.addEventListener('change', reordenar);
  $$('[data-limpar-filtros]', loja).forEach((b) => b.addEventListener('click', () => {
    if (form) form.reset();
    aplicar();
  }));
  /* No telemóvel os filtros abrem numa folha a toda a altura. */
  const abrirF = $('[data-abrir-filtros]', loja);
  if (abrirF && filtros) {
    abrirF.addEventListener('click', () => { filtros.dataset.aberto = ''; abrirF.setAttribute('aria-expanded', 'true'); const p = $('input', filtros); if (p) p.focus({ preventScroll: true }); });
    $$('[data-fechar-filtros]', filtros).forEach((b) => b.addEventListener('click', () => { delete filtros.dataset.aberto; abrirF.setAttribute('aria-expanded', 'false'); abrirF.focus(); }));
    filtros.addEventListener('keydown', (e) => { if (e.key === 'Escape' && filtros.hasAttribute('data-aberto')) { delete filtros.dataset.aberto; abrirF.focus(); } });
  }
  if (palavras.length && procuraEl) {
    procuraEl.innerHTML = `Resultados para «${q.replace(/[&<>"]/g, '')}» · <a href="${location.pathname}">ver tudo</a>`;
    procuraEl.hidden = false;
    $$('input[name="q"]').forEach((i) => { i.value = q; });
  }
  aplicar();
})();
