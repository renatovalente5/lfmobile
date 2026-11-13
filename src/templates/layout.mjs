// A MOLDURA DE TODAS AS PÁGINAS: o <head>, a faixa do topo, o cabeçalho, o menu do telemóvel, a
// procura, o rodapé e a gaveta do carrinho.
// O desenho é o de uma loja de electrónica (o Renato, 9 nov 2026: «Ele quer um site mais de
// eletrónica e não apenas um site simples de AI generated»), à volta do logótipo que existe: em cima
// a faixa escura (a campanha que está a correr, ou o aviso, ou os envios e a loja aberta); por baixo
// o logótipo, a procura larga, os serviços (Reparações e Retoma, juntos) e o carrinho; e a fila das
// categorias da loja (o Renato, 10 nov 2026: «Vender o meu» e «Retoma» eram a mesma coisa, e os
// serviços deviam estar juntos). No telemóvel: o menu, o logótipo, a lupa e o carrinho; a procura e
// o menu abrem em folhas.
import { esc, numeroWhatsApp } from './util.mjs';
import { icones } from './icones.mjs';
import { livroBotao, categoriasDeCima, filhasDe } from './componentes.mjs';

function logotipo(ctx, { alto = 40, classe = 'logo' } = {}) {
  const l = ctx.manifesto.logo;
  // a versão mais pequena que ainda chega ao dobro da altura (ecrãs de alta resolução)
  const alturas = Object.keys(l.altura).map(Number).sort((x, y) => x - y);
  const h = alturas.find((x) => x >= alto * 2) || alturas[alturas.length - 1];
  const v = l.altura[h];
  const largo = Math.round((v.largura / h) * alto);
  return `<img class="${classe}" src="${ctx.asset(`img/${v.webp}`)}" width="${largo}" height="${alto}" alt="${esc(ctx.site.marca)}">`;
}

/* A FAIXA DO TOPO: a campanha que está a correr (com a ligação para a página dela) ou o aviso do dono
   (Dados da loja › Aviso do topo). Sem nenhum dos dois não aparece (o Renato, 12 nov 2026: as frases de
   sempre — orçamento grátis, envios, levantamento — repetiam-se em todas as páginas e já estão onde
   contam: na capa, no artigo, nas reparações). À direita (no computador), a loja aberta ou fechada agora,
   calculada no browser pelo horário (site.js). */
function faixaTopo(ctx) {
  const c = ctx.campanhas[0];
  const a = ctx.site.aviso || {};
  let corpo;
  let ate = '';
  if (c) {
    corpo = `<a class="faixa-topo__campanha" href="${ctx.url(`/campanhas/${c.slug}/`)}"><span class="faixa-topo__selo">${esc(c.nome)}</span><span>${esc(c.faixa)}</span>${icones.seta}</a>`;
    ate = c.ate;
  } else if (a.texto && !(a.ate && ctx.hoje > a.ate)) {
    corpo = a.ligacao ? `<a href="${ctx.url(a.ligacao)}">${esc(a.texto)}</a>` : `<span>${esc(a.texto)}</span>`;
    ate = a.ate || '';
  } else {
    return '';
  }
  return `<div class="faixa-topo"${ate ? ` data-ate="${esc(ate)}"` : ''}>
  <div class="faixa-topo__dentro">
    <p class="faixa-topo__texto">${corpo}</p>
    <p class="faixa-topo__loja" data-estado-loja hidden></p>
  </div>
</div>`;
}

/* A procura: a mesma no cabeçalho (computador) e na folha (telemóvel, e a página inicial). Sem
   JavaScript vai para a loja com ?q=. Os resultados vêm de assets/busca-*.json (artigos, modelos para
   reparar, páginas). O campo (a pílula) e os resultados são irmãos: na folha os resultados ficam por
   baixo do campo (antes de 12 nov 2026 estavam dentro da pílula e saíam ao lado, fora do ecrã).
   O texto do campo não leva «iPhone», «telemóvel», «mobile», «nome» nem «email»: o Safari lê «phone» em
   «iPhone» e, mesmo com autocomplete="off", punha por cima do teclado o «AutoFill Contact» com o número de
   telemóvel de quem procurava (o Renato, 13 nov 2026). Na folha, o «Fechar» fica na linha do campo e os
   resultados por baixo, a toda a largura. */
