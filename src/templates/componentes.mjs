// Peças repetidas: imagens (com o recorte), preços, cartões de artigo, selos, migalhas, botões, o
// horário e as peças legais comuns.
import { esc, euros, precoDe, dataPorExtenso, numeroWhatsApp } from './util.mjs';
import { icones } from './icones.mjs';
import { temSuplementos, estadoDe, disponibilidadeDe, compravel, ESTADOS, linhasDe, categoriasDoArtigo } from '../lib/regras.mjs';
import { livroReclamacoes, VERSAO as LEGAL_COMUM_VERSAO } from '../../legal-comum/index.mjs';

/* AS PEÇAS DA BIBLIOTECA legal-comum (a cópia está em legal-comum/, instalada por
   _ferramentas/legal-comum/instalar.mjs; não se edita aqui), entre os marcadores que o
   verificar-versoes.mjs dela procura nas páginas publicadas:
   <!-- legal-comum:<peça> v<versão> --> … <!-- /legal-comum:<peça> --> */
export const pecaLegal = (nome, html) => `<!-- legal-comum:${nome} v${LEGAL_COMUM_VERSAO} -->${html}<!-- /legal-comum:${nome} -->`;

/* A ligação ao Livro de Reclamações Electrónico, com o ícone (DL 156/2005, art. 5.º-B, n.º 2), na
   variante DISCRETA da biblioteca (o Renato, 22 out 2026: nada de botão com caixa): a letra, o tamanho e
   a cor das ligações vizinhas. Só no rodapé (27 out 2026: «só devia aparecer no Rodapé»). */
export const livroBotao = () => pecaLegal('livro', livroReclamacoes());

/* A nota legal da promoção, por baixo do preço da ficha (DL 70/2007, art. 5.º): o período e o preço mais
   baixo dos 30 dias anteriores ao início — que é, por lei, o preço riscado. Só com a data de início
   (as campanhas têm-na sempre). */
export function promocaoNota(ctx, p) {
  const v = precoDe(p, ctx.hoje);
  const desde = typeof p.promocaoDesde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.promocaoDesde) ? p.promocaoDesde : '';
  if (!v.anterior || !v.ate || !desde) return '';
  const mesmoAno = desde.slice(0, 4) === v.ate.slice(0, 4);
  return `<p class="preco__promocao">${p.campanha ? `${esc(campanhaDe(ctx, p)?.nome || 'Campanha')}: ` : 'Promoção '}de ${dataPorExtenso(desde, !mesmoAno)} a ${dataPorExtenso(v.ate, true)} · preço mais baixo nos 30 dias anteriores: ${euros(v.anterior)}</p>`;
}
export const campanhaDe = (ctx, p) => (p && p.campanha ? ctx.campanhas.find((c) => c.slug === p.campanha) || null : null);

// <picture> com AVIF + WebP em várias larguras. «tamanhos» é o atributo sizes: diz ao browser a
// largura em que a imagem vai aparecer, para escolher a versão certa. Com «recorte», usa o recorte
// da fotografia (sem fundo) quando o há.
export function imagem(ctx, nome, { tamanhos = '100vw', classe = '', prioridade = false, alt, foco, proporcao, recorte = false } = {}) {
  const r = recorte ? ctx.manifesto.recortes?.[nome] : null;
  const m = r || ctx.manifesto.fotos[nome] || ctx.manifesto.posters[nome];
  if (!m) throw new Error(`imagem «${nome}» não existe em media/fotos (nem é a capa de um vídeo)`);
  const info = ctx.fotos[nome] || {};
  const texto = alt ?? info.alt ?? '';
  const base = r ? `recorte-${nome}` : nome;
  const ponto = r ? '50% 50%' : (foco ?? info.foco ?? '50% 50%');
  const srcset = (fmt) => m.larguras.map((w) => `${ctx.asset(`img/${base}-${m.resumo}-${w}.${fmt}`)} ${w}w`).join(', ');
  const fontes = m.formatos.filter((f) => f !== 'webp').map((f) => `<source type="image/${f}" srcset="${srcset(f)}" sizes="${tamanhos}">`).join('');
  const meio = m.larguras.find((w) => w >= (r ? 480 : 720)) || m.larguras[m.larguras.length - 1];
  const estilo = [ponto !== '50% 50%' ? `object-position:${ponto}` : '', proporcao ? `aspect-ratio:${proporcao}` : ''].filter(Boolean).join(';');
  return `<picture class="${esc([classe, r ? 'recorte' : ''].filter(Boolean).join(' '))}">${fontes}<img src="${ctx.asset(`img/${base}-${m.resumo}-${meio}.webp`)}" srcset="${srcset('webp')}" sizes="${tamanhos}" width="${m.largura}" height="${m.altura}" alt="${esc(texto)}"${prioridade ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"${estilo ? ` style="${estilo}"` : ''}></picture>`;
}
export const temRecorte = (ctx, nome) => Boolean(ctx.manifesto.recortes?.[nome]);

