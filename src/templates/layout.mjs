// A moldura de todas as páginas: <head>, aviso, cabeçalho, menu, rodapé e gaveta do carrinho.
// Arrumação simples e calma (o gosto do Renato: arredondado, pouco texto, Apple como referência de
// qualidade): o logótipo à esquerda, as páginas no meio (no computador), o WhatsApp e o carrinho à
// direita; no telemóvel, o menu abre numa folha.
import { esc, numeroWhatsApp } from './util.mjs';
import { icones } from './icones.mjs';
import { livroBotao, categoriasComArtigos, horarioHtml } from './componentes.mjs';

function logotipo(ctx, { alto = 40, classe = 'logo' } = {}) {
  const l = ctx.manifesto.logo;
  // a versão mais pequena que ainda chega ao dobro da altura (ecrãs de alta resolução)
  const alturas = Object.keys(l.altura).map(Number).sort((x, y) => x - y);
  const h = alturas.find((x) => x >= alto * 2) || alturas[alturas.length - 1];
  const v = l.altura[h];
  const largo = Math.round((v.largura / h) * alto);
  return `<img class="${classe}" src="${ctx.asset(`img/${v.webp}`)}" width="${largo}" height="${alto}" alt="${esc(ctx.site.marca)}">`;
}

function aviso(ctx) {
  const a = ctx.site.aviso || {};
  if (!a.texto || (a.ate && ctx.hoje > a.ate)) return '';
  const texto = esc(a.texto);
  const corpo = a.ligacao ? `<a href="${ctx.url(a.ligacao)}">${texto}</a>` : texto;
  // data-ate: o site.js esconde o aviso no dia seguinte, mesmo que ninguém publique nada
  return `<div class="aviso"${a.ate ? ` data-ate="${esc(a.ate)}"` : ''}><p>${corpo}</p></div>`;
}

/* As páginas do menu (as mesmas no cabeçalho, na folha do telemóvel e no rodapé). */
export const PAGINAS_MENU = [
  ['/loja/', 'Loja'],
  ['/reparacoes/', 'Reparações'],
  ['/retoma/', 'Retoma'],
  ['/sobre-nos/', 'Sobre'],
  ['/contactos/', 'Contactos'],
];

function cabecalho(ctx, atual) {
  const c = ctx.site.contactos;
  // a página em que se está (e as suas filhas: uma ficha de artigo marca «Loja»)
  const emLoja = atual.startsWith('/loja/') || atual.startsWith('/produtos/');
  const marca = (caminho) => ((caminho === '/loja/' ? emLoja : atual === caminho) ? ' aria-current="page"' : '');
  return `<header class="topo" data-topo>
  <div class="topo__barra">
    <a class="topo__marca" href="${ctx.url('/')}">${logotipo(ctx, { alto: 40 })}<span class="visualmente-escondido"> — página inicial</span></a>
    <nav class="topo__nav" aria-label="Páginas">
      <ul>${PAGINAS_MENU.map(([caminho, nome]) => `<li><a href="${ctx.url(caminho)}"${marca(caminho)}>${esc(nome)}</a></li>`).join('')}</ul>
    </nav>
    <div class="topo__direita">
      ${c.whatsapp ? `<a class="topo__whatsapp" href="https://wa.me/${numeroWhatsApp(c.whatsapp)}" target="_blank" rel="noopener">${icones.whatsapp}<span class="topo__whatsapp-texto">WhatsApp</span></a>` : ''}
      <a class="topo__carrinho" href="${ctx.url('/carrinho/')}" data-abrir="carrinho" aria-haspopup="dialog">${icones.carrinho}<span class="visualmente-escondido">Carrinho</span><span class="topo__conta" data-conta hidden></span></a>
      <button class="topo__menu" type="button" data-abrir="menu" aria-haspopup="dialog">${icones.menu}<span class="visualmente-escondido">Menu</span></button>
    </div>
  </div>
</header>`;
}

function redes(ctx, classe = 'redes') {
  const c = ctx.site.contactos;
  const r = [];
  if (c.instagram) r.push(`<a href="https://www.instagram.com/${esc(c.instagram)}/" target="_blank" rel="noopener">${icones.instagram}<span class="visualmente-escondido">Instagram</span></a>`);
  if (c.facebook) r.push(`<a href="https://www.facebook.com/${esc(c.facebook)}/" target="_blank" rel="noopener">${icones.facebook}<span class="visualmente-escondido">Facebook</span></a>`);
  if (c.whatsapp) r.push(`<a href="https://wa.me/${numeroWhatsApp(c.whatsapp)}" target="_blank" rel="noopener">${icones.whatsapp}<span class="visualmente-escondido">WhatsApp</span></a>`);
  return `<ul class="${classe}">${r.map((x) => `<li>${x}</li>`).join('')}</ul>`;
}

