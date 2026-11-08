// As páginas do site. Cada função devolve { caminho, titulo, descricao, conteudo, ... } e o
// build.mjs veste-a com a moldura (layout.mjs).
import { esc, euros, precoDe, markdown, inline, textoSimples, numeroWhatsApp, numeroLegivel, notaChamada, moradaCompleta } from './util.mjs';
import { icones, iconeServico } from './icones.mjs';
import { numeroPortugues, opcoesDe, temSuplementos, estadoDe, disponibilidadeDe, compravel, enviavel, linhasDe, GARANTIAS_USADOS } from '../lib/regras.mjs';
import { imagem, preco, cartaoProduto, cartaoServico, migalhas, botaoSeta, desconto, promocaoAte, cabecaDePagina, convite, promocaoNota, faixaConfianca, horarioHtml, moradaHtml, estadoRotulo, disponibilidadeRotulo, categoriasComArtigos } from './componentes.mjs';
import { fachadaMapa, textoGarantia } from '../../legal-comum/index.mjs';

const produtosDe = (ctx, cat) => ctx.produtos.filter((p) => p.categoria === cat);
const categoriaDe = (ctx, slug) => ctx.categorias.find((c) => c.slug === slug);
const paragrafos = (t) => String(t || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');

/* A primeira frase do prazo de entrega (mostra-se na ficha e no carrinho). Sem prazo dito, a marca
   «por confirmar» (em produção a construção pára antes). */
const prazoCurto = (ctx) => String(ctx.site.entrega.prazo || '').trim().split(/(?<=\.)\s+/)[0];
const portesCurto = (ctx) => {
  const p = ctx.site.entrega.portes || {};
  return Number.isFinite(p.continente) ? `Portes de ${euros(p.continente)} para Portugal Continental` : 'Portes para Portugal Continental a confirmar';
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

// ---------------------------------------------------------------- página inicial
export function inicio(ctx) {
  const h = ctx.inicio;
  const c = ctx.site.contactos;

  /* A CAPA: as palavras à esquerda e uma fotografia da loja à direita, num cartão de cantos redondos
     (o letreiro iluminado da LF Mobile). Nada por cima da fotografia: o texto tem o seu chão branco. */
  const capa = `<section class="capa" aria-labelledby="capa-titulo">
  <div class="capa__palavras">
    <p class="capa__local">${icones.local}<span>${esc(ctx.site.local.localidade)} · ${esc(ctx.site.local.concelho)}</span></p>
    <h1 class="capa__titulo" id="capa-titulo">${esc(h.capa.titulo)}</h1>
    ${h.capa.texto ? `<p class="capa__texto">${esc(h.capa.texto)}</p>` : ''}
    <div class="capa__botoes">
      <a class="botao botao--cheio" href="${ctx.url(h.capa.ligacao || '/reparacoes/')}">${esc(h.capa.botao)}</a>
      ${h.capa.botao2 ? `<a class="botao botao--contorno" href="${ctx.url(h.capa.ligacao2 || '/loja/')}">${esc(h.capa.botao2)}</a>` : ''}
    </div>
  </div>
  <div class="capa__foto">${imagem(ctx, h.capa.foto, { tamanhos: '(min-width: 900px) 44vw, 100vw', prioridade: true, proporcao: '4 / 5' })}</div>
</section>
${faixaConfianca(ctx)}`;

  /* OS DESTAQUES DA LOJA: os artigos marcados em destaque no painel (até oito); sem nenhum marcado,
     os primeiros pela ordem da loja. */
  const marcados = ctx.produtos.filter((p) => p.destaque === true);
  const lista = (marcados.length ? marcados : ctx.produtos).slice(0, 8);
  const destaques = lista.length ? `<section class="montra" aria-labelledby="destaques-titulo">
  <div class="seccao__cabeca">
    <div>
      <h2 class="titulo-seccao" id="destaques-titulo">${esc(h.destaques.titulo)}</h2>
      ${h.destaques.texto ? `<p class="seccao__texto">${esc(h.destaques.texto)}</p>` : ''}
    </div>
    ${botaoSeta(ctx.url('/loja/'), `${h.destaques.botao}`, { classe: 'botao botao--texto seccao__mais' })}
  </div>
  <div class="grelha">${lista.map((p) => cartaoProduto(ctx, p)).join('\n')}</div>
</section>` : '';

  /* AS REPARAÇÕES, numa secção escura (a identidade da loja: letreiro preto, dourado nos pormenores):
     os serviços em cartões compactos e os três passos. */
  const servicos = ctx.servicos.slice(0, 6);
  const reparacoes = `<section class="reparacoes-casa" aria-labelledby="reparacoes-titulo">
  <div class="contentor">
    <div class="seccao__cabeca seccao__cabeca--clara">
      <div>
        <p class="sobre-titulo">Reparações</p>
        <h2 class="titulo-seccao" id="reparacoes-titulo">${esc(h.reparacoes.titulo)}</h2>
        ${h.reparacoes.texto ? `<p class="seccao__texto">${esc(h.reparacoes.texto)}</p>` : ''}
      </div>
    </div>
    <ul class="servicos-mini">${servicos.map((s) => `<li><a class="servico-mini" href="${ctx.url(`/reparacoes/#servico-${esc(s.slug)}`)}"><span class="servico-mini__icone">${iconeServico(s.icone)}</span><span class="servico-mini__nome">${esc(s.nome)}</span><span class="servico-mini__texto">${esc(linhasDe(s.itens).slice(0, 3).join(' · '))}</span></a></li>`).join('')}</ul>
    <ol class="passos-casa">
      <li><span class="passos-casa__n">1</span><div><strong>Peça orçamento</strong><span>Pelo WhatsApp ou na loja. Sem compromisso.</span></div></li>
      <li><span class="passos-casa__n">2</span><div><strong>Diagnóstico transparente</strong><span>Dizemos o que tem e quanto custa antes de mexer.</span></div></li>
      <li><span class="passos-casa__n">3</span><div><strong>Reparação com garantia</strong><span>Peças de qualidade. Levanta na loja ou recebe em casa.</span></div></li>
    </ol>
    <div class="reparacoes-casa__botoes">
      <a class="botao botao--claro" href="${ctx.url('/reparacoes/')}">${esc(h.reparacoes.botao)}</a>
      ${c.whatsapp ? `<a class="botao botao--contorno-claro" href="${ctx.whatsapp('Olá! Gostava de um orçamento para uma reparação. Equipamento: \nAvaria: ')}" target="_blank" rel="noopener">${icones.whatsapp}<span>Falar no WhatsApp</span></a>` : ''}
    </div>
  </div>
</section>`;

  /* A RETOMA e o resto que a loja faz, em cartões pequenos. */
  const extras = [];
  extras.push(`<a class="extra extra--retoma" href="${ctx.url('/retoma/')}"><span class="extra__icone">${icones.retoma}</span><span class="extra__titulo">${esc(h.retoma.titulo)}</span><span class="extra__texto">${esc(h.retoma.texto || '')}</span><span class="extra__mais">${esc(h.retoma.botao)} ${icones.seta}</span></a>`);
  if (ctx.site.fidelidade?.texto) extras.push(`<div class="extra"><span class="extra__icone">${icones.presente}</span><span class="extra__titulo">Cartão das películas</span><span class="extra__texto">${esc(ctx.site.fidelidade.texto)}</span></div>`);
  extras.push(`<a class="extra" href="${ctx.whatsapp('Olá! Gostava de encomendar um equipamento: ')}" target="_blank" rel="noopener"><span class="extra__icone">${icones.caixa}</span><span class="extra__titulo">Não encontra? Encomendamos</span><span class="extra__texto">Telemóveis, tablets e acessórios por encomenda. Diga-nos o modelo.</span><span class="extra__mais">Pedir pelo WhatsApp ${icones.seta}</span></a>`);
  if (ctx.site.parcerias?.digi) extras.push(`<div class="extra"><span class="extra__icone">${icones.certo}</span><span class="extra__titulo">Vendedor Oficial DIGI</span><span class="extra__texto">Adesões e informações sobre os tarifários DIGI, na loja.</span></div>`);
  const maisNaLoja = `<section class="extras" aria-label="Também na loja"><div class="extras__grelha">${extras.join('')}</div></section>`;

  /* A LOJA: a fotografia da fachada, a morada, o horário e os botões. */
  const e = ctx.site.empresa;
  const loja = `<section class="loja-casa" aria-labelledby="loja-titulo">
  ${h.loja.foto ? `<div class="loja-casa__foto">${imagem(ctx, h.loja.foto, { tamanhos: '(min-width: 900px) 48vw, 100vw', proporcao: '4 / 3' })}</div>` : ''}
  <div class="loja-casa__texto">
    <p class="sobre-titulo">A loja</p>
    <h2 class="titulo-seccao" id="loja-titulo">${esc(h.loja.titulo === 'A loja' ? `Em ${ctx.site.local.localidade}, ${ctx.site.local.concelho}` : h.loja.titulo)}</h2>
    ${h.loja.texto ? `<p class="seccao__texto">${esc(h.loja.texto)}</p>` : ''}
    <div class="loja-casa__dados">
      <div><p class="loja-casa__rotulo">${icones.local}Morada</p>${moradaHtml(ctx)}</div>
      <div><p class="loja-casa__rotulo">${icones.relogio}Horário</p>${horarioHtml(ctx)}</div>
    </div>
    <div class="loja-casa__botoes">
      ${ctx.site.local.mapa ? `<a class="botao botao--contorno" href="${esc(ctx.site.local.mapa)}" target="_blank" rel="noopener">Como chegar${icones.externo}</a>` : ''}
      <a class="botao botao--texto" href="${ctx.url('/contactos/')}">Contactos ${icones.seta}</a>
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
    conteudo: `<div class="contentor">${capa}</div>\n${destaques ? `<div class="contentor">${destaques}</div>` : ''}\n${reparacoes}\n<div class="contentor">${maisNaLoja}\n${loja}</div>`,
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

// ---------------------------------------------------------------- loja e categorias
export function loja(ctx, cat = null) {
  const c = cat && categoriaDe(ctx, cat);
  const lista = c ? produtosDe(ctx, cat) : ctx.produtos;
  const caminho = c ? `/loja/${c.slug}/` : '/loja/';
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: 'Loja', caminho: '/loja/' }, ...(c ? [{ nome: c.nome, caminho }] : [])]);
  const chips = [{ slug: '', nome: 'Tudo', n: ctx.produtos.length }, ...categoriasComArtigos(ctx).map((k) => ({ ...k, n: produtosDe(ctx, k.slug).length }))]
    .map((k) => {
      const href = ctx.url(k.slug ? `/loja/${k.slug}/` : '/loja/');
      const atual = (k.slug || null) === (cat || null);
      return `<li><a class="chip" href="${href}"${atual ? ' aria-current="page"' : ''}><span>${esc(k.nome)}</span><span class="chip__n">${k.n}</span></a></li>`;
    }).join('');
  const intro = c ? (c.resumo ? `<p class="cabeca__texto">${esc(c.resumo)}</p>` : '') : `<p class="cabeca__texto">${esc(prazoCurto(ctx) || '')} ${portesCurto(ctx)}; levantamento na loja sem custos.</p>`;
  const conteudo = `<div class="contentor loja">
  ${cabecaDePagina(ctx, { migalhas: m.html, sobre: c ? 'Loja' : '', titulo: c ? c.titulo : 'Loja', extra: intro })}
  <nav class="chips" aria-label="Categorias"><ul>${chips}</ul></nav>
  ${lista.length ? `<div class="grelha">
    ${lista.map((p) => cartaoProduto(ctx, p, { titulo: 'h2' })).join('\n')}
  </div>` : `<p class="loja__vazia">Ainda não há artigos nesta categoria. <a href="${ctx.url('/loja/')}">Ver toda a loja</a></p>`}
  ${convite(ctx, { titulo: 'Não encontra o que procura? Encomendamos para si.', texto: 'Olá! Gostava de encomendar um equipamento: ' })}
</div>`;
  return {
    caminho,
    titulo: c ? c.titulo : 'Loja — telemóveis, acessórios e tecnologia',
    descricao: c ? textoSimples(c.resumo || c.titulo).slice(0, 158) : `Telemóveis novos e recondicionados, tablets, smartwatches, auriculares, películas e acessórios na ${ctx.site.marca}, em ${ctx.site.local.localidade}. Envios para Portugal Continental.`,
    jsonld: [m.ld, {
      '@context': 'https://schema.org', '@type': 'ItemList',
      itemListElement: lista.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: ctx.absoluto(`/produtos/${p.slug}/`), name: p.nome })),
    }],
    conteudo,
  };
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
  const galeria = `<div class="galeria" data-galeria style="--forma:${forma.toFixed(3)}">
    <div class="galeria__pista" tabindex="0" role="region" aria-label="${p.video ? 'Fotografias e vídeo' : 'Fotografias'} de ${esc(p.nome)}">
      ${itens.map((it) => (it.video
    ? `<figure class="galeria__foto galeria__foto--video" id="video">${video(ctx, it.video)}</figure>`
    : `<figure class="galeria__foto" id="foto-${it.n}">${imagem(ctx, it.foto, { tamanhos: '(min-width: 1000px) 46vw, 100vw', prioridade: it.n === 1 })}</figure>`)).join('\n')}
    </div>
    ${itens.length > 1 ? `<ul class="galeria__miniaturas">${itens.map((it, i) => `<li>${it.video
    ? `<button class="galeria__mini-video" type="button" data-foto="${i}">${capaDoVideo(ctx, it.video)}<span class="galeria__tocar">${icones.tocar}</span><span class="visualmente-escondido">Vídeo</span></button>`
    : `<button type="button" data-foto="${i}"${i === 0 ? ' aria-current="true"' : ''}>${imagem(ctx, it.foto, { tamanhos: '80px', alt: '', prioridade: true }).replace(' fetchpriority="high"', '')}<span class="visualmente-escondido">Fotografia ${it.n} de ${p.fotos.length}</span></button>`}</li>`).join('')}</ul>` : ''}
  </div>`;

  const selos = [
    pct ? `<span class="selo selo--promocao">${esc(promocaoAte(ctx, p) || 'Promoção')}</span>` : '',
    p.novidade ? '<span class="selo selo--novidade">Novidade</span>' : '',
  ].filter(Boolean).join('');

  const caracteristicas = linhasDe(p.caracteristicas);
  const inclui = linhasDe(p.inclui);
  const listas = `${caracteristicas.length ? `<div class="lista-ficha"><p class="lista-ficha__titulo">Características</p><ul>${caracteristicas.map((t) => `<li>${icones.certo}<span>${esc(t)}</span></li>`).join('')}</ul></div>` : ''}
  ${inclui.length ? `<div class="lista-ficha"><p class="lista-ficha__titulo">Inclui</p><ul>${inclui.map((t) => `<li>${icones.caixa}<span>${esc(t)}</span></li>`).join('')}</ul></div>` : ''}`;

  // --- o formulário: as escolhas (cor, capacidade), a quantidade e o botão -------------------------
  const grupos = opcoesDe(p);
  const blocoOpcoes = grupos.map((g, i) => `<fieldset class="campo escolha" data-escolha="${i}">
    <legend>${esc(g.nome)}</legend>
    <div class="escolha__lista">${g.valores.map((x, j) => `<label class="escolha__opcao"><input type="radio" name="opcao-${i}" value="${j}" required${j === g.valores.findIndex((y) => !y.suplemento) ? ' checked' : ''}><span>${esc(x.nome)}${x.suplemento ? ` <span class="escolha__mais">+ ${euros(x.suplemento)}</span>` : ''}</span></label>`).join('')}</div>
  </fieldset>`).join('');

  const perguntar = (texto) => (ctx.site.contactos.whatsapp ? `<a class="botao botao--whatsapp botao--largo" href="${ctx.whatsapp(texto)}" target="_blank" rel="noopener">${icones.whatsapp}<span>${texto.startsWith('Olá! Este artigo ainda está disponível') ? 'Perguntar disponibilidade' : 'Perguntar pelo WhatsApp'}</span></a>` : '');
  let comprar;
  if (compravel(p)) {
    comprar = `<form class="comprar" data-comprar="${esc(p.slug)}" novalidate>
      ${blocoOpcoes}
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
      ${disp === 'loja' ? `<p class="comprar__nota">${icones.loja}<span>Só na loja: aplica-se ou levanta-se em ${esc(ctx.site.local.localidade)}. Não se envia.</span></p>` : ''}
    </form>
    <noscript><p>${perguntar(`Olá! Gostava de encomendar: ${p.nome}.`)}</p></noscript>`;
  } else if (disp === 'esgotado') {
    comprar = `<div class="comprar comprar--sem">
      <p class="comprar__estado">Esgotado</p>
      ${perguntar(`Olá! O artigo «${p.nome}» está esgotado. Avisam-me quando voltar a haver?`)}
    </div>`;
  } else {
    comprar = `<div class="comprar comprar--sem">
      <p class="comprar__estado">${v.atual === null ? 'Preço e disponibilidade sob consulta' : 'Peça única: confirme a disponibilidade antes de comprar'}</p>
      ${perguntar(`Olá! Este artigo ainda está disponível? ${p.nome} (${ctx.absoluto(caminho)})`)}
    </div>`;
  }

  // --- a caixa de confiança: entrega, pagamento, garantia ----------------------------------------
  const garantia = garantiaTexto(ctx, p);
  const confianca = `<ul class="confianca">
    <li>${icones.camiao}<span>${enviavel(p) ? `${esc(prazoCurto(ctx)) || ctx.marcador('o prazo de entrega')} ${esc(portesCurto(ctx))}. Levantamento na loja sem custos.` : `Levantamento na loja, em ${esc(ctx.site.local.localidade)}, sem custos.`}</span></li>
    <li>${icones.cartao}<span>${ctx.site.pagamentos?.modo === 'online' ? 'Pagamento seguro: cartão, MB WAY ou Multibanco.' : 'Encomenda no site e paga na loja ou por MB WAY, depois de confirmarmos consigo.'}</span></li>
    <li>${icones.escudo}<span>${garantia ? esc(garantia) : ctx.marcador('a garantia dos recondicionados (18 meses ou 3 anos)')}. <a href="${ctx.url('/garantia/')}">Saber mais</a></span></li>
  </ul>`;

  const e = ctx.site.empresa;
  /* Quem vende, com a morada postal e o email, à vista em cada ficha (Regulamento (UE) 2023/988,
     art. 19.º): o fabricante do artigo, quando o painel o diz por inteiro (nome, morada e email);
     senão, a loja. Sem morada ainda, a marca «por confirmar». */
  const fab = fabricanteDoArtigo(p);
  const vendedor = fab
    ? [fab.nome, fab.morada, fab.email].map(esc).join(' · ')
    : [e.nome ? esc(`${e.nome} (${ctx.site.marca})`) : esc(ctx.site.marca), e.morada ? esc(moradaCompleta(e)) : ctx.marcador('a morada postal da loja'), ctx.site.contactos.email ? esc(ctx.site.contactos.email) : ctx.marcador('o email')].filter(Boolean).join(' · ');
  const avisos = linhasDe(String(p.avisos || '').split(/\n+/));
  const infoLegal = avisos.length || p.referencia ? `<div class="info-legal">
    ${avisos.length ? `<div class="info-legal__bloco"><p class="info-legal__titulo">Avisos de segurança</p><ul>${avisos.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${p.referencia ? `<p class="info-legal__linha"><strong>Referência:</strong> ${esc(p.referencia)}</p>` : ''}
  </div>` : '';
  const acordeoes = `<div class="acordeoes">
    <details><summary>${icones.camiao}Envios e levantamento</summary><div class="acordeoes__corpo"><p>${esc(ctx.site.entrega.prazo || '')}</p><p>${esc(ctx.site.entrega.levantamento || '')}</p><p><a href="${ctx.url('/envios-e-devolucoes/')}">Envios e devoluções</a></p></div></details>
    <details><summary>${icones.escudo}Garantia e devoluções</summary><div class="acordeoes__corpo"><p>${esc(textoGarantia({ usados: estado !== 'novo' }))}</p><p>Pode desistir da compra no prazo de 14 dias depois de receber o artigo, sem dar razões. <a href="${ctx.url('/desistir/')}">Como desistir</a></p></div></details>
  </div>
  <p class="vendido-por">${icones.loja}<span><strong>${fab ? 'Fabricante' : 'Vendido por'}:</strong> ${vendedor}</span></p>`;

  const relacionados = ctx.produtos.filter((x) => x.slug !== p.slug)
    .sort((a, b) => (b.categoria === p.categoria) - (a.categoria === p.categoria) || (a.ordem ?? 500) - (b.ordem ?? 500)).slice(0, 4);

  const etiqueta = estadoRotulo(p) || p.marca || c.nome;
  const conteudo = `<div class="contentor produto">
  ${m.html}
  <div class="produto__grelha">
    ${galeria}
    <div class="produto__info">
      ${selos ? `<div class="produto__selos">${selos}</div>` : ''}
      <p class="etiqueta">${esc(etiqueta)}</p>
      <h1 class="produto__nome">${esc(p.nome)}</h1>
      ${preco(ctx, p, { grande: true })}
      ${promocaoNota(ctx, p)}
      ${disponibilidadeRotulo(p) && disp !== 'esgotado' ? `<p class="produto__disp">${esc(disponibilidadeRotulo(p))}</p>` : ''}
      <div class="produto__resumo">${markdown(p.descricao, ctx.url)}</div>
      ${listas}
      ${comprar}
      ${infoLegal}
      ${confianca}
      ${acordeoes}
    </div>
  </div>
  <section class="relacionados" aria-labelledby="rel-titulo">
    <h2 id="rel-titulo" class="titulo-seccao">Também lhe pode interessar</h2>
    <div class="grelha">${relacionados.map((x) => cartaoProduto(ctx, x)).join('\n')}</div>
  </section>
</div>`;

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

// ---------------------------------------------------------------- reparações
export function reparacoes(ctx) {
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: 'Reparações', caminho: '/reparacoes/' }]);
  const c = ctx.site.contactos;
  const tipos = ctx.servicos.map((s) => s.nome);
  const conteudo = `<div class="contentor reparacoes">
  ${cabecaDePagina(ctx, { migalhas: m.html, sobre: 'Reparações', titulo: 'Diagnóstico e orçamento gratuitos.', sub: 'Smartphones, tablets, portáteis, computadores e consolas. Dizemos o que tem e quanto custa antes de mexer.' })}
  <div class="servicos">${ctx.servicos.map((s) => cartaoServico(ctx, s, { titulo: 'h2' })).join('\n')}</div>
  <section class="orcamento" aria-labelledby="orcamento-titulo">
    <div class="orcamento__texto">
      <h2 id="orcamento-titulo" class="titulo-seccao">Peça um orçamento</h2>
      <p>Diga-nos o equipamento e o que se passa. Respondemos pelo WhatsApp com o orçamento e o tempo que leva.</p>
      <ol class="passos-casa passos-casa--escuros">
        <li><span class="passos-casa__n">1</span><div><strong>Conte-nos a avaria</strong><span>Aqui, pelo WhatsApp ou na loja.</span></div></li>
        <li><span class="passos-casa__n">2</span><div><strong>Orçamento sem compromisso</strong><span>Só avançamos com o seu sim.</span></div></li>
        <li><span class="passos-casa__n">3</span><div><strong>Reparação com garantia</strong><span>Levanta na loja ou recebe em casa.</span></div></li>
      </ol>
    </div>
    <form class="formulario orcamento__form" data-whatsapp-form="orcamento" novalidate>
      <div class="campo"><label for="o-tipo">Equipamento</label><select id="o-tipo" name="tipo" required><option value="">Escolha…</option>${tipos.map((t) => `<option>${esc(t)}</option>`).join('')}<option>Outro</option></select></div>
      <div class="campo"><label for="o-modelo">Marca e modelo</label><input id="o-modelo" name="modelo" type="text" maxlength="80" placeholder="Ex.: iPhone 13, Samsung A54, PS5" required autocomplete="off"></div>
      <div class="campo"><label for="o-avaria">O que se passa?</label><textarea id="o-avaria" name="avaria" rows="3" maxlength="400" placeholder="Ex.: o ecrã partiu e já não acende" required></textarea></div>
      <div class="campo"><label for="o-nome">O seu nome <span class="campo__opcional">(opcional)</span></label><input id="o-nome" name="nome" type="text" maxlength="60" autocomplete="name"></div>
      <p class="comprar__erro" data-erro role="alert" hidden></p>
      ${c.whatsapp ? `<button class="botao botao--whatsapp botao--largo" type="submit">${icones.whatsapp}<span>Pedir orçamento pelo WhatsApp</span></button>` : `<p>${ctx.marcador('o número de WhatsApp')}</p>`}
      <p class="formulario__nota">Abre o WhatsApp com a mensagem escrita; nada fica guardado neste site.</p>
    </form>
  </section>
  ${convite(ctx, { titulo: 'Prefere falar connosco primeiro?', texto: 'Olá! Tenho uma dúvida sobre uma reparação.' })}
</div>`;
  return {
    caminho: '/reparacoes/',
    titulo: 'Reparação de telemóveis, tablets, computadores e consolas',
    descricao: `Reparação de smartphones (ecrã, bateria, vidro traseiro, danos por água), tablets, portáteis, PCs e consolas em ${ctx.site.local.localidade}, ${ctx.site.local.concelho}. Diagnóstico e orçamento gratuitos.`,
    jsonld: [m.ld, {
      '@context': 'https://schema.org', '@type': 'Service', name: 'Reparação de equipamentos electrónicos', provider: { '@id': ctx.absoluto('/#loja') }, areaServed: { '@type': 'Country', name: 'Portugal' },
      hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Reparações', itemListElement: ctx.servicos.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.nome, description: s.resumo || undefined } })) },
    }],
    conteudo,
  };
}

// ---------------------------------------------------------------- retoma
export function retoma(ctx) {
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: 'Retoma', caminho: '/retoma/' }]);
  const c = ctx.site.contactos;
  const conteudo = `<div class="contentor retoma">
  ${cabecaDePagina(ctx, { migalhas: m.html, sobre: 'Retoma', titulo: 'Vende-nos o seu telemóvel.', sub: 'Diga-nos o modelo e o estado. Respondemos pelo WhatsApp com uma proposta; o valor final confirma-se com o equipamento na loja.' })}
  <div class="retoma__grelha">
    <form class="formulario retoma__form" data-whatsapp-form="retoma" novalidate>
      <div class="campos-lado">
        <div class="campo"><label for="r-marca">Marca</label><input id="r-marca" name="marca" type="text" maxlength="40" placeholder="Ex.: Apple" required autocomplete="off"></div>
        <div class="campo"><label for="r-modelo">Modelo</label><input id="r-modelo" name="modelo" type="text" maxlength="60" placeholder="Ex.: iPhone 12, 128 GB" required autocomplete="off"></div>
      </div>
      <fieldset class="campo escolha">
        <legend>Estado geral</legend>
        <div class="escolha__lista">
          <label class="escolha__opcao"><input type="radio" name="estado" value="Como novo, sem marcas" required><span>Como novo</span></label>
          <label class="escolha__opcao"><input type="radio" name="estado" value="Bom, com marcas ligeiras de uso"><span>Bom</span></label>
          <label class="escolha__opcao"><input type="radio" name="estado" value="Com riscos ou amolgadelas visíveis"><span>Com marcas</span></label>
          <label class="escolha__opcao"><input type="radio" name="estado" value="Partido ou avariado"><span>Partido ou avariado</span></label>
        </div>
      </fieldset>
      <fieldset class="campo caixas">
        <legend>Funciona tudo?</legend>
        <label class="caixa"><input type="checkbox" name="problemas" value="Ecrã partido ou com riscos"><span>Ecrã partido ou riscado</span></label>
        <label class="caixa"><input type="checkbox" name="problemas" value="Bateria fraca"><span>Bateria fraca</span></label>
        <label class="caixa"><input type="checkbox" name="problemas" value="Não liga ou não carrega"><span>Não liga ou não carrega</span></label>
        <label class="caixa"><input type="checkbox" name="problemas" value="Câmara, som ou botões com problemas"><span>Câmara, som ou botões</span></label>
      </fieldset>
      <fieldset class="campo caixas">
        <legend>Acompanha</legend>
        <label class="caixa"><input type="checkbox" name="acompanha" value="Caixa"><span>Caixa</span></label>
        <label class="caixa"><input type="checkbox" name="acompanha" value="Carregador"><span>Carregador</span></label>
        <label class="caixa"><input type="checkbox" name="acompanha" value="Factura"><span>Factura</span></label>
      </fieldset>
      <div class="campo"><label for="r-notas">Mais alguma coisa? <span class="campo__opcional">(opcional)</span></label><textarea id="r-notas" name="notas" rows="2" maxlength="300"></textarea></div>
      <p class="comprar__erro" data-erro role="alert" hidden></p>
      ${c.whatsapp ? `<button class="botao botao--whatsapp botao--largo" type="submit">${icones.whatsapp}<span>Pedir proposta pelo WhatsApp</span></button>` : `<p>${ctx.marcador('o número de WhatsApp')}</p>`}
      <p class="formulario__nota">Abre o WhatsApp com a mensagem escrita; nada fica guardado neste site. Pode juntar fotografias na conversa.</p>
    </form>
    <aside class="retoma__lado">
      <div class="retoma__cartao">
        <p class="retoma__titulo">Como funciona</p>
        <ol class="passos-lista">
          <li><strong>Envia-nos os dados</strong><span>O modelo, o estado e o que acompanha.</span></li>
          <li><strong>Recebe uma proposta</strong><span>Pelo WhatsApp, normalmente no próprio dia.</span></li>
          <li><strong>Avaliação na loja</strong><span>Confirmamos o estado e o valor com o equipamento à frente.</span></li>
        </ol>
      </div>
      <div class="retoma__cartao retoma__cartao--nota">
        <p>${icones.info}<span>Antes de entregar, faça uma cópia de segurança, termine a sessão da sua conta (iCloud ou Google) e tire o cartão SIM.</span></p>
      </div>
    </aside>
  </div>
</div>`;
  return {
    caminho: '/retoma/',
    titulo: 'Retoma: vendemos e compramos telemóveis usados',
    descricao: `Tem um telemóvel parado? Diga-nos o modelo e o estado e a ${ctx.site.marca}, em ${ctx.site.local.localidade}, responde com uma proposta de retoma.`,
    jsonld: [m.ld],
    conteudo,
  };
}

