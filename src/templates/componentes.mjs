// Peças repetidas: imagens, preços, cartões de artigo e de serviço, migalhas, botões, a faixa de
// confiança, o horário, e as peças legais comuns.
import { esc, euros, precoDe, dataPorExtenso, numeroWhatsApp } from './util.mjs';
import { icones, iconeServico } from './icones.mjs';
import { temSuplementos, estadoDe, disponibilidadeDe, compravel, ESTADOS, linhasDe } from '../lib/regras.mjs';
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
   baixo dos 30 dias anteriores ao início — que é, por lei, o preço riscado. Só com a data de início. */
export function promocaoNota(ctx, p) {
  const v = precoDe(p, ctx.hoje);
  const desde = typeof p.promocaoDesde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.promocaoDesde) ? p.promocaoDesde : '';
  if (!v.anterior || !v.ate || !desde) return '';
  const mesmoAno = desde.slice(0, 4) === v.ate.slice(0, 4);
  return `<p class="preco__promocao">Promoção de ${dataPorExtenso(desde, !mesmoAno)} a ${dataPorExtenso(v.ate, true)} · preço mais baixo nos 30 dias anteriores: ${euros(v.anterior)}</p>`;
}

// <picture> com AVIF + WebP em várias larguras. «tamanhos» é o atributo sizes: diz ao browser
// a largura em que a imagem vai aparecer, para escolher a versão certa.
export function imagem(ctx, nome, { tamanhos = '100vw', classe = '', prioridade = false, alt, foco, proporcao } = {}) {
  const m = ctx.manifesto.fotos[nome] || ctx.manifesto.posters[nome];
  if (!m) throw new Error(`imagem «${nome}» não existe em media/fotos (nem é a capa de um vídeo)`);
  const info = ctx.fotos[nome] || {};
  const texto = alt ?? info.alt ?? '';
  const ponto = foco ?? info.foco ?? '50% 50%';
  const srcset = (fmt) => m.larguras.map((w) => `${ctx.asset(`img/${nome}-${m.resumo}-${w}.${fmt}`)} ${w}w`).join(', ');
  const fontes = m.formatos.filter((f) => f !== 'webp').map((f) => `<source type="image/${f}" srcset="${srcset(f)}" sizes="${tamanhos}">`).join('');
  const meio = m.larguras.find((w) => w >= 720) || m.larguras[m.larguras.length - 1];
  const estilo = [ponto !== '50% 50%' ? `object-position:${ponto}` : '', proporcao ? `aspect-ratio:${proporcao}` : ''].filter(Boolean).join(';');
  return `<picture class="${esc(classe)}">${fontes}<img src="${ctx.asset(`img/${nome}-${m.resumo}-${meio}.webp`)}" srcset="${srcset('webp')}" sizes="${tamanhos}" width="${m.largura}" height="${m.altura}" alt="${esc(texto)}"${prioridade ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"${estilo ? ` style="${estilo}"` : ''}></picture>`;
}

/* O estado de um artigo, como se mostra: «Recondicionado · Grade A+» (a grade vem das
   características, se lá estiver). Um artigo novo não leva etiqueta. */
