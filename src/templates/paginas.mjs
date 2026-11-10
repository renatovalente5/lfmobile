// As páginas do site. Cada função devolve { caminho, titulo, descricao, conteudo, ... } e o
// build.mjs veste-a com a moldura (layout.mjs). As reparações estão em reparacoes.mjs e a retoma em
// retoma.mjs.
import { esc, euros, precoDe, markdown, inline, textoSimples, numeroWhatsApp, numeroLegivel, notaChamada, dataPorExtenso } from './util.mjs';
import { icones } from './icones.mjs';
import { usarAparelho, spriteAparelhos } from './aparelhos.mjs';
import { numeroPortugues, opcoesDe, temSuplementos, estadoDe, disponibilidadeDe, compravel, enviavel, linhasDe, GARANTIAS_USADOS, ESTADOS } from '../lib/regras.mjs';
import { imagem, temRecorte, preco, cartaoProduto, migalhas, botaoSeta, desconto, promocaoAte, cabecaDePagina, convite, promocaoNota, horarioHtml, moradaHtml, estadoRotulo, especificacoes, categoriasComArtigos, campanhaDe, fila } from './componentes.mjs';
import { grelhaDosProblemas } from './reparacoes.mjs';
import { BOTAO_ENCOMENDA } from '../../legal-comum/index.mjs';

const produtosDe = (ctx, cat) => ctx.produtos.filter((p) => p.categoria === cat);
/* As categorias de equipamentos: na ficha, a etiqueta diz «Novo» (nos acessórios não faz falta). */
const EQUIPAMENTOS = new Set(['iphone', 'samsung', 'recondicionados', 'tablets', 'smartwatches', 'audio']);
const categoriaDe = (ctx, slug) => ctx.categorias.find((c) => c.slug === slug);

/* Os portes numa frase curta (a ficha, o carrinho): «Envio Nacex: 5,90 € até 5 kg». */
export function portesCurtos(ctx) {
  const e = ctx.escaloes;
  const t = ctx.site.entrega.transportadora;
  if (!e.length) return 'portes a confirmar';
  return `${e.length > 1 ? 'desde ' : ''}${euros(e[0].preco)}${t ? ` pela ${esc(t)}` : ''}`;
}
/* A entrega numa linha, para a ficha: o envio com os portes, ou só o levantamento na loja. */
const entregaNaFicha = (ctx, p) => {
  if (!enviavel(p)) return `Só na loja, em ${ctx.site.local.localidade}: escolha o levantamento.`;
  const g = ctx.site.entrega.portes?.gratisAPartirDe;
  const gratis = Number.isFinite(g) ? `, grátis acima de ${euros(g)}` : '';
  return `Envio em 24/48 h (${portesCurtos(ctx)}${gratis}) ou levantamento grátis na loja.`;
};
/* A garantia dos recondicionados e usados, como a loja a escolheu (18 meses por acordo, ou 3 anos). */
const garantiaUsadosMeses = (ctx) => (GARANTIAS_USADOS.includes(ctx.site.garantias?.recondicionados) ? ctx.site.garantias.recondicionados : null);
export const garantiaTexto = (ctx, p) => {
  if (estadoDe(p) === 'novo') return 'Garantia legal de 3 anos';
  const m = garantiaUsadosMeses(ctx);
  if (m === 36) return 'Garantia legal de 3 anos';
  if (m === 18) return 'Garantia de 18 meses (acordada na compra)';
  return null;
};

/* O desenho de uma categoria quando não há recorte de nenhum artigo dela. */
const DESENHO_CATEGORIA = { iphone: 'iphone-ilha', samsung: 'galaxy', recondicionados: 'iphone-entalhe', tablets: 'tablet', smartwatches: 'relogio' };
const ICONE_CATEGORIA = { audio: 'auriculares', peliculas: 'pelicula', acessorios: 'caixa' };
function imagemDaCategoria(ctx, slug) {
  const p = produtosDe(ctx, slug).find((x) => temRecorte(ctx, x.fotos[0]));
  if (p) return imagem(ctx, p.fotos[0], { tamanhos: '120px', alt: '', recorte: true, classe: 'cat-fila__img' });
  if (DESENHO_CATEGORIA[slug]) return usarAparelho(DESENHO_CATEGORIA[slug], 'cat-fila__desenho');
  return `<span class="cat-fila__icone">${icones[ICONE_CATEGORIA[slug]] || icones.caixa}</span>`;
}

/* A ESCOLHA RÁPIDA da capa: a marca e o modelo em duas listas, e «Ver preços» abre a página do
   modelo. Sem JavaScript, o botão leva às reparações. */