// ---------------------------------------------------------------- carrinho e checkout
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
      <div class="totais" data-totais aria-live="polite"></div>
      <p class="comprar__erro" data-erro-carrinho role="alert" hidden></p>
      <a class="botao botao--cheio botao--largo" href="${ctx.url('/checkout/')}" data-seguir>Continuar</a>
      <p class="resumo__nota">${esc(prazoCurto(ctx) || '')} ${esc(ctx.site.entrega.levantamento || '')}</p>
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
          <p class="formulario__nota">Enviamos só para Portugal Continental.</p>
        </div>
        <div class="campo"><label for="c-notas">Observações <span class="campo__opcional">(opcional)</span></label><textarea id="c-notas" name="notas" rows="2" maxlength="500"></textarea></div>
      </fieldset>
      <label class="caixa caixa--termos"><input type="checkbox" name="termos" required><span>Li e aceito os <a href="${ctx.url('/termos-e-condicoes/')}" target="_blank" rel="noopener">termos e condições</a>. Posso desistir da compra em 14 dias.</span></label>
      <p class="comprar__erro" data-erro-checkout role="alert" hidden></p>
      <button class="botao botao--cheio botao--largo" type="submit" data-botao-checkout>${online ? icones.cadeado : icones.certo}<span>${online ? 'Pagar agora' : 'Enviar encomenda'}</span></button>
      <p class="formulario__nota">${online ? 'Segue para a página segura da Stripe (cartão, MB WAY ou Multibanco). Pode desistir até pagar.' : 'Registamos a encomenda e confirmamos consigo o pagamento e a entrega, por email ou WhatsApp. A encomenda fica feita quando a confirmarmos.'}</p>
    </form>
    <aside class="checkout__resumo" aria-labelledby="c-resumo-titulo">
      <h2 id="c-resumo-titulo" class="resumo__titulo">A sua encomenda</h2>
      <div data-checkout-resumo><p class="carrinho-vazio">O carrinho está vazio. <a href="${ctx.url('/loja/')}">Ver a loja</a></p></div>
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
    <ol class="passos">${passos.map((x, i) => `<li class="passo"><span class="passo__numero" aria-hidden="true">${i + 1}</span><div class="passo__texto"><h2 id="${x.id}">${x.titulo.replace(/^\d+\.\s*/, '')}</h2>${x.corpo}</div></li>`).join('')}</ol>
    ${notas.length ? `<div class="notas">${notas.map((x) => { const ic = icones[ICONE_DA_NOTA[chaveDe(x.titulo)]]; return `<section class="nota-cartao">${ic ? `<span class="nota-cartao__icone">${ic}</span>` : ''}<h2 id="${x.id}">${x.titulo}</h2>${x.corpo}</section>`; }).join('')}</div>` : ''}`;
}
function comoPerguntas(html) {
  const { intro, lista } = seccoes(html);
  return `${intro ? `<div class="texto__intro">${intro}</div>` : ''}
    <div class="perguntas">${lista.map((x) => `<details class="pergunta"><summary><h2 class="pergunta__titulo" id="${x.id}">${x.titulo}</h2><span class="pergunta__sinal" aria-hidden="true"></span></summary><div class="pergunta__resposta">${x.corpo}</div></details>`).join('')}</div>`;
}

export function texto(ctx, pag) {
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: pag.titulo, caminho: pag.caminho }]);
  const legal = Boolean(pag.atualizado);
  const data = legal ? `Atualizado a ${new Date(`${pag.atualizado}T12:00:00Z`).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Lisbon' })}` : '';
  const corpo = pag.modelo === 'passos' ? comoPassos(pag.html) : pag.modelo === 'perguntas' ? comoPerguntas(pag.html) : pag.html;
  const conteudo = `<div class="contentor texto-pagina${pag.modelo ? ` texto-pagina--${esc(pag.modelo)}` : ''}${legal ? ' texto-pagina--legal' : ''}">
  ${cabecaDePagina(ctx, { migalhas: m.html, titulo: pag.titulo, sub: pag.subtitulo, data })}
  <article class="texto">
    ${pag.foto ? `<figure class="texto__foto">${imagem(ctx, pag.foto, { tamanhos: '(min-width: 900px) 720px, 100vw' })}</figure>` : ''}
    ${corpo}
  </article>
  ${legal ? '' : convite(ctx)}
</div>`;
  return { caminho: pag.caminho, titulo: pag.tituloSeo || pag.titulo, descricao: pag.descricao, indexar: pag.indexar, jsonld: [m.ld], conteudo };
}