/* O MENU DO TELEMÓVEL (uma folha que desce do topo): as páginas em letra grande, as categorias da
   loja em pílulas, e o WhatsApp em baixo. A página em que se está fica marcada (aria-current). */
function menu(ctx, atual) {
  const c = ctx.site.contactos;
  const marca = (caminho) => (caminho === atual ? ' aria-current="page"' : '');
  return `<dialog class="menu" id="menu" aria-label="Menu">
  <div class="menu__corpo" tabindex="-1">
    <div class="menu__topo">
      <a class="menu__marca" href="${ctx.url('/')}">${logotipo(ctx, { alto: 36 })}</a>
      <button class="menu__fechar" type="button" data-fechar>${icones.fechar}<span class="visualmente-escondido">Fechar o menu</span></button>
    </div>
    <nav class="menu__nav" aria-label="Menu">
      <ul class="menu__paginas">
        ${PAGINAS_MENU.map(([caminho, nome]) => `<li><a class="menu__pagina" href="${ctx.url(caminho)}"${marca(caminho)}>${esc(nome)}${icones.seta}</a></li>`).join('')}
      </ul>
      <p class="menu__rotulo" id="menu-loja">Na loja</p>
      <ul class="menu__categorias" aria-labelledby="menu-loja">
        ${categoriasComArtigos(ctx).map((k) => `<li><a class="pilula" href="${ctx.url(`/loja/${k.slug}/`)}"${marca(`/loja/${k.slug}/`)}>${esc(k.nome)}</a></li>`).join('')}
      </ul>
    </nav>
    <div class="menu__pe">
      ${c.whatsapp ? `<a class="botao botao--whatsapp-suave botao--largo" href="https://wa.me/${numeroWhatsApp(c.whatsapp)}" target="_blank" rel="noopener">${icones.whatsapp}<span>Falar no WhatsApp</span></a>` : ''}
      ${redes(ctx, 'redes redes--menu')}
    </div>
  </div>
</dialog>`;
}

/* O RODAPÉ, como nos outros sites do Renato (memória rodape-com-logotipo): à esquerda o logótipo, a
   frase e as redes; depois a Loja, a Ajuda e os Contactos (o WhatsApp só como ligação, o telefone com a
   nota entre parênteses, o horário); em baixo as páginas legais numa linha, com o Livro de Reclamações
   discreto. O pormenor da marca: a linha fina dourada por cima da linha legal (a das histórias de
   «feedback» da LF Mobile). */
function rodape(ctx) {
  const c = ctx.site.contactos;
  const e = ctx.site.empresa || {};
  const contactos = [];
  if (c.whatsapp) contactos.push(`<li><a href="https://wa.me/${numeroWhatsApp(c.whatsapp)}" target="_blank" rel="noopener">${icones.whatsapp}<span>WhatsApp</span></a></li>`);
  if (c.telefone) contactos.push(`<li><a href="tel:+${numeroWhatsApp(c.telefone)}">${icones.telefone}<span>${esc(ctx.numeroLegivel(c.telefone))}</span></a> ${ctx.notaChamada(c.telefone)}</li>`);
  contactos.push(`<li>${c.email ? `<a href="mailto:${esc(c.email)}">${icones.email}<span>${esc(c.email)}</span></a>` : `<span class="rodape__sem-ligacao">${icones.email}${ctx.marcador('o email')}</span>`}</li>`);
  contactos.push(`<li><a class="rodape__local" href="${ctx.url('/contactos/')}">${icones.local}<span>${e.morada ? `${esc(e.morada)}, ` : ''}${esc(ctx.site.local.localidade)}, ${esc(ctx.site.local.concelho)}</span></a></li>`);
  const ligacao = (caminho, texto) => `<li><a href="${ctx.url(caminho)}">${esc(texto)}</a></li>`;
  return `<footer class="rodape">
  <div class="rodape__corpo">
    <div class="rodape__marca">
      <a class="rodape__logo" href="${ctx.url('/')}">${logotipo(ctx, { alto: 56, classe: 'rodape__logo-img' })}<span class="visualmente-escondido"> — página inicial</span></a>
      <p class="rodape__frase">${esc(ctx.site.assinatura)}</p>
      ${redes(ctx, 'redes redes--rodape')}
    </div>
    <nav class="rodape__nav" aria-label="Rodapé">
      <div class="rodape__coluna">
        <h2>Loja</h2>
        <ul>
          ${categoriasComArtigos(ctx).map((k) => ligacao(`/loja/${k.slug}/`, k.nome)).join('')}
          ${ligacao('/loja/', 'Toda a loja')}
        </ul>
      </div>
      <div class="rodape__coluna">
        <h2>Ajuda</h2>
        <ul>
          ${ligacao('/reparacoes/', 'Reparações')}
          ${ligacao('/retoma/', 'Retoma do seu telemóvel')}
          ${ligacao('/envios-e-devolucoes/', 'Envios e devoluções')}
          ${ligacao('/perguntas-frequentes/', 'Perguntas frequentes')}
          ${ligacao('/sobre-nos/', 'Sobre a LF Mobile')}
        </ul>
      </div>
    </nav>
    <div class="rodape__coluna rodape__coluna--contactos">
      <h2>Contactos</h2>
      <ul class="rodape__contactos">${contactos.join('')}</ul>
      ${horarioHtml(ctx, { classe: 'horario horario--rodape' })}
    </div>
  </div>
  <div class="rodape__fim">
    <p class="rodape__direitos">© ${ctx.hoje.slice(0, 4)} ${esc(ctx.site.marca)}${e.nif ? ` · NIF ${esc(e.nif)}` : ''}</p>
    <ul class="rodape__legal">
      ${ligacao('/termos-e-condicoes/', 'Termos e condições')}
      ${ligacao('/politica-de-privacidade/', 'Privacidade')}
      ${ligacao('/politica-de-cookies/', 'Cookies')}
      ${ligacao('/garantia/', 'Garantia')}
      ${ligacao('/resolucao-de-litigios/', 'Resolução de litígios')}
      ${ligacao('/desistir/', 'Desistir de uma compra')}
      <li>${livroBotao()}</li>
    </ul>
  </div>
</footer>`;
}