function escolhaRapida(ctx, h) {
  const { marcas, familias, modelos } = ctx.aparelhos;
  return `<form class="rapido" action="${ctx.url('/reparacoes/')}" data-rapido="${esc(ctx.url('/reparacoes/'))}">
  <div class="rapido__campos">
    <div class="rapido__campo"><label for="rapido-marca">Marca</label>
      <select id="rapido-marca" data-rapido-marca>${marcas.map((m) => `<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join('')}</select></div>
    <div class="rapido__campo rapido__campo--largo"><label for="rapido-modelo">Modelo</label>
      <select id="rapido-modelo" name="modelo" data-rapido-modelo>
        <option value="">Escolha o modelo…</option>
        ${familias.map((f) => {
    const lista = modelos.filter((m) => m.familia === f.id);
    return lista.length ? `<optgroup label="${esc(f.nome)}" data-marca="${esc(f.marca)}">${lista.map((m) => `<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join('')}</optgroup>` : '';
  }).join('')}
      </select></div>
  </div>
  <button class="botao botao--ouro" type="submit">${esc(h.capa.botao)}${icones.seta}</button>
</form>`;
}

// ---------------------------------------------------------------- página inicial
export function inicio(ctx) {
  const h = ctx.inicio;
  const camp = ctx.campanhas[0];

  /* O MOSAICO DA CAPA: o cartão grande e escuro com a escolha rápida do modelo para reparar (o que
     a loja mais faz), a fotografia de uma reparação; ao lado, a retoma e — com uma campanha a correr
     — a campanha, senão os recondicionados. */
  const recond = produtosDe(ctx, 'recondicionados').filter((p) => precoDe(p, ctx.hoje).atual !== null);
  const desde = recond.length ? Math.min(...recond.map((p) => precoDe(p, ctx.hoje).atual)) : null;
  const fotoRecond = recond.find((p) => temRecorte(ctx, p.fotos[0]));
  const terceiro = camp
    ? `<a class="mosaico__cartao mosaico__cartao--campanha" href="${ctx.url(`/campanhas/${camp.slug}/`)}">
      <span class="rotulo rotulo--ouro">${esc(camp.nome)}</span>
      <strong class="mosaico__titulo">${esc(camp.titulo)}</strong>
      ${camp.desconto ? `<span class="mosaico__grande">−${camp.desconto}%</span>` : ''}
      <span class="mosaico__texto">Até ${dataPorExtenso(camp.ate)}.</span>
      <span class="mosaico__seta">Ver a campanha${icones.seta}</span>
    </a>`
    : `<a class="mosaico__cartao mosaico__cartao--loja" href="${ctx.url('/loja/recondicionados/')}">
      <span class="rotulo">Recondicionados</span>
      <strong class="mosaico__titulo">${esc(categoriaDe(ctx, 'recondicionados')?.titulo || 'Recondicionados')}</strong>
      ${desde !== null ? `<span class="mosaico__texto">Desde <b>${euros(desde)}</b>, testados na loja.</span>` : ''}
      <span class="mosaico__seta">Ver os recondicionados${icones.seta}</span>
      ${fotoRecond ? `<span class="mosaico__produto">${imagem(ctx, fotoRecond.fotos[0], { tamanhos: '200px', alt: '', recorte: true })}</span>` : ''}
    </a>`;
  const mosaico = `<section class="mosaico" aria-labelledby="capa-titulo">
  <div class="mosaico__principal">
    <div class="mosaico__palavras">
      <p class="rotulo rotulo--claro">Reparação de telemóveis</p>
      <h1 class="mosaico__h1" id="capa-titulo">${esc(h.capa.titulo)}</h1>
      ${h.capa.texto ? `<p class="mosaico__sub">${esc(h.capa.texto)}</p>` : ''}
      ${escolhaRapida(ctx, h)}
    </div>
    ${h.capa.foto && ctx.manifesto.fotos[h.capa.foto] ? `<figure class="mosaico__foto">${imagem(ctx, h.capa.foto, { tamanhos: '(min-width: 1100px) 360px, (min-width: 700px) 40vw, 100vw', prioridade: true })}</figure>` : ''}
  </div>
  <a class="mosaico__cartao mosaico__cartao--retoma" href="${ctx.url('/retoma/')}">
    <span class="rotulo rotulo--ouro">Retoma</span>
    <strong class="mosaico__titulo">${esc(h.retoma.titulo)}</strong>
    ${h.retoma.texto ? `<span class="mosaico__texto">${esc(h.retoma.texto)}</span>` : ''}
    <span class="mosaico__seta">${esc(h.retoma.botao)}${icones.seta}</span>
    <span class="mosaico__desenhos" aria-hidden="true">${usarAparelho('galaxy', 'mosaico__d1')}${usarAparelho('iphone-ilha', 'mosaico__d2')}</span>
  </a>
  ${terceiro}
</section>`;

  /* AS CATEGORIAS numa fila redonda (como as lojas de electrónica): a imagem de um artigo dela, sem
     fundo, ou o desenho do aparelho. */
  const cats = categoriasComArtigos(ctx);
  const filaCats = `<nav class="cat-fila" aria-label="Categorias da loja">
  <ul>${cats.map((k) => `<li><a href="${ctx.url(`/loja/${k.slug}/`)}"><span class="cat-fila__poco">${imagemDaCategoria(ctx, k.slug)}</span><span class="cat-fila__nome">${esc(k.nome)}</span></a></li>`).join('')}
  <li><a href="${ctx.url('/reparacoes/')}"><span class="cat-fila__poco cat-fila__poco--escuro"><span class="cat-fila__icone">${icones.ferramentas}</span></span><span class="cat-fila__nome">Reparações</span></a></li>
  </ul>
</nav>`;

  /* OS DESTAQUES: os artigos marcados no painel (até doze); sem nenhum, os primeiros pela ordem. */
  const marcados = ctx.produtos.filter((p) => p.destaque === true);
  const destaques = fila(ctx, (marcados.length ? marcados : ctx.produtos).slice(0, 12), { id: 'destaques-titulo', titulo: h.destaques.titulo, sub: h.destaques.texto, ligacao: '/loja/', textoLigacao: h.destaques.botao });
  const daCampanha = camp ? ctx.produtos.filter((p) => p.campanha === camp.slug) : [];
  const filaCampanha = camp && daCampanha.length ? fila(ctx, daCampanha.slice(0, 12), { id: 'campanha-titulo', titulo: camp.titulo, sub: camp.desconto ? `${camp.desconto}% de desconto até ${dataPorExtenso(camp.ate)}.` : '', ligacao: `/campanhas/${camp.slug}/`, textoLigacao: 'Ver tudo' }) : '';

  /* A RETOMA, numa faixa escura: a pergunta, os três passos e o botão. */
  const faixaRetoma = `<section class="faixa-retoma" aria-labelledby="retoma-titulo">
  <div class="faixa-retoma__texto">
    <p class="rotulo rotulo--ouro">Retoma</p>
    <h2 class="titulo-seccao" id="retoma-titulo">${esc(h.retoma.titulo)}</h2>
    ${h.retoma.texto ? `<p class="faixa-retoma__sub">${esc(h.retoma.texto)}</p>` : ''}
    <ol class="faixa-retoma__passos">
      <li><span>1</span>Simule no site</li>
      <li><span>2</span>Entregue na loja</li>
      <li><span>3</span>Receba o valor</li>
    </ol>
    <a class="botao botao--ouro" href="${ctx.url('/retoma/')}">${esc(h.retoma.botao)}${icones.seta}</a>
  </div>
  <div class="faixa-retoma__desenho" aria-hidden="true">${usarAparelho('iphone-ilha', 'faixa-retoma__a')}${usarAparelho('galaxy-fold', 'faixa-retoma__b')}</div>
</section>`;

  /* AS PELÍCULAS: os tipos (cada um leva à ficha, onde se diz o modelo). */
  const pels = produtosDe(ctx, 'peliculas');
  const faixaPeliculas = pels.length ? `<section class="faixa-peliculas" aria-labelledby="peliculas-titulo">
  <div class="faixa-peliculas__texto">
    <h2 class="titulo-seccao" id="peliculas-titulo">${esc(h.peliculas.titulo)}</h2>
    ${h.peliculas.texto ? `<p class="seccao__texto">${esc(h.peliculas.texto)}</p>` : ''}
    <a class="botao botao--cheio" href="${ctx.url('/loja/peliculas/')}">${esc(h.peliculas.botao)}${icones.seta}</a>
  </div>
  <ul class="faixa-peliculas__tipos">${pels.slice(0, 5).map((p) => `<li><a href="${ctx.url(`/produtos/${p.slug}/`)}"><span class="faixa-peliculas__img">${imagem(ctx, p.fotos[0], { tamanhos: '140px', alt: '', recorte: true })}</span><span class="faixa-peliculas__nome">${esc(p.nomeCurto || p.nome).replace(/^Película (de |para a )?/i, '')}</span>${precoDe(p, ctx.hoje).atual !== null ? `<span class="faixa-peliculas__preco">${euros(precoDe(p, ctx.hoje).atual)}</span>` : ''}</a></li>`).join('')}</ul>
</section>` : '';

  /* A CONFIANÇA: a nota do Google (com a ligação, para quem quiser conferir) e o que a loja faz. As
     opiniões em si não se copiam (DL 57/2008, art. 8.º, al. cc). */
  const g = ctx.site.google || {};
  const t = ctx.site.entrega.transportadora;
  const confianca = `<ul class="confianca-faixa" aria-label="Porquê a LF Mobile">
  ${g.nota && g.ligacao ? `<li><a class="confianca-faixa__caixa" href="${esc(g.ligacao)}" target="_blank" rel="noopener"><span class="confianca-faixa__icone confianca-faixa__icone--ouro">${icones.estrela}</span><span><strong>${esc(String(g.nota).replace('.', ','))} no Google</strong><small>${g.opinioes ? `${g.opinioes} opiniões` : 'Ver as opiniões'}</small></span></a></li>` : ''}
  <li><div class="confianca-faixa__caixa"><span class="confianca-faixa__icone">${icones.ferramentas}</span><span><strong>Reparações desde 2020</strong><small>Diagnóstico e orçamento grátis</small></span></div></li>
  <li><div class="confianca-faixa__caixa"><span class="confianca-faixa__icone">${icones.camiao}</span><span><strong>${t ? `Envios ${esc(t)} 24/48 h` : 'Envios 24/48 h'}</strong><small>${ctx.escaloes.length ? `Desde ${euros(ctx.escaloes[0].preco)}` : 'Portugal Continental'}</small></span></div></li>
  <li><div class="confianca-faixa__caixa"><span class="confianca-faixa__icone">${icones.loja}</span><span><strong>Loja em ${esc(ctx.site.local.localidade)}</strong><small>Levantamento grátis</small></span></div></li>
</ul>`;

  /* A LOJA: a fotografia da fachada, a morada, o horário e os botões. */
  const loja = `<section class="loja-casa" aria-labelledby="loja-titulo">
  ${h.loja.foto && ctx.manifesto.fotos[h.loja.foto] ? `<div class="loja-casa__foto">${imagem(ctx, h.loja.foto, { tamanhos: '(min-width: 900px) 48vw, 100vw', proporcao: '4 / 3' })}</div>` : ''}
  <div class="loja-casa__texto">
    <p class="rotulo">A loja</p>
    <h2 class="titulo-seccao" id="loja-titulo">${esc(h.loja.titulo === 'A loja' ? `Em ${ctx.site.local.localidade}, ${ctx.site.local.concelho}` : h.loja.titulo)}</h2>
    ${h.loja.texto ? `<p class="seccao__texto">${esc(h.loja.texto)}</p>` : ''}
    <div class="loja-casa__dados">
      <div><p class="loja-casa__rotulo">${icones.local}Morada</p>${moradaHtml(ctx)}</div>
      <div><p class="loja-casa__rotulo">${icones.relogio}Horário</p>${horarioHtml(ctx)}</div>
    </div>
    <div class="botoes">
      ${ctx.site.local.mapa ? `<a class="botao botao--cheio" href="${esc(ctx.site.local.mapa)}" target="_blank" rel="noopener">${icones.local}<span>Como chegar</span></a>` : ''}
      <a class="botao botao--contorno" href="${ctx.url('/contactos/')}">Contactos</a>
    </div>
  </div>
</section>`;

  const org = organizacao(ctx);
  return {
    caminho: '/',
    titulo: h.seo.titulo,
    descricao: h.seo.descricao,
    classe: 'pagina-inicio',
    jsonld: [org, { '@context': 'https://schema.org', '@type': 'WebSite', '@id': ctx.absoluto('/#site'), name: ctx.site.marca, url: ctx.absoluto('/'), inLanguage: 'pt-PT', publisher: { '@id': ctx.absoluto('/#loja') } }],
    conteudo: `${spriteAparelhos()}
<div class="contentor inicio">
  ${mosaico}
  ${filaCats}
  ${filaCampanha}
  ${destaques}
  ${grelhaDosProblemas(ctx, { titulo: h.reparacoes.titulo, texto: h.reparacoes.texto, ligacaoModelo: ctx.url('/reparacoes/#escolher') })}
</div>
<div class="contentor">${faixaRetoma}</div>
<div class="contentor">
  ${faixaPeliculas}
  ${confianca}
  ${loja}
</div>`,
  };
}


// ---------------------------------------------------------------- loja e categorias
/* OS FILTROS da loja (loja.js): a marca, o estado, o preço, e «compra-se no site». Só aparecem os
   que dividem a lista (uma marca só, ou um estado só, não se filtra). */
function filtros(ctx, lista) {
  const marcas = [...new Set(lista.map((p) => (p.marca || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
  const semMarca = lista.some((p) => !(p.marca || '').trim());
  const estados = [...new Set(lista.map((p) => estadoDe(p)))];
  const precos = lista.map((p) => precoDe(p, ctx.hoje).atual).filter((v) => v !== null);
  const FAIXAS = [[0, 50, 'Até 50 €'], [50, 200, '50 € a 200 €'], [200, 500, '200 € a 500 €'], [500, 100000, 'Mais de 500 €']].filter(([a, b]) => precos.some((v) => v >= a && v < b));
  const grupos = [];
  if (marcas.length + (semMarca ? 1 : 0) > 1) grupos.push(`<fieldset class="filtro"><legend>Marca</legend>${marcas.map((m) => `<label class="caixa"><input type="checkbox" name="marca" value="${esc(m.toLowerCase())}"><span>${esc(m)}</span></label>`).join('')}${semMarca ? '<label class="caixa"><input type="checkbox" name="marca" value=""><span>Outras</span></label>' : ''}</fieldset>`);
  if (estados.length > 1) grupos.push(`<fieldset class="filtro"><legend>Estado</legend>${estados.map((e) => `<label class="caixa"><input type="checkbox" name="estado" value="${esc(e)}"><span>${esc(ESTADOS[e])}</span></label>`).join('')}</fieldset>`);
  if (FAIXAS.length > 1) grupos.push(`<fieldset class="filtro"><legend>Preço</legend>${FAIXAS.map(([a, b, t]) => `<label class="caixa"><input type="checkbox" name="preco" value="${a}-${b}"><span>${esc(t)}</span></label>`).join('')}</fieldset>`);
  if (lista.some((p) => compravel(p)) && lista.some((p) => !compravel(p))) grupos.push('<fieldset class="filtro"><legend>Compra</legend><label class="caixa"><input type="checkbox" name="compravel" value="sim"><span>Compra-se no site</span></label></fieldset>');
  if (!grupos.length) return '';
  return `<aside class="filtros" id="filtros" aria-label="Filtros" data-filtros>
  <div class="filtros__topo"><p class="filtros__titulo">Filtrar</p><button class="filtros__fechar" type="button" data-fechar-filtros>${icones.fechar}<span class="visualmente-escondido">Fechar os filtros</span></button></div>
  <form class="filtros__corpo" data-filtros-form>${grupos.join('')}</form>
  <div class="filtros__pe"><button class="botao botao--contorno botao--pequeno" type="button" data-limpar-filtros>Limpar</button><button class="botao botao--cheio botao--pequeno filtros__ver" type="button" data-fechar-filtros>Ver os artigos</button></div>
</aside>`;
}

export function loja(ctx, cat = null) {
  const c = cat && categoriaDe(ctx, cat);
  const lista = c ? produtosDe(ctx, cat) : ctx.produtos;
  const caminho = c ? `/loja/${c.slug}/` : '/loja/';
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: 'Loja', caminho: '/loja/' }, ...(c ? [{ nome: c.nome, caminho }] : [])]);
  const chips = [{ slug: '', nome: 'Tudo' }, ...categoriasComArtigos(ctx)]
    .map((k) => {
      const href = ctx.url(k.slug ? `/loja/${k.slug}/` : '/loja/');
      const atual = (k.slug || null) === (cat || null);
      return `<li><a class="chip" href="${href}"${atual ? ' aria-current="page"' : ''}>${esc(k.nome)}</a></li>`;
    }).join('');
  const f = filtros(ctx, lista);
  const conteudo = `<div class="contentor loja" data-loja>
  <header class="loja-cabeca">
    <h1 class="titulo-pagina">${esc(c ? c.titulo : 'Loja')}</h1>
    ${c?.resumo ? `<p class="cabeca__sub">${esc(c.resumo)}</p>` : '<p class="cabeca__sub">iPhone e Samsung novos e recondicionados, películas para qualquer telemóvel, áudio e acessórios.</p>'}
  </header>
  <nav class="chips" aria-label="Categorias"><ul>${chips}</ul></nav>
  <div class="loja-barra">
    <p class="loja-barra__conta" data-conta-artigos aria-live="polite">${lista.length} ${lista.length === 1 ? 'artigo' : 'artigos'}</p>
    <p class="loja-barra__procura" data-loja-procura hidden></p>
    ${f ? `<button class="botao botao--contorno botao--pequeno loja-barra__filtrar" type="button" data-abrir-filtros aria-controls="filtros">${icones.filtro}<span>Filtrar</span></button>` : ''}
    <label class="loja-barra__ordem"><span class="visualmente-escondido">Ordenar</span>${icones.ordenar}<select data-ordenar><option value="">Em destaque</option><option value="preco-asc">Preço: mais baixo</option><option value="preco-desc">Preço: mais alto</option><option value="nome">Nome</option></select></label>
  </div>
  <div class="loja-corpo${f ? '' : ' loja-corpo--sem-filtros'}">
    ${f}
    ${lista.length ? `<div class="grelha" data-grelha-loja>
      ${lista.map((p) => cartaoProduto(ctx, p, { titulo: 'h2' })).join('\n')}
    </div>` : `<p class="loja__vazia">Ainda não há artigos nesta categoria. <a href="${ctx.url('/loja/')}">Ver toda a loja</a></p>`}
    <p class="loja__vazia" data-loja-vazia hidden>Nenhum artigo com estes filtros. <button class="botao botao--texto" type="button" data-limpar-filtros>Limpar os filtros</button></p>
  </div>
  ${convite(ctx, { titulo: 'Não encontra o que procura? Encomendamos para si.', texto: 'Olá! Gostava de encomendar um equipamento: ', contactos: false })}
</div>`;
  return {
    caminho,
    titulo: c ? c.titulo : 'Loja — iPhone, Samsung, películas e acessórios',
    descricao: c ? textoSimples(c.resumo || c.titulo).slice(0, 158) : `iPhone e Samsung novos e recondicionados, películas para qualquer telemóvel, áudio e acessórios na ${ctx.site.marca}, em ${ctx.site.local.localidade}. Envios para Portugal Continental.`,
    classe: 'pagina-loja',
    jsonld: [m.ld, {
      '@context': 'https://schema.org', '@type': 'ItemList',
      itemListElement: lista.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: ctx.absoluto(`/produtos/${p.slug}/`), name: p.nome })),
    }],
    conteudo,
  };
}