/* O estado de um artigo, como se mostra: «Recondicionado · Grade A+» (a grade vem das
   características, se lá estiver). Um artigo novo não leva etiqueta. */
/* O estado por cima do nome, na ficha: «Recondicionado». A grade não entra: já está nas pílulas por baixo do
   nome (especificacoes), e aparecia duas vezes («Apple · Recondicionado · Grade A+» e «Grade A+»). */
export function estadoRotulo(p) {
  const estado = estadoDe(p);
  if (estado === 'novo') return '';
  return ESTADOS[estado];
}

/* A linha das especificações do cartão: a capacidade, a bateria e a grade, quando as características
   as dizem («128 GB · Bateria a 89 % · Grade A+»). */
export function especificacoes(p) {
  const l = linhasDe(p.caracteristicas);
  const cap = l.find((t) => /\b\d+\s?(GB|TB)\b/i.test(t));
  const bat = l.find((t) => /bateria/i.test(t));
  const grade = l.find((t) => /^grade\s/i.test(t));
  return [cap && cap.replace(/\s*de armazenamento/i, ''), bat, grade].filter(Boolean);
}

/* A disponibilidade, em palavras curtas (o cartão e a ficha). «Disponível» não se escreve: é o
   normal, e «em stock» lê-se «sem stock» à pressa (memória mensagens-ao-cliente-so-o-necessario). */
export function disponibilidadeRotulo(p) {
  return { confirmar: 'Confirmar disponibilidade', loja: 'Só na loja', esgotado: 'Esgotado' }[disponibilidadeDe(p)] || '';
}

// O preço como se mostra: o de hoje, e o anterior riscado quando há promoção. «Desde» quando
// uma escolha pode fazer o preço subir. Sem preço: «sob consulta» num artigo a confirmar (pergunta-se
// pelo WhatsApp); nos outros, na pré-visualização, a marca «por confirmar» (no domínio o artigo nem
// chega aqui: está escondido).
export function preco(ctx, p, { grande = false } = {}) {
  const v = precoDe(p, ctx.hoje);
  const classe = `preco${grande ? ' preco--grande' : ''}`;
  if (v.atual === null) return disponibilidadeDe(p) === 'confirmar' ? `<p class="${classe} preco--consulta">Preço sob consulta</p>` : `<p class="${classe} preco--por-confirmar">Preço por confirmar</p>`;
  const desde = temSuplementos(p) ? '<span class="preco__desde">Desde </span>' : '';
  const atual = `<span class="preco__atual">${desde}${euros(v.atual)}</span>`;
  if (!v.anterior) return `<p class="${classe}">${atual}</p>`;
  return `<p class="${classe} preco--promocao">${atual} <s class="preco__antes"><span class="visualmente-escondido">em vez de </span>${euros(v.anterior)}</s></p>`;
}

export function desconto(ctx, p) {
  const v = precoDe(p, ctx.hoje);
  if (!v.anterior || v.atual === null) return '';
  return Math.round((1 - v.atual / v.anterior) * 100);
}

export function promocaoAte(ctx, p) {
  const v = precoDe(p, ctx.hoje);
  return v.anterior && v.ate ? `Promoção até ${dataPorExtenso(v.ate)}` : '';
}

/* O CARTÃO DE ARTIGO, como numa loja de electrónica: a imagem num poço claro (o recorte, sem fundo,
   quando o há; senão a fotografia a encher o poço), os selos (o desconto, a campanha, a novidade), a
   marca e o estado em letra pequena, o nome, as especificações numa linha e, em baixo, o preço e uma
   seta. O cartão inteiro leva ao artigo (a ligação do nome estende-se por cima dele com ::after), e
   compra-se lá dentro: o botão do carrinho e o «Escolher» saíram dos cartões a 13 nov 2026 (o Renato:
   «se calhar é melhor só comprar quando se vai ver dentro do produto»). Os data-* servem os filtros e a
   ordem da loja (loja.js). */