export function estadoRotulo(p) {
  const estado = estadoDe(p);
  if (estado === 'novo') return '';
  const grade = linhasDe(p.caracteristicas).find((t) => /^grade\s/i.test(t));
  return grade ? `${ESTADOS[estado]} · ${grade}` : ESTADOS[estado];
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

// Cartão de artigo: a fotografia (quadrada, cortada pelo ponto de foco), a marca ou o estado em
// letra pequena, o nome e o preço. O cartão inteiro leva ao artigo (a ligação do nome estende-se por
// cima dele com ::after — nunca display:contents, que tira o foco do teclado).
export function cartaoProduto(ctx, p, { tamanhos = '(min-width: 1100px) 22vw, (min-width: 700px) 30vw, 46vw', titulo = 'h3' } = {}) {
  const pct = desconto(ctx, p);
  const segunda = p.fotos[1];
  const estado = estadoRotulo(p);
  const disp = disponibilidadeRotulo(p);
  const selos = [
    pct ? `<span class="selo selo--promocao">−${pct}%</span>` : '',
    p.novidade ? '<span class="selo selo--novidade">Novidade</span>' : '',
    disponibilidadeDe(p) === 'esgotado' ? '<span class="selo selo--esgotado">Esgotado</span>' : '',
  ].filter(Boolean).join('');
  const etiqueta = estado || p.marca || '';
  return `<article class="cartao${disponibilidadeDe(p) === 'esgotado' ? ' cartao--esgotado' : ''}">
  <div class="cartao__foto">${imagem(ctx, p.fotos[0], { tamanhos, classe: 'cartao__img' })}${segunda ? imagem(ctx, segunda, { tamanhos, classe: 'cartao__img cartao__img--outra', alt: '' }) : ''}${selos ? `<div class="cartao__selos">${selos}</div>` : ''}</div>
  ${etiqueta ? `<p class="cartao__etiqueta">${esc(etiqueta)}</p>` : ''}
  <${titulo} class="cartao__nome"><a class="cartao__ligacao" href="${ctx.url(`/produtos/${p.slug}/`)}">${esc(p.nome)}</a></${titulo}>
  <div class="cartao__pe">${preco(ctx, p)}${disp && disp !== 'Esgotado' ? `<span class="cartao__disp">${esc(disp)}</span>` : ''}</div>
</article>`;
}

/* Cartão de um serviço de reparação: o desenho, o nome, a frase, o que se faz e o botão que abre o
   WhatsApp com o pedido escrito («Olá! Gostava de um orçamento para … »). */
export function cartaoServico(ctx, s, { titulo = 'h3' } = {}) {
  const itens = linhasDe(s.itens);
  const texto = `Olá! Gostava de um orçamento para ${s.nome.toLowerCase()}. Equipamento: \nAvaria: `;
  return `<article class="servico" id="servico-${esc(s.slug)}">
  <span class="servico__icone">${iconeServico(s.icone)}</span>
  <div class="servico__corpo">
    <${titulo} class="servico__nome">${esc(s.nome)}</${titulo}>
    ${s.resumo ? `<p class="servico__resumo">${esc(s.resumo)}</p>` : ''}
    ${itens.length ? `<ul class="servico__itens">${itens.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <div class="servico__pe">
      ${s.preco ? `<span class="servico__preco">${esc(s.preco)}</span>` : ''}
      ${ctx.site.contactos.whatsapp ? `<a class="botao botao--pequeno botao--contorno" href="${ctx.whatsapp(texto)}" target="_blank" rel="noopener">${icones.whatsapp}<span>Pedir orçamento</span></a>` : ''}
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

/* A CABEÇA DAS PÁGINAS: as migalhas, uma palavra pequena por cima (a categoria, «Reparações»), o
   título e um subtítulo curto — ou, nas páginas legais, a data. À esquerda, como no resto do site. */
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

/* A FAIXA DE CONFIANÇA (por baixo da capa e no fim das fichas): o que a loja tem para mostrar sem
   inventar nada — a nota do Google com a ligação para quem quiser conferir (o número é do dono, no
   painel), as reparações desde 2020, os envios em 24/48 h, o orçamento gratuito e a DIGI. As opiniões
   em si não se copiam para o site (DL 57/2008, art. 8.º, al. cc). */
export function faixaConfianca(ctx) {
  const g = ctx.site.google || {};
  const itens = [];
  if (g.nota && g.ligacao) itens.push(`<li><a class="faixa__google" href="${esc(g.ligacao)}" target="_blank" rel="noopener">${icones.estrela}<strong>${esc(String(g.nota).replace('.', ','))}</strong><span>${g.opinioes ? `${g.opinioes} opiniões no Google` : 'no Google'}</span></a></li>`);
  itens.push(`<li>${icones.ferramentas}<span>Reparações desde 2020</span></li>`);
  itens.push(`<li>${icones.documento}<span>Orçamento gratuito</span></li>`);
  itens.push(`<li>${icones.camiao}<span>Envios em 24/48 h úteis</span></li>`);
  if (ctx.site.parcerias?.digi) itens.push(`<li>${icones.certo}<span>Vendedor Oficial DIGI</span></li>`);
  return `<ul class="faixa" aria-label="Porquê a LF Mobile">${itens.join('')}</ul>`;
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
export function convite(ctx, { titulo = 'Uma dúvida? Fale connosco.', texto = 'Olá! Tenho uma dúvida.' } = {}) {
  const c = ctx.site.contactos;
  return `<aside class="convite" aria-label="Fale connosco">
  <p class="convite__titulo">${esc(titulo)}</p>
  <div class="convite__botoes">
    ${c.whatsapp ? `<a class="botao botao--whatsapp-suave" href="${ctx.whatsapp(texto)}" target="_blank" rel="noopener">${icones.whatsapp}<span>Falar no WhatsApp</span></a>` : ''}
    <a class="botao botao--contorno" href="${ctx.url('/contactos/')}">Contactos</a>
  </div>
</aside>`;
}

/* As categorias com artigos no site (a de «Outros» some sozinha quando não tem nada). */
export const categoriasComArtigos = (ctx) => ctx.categorias.filter((c) => ctx.produtos.some((p) => p.categoria === c.slug));

/* A ligação do WhatsApp sem texto: o número da loja, em dígitos. */
export const whatsappNumero = (ctx) => numeroWhatsApp(ctx.site.contactos.whatsapp);

export { compravel };