// ---------------------------------------------------------------- campanhas
/* A PÁGINA DE UMA CAMPANHA (a que está a correr): a faixa escura com o nome, o desconto e as datas,
   o texto, e os artigos que ela apanha. */
export function campanha(ctx, c) {
  const caminho = `/campanhas/${c.slug}/`;
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: c.nome, caminho }]);
  const lista = ctx.produtos.filter((p) => p.campanha === c.slug);
  const conteudo = `<section class="camp-capa">
  <div class="contentor camp-capa__dentro">
    <p class="rotulo rotulo--ouro">${esc(c.nome)}</p>
    <h1 class="camp-capa__titulo">${esc(c.titulo)}</h1>
    ${c.texto ? `<p class="camp-capa__sub">${esc(c.texto)}</p>` : ''}
    <p class="camp-capa__datas">${icones.relogio}De ${dataPorExtenso(c.desde)} a ${dataPorExtenso(c.ate, true)}</p>
    ${c.desconto ? `<p class="camp-capa__desconto" aria-hidden="true">−${c.desconto}%</p>` : ''}
  </div>
</section>
<div class="contentor campanha-pagina">
  ${lista.length ? `<div class="grelha">${lista.map((p) => cartaoProduto(ctx, p, { titulo: 'h2' })).join('\n')}</div>` : `<p class="loja__vazia">${esc(c.nome)}: veja a <a href="${ctx.url('/loja/')}">loja</a>.</p>`}
  <p class="nota">Os preços riscados são os mais baixos dos 30 dias anteriores à campanha. Os descontos não se juntam a outras promoções.</p>
</div>`;
  return {
    caminho,
    titulo: c.titulo,
    descricao: `${c.faixa}. Na ${ctx.site.marca}, em ${ctx.site.local.localidade}, e no site.`.slice(0, 160),
    classe: 'pagina-campanha',
    jsonld: [m.ld],
    conteudo,
  };
}