/* Os contactos: o WhatsApp à cabeça (é por lá que se pedem orçamentos; só a ligação, sem o número), a
   morada com o horário e o mapa (carregado só com consentimento: legal-comum, fachadaMapa), e os outros
   caminhos. O telefone leva a nota da chamada entre parênteses (DL 59/2021). */
export function contactos(ctx) {
  const c = ctx.site.contactos;
  const e = ctx.site.empresa;
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: 'Contactos', caminho: '/contactos/' }]);
  const tel = numeroPortugues(c.telefone);
  const linha = (icone, nome, corpo) => `<li class="contacto"><span class="contacto__icone">${icone}</span><div><h2 class="contacto__nome">${nome}</h2>${corpo}</div></li>`;
  const outros = [];
  if (tel) outros.push(linha(icones.telefone, 'Telefone', `<p><a href="tel:+351${tel}">${esc(numeroLegivel(tel))}</a> ${notaChamada(tel)}</p>`));
  outros.push(linha(icones.email, 'Email', c.email ? `<p><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>` : `<p>${ctx.marcador('o email da loja')}</p>`));
  if (c.instagram) outros.push(linha(icones.instagram, 'Instagram', `<p><a href="https://www.instagram.com/${esc(c.instagram)}/" target="_blank" rel="noopener">@${esc(c.instagram)}</a></p>`));
  if (c.facebook) outros.push(linha(icones.facebook, 'Facebook', `<p><a href="https://www.facebook.com/${esc(c.facebook)}/" target="_blank" rel="noopener">${esc(ctx.site.marca)}</a></p>`));
  const g = ctx.site.google || {};
  if (g.ligacao) outros.push(linha(icones.estrela, 'Opiniões', `<p><a href="${esc(g.ligacao)}" target="_blank" rel="noopener">${g.nota ? `${esc(String(g.nota).replace('.', ','))} no Google` : 'No Google'}${g.opinioes ? ` · ${g.opinioes} opiniões` : ''}</a></p>`));
  const principal = c.whatsapp
    ? `<section class="contacto-principal" aria-labelledby="contacto-whatsapp">
      <span class="contacto-principal__icone">${icones.whatsapp}</span>
      <h2 id="contacto-whatsapp">WhatsApp</h2>
      <p>Orçamentos, retomas e dúvidas. É por aqui que respondemos mais depressa.</p>
      <a class="botao botao--whatsapp" href="${ctx.whatsapp('Olá!')}" target="_blank" rel="noopener">${icones.whatsapp}<span>Enviar uma mensagem</span></a>
    </section>`
    : `<section class="contacto-principal"><h2>WhatsApp</h2><p>${ctx.marcador('o número de WhatsApp')}</p></section>`;
  const coords = (ctx.site.local.coordenadas || '').replace(/\s/g, '');
  const mapa = coords ? fachadaMapa({ src: `https://www.google.com/maps?q=${encodeURIComponent(coords)}&hl=pt-PT&z=16&output=embed`, titulo: `Mapa: ${ctx.site.marca} em ${ctx.site.local.localidade}`, chave: 'lfmobile-mapa', textoBotao: 'Carregar o mapa (Google)', texto: 'O mapa é do Google e só carrega se o pedir.', altura: 360, classe: 'fachada-mapa', id: 'mapa' }) : '';
  const conteudo = `<div class="contentor contactos-pagina">
  ${cabecaDePagina(ctx, { migalhas: m.html, titulo: 'Contactos', sub: `${esc(ctx.site.local.localidade)}, ${esc(ctx.site.local.concelho)}. Fale connosco como preferir.` })}
  <div class="contactos-grelha">
    <div class="contactos-coluna">
      ${principal}
      <ul class="contactos-lista">${outros.join('')}</ul>
    </div>
    <div class="contactos-coluna">
      <section class="loja-cartao" aria-labelledby="loja-cartao-titulo">
        <h2 id="loja-cartao-titulo">${icones.loja}A loja</h2>
        ${moradaHtml(ctx)}
        ${horarioHtml(ctx)}
        <div class="loja-cartao__botoes">
          ${ctx.site.local.mapa ? `<a class="botao botao--contorno" href="${esc(ctx.site.local.mapa)}" target="_blank" rel="noopener">Como chegar${icones.externo}</a>` : ''}
        </div>
      </section>
      ${mapa}
    </div>
  </div>
</div>`;
  return { caminho: '/contactos/', titulo: 'Contactos', descricao: `Fale com a ${ctx.site.marca}: WhatsApp, ${tel ? 'telefone, ' : ''}email, Instagram e Facebook. ${e.morada ? `${e.morada}, ` : ''}${ctx.site.local.localidade}, ${ctx.site.local.concelho}.`, jsonld: [m.ld, organizacao(ctx)], conteudo };
}

export function erro404(ctx) {
  const conteudo = `<div class="contentor erro">
  ${cabecaDePagina(ctx, { titulo: 'Esta página não existe', sub: 'Pode ter mudado de sítio, ou o endereço tem um erro.' })}
  <ul class="menu__categorias erro__categorias">${categoriasComArtigos(ctx).map((k) => `<li><a class="pilula" href="${ctx.url(`/loja/${k.slug}/`)}">${esc(k.nome)}</a></li>`).join('')}</ul>
  <p class="erro__loja">${botaoSeta(ctx.url('/loja/'), 'Ver toda a loja', { classe: 'botao botao--cheio' })} ${botaoSeta(ctx.url('/reparacoes/'), 'Reparações')}</p>
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