function procura(ctx, id, { fechar = false } = {}) {
  const campo = `<div class="busca__campo">
    <label class="visualmente-escondido" for="${id}">Procurar no site</label>
    <span class="busca__lupa">${icones.pesquisa}</span>
    <input id="${id}" name="q" type="search" placeholder="O que procura?" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
  </div>`;
  return `<form class="busca" role="search" action="${ctx.url('/loja/')}" data-busca="${esc(ctx.asset(ctx.ficheiros.busca))}">
  ${fechar ? `<div class="busca__linha">
  ${campo}
  <button class="folha-procura__fechar" type="button" data-fechar>Fechar</button>
  </div>` : campo}
  <div class="busca__resultados" data-busca-resultados hidden></div>
</form>`;
}

/* As ligações do cabeçalho e do menu: os serviços (as Reparações e a Retoma, que é vender ou
   trocar) e as categorias de cima da loja com artigos (Telemóveis, Gadgets, Acessórios…: as filhas estão
   na página de cada uma). */
function ligacoesDaFila(ctx) {
  const cats = categoriasDeCima(ctx).map((k) => ({ caminho: `/loja/${k.slug}/`, nome: k.nome, slug: k.slug }));
  const servicos = [
    { caminho: '/reparacoes/', nome: 'Reparações', icone: icones.ferramentas, sub: 'Preço pelo modelo' },
    { caminho: '/retoma/', nome: 'Retoma', icone: icones.retoma, sub: 'Compramos o seu' },
  ];
  return { cats, servicos };
}
/* O desenho de cada categoria no menu do telemóvel. */
const ICONE_CATEGORIA = { telemoveis: 'telemovel', apple: 'telemovel', samsung: 'telemovel', recondicionados: 'verificado', tablets: 'tablet', computadores: 'portatil', gadgets: 'auriculares', smartwatches: 'relogioPulso', audio: 'auriculares', casa: 'casa', kids: 'comando', acessorios: 'conector', peliculas: 'pelicula', 'encomendas-misterio': 'caixa' };

/* O CABEÇALHO, o mesmo em todas as páginas (o Renato, 12 nov 2026: «se for preciso refaz a Navbar
   também nas outras páginas»; antes, fora da página inicial, havia a procura larga, os botões Reparações
   e Retoma e uma fila com as categorias, que repetia as pílulas da loja): escuro, o logótipo em branco, e
   no computador quatro ligações em letras espaçadas, separadas por traços finos (como na imagem da LF
   Mobile), com a página onde se está assinalada; a barra da procura grande ao lado do logótipo (o Renato,
   12 nov 2026: «eu gostava da barra de pesquisas em grande… remove o icon da direita»); o carrinho. No
   telemóvel, onde a barra não cabe: o menu, o logótipo, a lupa (a procura abre na folha) e o carrinho. Claro, com o logótipo a preto, como ele é; na
   página inicial (naCapa), só no topo, transparente por cima da capa com o logótipo em branco (o CSS). */
const LIGACOES_DO_TOPO = [
  { caminho: '/loja/', nome: 'Loja', tambem: ['/produtos/', '/campanhas/'] },
  { caminho: '/reparacoes/', nome: 'Reparações' },
  { caminho: '/retoma/', nome: 'Retoma' },
  { caminho: '/contactos/', nome: 'Contactos' },
];
/* O MENU DA LOJA no computador (o esquema do Leandro, 13 nov 2026: as categorias «no cabeçalho»): ao passar o rato
   por «Loja», ou ao chegar lá com o Tab, abre um painel por baixo do cabeçalho, como o da Apple: à esquerda as
   categorias de cima em letra grande, e uma coluna com as filhas de cada uma que as tem. No telemóvel e no tablet
   (sem rato), «Loja» leva à loja, que tem as categorias em cima. */
