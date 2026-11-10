// AS REPARAÇÕES, como a iServices e melhor (o Renato, 9 nov 2026: «Para a página das reparações ele
// gosta de um sistema como a iServices tem»). Três páginas:
//   /reparacoes/            escolher o aparelho (marca → família → modelo, com procura; Apple e
//                           Samsung à vista, as outras marcas atrás de «Outras») e a grelha
//                           dos problemas, cada um com a explicação e os sintomas;
//   /reparacoes/<família>/  os modelos de uma família (iPhone, Galaxy S…), para quem chega do Google
//                           ou do rodapé;
//   /reparacoes/<modelo>/   as reparações daquele modelo com o preço (ou «Orçamento grátis»), os
//                           níveis (o ecrã compatível ou original) e a marcação pelo WhatsApp com
//                           tudo escrito; por baixo, as películas para aquele modelo.
// Melhor do que a iServices: tudo numa página (escolher o nível não abre outra), várias reparações de
// uma vez com o total, e a película já com o modelo escolhido.
import { esc, euros, numeroWhatsApp } from './util.mjs';
import { icones, iconeReparacao } from './icones.mjs';
import { usarAparelho, spriteAparelhos } from './aparelhos.mjs';
import { migalhas, imagem, cartaoProduto, notaPorConfirmar, convite } from './componentes.mjs';
import { reparacoesDoModelo } from '../lib/regras.mjs';

const nomeMarca = (ctx, id) => (ctx.aparelhos.marcas.find((m) => m.id === id) || {}).nome || '';
const familiaDe = (ctx, id) => ctx.aparelhos.familias.find((f) => f.id === id);
const modelosDaFamilia = (ctx, id) => ctx.aparelhos.modelos.filter((m) => m.familia === id);

/* O preço de uma reparação, como se diz na lista: «129,90 €», «desde 129,90 €», «Grátis» ou
   «Orçamento grátis». */
export function precoDaReparacao(r) {
  if (r.gratis) return 'Grátis';
  if (r.preco === null) return r.orcamento ? 'Depois do diagnóstico' : 'Orçamento grátis';
  return `${r.desde ? 'desde ' : ''}${euros(r.preco)}`;
}

/* A ESCOLHA DO APARELHO: a marca, a família e o modelo. Sem JavaScript, as famílias são ligações
   para as páginas delas e os modelos estão todos à vista; com JavaScript (reparacoes.js), a marca e
   a família filtram a lista e a procura encontra pelo nome. */
export function seletorDeModelo(ctx, { id = 'escolher', destino = 'reparacoes', titulo = 'Escolha o seu aparelho' } = {}) {
  const { marcas, familias } = ctx.aparelhos;
  const comModelos = familias.filter((f) => modelosDaFamilia(ctx, f.id).length);
  // Apple e Samsung à vista; as outras marcas (o dono repara todas, 9 nov 2026) atrás de «Outras»
  const comFamilias = marcas.filter((m) => comModelos.some((f) => f.marca === m.id));
  const principais = comFamilias.slice(0, 2);
  const outras = comFamilias.slice(2);
  return `<div class="seletor" id="${id}" data-seletor="${destino}">
  <p class="seletor__titulo">${esc(titulo)}</p>
  <div class="seletor__marcas${outras.length ? ' seletor__marcas--com-outras' : ''}" role="group" aria-label="Marca">
    ${principais.map((m, i) => `<button class="seletor__marca" type="button" data-marca="${esc(m.id)}" aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(m.nome)}</button>`).join('')}
    ${outras.length ? `<button class="seletor__marca" type="button" data-outras aria-pressed="false" aria-expanded="false" aria-controls="${id}-outras">Outras<span class="visualmente-escondido"> marcas</span></button>` : ''}
  </div>
  ${outras.length ? `<div class="seletor__outras" id="${id}-outras" role="group" aria-label="Outras marcas" hidden>
    ${outras.map((m) => `<button class="seletor__outra" type="button" data-marca="${esc(m.id)}" aria-pressed="false">${esc(m.nome)}</button>`).join('')}
  </div>` : ''}
  <ul class="seletor__familias" aria-label="Aparelho">
    ${comModelos.map((f) => `<li><a class="seletor__familia" href="${ctx.url(`/reparacoes/${f.id}/`)}" data-familia="${esc(f.id)}" data-marca-da-familia="${esc(f.marca)}">${esc(f.nome)}</a></li>`).join('')}
  </ul>
  <div class="seletor__procura">
    <label class="visualmente-escondido" for="${id}-procura">Procurar o modelo</label>
    ${icones.pesquisa}<input id="${id}-procura" type="search" placeholder="Procurar o modelo (ex.: 13 Pro, S24)" autocomplete="off" data-seletor-procura>
  </div>
  <ul class="seletor__modelos" data-seletor-modelos>
    ${ctx.aparelhos.modelos.map((m) => `<li data-familia="${esc(m.familia)}" data-marca="${esc(m.marca)}" data-nome="${esc(m.nome.toLowerCase())}"><a href="${ctx.url(`/${destino}/${m.id}/`)}">${usarAparelho(m.desenho, 'aparelho--mini')}<span>${esc(m.nome)}</span></a></li>`).join('')}
  </ul>
  <p class="seletor__vazio" data-seletor-vazio hidden>Não encontramos esse modelo.</p>
  <p class="seletor__outro">Outra marca ou modelo? <a href="${ctx.whatsapp('Olá! Queria um orçamento para reparar o meu telemóvel. Marca e modelo: ')}" target="_blank" rel="noopener">Pergunte-nos pelo WhatsApp</a>: o orçamento é grátis.</p>
</div>`;
}