/* O horário em openingHoursSpecification (o que o Google lê), a partir das linhas em texto: só as
   linhas que se percebem («Segunda a sexta», «Sábado», «10:00–13:00 · 14:30–19:00»); as outras ficam
   de fora, sem erro. */
const DIAS = { segunda: 'Monday', terca: 'Tuesday', terça: 'Tuesday', quarta: 'Wednesday', quinta: 'Thursday', sexta: 'Friday', sabado: 'Saturday', sábado: 'Saturday', domingo: 'Sunday', domingos: 'Sunday' };
const ORDEM_DIAS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function horarioLd(ctx) {
  const out = [];
  for (const l of Array.isArray(ctx.site.horario) ? ctx.site.horario : []) {
    if (!l || !l.dias || !l.horas) continue;
    const dias = String(l.dias).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const nomes = dias.match(/segunda|terca|quarta|quinta|sexta|sabado|domingos?/g) || [];
    if (!nomes.length) continue;
    let lista;
    if (/\sa\s/.test(dias) && nomes.length === 2) {
      const a = ORDEM_DIAS.indexOf(DIAS[nomes[0]]); const b = ORDEM_DIAS.indexOf(DIAS[nomes[1]]);
      lista = a >= 0 && b >= a ? ORDEM_DIAS.slice(a, b + 1) : [];
    } else lista = nomes.map((n) => DIAS[n]).filter(Boolean);
    const horas = [...String(l.horas).matchAll(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/g)];
    if (!lista.length) continue;
    if (!horas.length) { if (/encerrad|fechad/.test(String(l.horas).toLowerCase())) out.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: lista, opens: '00:00', closes: '00:00' }); continue; }
    for (const m of horas) out.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: lista, opens: m[1].padStart(5, '0'), closes: m[2].padStart(5, '0') });
  }
  return out;
}

export function organizacao(ctx) {
  const c = ctx.site.contactos;
  const e = ctx.site.empresa;
  const coords = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(ctx.site.local.coordenadas || '');
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'MobilePhoneStore',
    '@id': ctx.absoluto('/#loja'),
    name: ctx.site.marca,
    description: ctx.site.descricao,
    url: ctx.absoluto('/'),
    logo: ctx.absoluto(`/assets/img/${ctx.manifesto.logo.altura[256].png}`),
    image: ctx.absoluto(`/assets/img/${ctx.manifesto.partilha._site}`),
    address: { '@type': 'PostalAddress', ...(e.morada ? { streetAddress: e.morada } : {}), ...(e.codigoPostal ? { postalCode: e.codigoPostal } : {}), addressLocality: e.localidade || ctx.site.local.localidade, addressRegion: ctx.site.local.distrito, addressCountry: 'PT' },
    areaServed: { '@type': 'Country', name: 'Portugal' },
    currenciesAccepted: 'EUR',
    paymentAccepted: 'Cartão, MB WAY, Multibanco, numerário',
    sameAs: [c.instagram && `https://www.instagram.com/${c.instagram}/`, c.facebook && `https://www.facebook.com/${c.facebook}/`].filter(Boolean),
  };
  if (coords) ld.geo = { '@type': 'GeoCoordinates', latitude: Number(coords[1]), longitude: Number(coords[2]) };
  if (ctx.site.local.mapa) ld.hasMap = ctx.site.local.mapa;
  const horas = horarioLd(ctx);
  if (horas.length) ld.openingHoursSpecification = horas;
  if (c.email) ld.email = c.email;
  if (c.whatsapp) ld.telephone = `+${numeroWhatsApp(c.whatsapp)}`;
  if (e.nif) ld.vatID = `PT${e.nif.replace(/\D/g, '')}`;
  return ld;
}


/* ---------------------------------------------------------------- vídeo */
function capaDoVideo(ctx, nome) {
  const poster = ctx.manifesto.posters[`video-${nome}`];
  const w = poster.larguras[0];
  return `<img src="${ctx.asset(`img/video-${nome}-${poster.resumo}-${w}.webp`)}" width="${w}" height="${Math.round((w * poster.altura) / poster.largura)}" alt="" loading="lazy" decoding="async">`;
}
export function video(ctx, nome) {
  const poster = ctx.manifesto.posters[`video-${nome}`];
  if (!poster) throw new Error(`vídeo «${nome}» sem capa em media/video/${nome}.jpg`);
  const posterUrl = ctx.asset(`img/video-${nome}-${poster.resumo}-${poster.larguras[poster.larguras.length - 1]}.webp`);
  return `<div class="video" data-video>
  <video muted loop playsinline preload="none" poster="${posterUrl}" width="${poster.largura}" height="${poster.altura}" aria-label="Vídeo sem som: ${esc(ctx.videos[nome] || nome)}">
    <source src="${ctx.asset(ctx.ficheiros.videos[nome])}" type="video/mp4">
  </video>
  <button class="video__botao" type="button" aria-pressed="false" data-video-botao>${icones.tocar}<span class="visualmente-escondido">Ver o vídeo</span></button>
</div>`;
}