export function cartaoProduto(ctx, p, { tamanhos = '(min-width: 1200px) 260px, (min-width: 700px) 30vw, 46vw', titulo = 'h3' } = {}) {
  const pct = desconto(ctx, p);
  const camp = campanhaDe(ctx, p);
  const disp = disponibilidadeDe(p);
  const v = precoDe(p, ctx.hoje);
  const selos = [
    pct ? `<span class="selo selo--desconto">−${pct}%</span>` : '',
    camp ? `<span class="selo selo--campanha">${esc(camp.nome)}</span>` : '',
    p.novidade ? '<span class="selo selo--novidade">Novidade</span>' : '',
    disp === 'esgotado' ? '<span class="selo selo--esgotado">Esgotado</span>' : '',
  ].filter(Boolean).join('');
  const recorte = temRecorte(ctx, p.fotos[0]);
  const estado = estadoDe(p);
  const marca = [p.marca, estado !== 'novo' ? ESTADOS[estado] : ''].filter(Boolean).join(' · ');
  const specs = especificacoes(p);
  const dispTexto = disponibilidadeRotulo(p);
  return `<article class="cartao${disp === 'esgotado' ? ' cartao--esgotado' : ''}" data-artigo="${esc(p.slug)}" data-categoria="${esc(p.categoria)}" data-marca="${esc((p.marca || '').toLowerCase())}" data-estado="${esc(estado)}" data-preco="${v.atual ?? ''}" data-ordem="${p.ordem ?? 500}" data-compravel="${compravel(p) ? 'sim' : 'nao'}" data-texto="${esc(`${p.nome} ${p.marca || ''} ${p.resumo || ''}`.toLowerCase())}">
  <div class="cartao__foto${recorte ? ' cartao__foto--recorte' : ''}">${imagem(ctx, p.fotos[0], { tamanhos, classe: 'cartao__img', recorte: true })}</div>
  ${selos ? `<div class="cartao__selos">${selos}</div>` : ''}
  <div class="cartao__corpo">
    ${marca ? `<p class="cartao__marca">${esc(marca)}</p>` : ''}
    <${titulo} class="cartao__nome"><a class="cartao__ligacao" href="${ctx.url(`/produtos/${p.slug}/`)}">${esc(p.nome)}</a></${titulo}>
    ${specs.length ? `<p class="cartao__specs">${specs.map(esc).join(' · ')}</p>` : ''}
    <div class="cartao__pe">
      <div class="cartao__precos">${preco(ctx, p)}${dispTexto && disp !== 'esgotado' ? `<span class="cartao__disp">${esc(dispTexto)}</span>` : ''}</div>
      <span class="cartao__seta" aria-hidden="true">${icones.seta}</span>
    </div>
  </div>
</article>`;
}

export function migalhas(ctx, itens) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: itens.map((i, n) => ({ '@type': 'ListItem', position: n + 1, name: i.nome, item: ctx.absoluto(i.caminho) })),
  };
  const html = `<nav class="migalhas" aria-label="Está aqui"><ol>${itens
    .map((i, n) => (n === itens.length - 1 ? `<li><span aria-current="page">${esc(i.nome)}</span></li>` : `<li><a href="${ctx.url(i.caminho)}">${esc(i.nome)}</a></li>`))
    .join('')}</ol></nav>`;
  return { html, ld };
}

// Botão-ligação com uma seta discreta à direita
export function botaoSeta(href, texto, { classe = 'botao botao--contorno', externo = false } = {}) {
  return `<a class="${classe}" href="${esc(href)}"${externo ? ' target="_blank" rel="noopener"' : ''}><span>${esc(texto)}</span>${icones.seta}</a>`;
}

/* A CABEÇA DAS PÁGINAS: as migalhas, uma palavra pequena por cima, o título e um subtítulo curto — ou,
   nas páginas legais, a data. */
export function cabecaDePagina(ctx, { migalhas = '', sobre = '', titulo, sub = '', data = '', extra = '' }) {
  return `<header class="cabeca">
  ${migalhas}
  ${sobre ? `<p class="cabeca__sobre">${esc(sobre)}</p>` : ''}
  <h1 class="titulo-pagina">${esc(titulo)}</h1>
  ${sub ? `<p class="cabeca__sub">${esc(sub)}</p>` : ''}
  ${data ? `<p class="cabeca__data">${esc(data)}</p>` : ''}
  ${extra}
</header>`;
}

/* O horário, como lista de linhas (dias e horas). */
export function horarioHtml(ctx, { classe = 'horario' } = {}) {
  const h = Array.isArray(ctx.site.horario) ? ctx.site.horario.filter((l) => l && l.dias && l.horas) : [];
  if (!h.length) return `<p class="${classe}">${ctx.marcador('o horário da loja')}</p>`;
  return `<dl class="${classe}">${h.map((l) => `<div><dt>${esc(l.dias)}</dt><dd>${esc(l.horas)}</dd></div>`).join('')}</dl>`;
}