/* A GRELHA DOS PROBLEMAS (a da iServices): o desenho e o nome de cada um; tocar abre a explicação e
   os sintomas por baixo. Sem JavaScript, as explicações estão todas à vista, uma a seguir à outra. */
export function grelhaDosProblemas(ctx, { titulo, texto = '', ligacaoModelo = '#escolher', comPeliculas = true } = {}) {
  const tipos = ctx.tiposReparacao;
  const peliculas = comPeliculas && ctx.produtos.some((p) => p.categoria === 'peliculas');
  return `<section class="problemas" aria-labelledby="problemas-titulo" data-problemas>
  <div class="seccao__cabeca seccao__cabeca--centro">
    <div>
      <h2 class="titulo-seccao" id="problemas-titulo">${esc(titulo)}</h2>
      ${texto ? `<p class="seccao__texto">${esc(texto)}</p>` : ''}
    </div>
  </div>
  <ul class="problemas__grelha" role="tablist" aria-label="Problemas">
    ${tipos.map((t, i) => `<li role="presentation"><a class="problema" href="#problema-${esc(t.id)}" role="tab" id="aba-${esc(t.id)}" aria-controls="problema-${esc(t.id)}" aria-selected="${i === 0 ? 'true' : 'false'}" data-problema="${esc(t.id)}"><span class="problema__icone">${iconeReparacao(t.icone)}</span><span class="problema__nome">${esc(t.nome)}</span></a></li>`).join('')}
    ${peliculas ? `<li role="presentation"><a class="problema problema--loja" href="${ctx.url('/loja/peliculas/')}"><span class="problema__icone">${icones.pelicula}</span><span class="problema__nome">Películas</span></a></li>` : ''}
  </ul>
  <div class="problemas__paineis">
    ${tipos.map((t) => `<div class="problema-painel${t.foto ? ' problema-painel--foto' : ''}" id="problema-${esc(t.id)}" role="tabpanel" aria-labelledby="aba-${esc(t.id)}" data-painel="${esc(t.id)}">
      ${t.foto && ctx.manifesto.fotos[t.foto] ? `<figure class="problema-painel__foto">${imagem(ctx, t.foto, { tamanhos: '(min-width: 900px) 420px, 100vw' })}</figure>` : ''}
      <div class="problema-painel__texto">
        <h3>${esc(t.titulo)}</h3>
        <p>${esc(t.resumo)}</p>
        ${t.sintomas.length ? `<ul class="lista-certa">${t.sintomas.map((s) => `<li>${icones.certo}<span>${esc(s)}</span></li>`).join('')}</ul>` : ''}
        <a class="botao botao--cheio" href="${esc(ligacaoModelo)}" data-ir-escolher>Ver o preço para o meu modelo${icones.seta}</a>
      </div>
    </div>`).join('\n')}
  </div>
</section>`;
}