function menuDaLoja(ctx) {
  const cima = categoriasDeCima(ctx);
  if (!cima.length) return '';
  const colunas = cima.map((k) => ({ k, filhas: filhasDe(ctx, k.slug) })).filter((x) => x.filhas.length);
  return `<div class="topo__mega" data-menu-loja>
        <div class="topo__mega-dentro">
          <ul class="topo__mega-cima">
            <li><a href="${ctx.url('/loja/')}">Toda a loja</a></li>
            ${cima.map((k) => `<li><a href="${ctx.url(`/loja/${k.slug}/`)}">${esc(k.nome)}</a></li>`).join('')}
          </ul>
          ${colunas.map(({ k, filhas }) => `<div class="topo__mega-coluna">
            <p class="topo__mega-titulo">${esc(k.nome)}</p>
            <ul>${filhas.map((f) => `<li><a href="${ctx.url(`/loja/${f.slug}/`)}">${esc(f.nome)}</a></li>`).join('')}</ul>
          </div>`).join('')}
        </div>
      </div>`;
}
function cabecalho(ctx, atual, { naCapa = false } = {}) {
  const corrente = (x) => [x.caminho, ...(x.tambem || [])].some((c) => atual.startsWith(c));
  return `<header class="topo${naCapa ? ' topo--capa' : ''}" data-topo>
  <div class="topo__barra">
    <button class="topo__botao topo__menu" type="button" data-abrir="menu" aria-haspopup="dialog">${icones.menu}<span class="visualmente-escondido">Menu</span></button>
    <a class="topo__marca" href="${ctx.url('/')}"${atual === '/' ? ' aria-current="page"' : ''}>${logotipo(ctx, { alto: 46 })}<span class="visualmente-escondido"> — página inicial</span></a>
    <div class="topo__procura">${procura(ctx, 'busca-topo')}</div>
    <nav class="topo__ligacoes" aria-label="Principal">
      <ul>${LIGACOES_DO_TOPO.map((x) => (x.caminho === '/loja/'
    ? `<li class="topo__loja"><a href="${ctx.url(x.caminho)}"${corrente(x) ? ' aria-current="page"' : ''}>${esc(x.nome)}</a>${menuDaLoja(ctx)}</li>`
    : `<li><a href="${ctx.url(x.caminho)}"${corrente(x) ? ' aria-current="page"' : ''}>${esc(x.nome)}</a></li>`)).join('')}</ul>
    </nav>
    <div class="topo__direita">
      <button class="topo__botao topo__lupa" type="button" data-abrir="procurar" aria-haspopup="dialog">${icones.pesquisa}<span class="visualmente-escondido">Procurar</span></button>
      <a class="topo__botao topo__carrinho" href="${ctx.url('/carrinho/')}" data-abrir="carrinho" aria-haspopup="dialog">${icones.carrinho}<span class="visualmente-escondido">Carrinho</span><span class="topo__conta" data-conta hidden></span></a>
    </div>
  </div>
</header>`;
}

/* As redes em ícones. */
function redes(ctx, classe = 'redes', { whatsapp = true } = {}) {
  const c = ctx.site.contactos;
  const r = [];
  if (c.instagram) r.push(`<a href="https://www.instagram.com/${esc(c.instagram)}/" target="_blank" rel="noopener">${icones.instagram}<span class="visualmente-escondido">Instagram</span></a>`);
  if (c.facebook) r.push(`<a href="https://www.facebook.com/${esc(c.facebook)}/" target="_blank" rel="noopener">${icones.facebook}<span class="visualmente-escondido">Facebook</span></a>`);
  if (c.whatsapp && whatsapp) r.push(`<a href="https://wa.me/${numeroWhatsApp(c.whatsapp)}" target="_blank" rel="noopener">${icones.whatsapp}<span class="visualmente-escondido">WhatsApp</span></a>`);
  return `<ul class="${classe}">${r.map((x) => `<li>${x}</li>`).join('')}</ul>`;
}

/* O MENU DO TELEMÓVEL (uma folha que entra da esquerda), curto (o Renato, 10 nov 2026: «Organiza
   melhor também o Menu»): os dois serviços em cartões (e a campanha a correr), a loja numa grelha de
   duas colunas, a ajuda em linhas, e o WhatsApp. */