// ---------------------------------------------------------------- ficha de artigo
export function produto(ctx, p) {
  const c = categoriaDe(ctx, p.categoria);
  const caminho = `/produtos/${p.slug}/`;
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: 'Loja', caminho: '/loja/' }, { nome: c.nome, caminho: `/loja/${c.slug}/` }, { nome: p.nome, caminho }]);
  const v = precoDe(p, ctx.hoje);
  const pct = desconto(ctx, p);
  const disp = disponibilidadeDe(p);
  const estado = estadoDe(p);

  // A galeria: a fotografia inteira (sem cortes), numa moldura com a forma da mais alta do artigo.
  const itens = p.fotos.map((f, i) => ({ foto: f, n: i + 1 }));
  if (p.video && ctx.ficheiros.videos[p.video]) itens.splice(1, 0, { video: p.video });
  const formas = p.fotos.map((f) => { const mm = ctx.manifesto.fotos[f]; return mm ? mm.largura / mm.altura : 1; });
  const forma = Math.max(0.7, Math.min(1.25, Math.min(...formas)));
  const comRecorte = temRecorte(ctx, p.fotos[0]);
  const galeria = `<div class="galeria" data-galeria style="--forma:${forma.toFixed(3)}">
    <div class="galeria__pista" tabindex="0" role="region" aria-label="${p.video ? 'Fotografias e vídeo' : 'Fotografias'} de ${esc(p.nome)}">
      ${itens.map((it) => (it.video
    ? `<figure class="galeria__foto galeria__foto--video" id="video">${video(ctx, it.video)}</figure>`
    : `<figure class="galeria__foto${it.n === 1 && comRecorte ? ' galeria__foto--recorte' : ''}" id="foto-${it.n}">${imagem(ctx, it.foto, { tamanhos: '(min-width: 1000px) 46vw, 100vw', prioridade: it.n === 1, recorte: it.n === 1 })}</figure>`)).join('\n')}
    </div>
    ${itens.length > 1 ? `<ul class="galeria__miniaturas">${itens.map((it, i) => `<li>${it.video
    ? `<button class="galeria__mini-video" type="button" data-foto="${i}">${capaDoVideo(ctx, it.video)}<span class="galeria__tocar">${icones.tocar}</span><span class="visualmente-escondido">Vídeo</span></button>`
    : `<button type="button" data-foto="${i}"${i === 0 ? ' aria-current="true"' : ''}${i === 0 && comRecorte ? ' class="galeria__mini-recorte"' : ''}>${imagem(ctx, it.foto, { tamanhos: '80px', alt: '', prioridade: true, recorte: i === 0 }).replace(' fetchpriority="high"', '')}<span class="visualmente-escondido">Fotografia ${it.n} de ${p.fotos.length}</span></button>`}</li>`).join('')}</ul>` : ''}
  </div>`;

  const camp = campanhaDe(ctx, p);
  const selos = [
    pct ? `<span class="selo selo--desconto">−${pct}%</span>` : '',
    camp ? `<a class="selo selo--campanha" href="${ctx.url(`/campanhas/${camp.slug}/`)}">${esc(camp.nome)}</a>` : (pct ? `<span class="selo selo--promocao">${esc(promocaoAte(ctx, p) || 'Promoção')}</span>` : ''),
    p.novidade ? '<span class="selo selo--novidade">Novidade</span>' : '',
  ].filter(Boolean).join('');

  // A grade, a bateria e a capacidade já estão por cima do preço: não se repetem na lista.
  const jaDitas = new Set(especificacoes(p));
  const caracteristicas = linhasDe(p.caracteristicas).filter((t) => !/^grade\s/i.test(t) && !jaDitas.has(t) && !jaDitas.has(t.replace(/\s*de armazenamento/i, '')));
  const inclui = linhasDe(p.inclui);
  const listas = `${caracteristicas.length ? `<div class="lista-ficha"><p class="lista-ficha__titulo">Características</p><ul>${caracteristicas.map((t) => `<li>${icones.certo}<span>${esc(t)}</span></li>`).join('')}</ul></div>` : ''}
  ${inclui.length ? `<div class="lista-ficha"><p class="lista-ficha__titulo">Inclui</p><ul>${inclui.map((t) => `<li>${icones.caixa}<span>${esc(t)}</span></li>`).join('')}</ul></div>` : ''}`;

  // --- o formulário: as escolhas (cor, capacidade), o modelo, a quantidade e o botão ---------------
  const grupos = opcoesDe(p);
  /* O MODELO DO TELEMÓVEL (as películas): a marca numa lista e o modelo escrito, com as sugestões
     da marca escolhida (content/aparelhos.json); sem modelo não se junta ao carrinho. Uma página que
     chega com ?modelo=Marca|Modelo (das reparações) já o traz escolhido (site.js). */
  const blocoModelo = p.pedeModelo === true ? `<fieldset class="campo escolha-modelo" data-escolha-modelo>
    <legend>O seu telemóvel</legend>
    <div class="campos-lado">
      <div class="campo"><label for="m-marca-${esc(p.slug)}">Marca</label><select id="m-marca-${esc(p.slug)}" name="marcaModelo" required data-modelo-marca><option value="">Escolha…</option>${ctx.marcasParaModelo.map((mm) => `<option>${esc(mm)}</option>`).join('')}<option value="Outra">Outra marca</option></select></div>
      <div class="campo"><label for="m-modelo-${esc(p.slug)}">Modelo</label><input id="m-modelo-${esc(p.slug)}" name="modelo" type="text" list="m-lista-${esc(p.slug)}" maxlength="60" required autocomplete="off" placeholder="Ex.: iPhone 13, Galaxy A55" data-modelo-nome><datalist id="m-lista-${esc(p.slug)}" data-modelo-lista></datalist></div>
    </div>
    <p class="campo__ajuda">Cortamos a película para este modelo. Se não souber o nome, veja em Definições › Geral › Informações (iPhone) ou Definições › Acerca do telemóvel (Android).</p>
  </fieldset>` : '';
  const blocoOpcoes = grupos.map((g, i) => `<fieldset class="campo escolha" data-escolha="${i}">
    <legend>${esc(g.nome)}</legend>
    <div class="escolha__lista">${g.valores.map((x, j) => `<label class="escolha__opcao"><input type="radio" name="opcao-${i}" value="${j}" required${j === g.valores.findIndex((y) => !y.suplemento) ? ' checked' : ''}><span>${esc(x.nome)}${x.suplemento ? ` <span class="escolha__mais">+ ${euros(x.suplemento)}</span>` : ''}</span></label>`).join('')}</div>
  </fieldset>`).join('');

  const perguntar = (texto) => (ctx.site.contactos.whatsapp ? `<a class="botao botao--whatsapp botao--largo" href="${ctx.whatsapp(texto)}" target="_blank" rel="noopener">${icones.whatsapp}<span>${texto.startsWith('Olá! Este artigo ainda está disponível') ? 'Perguntar disponibilidade' : 'Perguntar pelo WhatsApp'}</span></a>` : '');
  let comprar;
  if (compravel(p)) {
    comprar = `<form class="comprar" data-comprar="${esc(p.slug)}" novalidate>
      ${blocoOpcoes}
      ${blocoModelo}
      <div class="comprar__linha">
        <div class="quantidade" data-quantidade>
          <button type="button" data-menos>${icones.menos}<span class="visualmente-escondido">Menos um</span></button>
          <label class="visualmente-escondido" for="qtd-${p.slug}">Quantidade</label>
          <input id="qtd-${p.slug}" name="quantidade" type="number" inputmode="numeric" min="1" max="20" value="1">
          <button type="button" data-mais>${icones.mais}<span class="visualmente-escondido">Mais um</span></button>
        </div>
        <button class="botao botao--cheio botao--largo" type="submit">${icones.carrinho}<span>Adicionar ao carrinho</span></button>
      </div>
      <p class="comprar__total" data-total aria-live="polite"></p>
      <p class="comprar__erro" data-erro role="alert" hidden></p>
    </form>
    <noscript><p>${perguntar(`Olá! Gostava de encomendar: ${p.nome}.`)}</p></noscript>`;
  } else if (disp === 'esgotado') {
    comprar = `<div class="comprar comprar--sem">
      <p class="comprar__estado">Esgotado</p>
      ${perguntar(`Olá! O artigo «${p.nome}» está esgotado. Avisam-me quando voltar a haver?`)}
    </div>`;
  } else {
    // «Preço sob consulta» já está no lugar do preço: aí a caixa leva só o botão.
    const frase = v.atual === null ? '' : estado === 'novo' ? 'Confirme a disponibilidade antes de comprar.' : 'Peça única: confirme a disponibilidade antes de comprar.';
    comprar = `<div class="comprar comprar--sem">
      ${frase ? `<p class="comprar__estado">${frase}</p>` : ''}
      ${perguntar(`Olá! Este artigo ainda está disponível? ${p.nome} (${ctx.absoluto(caminho)})`)}
    </div>`;
  }

  /* --- por baixo do botão, só o essencial (o Renato, 8 nov 2026: «muita informação repetida, apenas
     quero o essencial, simples e direto»): a entrega numa linha e a garantia com a ligação para a
     página dela. O pagamento diz-se no carrinho, no início da encomenda (DL 24/2014); os prazos, os
     portes e a desistência estão nas páginas de cada um. */
  const garantia = garantiaTexto(ctx, p);
  const notas = `<ul class="confianca">
    <li>${icones.camiao}<span>${esc(entregaNaFicha(ctx, p))}</span></li>
    <li>${icones.escudo}<span>${garantia ? `<a href="${ctx.url('/garantia/')}">${esc(garantia)}</a>` : `${ctx.marcador('a garantia dos recondicionados (18 meses ou 3 anos)')} · <a href="${ctx.url('/garantia/')}">Garantia</a>`}</span></li>
  </ul>`;

  /* O que a lei pede numa venda à distância, só quando o artigo o tem (Regulamento (UE) 2023/988,
     art. 19.º): os avisos de segurança, a referência e o fabricante (nome, morada e email, quando o
     painel os diz por inteiro). */
  const fab = fabricanteDoArtigo(p);
  const avisos = linhasDe(String(p.avisos || '').split(/\n+/));
  const infoLegal = avisos.length || p.referencia || fab ? `<div class="info-legal">
    ${avisos.length ? `<div class="info-legal__bloco"><p class="info-legal__titulo">Avisos de segurança</p><ul>${avisos.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${p.referencia ? `<p class="info-legal__linha"><strong>Referência:</strong> ${esc(p.referencia)}</p>` : ''}
    ${fab ? `<p class="info-legal__linha"><strong>Fabricante:</strong> ${[fab.nome, fab.morada, fab.email].map(esc).join(' · ')}</p>` : ''}
  </div>` : '';

  const relacionados = ctx.produtos.filter((x) => x.slug !== p.slug)
    .sort((a, b) => (b.categoria === p.categoria) - (a.categoria === p.categoria) || (a.ordem ?? 500) - (b.ordem ?? 500)).slice(0, 8);

  // A marca (ou a categoria) e o estado: «Huawei · Novo», «Apple · Recondicionado · Grade A+». Os
  // acessórios sem marca ficam só com a categoria.
  const estadoTexto = estadoRotulo(p) || (EQUIPAMENTOS.has(p.categoria) ? 'Novo' : '');
  const specs = especificacoes(p);
  const etiqueta = [p.marca || c.nome, estadoTexto].filter(Boolean).join(' · ');
  const conteudo = `<div class="contentor produto">
  ${m.html}
  <div class="produto__grelha">
    ${galeria}
    <div class="produto__info">
      ${selos ? `<div class="produto__selos">${selos}</div>` : ''}
      <p class="etiqueta">${esc(etiqueta)}</p>
      <h1 class="produto__nome">${esc(p.nome)}</h1>
      ${specs.length ? `<ul class="produto__specs">${specs.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <div class="produto__preco">${preco(ctx, p, { grande: true })}${promocaoNota(ctx, p)}</div>
      <div class="produto__resumo">${markdown(p.descricao, ctx.url)}</div>
      ${listas}
      ${comprar}
      ${notas}
      ${infoLegal}
    </div>
  </div>
  ${fila(ctx, relacionados, { id: 'rel-titulo', titulo: 'Também lhe pode interessar' })}
</div>
${p.pedeModelo === true ? `<script type="application/json" id="dados-modelos">${JSON.stringify(ctx.modelosPorMarca).replace(/</g, '\\u003c')}</script>` : ''}`;

  const CONDICAO = { novo: 'https://schema.org/NewCondition', recondicionado: 'https://schema.org/RefurbishedCondition', usado: 'https://schema.org/UsedCondition' };
  const DISPONIVEL = { disponivel: 'https://schema.org/InStock', loja: 'https://schema.org/InStoreOnly', confirmar: 'https://schema.org/LimitedAvailability', esgotado: 'https://schema.org/OutOfStock' };
  const ldProduto = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.nome,
    description: p.resumo,
    image: p.fotos.slice(0, 4).map((f) => {
      const mm = ctx.manifesto.fotos[f];
      return ctx.absoluto(`/assets/img/${f}-${mm.resumo}-${mm.larguras[mm.larguras.length - 1]}.webp`);
    }),
    brand: { '@type': 'Brand', name: p.marca || ctx.site.marca },
    category: c.titulo,
  };
  if (v.atual !== null) {
    ldProduto.offers = {
      '@type': 'Offer',
      url: ctx.absoluto(caminho),
      priceCurrency: 'EUR',
      price: v.atual.toFixed(2),
      availability: DISPONIVEL[disp],
      itemCondition: CONDICAO[estado],
      seller: { '@id': ctx.absoluto('/#loja') },
      hasMerchantReturnPolicy: { '@type': 'MerchantReturnPolicy', applicableCountry: 'PT', returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow', merchantReturnDays: 14, returnMethod: 'https://schema.org/ReturnByMail', returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility' },
      ...(v.ate ? { priceValidUntil: v.ate } : {}),
      ...(v.anterior && /^\d{4}-\d{2}-\d{2}$/.test(p.promocaoDesde || '') ? { validFrom: p.promocaoDesde } : {}),
      ...(p.referencia ? { sku: p.referencia } : {}),
    };
  }
  if (p.referencia) ldProduto.sku = p.referencia;
  return {
    caminho,
    titulo: p.nome,
    descricao: `${p.resumo}${v.atual !== null ? ` ${temSuplementos(p) ? 'Desde ' : ''}${euros(v.atual)}.` : ''} Na ${ctx.site.marca}, em ${ctx.site.local.localidade}.`.slice(0, 160),
    tipo: 'product',
    partilha: ctx.manifesto.partilha[p.slug],
    jsonld: [m.ld, ldProduto],
    conteudo,
  };
}


// ---------------------------------------------------------------- carrinho e checkout
/* O CUPÃO: o campo e o botão «Usar»; o carrinho pergunta ao Worker (POST /cupao) e mostra o
   desconto nos totais. Fechado num <details> enquanto não há cupão (é o que quase ninguém usa). */
const cupao = (onde) => `<details class="cupao" data-cupao>
  <summary class="cupao__abrir">${icones.presente}<span>Tem um cupão?</span></summary>
  <div class="cupao__linha">
    <label class="visualmente-escondido" for="cupao-${onde}">Código do cupão</label>
    <input id="cupao-${onde}" type="text" maxlength="30" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Código" data-cupao-codigo>
    <button class="botao botao--contorno botao--pequeno" type="button" data-cupao-usar>Usar</button>
  </div>
  <p class="cupao__estado" data-cupao-estado role="status" hidden></p>
</details>`;

export function carrinho(ctx) {
  const conteudo = `<div class="contentor carrinho-pagina">
  <h1 class="titulo-pagina">Carrinho</h1>
  <div class="carrinho-pagina__grelha" data-carrinho-pagina>
    <section class="carrinho-pagina__artigos" aria-labelledby="artigos-titulo">
      <h2 id="artigos-titulo" class="visualmente-escondido">Artigos</h2>
      <div data-carrinho-lista><p class="carrinho-vazio">O carrinho está vazio. <a href="${ctx.url('/loja/')}">Ver a loja</a></p></div>
    </section>
    <aside class="carrinho-pagina__resumo" aria-labelledby="resumo-titulo" data-carrinho-resumo hidden>
      <h2 id="resumo-titulo" class="resumo__titulo">Resumo</h2>
      <fieldset class="entrega-escolha">
        <legend>Como quer receber?</legend>
        ${ctx.site.entrega.zonas.map((z, i) => `<label class="opcao-entrega"><input type="radio" name="entrega" value="${esc(z.id)}"${i === 0 ? ' checked' : ''}><span class="opcao-entrega__nome">${esc(z.nome)}</span><span class="opcao-entrega__preco" data-preco-zona="${esc(z.id)}"></span></label>`).join('\n')}
      </fieldset>
      ${cupao('carrinho')}
      <div class="totais" data-totais aria-live="polite"></div>
      <p class="comprar__erro" data-erro-carrinho role="alert" hidden></p>
      <a class="botao botao--cheio botao--largo" href="${ctx.url('/checkout/')}" data-seguir>Continuar</a>
      <p class="resumo__nota">${ctx.site.pagamentos?.modo === 'online' ? 'Pagamento seguro: cartão, MB WAY ou Multibanco.' : 'Pagamento: combinamos consigo depois de confirmar a encomenda.'}</p>
    </aside>
  </div>
  <noscript><p class="nota">O carrinho precisa de JavaScript. Pode sempre encomendar pelo <a href="${ctx.whatsapp('Olá! Gostava de fazer uma encomenda.')}">WhatsApp</a>.</p></noscript>
</div>`;
  return { caminho: '/carrinho/', titulo: 'Carrinho', descricao: 'Reveja os artigos, escolha a entrega e continue para a encomenda.', conteudo, classe: 'pagina-carrinho', indexar: false };
}

export function checkout(ctx) {
  const online = ctx.site.pagamentos?.modo === 'online';
  const conteudo = `<div class="contentor checkout">
  <h1 class="titulo-pagina">${online ? 'Pagamento' : 'Encomenda'}</h1>
  <div class="checkout__grelha" data-checkout-pagina>
    <form class="formulario checkout__form" data-checkout novalidate>
      <fieldset class="checkout__bloco">
        <legend>Os seus dados</legend>
        <div class="campo"><label for="c-nome">Nome</label><input id="c-nome" name="nome" type="text" autocomplete="name" required maxlength="80"></div>
        <div class="campos-lado">
          <div class="campo"><label for="c-email">Email</label><input id="c-email" name="email" type="email" autocomplete="email" required maxlength="120" inputmode="email"></div>
          <div class="campo"><label for="c-telefone">Telemóvel</label><input id="c-telefone" name="telefone" type="tel" autocomplete="tel" required maxlength="20" inputmode="tel"></div>
        </div>
        <div class="campo"><label for="c-nif">NIF para a factura <span class="campo__opcional">(opcional)</span></label><input id="c-nif" name="nif" type="text" inputmode="numeric" maxlength="12" autocomplete="off"></div>
      </fieldset>
      <fieldset class="checkout__bloco">
        <legend>Entrega</legend>
        ${ctx.site.entrega.zonas.map((z, i) => `<label class="opcao-entrega"><input type="radio" name="entrega" value="${esc(z.id)}"${i === 0 ? ' checked' : ''}><span class="opcao-entrega__nome">${esc(z.nome)}</span><span class="opcao-entrega__preco" data-preco-zona="${esc(z.id)}"></span></label>`).join('\n')}
        <div data-so-envio hidden>
          <div class="campo"><label for="c-morada">Morada</label><input id="c-morada" name="morada" type="text" autocomplete="street-address" maxlength="160" data-obrigatorio-envio></div>
          <div class="campos-lado">
            <div class="campo"><label for="c-cp">Código postal</label><input id="c-cp" name="codigoPostal" type="text" autocomplete="postal-code" maxlength="8" placeholder="0000-000" inputmode="numeric" data-obrigatorio-envio></div>
            <div class="campo"><label for="c-local">Localidade</label><input id="c-local" name="localidade" type="text" autocomplete="address-level2" maxlength="60" data-obrigatorio-envio></div>
          </div>
          <p class="formulario__nota">Enviamos só para Portugal Continental${ctx.site.entrega.transportadora ? `, pela ${esc(ctx.site.entrega.transportadora)}` : ''}.</p>
        </div>
        <div class="campo"><label for="c-notas">Observações <span class="campo__opcional">(opcional)</span></label><textarea id="c-notas" name="notas" rows="2" maxlength="500"></textarea></div>
      </fieldset>
      <label class="caixa caixa--termos"><input type="checkbox" name="termos" required><span>Li e aceito os <a href="${ctx.url('/termos-e-condicoes/')}" target="_blank" rel="noopener">termos e condições</a>. Posso desistir da compra em 14 dias.</span></label>
      <p class="comprar__erro" data-erro-checkout role="alert" hidden></p>
      <button class="botao botao--cheio botao--largo" type="submit" data-botao-checkout>${online ? icones.cadeado : icones.certo}<span>${online ? esc(BOTAO_ENCOMENDA) : 'Enviar encomenda'}</span></button>
      <p class="formulario__nota">${online ? 'Segue para a página segura da Stripe (cartão, MB WAY ou Multibanco). Pode desistir até pagar.' : 'Registamos a encomenda e confirmamos consigo o pagamento e a entrega, por email ou WhatsApp. A encomenda fica feita quando a confirmarmos.'}</p>
    </form>
    <aside class="checkout__resumo" aria-labelledby="c-resumo-titulo">
      <h2 id="c-resumo-titulo" class="resumo__titulo">A sua encomenda</h2>
      <div data-checkout-resumo><p class="carrinho-vazio">O carrinho está vazio. <a href="${ctx.url('/loja/')}">Ver a loja</a></p></div>
      ${cupao('checkout')}
    </aside>
  </div>
  <noscript><p class="nota">A encomenda precisa de JavaScript. Pode sempre encomendar pelo <a href="${ctx.whatsapp('Olá! Gostava de fazer uma encomenda.')}">WhatsApp</a>.</p></noscript>
</div>`;
  return { caminho: '/checkout/', titulo: online ? 'Pagamento' : 'Encomenda', descricao: 'Os seus dados, a entrega e a confirmação da encomenda.', conteudo, classe: 'pagina-checkout', indexar: false };
}

export function obrigado(ctx) {
  const conteudo = `<div class="contentor obrigado" data-obrigado>
  <div class="obrigado__cartao">
    <span class="obrigado__icone">${icones.certo}</span>
    <h1 class="titulo-pagina" data-obrigado-titulo>Obrigado!</h1>
    <p class="obrigado__texto" data-obrigado-texto>A sua encomenda ficou registada. Enviámos-lhe um email com o resumo.</p>
    <div class="obrigado__detalhe" data-obrigado-detalhe hidden></div>
    <div class="obrigado__botoes">
      <a class="botao botao--contorno" href="${ctx.url('/loja/')}">Voltar à loja</a>
      ${ctx.site.contactos.whatsapp ? `<a class="botao botao--whatsapp-suave" href="${ctx.whatsapp('Olá! Fiz uma encomenda no site e tenho uma dúvida.')}" target="_blank" rel="noopener">${icones.whatsapp}<span>Falar no WhatsApp</span></a>` : ''}
    </div>
  </div>
</div>`;
  return { caminho: '/obrigado/', titulo: 'Encomenda registada', descricao: 'A sua encomenda ficou registada.', conteudo, classe: 'pagina-obrigado', indexar: false };
}

// ---------------------------------------------------------------- páginas de texto
const ICONE_DA_NOTA = { pagamento: 'cartao', prazos: 'relogio', prazo: 'relogio', levantamento: 'local', entrega: 'camiao', envios: 'camiao', devolucoes: 'retoma' };
const chaveDe = (t) => textoSimples(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
// O HTML do Markdown partido pelos <h2>: o que vem antes e cada secção (id, título, corpo).
function seccoes(html) {
  const partes = html.split(/(?=<h2[ >])/);
  const intro = partes.length && !partes[0].startsWith('<h2') ? partes.shift().trim() : '';
  return { intro, lista: partes.map((x) => {
    const m = /^<h2(?: id="([^"]*)")?>([\s\S]*?)<\/h2>([\s\S]*)$/.exec(x.trim());
    return m ? { id: m[1] || '', titulo: m[2], corpo: m[3].trim() } : { id: '', titulo: '', corpo: x };
  }) };
}
function comoPassos(html) {
  const { intro, lista } = seccoes(html);
  const numerado = (x) => /^\d+\.\s/.test(textoSimples(x.titulo));
  const passos = lista.filter(numerado);
  const notas = lista.filter((x) => !numerado(x));
  return `${intro ? `<div class="texto__intro">${intro}</div>` : ''}
    ${passos.length ? `<ol class="passos">${passos.map((x, i) => `<li class="passo"><span class="passo__numero" aria-hidden="true">${i + 1}</span><div class="passo__texto"><h2 id="${x.id}">${x.titulo.replace(/^\d+\.\s*/, '')}</h2>${x.corpo}</div></li>`).join('')}</ol>` : ''}
    ${notas.length ? `<div class="notas">${notas.map((x) => { const ic = icones[ICONE_DA_NOTA[chaveDe(x.titulo)]]; return `<section class="nota-cartao">${ic ? `<span class="nota-cartao__icone">${ic}</span>` : ''}<h2 id="${x.id}">${x.titulo}</h2>${x.corpo}</section>`; }).join('')}</div>` : ''}`;
}
function comoPerguntas(html) {
  const { intro, lista } = seccoes(html);
  return `${intro ? `<div class="texto__intro">${intro}</div>` : ''}
    <div class="perguntas">${lista.map((x) => `<details class="pergunta"><summary><h2 class="pergunta__titulo" id="${x.id}">${x.titulo}</h2><span class="pergunta__sinal" aria-hidden="true"></span></summary><div class="pergunta__resposta">${x.corpo}</div></details>`).join('')}</div>`;
}

/* O SOBRE (modelo «sobre»): curto e direto, com a fotografia num tamanho contido (o Renato, 8 nov 2026:
   «quero algo curto e direto, e a imagem não precisa de estar gigante»). O título, a frase de abertura
   (o primeiro parágrafo), um facto por cada «##» do texto (o título e uma linha) e os botões «Como
   chegar» e «Contactos»; a fachada ao lado, no computador, e por baixo, no telemóvel. */
function paginaSobre(ctx, pag, m) {
  const { intro, lista } = seccoes(pag.html);
  const mapa = ctx.site.local?.mapa;
  return `<div class="contentor sobre">
  <div class="sobre__grelha">
    <div class="sobre__texto">
      <h1 class="titulo-pagina">${esc(pag.titulo)}</h1>
      ${intro ? `<div class="sobre__abertura">${intro}</div>` : ''}
      ${lista.length ? `<ul class="sobre__factos">${lista.map((x) => `<li><h2 id="${x.id}">${x.titulo}</h2>${x.corpo}</li>`).join('')}</ul>` : ''}
      <div class="sobre__botoes">
        ${mapa ? `<a class="botao botao--cheio" href="${esc(mapa)}" target="_blank" rel="noopener">${icones.local}<span>Como chegar</span></a>` : ''}
        <a class="botao botao--contorno" href="${ctx.url('/contactos/')}">Contactos</a>
      </div>
    </div>
    ${pag.foto ? `<figure class="sobre__foto">${imagem(ctx, pag.foto, { tamanhos: '(min-width: 900px) 420px, 100vw', foco: '50% 55%' })}</figure>` : ''}
  </div>
</div>`;
}

export function texto(ctx, pag) {
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: pag.titulo, caminho: pag.caminho }]);
  if (pag.modelo === 'sobre') return { caminho: pag.caminho, titulo: pag.tituloSeo || pag.titulo, descricao: pag.descricao, indexar: pag.indexar, jsonld: [m.ld], conteudo: paginaSobre(ctx, pag, m) };
  const legal = Boolean(pag.atualizado);
  const data = legal ? `Atualizado a ${new Date(`${pag.atualizado}T12:00:00Z`).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Lisbon' })}` : '';
  const corpo = pag.modelo === 'passos' ? comoPassos(pag.html) : pag.modelo === 'perguntas' ? comoPerguntas(pag.html) : pag.html;
  const conteudo = `<div class="contentor texto-pagina${pag.modelo ? ` texto-pagina--${esc(pag.modelo)}` : ''}${legal ? ' texto-pagina--legal' : ''}">
  ${cabecaDePagina(ctx, { titulo: pag.titulo, sub: pag.subtitulo, data })}
  <article class="texto">
    ${pag.foto ? `<figure class="texto__foto">${imagem(ctx, pag.foto, { tamanhos: '(min-width: 900px) 720px, 100vw' })}</figure>` : ''}
    ${corpo}
  </article>
  ${pag.modelo === 'perguntas' ? convite(ctx) : ''}
</div>`;
  return { caminho: pag.caminho, titulo: pag.tituloSeo || pag.titulo, descricao: pag.descricao, indexar: pag.indexar, jsonld: [m.ld], conteudo };
}