const passos = (ctx) => `<section class="passos-faixa" aria-labelledby="passos-titulo">
  <h2 class="titulo-seccao" id="passos-titulo">Como funciona</h2>
  <ol class="passos-faixa__lista">
    <li><span class="passos-faixa__n">1</span><strong>Veja o preço</strong><span>Escolha o modelo e a reparação aqui no site.</span></li>
    <li><span class="passos-faixa__n">2</span><strong>Marque ou passe na loja</strong><span>Pelo WhatsApp, com tudo já escrito, ou em ${esc(ctx.site.local.localidade)}.</span></li>
    <li><span class="passos-faixa__n">3</span><strong>Diagnóstico grátis</strong><span>Confirmamos o problema e o preço antes de reparar.</span></li>
  </ol>
</section>`;

// ---------------------------------------------------------------- /reparacoes/
export function reparacoes(ctx) {
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: 'Reparações', caminho: '/reparacoes/' }]);
  const conteudo = `${spriteAparelhos()}
<section class="rep-capa">
  <div class="contentor rep-capa__grelha">
    <div class="rep-capa__texto">
      <p class="rotulo rotulo--claro">Reparações</p>
      <h1 class="rep-capa__titulo">Reparação de telemóveis, com o preço à vista.</h1>
      <p class="rep-capa__sub">Todas as marcas. Escolha o seu modelo e veja quanto custa. Diagnóstico e orçamento grátis, na loja ou pelo WhatsApp.</p>
      <ul class="rep-capa__pontos">
        <li>${icones.certo}Orçamento grátis e sem compromisso</li>
        <li>${icones.certo}Ecrã compatível ou original, à escolha</li>
        <li>${icones.certo}Na loja, em ${esc(ctx.site.local.localidade)}</li>
      </ul>
    </div>
    ${seletorDeModelo(ctx)}
  </div>
</section>
<div class="contentor">
  ${grelhaDosProblemas(ctx, { titulo: 'O que se passa com o seu telemóvel?', texto: 'Escolha o problema para ver o que fazemos.' })}
  ${passos(ctx)}
  ${convite(ctx, { titulo: 'Não encontra o seu caso? Pergunte-nos.', texto: 'Olá! Queria um orçamento para uma reparação.' })}
</div>`;
  return {
    caminho: '/reparacoes/',
    titulo: 'Reparação de telemóveis de todas as marcas — preços por modelo',
    descricao: `Reparação de iPhone, Samsung, Xiaomi, Huawei, OPPO e outras marcas em ${ctx.site.local.localidade}, ${ctx.site.local.concelho}: ecrã, bateria, traseira, câmaras, carregamento. Veja o preço do seu modelo; orçamento grátis.`,
    classe: 'pagina-reparacoes',
    jsonld: [m.ld, {
      '@context': 'https://schema.org', '@type': 'Service', name: 'Reparação de telemóveis, tablets e relógios de todas as marcas', provider: { '@id': ctx.absoluto('/#loja') }, areaServed: { '@type': 'Country', name: 'Portugal' },
      hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Reparações', itemListElement: ctx.tiposReparacao.map((t) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: t.titulo, description: t.resumo } })) },
    }],
    conteudo,
  };
}

// ---------------------------------------------------------------- /reparacoes/<família>/
export function familia(ctx, f) {
  const lista = modelosDaFamilia(ctx, f.id);
  const caminho = `/reparacoes/${f.id}/`;
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: 'Reparações', caminho: '/reparacoes/' }, { nome: f.nome, caminho }]);
  const conteudo = `${spriteAparelhos()}
<div class="contentor familia-pagina">
  ${m.html}
  <header class="cabeca">
    <p class="rotulo">${esc(nomeMarca(ctx, f.marca))}</p>
    <h1 class="titulo-pagina">Reparação ${esc(f.nome)}</h1>
    <p class="cabeca__sub">Escolha o seu modelo para ver as reparações e os preços.</p>
  </header>
  <ul class="modelos-grelha">
    ${lista.map((x) => `<li><a class="modelo-cartao" href="${ctx.url(`/reparacoes/${x.id}/`)}">${usarAparelho(x.desenho)}<span class="modelo-cartao__nome">${esc(x.nome)}</span>${x.ano ? `<span class="modelo-cartao__ano">${x.ano}</span>` : ''}</a></li>`).join('')}
  </ul>
  ${convite(ctx, { titulo: 'O seu modelo não está na lista? Pergunte-nos.', texto: `Olá! Queria um orçamento para reparar o meu ${f.nome}: ` })}
</div>`;
  return {
    caminho,
    titulo: `Reparação ${f.nome} — escolha o modelo`,
    descricao: `Reparação de ${f.nome} em ${ctx.site.local.localidade}: ${lista.slice(0, 6).map((x) => x.nome).join(', ')} e outros. Ecrã, bateria e mais, com o preço de cada modelo.`,
    classe: 'pagina-familia',
    jsonld: [m.ld],
    conteudo,
  };
}