function menu(ctx, atual) {
  const c = ctx.site.contactos;
  const { cats, servicos } = ligacoesDaFila(ctx);
  const marca = (caminho) => (caminho === atual ? ' aria-current="page"' : '');
  const camp = ctx.campanhas[0];
  return `<dialog class="menu" id="menu" aria-label="Menu">
  <div class="menu__corpo" tabindex="-1">
    <div class="menu__topo">
      <a class="menu__marca" href="${ctx.url('/')}">${logotipo(ctx, { alto: 34 })}</a>
      <button class="menu__fechar" type="button" data-fechar>${icones.fechar}<span class="visualmente-escondido">Fechar o menu</span></button>
    </div>
    <nav class="menu__nav" aria-label="Menu">
      <ul class="menu__servicos">
        ${servicos.map((x) => `<li><a class="menu__servico" href="${ctx.url(x.caminho)}"${marca(x.caminho)}><span class="menu__servico-icone">${x.icone}</span><span><strong>${esc(x.nome)}</strong><small>${esc(x.sub)}</small></span></a></li>`).join('')}
        ${camp ? `<li class="menu__servico-largo"><a class="menu__servico menu__servico--campanha" href="${ctx.url(`/campanhas/${camp.slug}/`)}"><span class="menu__servico-icone">${icones.presente}</span><span><strong>${esc(camp.nome)}</strong><small>${esc(camp.faixa)}</small></span></a></li>` : ''}
      </ul>
      <p class="menu__rotulo" id="menu-loja">Loja</p>
      <ul class="menu__grelha" aria-labelledby="menu-loja">
        ${cats.map((x) => `<li><a href="${ctx.url(x.caminho)}"${marca(x.caminho)}>${icones[ICONE_CATEGORIA[x.slug]] || icones.caixa}<span>${esc(x.nome)}</span></a></li>`).join('')}
        <li><a href="${ctx.url('/loja/')}"${marca('/loja/')}>${icones.loja}<span>Toda a loja</span></a></li>
      </ul>
      <p class="menu__rotulo" id="menu-ajuda">Ajuda</p>
      <ul class="menu__linhas" aria-labelledby="menu-ajuda">
        <li><a href="${ctx.url('/contactos/')}"${marca('/contactos/')}>Contactos e horário${icones.seta}</a></li>
        <li><a href="${ctx.url('/envios-e-devolucoes/')}"${marca('/envios-e-devolucoes/')}>Envios e devoluções${icones.seta}</a></li>
        <li><a href="${ctx.url('/perguntas-frequentes/')}"${marca('/perguntas-frequentes/')}>Perguntas frequentes${icones.seta}</a></li>
        <li><a href="${ctx.url('/sobre-nos/')}"${marca('/sobre-nos/')}>Sobre nós${icones.seta}</a></li>
      </ul>
    </nav>
    <div class="menu__pe">
      ${c.whatsapp ? `<a class="botao botao--whatsapp botao--largo" href="https://wa.me/${numeroWhatsApp(c.whatsapp)}" target="_blank" rel="noopener">${icones.whatsapp}<span>Falar no WhatsApp</span></a>` : ''}
      ${redes(ctx, 'redes redes--menu', { whatsapp: false })}
    </div>
  </div>
</dialog>`;
}

/* A FOLHA DA PROCURA (telemóvel): o campo em cima, os resultados por baixo. */
function folhaProcura(ctx) {
  return `<dialog class="folha-procura" id="procurar" aria-label="Procurar">
  <div class="folha-procura__corpo" tabindex="-1">
    ${procura(ctx, 'busca-folha', { fechar: true })}
    <div class="folha-procura__atalhos" data-busca-atalhos>
      <p class="menu__rotulo">Procurados</p>
      <ul class="pilulas">
        <li><a class="pilula" href="${ctx.url('/reparacoes/')}">Reparação de ecrã</a></li>
        <li><a class="pilula" href="${ctx.url('/reparacoes/')}">Troca de bateria</a></li>
        <li><a class="pilula" href="${ctx.url('/loja/recondicionados/')}">iPhone recondicionado</a></li>
        <li><a class="pilula" href="${ctx.url('/loja/peliculas/')}">Películas</a></li>
        <li><a class="pilula" href="${ctx.url('/retoma/')}">Vender o meu telemóvel</a></li>
      </ul>
    </div>
  </div>
</dialog>`;
}

/* O RODAPÉ (memória rodape-com-logotipo), alto: o logótipo, a frase e as redes; a Loja e a Ajuda em
   colunas; em baixo o «©» (só o ano e a marca: memória rodape-sem-dados-da-empresa) e as páginas legais
   numa linha, com o Livro de Reclamações discreto. O Renato, 12 nov 2026: a coluna das reparações estava
   «a mais» e saiu; o rodapé curto que a seguir fiz (numa linha só) não gostou: «mete o que estava antes,
   alto». Sem o bloco dos contactos e do horário (8 nov 2026): estão na página dos contactos. */