/* A morada da loja em linhas: a rua, o código postal e a localidade, o concelho. */
export function moradaHtml(ctx) {
  const e = ctx.site.empresa;
  const rua = e.morada ? esc(e.morada) : ctx.marcador('a rua e o número');
  const cp = [e.codigoPostal, e.localidade].filter(Boolean).join(' ');
  return `<p class="morada">${rua}<br>${cp ? esc(cp) : ctx.marcador('o código postal')}${e.concelho ? `<br>${esc(e.concelho)}` : ''}</p>`;
}

/* O convite no fim das páginas que não são legais: uma linha e dois botões. */
export function convite(ctx, { titulo = 'Uma dúvida? Fale connosco.', texto = 'Olá! Tenho uma dúvida.', contactos = true } = {}) {
  const c = ctx.site.contactos;
  return `<aside class="convite" aria-label="Fale connosco">
  <p class="convite__titulo">${esc(titulo)}</p>
  <div class="convite__botoes">
    ${c.whatsapp ? `<a class="botao botao--whatsapp" href="${ctx.whatsapp(texto)}" target="_blank" rel="noopener">${icones.whatsapp}<span>Falar no WhatsApp</span></a>` : ''}
    ${contactos ? `<a class="botao botao--contorno" href="${ctx.url('/contactos/')}">Contactos</a>` : ''}
  </div>
</aside>`;
}

/* A nota «por confirmar» dos preços e valores que vieram do mercado (só na pré-visualização). */
export const notaPorConfirmar = (ctx, texto) => `<p class="nota-confirmar">${icones.info}<span>${ctx.marcador(texto)}</span></p>`;

/* Uma fila de cartões que desliza (telemóvel) com as setas (computador). */
export function fila(ctx, produtos, { id, titulo, ligacao = '', textoLigacao = 'Ver todos', sub = '' }) {
  if (!produtos.length) return '';
  return `<section class="fila" aria-labelledby="${id}">
  <div class="seccao__cabeca">
    <div>
      <h2 class="titulo-seccao" id="${id}">${esc(titulo)}</h2>
      ${sub ? `<p class="seccao__texto">${esc(sub)}</p>` : ''}
    </div>
    <div class="fila__controlo">
      ${ligacao ? `<a class="botao botao--texto" href="${ctx.url(ligacao)}">${esc(textoLigacao)}${icones.seta}</a>` : ''}
      <button class="fila__seta" type="button" data-fila-anterior aria-label="Anteriores">${icones.setaEsq}</button>
      <button class="fila__seta" type="button" data-fila-seguinte aria-label="Seguintes">${icones.seta}</button>
    </div>
  </div>
  <div class="fila__pista" data-fila tabindex="0" role="region" aria-label="${esc(titulo)}">
    ${produtos.map((p) => cartaoProduto(ctx, p)).join('\n')}
  </div>
</section>`;
}

/* As categorias com artigos no site. */
export const categoriasComArtigos = (ctx) => ctx.categorias.filter((c) => ctx.produtos.some((p) => categoriasDoArtigo(p, ctx.categorias).includes(c.slug)));
/* AS CATEGORIAS EM DOIS NÍVEIS (o esquema do Leandro, 13 nov 2026): as de cima (sem mãe: Telemóveis, Tablets,
   Computadores, Gadgets, Casa, Kids, Acessórios, Encomendas mistério) e as filhas de uma (Apple, Samsung…). TODAS,
   mesmo as que ainda não têm artigos (o Leandro: «precisava que tivesse aquelas categorias e subcategorias todas»):
   a página de uma vazia diz que ainda não há e oferece a encomenda, e fica fora do Google até ter artigos. A fila
   redonda da página inicial é que só mostra as que têm artigos e não têm filhas com artigos (leva fotografias). */
export const categoriasDeCima = (ctx) => ctx.categorias.filter((c) => !c.grupo);
export const filhasDe = (ctx, slug) => ctx.categorias.filter((c) => c.grupo === slug);
export const categoriasSemFilhas = (ctx) => { const cs = categoriasComArtigos(ctx); return cs.filter((c) => !cs.some((x) => x.grupo === c.slug)); };

/* A ligação do WhatsApp sem texto: o número da loja, em dígitos. */
export const whatsappNumero = (ctx) => numeroWhatsApp(ctx.site.contactos.whatsapp);

export { compravel };