/* OS CONTACTOS (8 nov 2026, «melhora a página de contactos»): três cartões para falar connosco (o WhatsApp
   à cabeça, só a ligação; o telefone com a nota da chamada; o email), a loja com o mapa visível logo ao
   abrir (desenhado pelo próprio site, scripts/mapa.mjs: sem o Google, sem cookies, sem esperar), a
   morada e o horário, e as redes numa linha. Tocar no mapa abre o Google Maps (a ligação «Como chegar»). */
export function contactos(ctx) {
  const c = ctx.site.contactos;
  const e = ctx.site.empresa;
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: 'Contactos', caminho: '/contactos/' }]);
  const tel = numeroPortugues(c.telefone);
  const cartoes = [];
  cartoes.push(c.whatsapp
    ? `<li class="contacto-cartao contacto-cartao--whatsapp"><span class="contacto-cartao__icone">${icones.whatsapp}</span><h2 class="contacto-cartao__nome">WhatsApp</h2><p class="contacto-cartao__texto">É por aqui que respondemos mais depressa.</p><a class="botao botao--whatsapp" href="${ctx.whatsapp('Olá!')}" target="_blank" rel="noopener">Enviar mensagem</a></li>`
    : `<li class="contacto-cartao"><h2 class="contacto-cartao__nome">WhatsApp</h2><p>${ctx.marcador('o número de WhatsApp')}</p></li>`);
  if (tel) cartoes.push(`<li class="contacto-cartao"><span class="contacto-cartao__icone">${icones.telefone}</span><h2 class="contacto-cartao__nome">Telefone</h2><p class="contacto-cartao__valor"><a href="tel:+351${tel}">${esc(numeroLegivel(tel))}</a></p><p class="contacto-cartao__texto">${notaChamada(tel)}</p></li>`);
  cartoes.push(`<li class="contacto-cartao"><span class="contacto-cartao__icone">${icones.email}</span><h2 class="contacto-cartao__nome">Email</h2><p class="contacto-cartao__valor">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ctx.marcador('o email da loja')}</p></li>`);

  const mapaUrl = ctx.site.local.mapa;
  const mapa = ctx.mapaLoja
    ? `<figure class="mapa-loja">
      ${ctx.mapaLoja}
      ${mapaUrl ? `<a class="mapa-loja__ligacao" href="${esc(mapaUrl)}" target="_blank" rel="noopener"><span class="mapa-loja__abrir">${icones.local}<span>Como chegar</span><span class="visualmente-escondido"> (abre o Google Maps)</span></span></a>` : ''}
      <figcaption class="mapa-loja__credito"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></figcaption>
    </figure>`
    : (mapaUrl ? `<p><a class="botao botao--cheio" href="${esc(mapaUrl)}" target="_blank" rel="noopener">Como chegar${icones.externo}</a></p>` : '');

  const redes = [];
  if (c.instagram) redes.push(`<li><a class="pilula" href="https://www.instagram.com/${esc(c.instagram)}/" target="_blank" rel="noopener">${icones.instagram}<span>@${esc(c.instagram)}</span></a></li>`);
  if (c.facebook) redes.push(`<li><a class="pilula" href="https://www.facebook.com/${esc(c.facebook)}/" target="_blank" rel="noopener">${icones.facebook}<span>Facebook</span></a></li>`);
  const g = ctx.site.google || {};
  if (g.ligacao) redes.push(`<li><a class="pilula" href="${esc(g.ligacao)}" target="_blank" rel="noopener">${icones.estrela}<span>${g.nota ? `${esc(String(g.nota).replace('.', ','))} no Google` : 'Opiniões no Google'}${g.opinioes ? ` · ${g.opinioes} opiniões` : ''}</span></a></li>`);

  const conteudo = `<div class="contentor contactos-pagina">
  ${cabecaDePagina(ctx, { titulo: 'Contactos' })}
  <ul class="contactos-cartoes">${cartoes.join('')}</ul>
  <section class="contactos-loja" aria-labelledby="loja-titulo">
    ${mapa}
    <div class="contactos-loja__dados">
      <h2 class="contactos-loja__titulo" id="loja-titulo">A loja</h2>
      ${moradaHtml(ctx)}
      <h3 class="contactos-loja__rotulo">Horário</h3>
      ${horarioHtml(ctx)}
    </div>
  </section>
  ${redes.length ? `<ul class="contactos-redes" aria-label="Redes sociais e opiniões">${redes.join('')}</ul>` : ''}
</div>`;
  return { caminho: '/contactos/', titulo: 'Contactos', descricao: `Fale com a ${ctx.site.marca}: WhatsApp, ${tel ? 'telefone, ' : ''}email, Instagram e Facebook. ${e.morada ? `${e.morada}, ` : ''}${ctx.site.local.localidade}, ${ctx.site.local.concelho}.`, jsonld: [m.ld, organizacao(ctx)], conteudo };
}