function rodape(ctx) {
  const ligacao = (caminho, texto) => `<li><a href="${ctx.url(caminho)}">${esc(texto)}</a></li>`;
  return `<footer class="rodape">
  <div class="rodape__corpo">
    <div class="rodape__marca">
      <a class="rodape__logo" href="${ctx.url('/')}">${logotipo(ctx, { alto: 52, classe: 'rodape__logo-img' })}<span class="visualmente-escondido"> — página inicial</span></a>
      <p class="rodape__frase">${esc(ctx.site.assinatura)}</p>
      ${redes(ctx, 'redes redes--rodape')}
    </div>
    <nav class="rodape__nav" aria-label="Rodapé">
      <div class="rodape__coluna">
        <h2>Loja</h2>
        <ul>
          ${categoriasDeCima(ctx).map((k) => ligacao(`/loja/${k.slug}/`, k.nome)).join('')}
          ${ligacao('/loja/', 'Toda a loja')}
        </ul>
      </div>
      <div class="rodape__coluna">
        <h2>Ajuda</h2>
        <ul>
          ${ligacao('/retoma/', 'Retoma do seu telemóvel')}
          ${ligacao('/envios-e-devolucoes/', 'Envios e devoluções')}
          ${ligacao('/perguntas-frequentes/', 'Perguntas frequentes')}
          ${ligacao('/sobre-nos/', 'Sobre a LF Mobile')}
          ${ligacao('/contactos/', 'Contactos')}
        </ul>
      </div>
    </nav>
  </div>
  <div class="rodape__fim">
    <p class="rodape__direitos">© ${ctx.hoje.slice(0, 4)} ${esc(ctx.site.marca)}</p>
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

/* O WHATSAPP FLUTUANTE: um botão redondo no canto de baixo à direita, que aparece quando se desce na
   página (html[data-whatsapp="sim"], site.js). Foi o Renato que o pediu a 8 nov 2026. Só a ligação,
   sem o número. Não aparece no carrinho, na encomenda, no «obrigado», nem nas páginas com uma barra
   de baixo própria (o modelo a reparar, a retoma): aí tapava o resumo no telemóvel. */
const SEM_WHATSAPP_FLUTUANTE = ['pagina-carrinho', 'pagina-checkout', 'pagina-obrigado', 'pagina-modelo', 'pagina-retoma'];
function whatsappFlutuante(ctx, classe) {
  const n = ctx.site.contactos?.whatsapp;
  if (!n || SEM_WHATSAPP_FLUTUANTE.some((k) => String(classe).split(/\s+/).includes(k))) return '';
  return `<a class="whatsapp-flutuante" href="https://wa.me/${numeroWhatsApp(n)}" target="_blank" rel="noopener" data-whatsapp-flutuante>${icones.whatsapp}<span class="visualmente-escondido">Falar connosco no WhatsApp</span></a>`;
}

export function pagina(ctx, { titulo, descricao, caminho, conteudo, partilha, tipo = 'website', jsonld = [], classe = '', indexar = true }) {
  // a página inicial começa pela capa escura, com o cabeçalho transparente por cima (cabecalho, naCapa)
  const naCapa = String(classe).split(/\s+/).includes('pagina-inicio');
  const tituloCompleto = titulo.includes(ctx.site.marca) ? titulo : `${titulo} | ${ctx.site.marca}`;
  const cartao = partilha || ctx.manifesto.partilha._site;
  const l = ctx.manifesto.logo;
  const imgAbs = ctx.absoluto(`/assets/img/${cartao}`);
  return `<!doctype html>
<html lang="pt-PT"${naCapa ? ' class="na-capa"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script>document.documentElement.dataset.rolado=scrollY>12?'sim':'nao'</script>
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
<meta name="theme-color" content="${naCapa ? '#040404' : '#FFFFFF'}">
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
${faixaTopo(ctx)}
${cabecalho(ctx, caminho, { naCapa })}
<main id="conteudo" tabindex="-1">
${conteudo}
</main>
${rodape(ctx)}
${whatsappFlutuante(ctx, classe)}
${gavetaCarrinho()}
${menu(ctx, caminho)}
${folhaProcura(ctx)}
<script type="application/json" id="horario-loja">${JSON.stringify(ctx.horarioSemana).replace(/</g, '\\u003c')}</script>
</body>
</html>
`;
}