// ---------------------------------------------------------------- /reparacoes/<modelo>/
export function modelo(ctx, x) {
  const f = familiaDe(ctx, x.familia);
  const caminho = `/reparacoes/${x.id}/`;
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: 'Reparações', caminho: '/reparacoes/' }, { nome: f.nome, caminho: `/reparacoes/${f.id}/` }, { nome: x.nome, caminho }]);
  const reps = reparacoesDoModelo(ctx.dados.reparacoes, x, { mostrarPorConfirmar: !ctx.producao });
  const porConfirmar = reps.some((r) => r.porConfirmar);
  const marca = nomeMarca(ctx, x.marca);
  const lista = reps.map((r) => {
    const niveisComPreco = r.niveis.filter((n) => n.preco !== null);
    const escolherNivel = r.niveis.length > 1 && niveisComPreco.length > 1;
    return `<div class="rep" id="${esc(r.id)}" data-rep="${esc(r.id)}" data-nome="${esc(r.nome)}">
      <label class="rep__cabeca">
        <input type="checkbox" name="reparacao" value="${esc(r.id)}" data-preco="${r.preco ?? ''}" data-gratis="${r.gratis ? 'sim' : ''}"${!escolherNivel && r.niveis.length > 1 && niveisComPreco.length === 1 ? ` data-nivel="${esc(niveisComPreco[0].nome)}"` : ''}>
        <span class="rep__icone">${iconeReparacao(r.icone)}</span>
        <span class="rep__texto"><span class="rep__nome">${esc(r.titulo)}</span><span class="rep__resumo">${esc(r.resumo)}</span></span>
        <span class="rep__preco${r.preco === null && !r.gratis ? ' rep__preco--orcamento' : ''}">${esc(precoDaReparacao(r))}</span>
        <span class="rep__marca" aria-hidden="true">${icones.certo}</span>
      </label>
      ${escolherNivel ? `<fieldset class="rep__niveis" data-niveis hidden>
        <legend>Que ${esc(r.nome.toLowerCase())}?</legend>
        ${r.niveis.map((n, i) => `<label class="nivel${n.preco === null ? ' nivel--sem' : ''}">
          <input type="radio" name="nivel-${esc(r.id)}" value="${esc(n.id)}" data-preco="${n.preco ?? ''}" data-nome-nivel="${esc(n.nome)}"${n.preco !== null && n.preco === r.preco && !r.niveis.slice(0, i).some((y) => y.preco === r.preco) ? ' checked' : ''}${n.preco === null ? ' disabled' : ''}>
          <span class="nivel__texto"><strong>${esc(n.nome)}</strong>${n.texto ? `<span>${esc(n.texto)}</span>` : ''}</span>
          <span class="nivel__preco">${n.preco === null ? 'Pergunte-nos' : euros(n.preco)}</span>
        </label>`).join('')}
      </fieldset>` : ''}
    </div>`;
  }).join('\n');
  const peliculas = ctx.produtos.filter((p) => p.categoria === 'peliculas' && p.pedeModelo === true).slice(0, 4);
  const irmaos = modelosDaFamilia(ctx, f.id).filter((y) => y.id !== x.id);
  const msgBase = `Olá! Quero marcar uma reparação.\n\nEquipamento: ${x.nome}`;
  const conteudo = `<div class="contentor modelo-pagina" data-modelo="${esc(x.id)}" data-nome-modelo="${esc(x.nome)}"${porConfirmar ? ' data-por-confirmar="sim"' : ''}>
  ${m.html}
  <header class="modelo-cabeca">
    <div class="modelo-cabeca__desenho">${usarAparelho(x.desenho, 'aparelho--grande')}</div>
    <div class="modelo-cabeca__texto">
      <p class="rotulo">${esc(marca)} · ${esc(f.nome)}</p>
      <h1 class="titulo-pagina">Reparação ${esc(x.nome)}</h1>
      <p class="cabeca__sub">Escolha o que quer reparar: pode juntar mais do que uma. O diagnóstico e o orçamento são grátis.</p>
      ${porConfirmar ? notaPorConfirmar(ctx, 'preços de referência do mercado, a confirmar pela loja') : ''}
    </div>
  </header>
  <div class="modelo-grelha">
    <form class="reps" data-reparacoes novalidate>
      <fieldset class="reps__lista">
        <legend class="visualmente-escondido">Reparações do ${esc(x.nome)}</legend>
        ${lista}
      </fieldset>
    </form>
    <aside class="resumo-rep" id="marcar" aria-labelledby="resumo-rep-titulo" data-resumo-rep>
      <h2 class="resumo-rep__titulo" id="resumo-rep-titulo">A sua reparação</h2>
      <p class="resumo-rep__aparelho">${usarAparelho(x.desenho, 'aparelho--mini')}<span>${esc(x.nome)}</span></p>
      <ul class="resumo-rep__linhas" data-resumo-linhas><li class="resumo-rep__vazio">Escolha uma ou mais reparações.</li></ul>
      <p class="resumo-rep__total" data-resumo-total hidden></p>
      <div class="campo"><label for="rep-nome">O seu nome <span class="campo__opcional">(opcional)</span></label><input id="rep-nome" type="text" maxlength="60" autocomplete="name" data-resumo-nome></div>
      ${ctx.site.contactos.whatsapp ? `<button class="botao botao--whatsapp botao--largo" type="button" data-marcar data-mensagem="${esc(msgBase)}">${icones.whatsapp}<span>Marcar pelo WhatsApp</span></button>` : ''}
      <p class="resumo-rep__nota">O preço confirma-se no diagnóstico, antes de reparar.</p>
    </aside>
  </div>
  <div class="barra-rep" data-barra-rep hidden>
    <p class="barra-rep__texto" data-barra-texto></p>
    <a class="botao botao--cheio" href="#marcar">Marcar</a>
  </div>
  ${peliculas.length ? `<section class="modelo-peliculas" aria-labelledby="pel-titulo">
    <div class="seccao__cabeca"><div><h2 class="titulo-seccao" id="pel-titulo">Películas para o ${esc(x.nome)}</h2><p class="seccao__texto">Escolha o tipo: o modelo já vai escolhido.</p></div></div>
    <div class="grelha grelha--4">${peliculas.map((p) => cartaoProduto(ctx, p, { comBotao: false }).replace(`href="${ctx.url(`/produtos/${p.slug}/`)}"`, `href="${ctx.url(`/produtos/${p.slug}/`)}?modelo=${encodeURIComponent(`${marca}|${x.nome}`)}"`)).join('\n')}</div>
  </section>` : ''}
  ${irmaos.length ? `<section class="modelo-irmaos" aria-labelledby="irmaos-titulo">
    <h2 class="titulo-pequeno" id="irmaos-titulo">Outros ${esc(f.nome)}</h2>
    <ul class="pilulas">${irmaos.map((y) => `<li><a class="pilula" href="${ctx.url(`/reparacoes/${y.id}/`)}">${esc(y.nome)}</a></li>`).join('')}</ul>
  </section>` : ''}
</div>
${spriteAparelhos()}`;
  const comPreco = ctx.producao ? reps.filter((r) => r.preco !== null && !r.porConfirmar) : [];
  return {
    caminho,
    titulo: `Reparação ${x.nome} — ecrã, bateria e mais`,
    descricao: `Reparação do ${x.nome} em ${ctx.site.local.localidade}, ${ctx.site.local.concelho}: ${reps.slice(0, 5).map((r) => r.nome.toLowerCase()).join(', ')}. Veja o preço e marque pelo WhatsApp; diagnóstico grátis.`.slice(0, 160),
    classe: 'pagina-modelo',
    jsonld: [m.ld, {
      '@context': 'https://schema.org', '@type': 'Service', name: `Reparação ${x.nome}`, provider: { '@id': ctx.absoluto('/#loja') }, areaServed: { '@type': 'Country', name: 'Portugal' },
      ...(comPreco.length ? { hasOfferCatalog: { '@type': 'OfferCatalog', name: `Reparações ${x.nome}`, itemListElement: comPreco.map((r) => ({ '@type': 'Offer', priceCurrency: 'EUR', price: r.preco.toFixed(2), itemOffered: { '@type': 'Service', name: `${r.titulo} ${x.nome}` } })) } } : {}),
    }],
    conteudo,
  };
}