export function erro404(ctx) {
  const conteudo = `<div class="contentor erro">
  ${cabecaDePagina(ctx, { titulo: 'Esta página não existe', sub: 'Pode ter mudado de sítio, ou o endereço tem um erro. Experimente procurar lá em cima.' })}
  <p class="erro__loja">${botaoSeta(ctx.url('/loja/'), 'Ver toda a loja', { classe: 'botao botao--cheio' })} ${botaoSeta(ctx.url('/reparacoes/'), 'Reparações')} ${botaoSeta(ctx.url('/retoma/'), 'Retoma')}</p>
</div>`;
  return { caminho: '/404.html', titulo: 'Página não encontrada', descricao: 'Esta página não existe.', conteudo };
}

/* O fabricante de um artigo, quando o painel o diz por inteiro (nome, morada e email); senão null,
   e a ficha diz a loja. */
export function fabricanteDoArtigo(p) {
  const f = p.fabricante;
  if (!f || typeof f !== 'object') return null;
  const ok = ['nome', 'morada', 'email'].every((k) => typeof f[k] === 'string' && f[k].trim());
  return ok ? { nome: f.nome.trim(), morada: f.morada.trim(), email: f.email.trim() } : null;
}
/* Os avisos de segurança de um artigo: um por linha do campo. */
export const avisosDoArtigo = (p) => String(typeof p.avisos === 'string' ? p.avisos : '').split(/\n+/).map((t) => t.trim()).filter(Boolean);

// usada pelo build para as páginas de texto com o quadro dos portes
export { inline };