function gavetaCarrinho() {
  return `<dialog class="gaveta" id="carrinho" aria-labelledby="carrinho-titulo">
  <div class="gaveta__corpo" tabindex="-1">
    <div class="gaveta__topo">
      <h2 id="carrinho-titulo">Carrinho</h2>
      <button class="gaveta__fechar" type="button" data-fechar>${icones.fechar}<span class="visualmente-escondido">Fechar o carrinho</span></button>
    </div>
    <div class="gaveta__conteudo" data-carrinho-gaveta>
      <p class="gaveta__vazio">O carrinho está vazio.</p>
    </div>
  </div>
</dialog>`;
}

export function pagina(ctx, { titulo, descricao, caminho, conteudo, partilha, tipo = 'website', jsonld = [], classe = '', indexar = true, semMoldura = false }) {
  const tituloCompleto = titulo.includes(ctx.site.marca) ? titulo : `${titulo} | ${ctx.site.marca}`;
  const cartao = partilha || ctx.manifesto.partilha._site;
  const l = ctx.manifesto.logo;
  const imgAbs = ctx.absoluto(`/assets/img/${cartao}`);
  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script>document.documentElement.dataset.rolado=scrollY>40?'sim':'nao'</script>
<title>${esc(tituloCompleto)}</title>
<meta name="description" content="${esc(descricao)}">
<link rel="canonical" href="${ctx.absoluto(caminho)}">
${!ctx.producao ? '<meta name="robots" content="noindex, nofollow">\n' : indexar === false ? '<meta name="robots" content="noindex">\n' : ''}<meta property="og:type" content="${tipo}">
<meta property="og:site_name" content="${esc(ctx.site.marca)}">
<meta property="og:locale" content="pt_PT">
<meta property="og:title" content="${esc(tituloCompleto)}">
<meta property="og:description" content="${esc(descricao)}">
<meta property="og:url" content="${ctx.absoluto(caminho)}">
<meta property="og:image" content="${imgAbs}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(ctx.site.marca)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" type="image/png" sizes="32x32" href="${ctx.asset(`img/${l.icones[32]}`)}">
<link rel="icon" type="image/png" sizes="48x48" href="${ctx.asset(`img/${l.icones[48]}`)}">
<link rel="apple-touch-icon" href="${ctx.asset(`img/${l.icones.apple}`)}">
<link rel="preload" href="${ctx.asset('fontes/manrope-latin.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${ctx.asset(ctx.ficheiros.css)}">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
<script src="${ctx.asset(ctx.ficheiros.js)}" defer></script>
</head>
<body class="${esc(classe)}" data-catalogo="${ctx.asset(ctx.ficheiros.catalogo)}" data-base="${ctx.url('/')}" data-api="${esc(ctx.api)}">
<a class="saltar" href="#conteudo">Saltar para o conteúdo</a>
${aviso(ctx)}
${cabecalho(ctx, caminho)}
<main id="conteudo" tabindex="-1">
${conteudo}
</main>
${rodape(ctx)}
${gavetaCarrinho()}
${menu(ctx, caminho)}
</body>
</html>
`;
}
