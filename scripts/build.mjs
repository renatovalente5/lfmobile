#!/usr/bin/env node
// Gera o site da LF Mobile em _site/, a partir de content/ e media/. Node 22, sem dependências.
// (O gerador é o da Mimices, adaptado: loja de tecnologia com reparações, retoma e pagamentos.)
//
//   node scripts/build.mjs                       local, em http://localhost:4870/
//   node scripts/build.mjs --base=/lfmobile      pré-visualização no GitHub Pages (noindex)
//   node scripts/build.mjs --dominio             o domínio (na Cloudflare) ANTES de abrir: na raiz,
//                                                com o _headers, mas fechado aos motores de busca e
//                                                com o que falta «[por confirmar]»
//   node scripts/build.mjs --producao            o domínio aberto: aos motores de busca, e RECUSA
//                                                publicar com dados legais por preencher
//   node scripts/build.mjs --api=<url>           o Worker das encomendas (sem isto, o do workers.dev)
//   node scripts/build.mjs --sem-imagens         não corre o scripts/imagens.py (usa a cache)
//
// Os textos que a lei manda ter certos (identificação, NIF, morada, contactos, prazos, portes) vêm
// todos de content/site.json por marcadores ({{email}}, {{empresa.identificacao}}…): nunca escritos
// à mão nas páginas, para não envelhecerem num sítio e ficarem certos noutro.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { esc, euros, hojeEmLisboa, markdown, numeroWhatsApp, numeroLegivel, custoChamada, notaChamada, moradaCompleta } from '../src/templates/util.mjs';
import { pagina } from '../src/templates/layout.mjs';
import * as R from '../src/lib/regras.mjs';
import * as paginas from '../src/templates/paginas.mjs';
import * as reparacoes from '../src/templates/reparacoes.mjs';
import { retoma as paginaRetoma } from '../src/templates/retoma.mjs';
/* As peças legais comuns aos sites do Renato (a cópia em legal-comum/, instalada por
   _ferramentas/legal-comum/instalar.mjs; não se edita aqui). */
import { livroCss, destinatariosHtml, CATALOGO_DESTINATARIOS, frasesPrivacidade, prazos as PRAZOS_LEGAIS, verificarIdentificacao, verificarPromocao, verificarProduto, AVISO_RETOMA, COMO_SE_FAZ_A_ENCOMENDA, BOTAO_ENCOMENDA, formularioLivreResolucao, ralHtml, textoGarantia, VERSAO as LEGAL_COMUM_VERSAO } from '../legal-comum/index.mjs';
import { pecaLegal } from '../src/templates/componentes.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
// --conteudo=<pasta> e --saida=<pasta>: para as baterias e o ensaio do painel gerarem o site a
// partir de outro conteúdo (o media/, os modelos e a cache das imagens são sempre os daqui).
const CONTEUDO = path.resolve(args.find((a) => a.startsWith('--conteudo='))?.slice(11) || path.join(RAIZ, 'content'));
const SAIDA = path.resolve(args.find((a) => a.startsWith('--saida='))?.slice(8) || path.join(RAIZ, '_site'));
const producao = args.includes('--producao');
const dominio = producao || args.includes('--dominio');
const base = dominio ? '' : (args.find((a) => a.startsWith('--base='))?.slice(7) || '').replace(/\/$/, '');
const semImagens = args.includes('--sem-imagens');

// O domínio (o Renato compra-o quando o site estiver pronto, 8 nov 2026: lfmobile.pt estava livre):
// o canonical, o sitemap e os cartões de partilha seguem-no em produção.
const DOMINIO = 'lfmobile.pt';
const ORIGEM = dominio ? `https://${DOMINIO}` : (base ? 'https://renatovalente5.github.io' : 'http://localhost:4870');
// O Worker das encomendas e dos pagamentos (worker/): em produção, o do workers.dev da conta do Renato.
const API = (args.find((a) => a.startsWith('--api='))?.slice(6) || process.env.LF_API || 'https://lfmobile-encomendas.renato-lima-valente-dcb.workers.dev').replace(/\/$/, '');

const erros = [];
const avisos = [];
// NO GITHUB ACTIONS, CADA PROBLEMA VAI TAMBÉM COMO ANOTAÇÃO (::error / ::warning): é o que o painel
// lê para dizer ao dono porque é que a publicação parou («Dados da loja › Contactos: falta o
// email»), com a ligação para o ecrã onde se corrige. O título é o ecrã («A › B: mensagem»).
const NO_CI = process.env.GITHUB_ACTIONS === 'true';
const escaparDados = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escaparPropriedade = (s) => escaparDados(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
function anotar(nivel, texto) {
  if (!NO_CI) return;
  const m = /^([^:]{3,80}?): (.+)$/s.exec(String(texto));
  console.log(m ? `::${nivel} title=${escaparPropriedade(m[1])}::${escaparDados(m[2])}` : `::${nivel}::${escaparDados(texto)}`);
}
/** Pára a publicação: a lista no registo e, no CI, uma anotação por problema (10 no máximo: o
 *  GitHub não guarda mais por passo; a lista inteira calcula-a o painel). `tecnico`: um defeito do
 *  gerador, e não do conteúdo — a anotação di-lo, e o painel manda falar com o Renato. */
function parar(titulo, lista, { tecnico = false } = {}) {
  console.error(`\n${titulo}\n`);
  for (const e of lista) console.error(`  ✗ ${e}`);
  for (const e of [...new Set(lista)].slice(0, 10)) anotar('error', tecnico ? `${e} (Só o Renato pode corrigir.)` : e);
  process.exit(1);
}
const existe = (rel) => fs.existsSync(path.join(RAIZ, rel));
// Os ficheiros de uma pasta com a extensão dada, sem a extensão; uma pasta que não existe (o git não
// guarda pastas vazias: media/video/ sem vídeos não chega ao CI) é uma lista vazia.
const listar = (rel, ext) => (existe(rel) ? fs.readdirSync(path.join(RAIZ, rel)).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)) : []);

// ---------------------------------------------------------------- conteúdo e regras
// As regras dos dados estão em src/lib/regras.mjs, o MESMO ficheiro que o painel usa (cópia byte a
// byte em lfmobile-painel/estatico/js/regras.js): o que o painel deixa gravar é o que a publicação
// aceita. Classes: «bloqueia» pára a publicação; «neutraliza» esconde só aquele artigo (ou tira-lhe
// a fotografia que falta) na cópia que o gerador lê; «avisa» só avisa.
const lerTexto = (rel) => fs.readFileSync(path.join(CONTEUDO, rel.replace(/^content\//, '')), 'utf8');
const dadosRegras = {
  site: lerTexto('content/site.json'),
  inicio: lerTexto('content/inicio.json'),
  categorias: lerTexto('content/categorias.json'),
  fotos: lerTexto('content/fotos.json'),
  aparelhos: lerTexto('content/aparelhos.json'),
  reparacoes: lerTexto('content/reparacoes.json'),
  retoma: lerTexto('content/retoma.json'),
  campanhas: lerTexto('content/campanhas.json'),
  artigos: Object.fromEntries(fs.readdirSync(path.join(CONTEUDO, 'produtos')).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), lerTexto(`content/produtos/${f}`)])),
  ficheirosFotos: fs.readdirSync(path.join(RAIZ, 'media/fotos')).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)),
  videos: listar('media/video', '.mp4'),
};
const hoje = hojeEmLisboa();
const listaRegras = R.problemas(dadosRegras, { hoje, producao });
for (const p of listaRegras.filter((x) => x.classe === 'bloqueia')) erros.push(`${p.ecra}: ${p.mensagem}`);
for (const p of listaRegras.filter((x) => x.classe === 'avisa')) avisos.push(`${p.ecra}: ${p.mensagem}`);
if (erros.length) parar(`A publicação parou: ${erros.length} ${erros.length === 1 ? 'problema' : 'problemas'} no conteúdo.`, erros);
const neutro = R.neutralizar(dadosRegras, listaRegras);
for (const e of neutro.efeitos) {
  avisos.push(`Artigos › ${e.nome}: ${R.descreverEfeitos(e)} (${e.motivos.join(' ')})`);
  anotar('warning', `Artigos › ${e.nome}: ${R.descreverEfeitos(e)}.`);
}

const site = JSON.parse(dadosRegras.site);
const inicio = JSON.parse(dadosRegras.inicio);
const categorias = JSON.parse(dadosRegras.categorias);
const fotos = JSON.parse(dadosRegras.fotos);
// Os modelos (só os que passam nas regras), os tipos de reparação, a retoma (os valores por
// confirmar só na pré-visualização) e as campanhas que estão a correr HOJE.
const aparelhos = R.aparelhosDe(dadosRegras.aparelhos);
const tiposReparacao = R.tiposDeReparacao(dadosRegras.reparacoes);
const retoma = R.retomaDe(dadosRegras.retoma, { mostrarPorConfirmar: !producao });
const campanhas = R.campanhasActivas(dadosRegras.campanhas, hoje);
// Os artigos como o gerador os lê: a cópia neutralizada (um artigo com problemas sai escondido),
// com o desconto da campanha que os apanha (o preço normal fica riscado, com o período).
const produtos = Object.entries(neutro.artigos)
  .map(([slug, a]) => ({ slug, ...R.comCampanha(a, slug, campanhas, hoje, categorias) }))
  .filter((p) => p.publicado !== false)
  .sort((a, b) => (a.ordem ?? 500) - (b.ordem ?? 500) || a.nome.localeCompare(b.nome, 'pt'));
const fotoExiste = (f) => fotos[f] && dadosRegras.ficheirosFotos.includes(f);

// ---------------------------------------------------------------- as guardas legais (só avisam)
/* As guardas da biblioteca legal-comum, em modo AVISAR: nada pára nem se esconde por elas; o que dizem
   vai para os avisos do registo da publicação, para o Renato ver. A identificação (DL 7/2004, art.
   10.º), as promoções (DL 70/2007, art. 5.º) e as fichas (Regulamento (UE) 2023/988, art. 19.º; a
   retoma dos equipamentos eléctricos, DL 152-D/2017). Os dados que a lei pede param a produção pelas
   regras (regras.mjs, `legal()`), não por aqui. */
{
  const e = site.empresa || {};
  const FORMAS = [[/nome individual|\beni\b/i, 'eni'], [/unipessoal/i, 'unipessoal'], [/\blda\b|limitada/i, 'lda'], [/\bs\.?\s?a\b|an[óo]nima/i, 'sa']];
  const forma = FORMAS.find(([re]) => re.test(e.tipo || ''))?.[1] || (!e.nif ? 'sem-actividade' : undefined);
  const r = verificarIdentificacao({
    nome: e.nome, formaJuridica: forma, nif: e.nif,
    morada: [e.morada, [e.codigoPostal, e.localidade].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    email: site.contactos?.email, telefone: site.contactos?.telefone || site.contactos?.whatsapp,
  }, { modo: 'avisar', ecra: 'Dados da loja › Dados legais' });
  for (const p of r.problemas) avisos.push(`Identificação (${p.campo}): ${p.mensagem}`);
}
const EEE = new Set(['iphone', 'samsung', 'recondicionados', 'tablets', 'smartwatches', 'audio']);
for (const p of produtos) {
  if (typeof p.precoAnterior === 'number' && typeof p.preco === 'number' && p.precoAnterior > p.preco) {
    const r = verificarPromocao({ precoAntes: p.precoAnterior, precoAgora: p.preco, inicio: p.promocaoDesde, fim: p.promocaoAte, historico: [] }, { modo: 'avisar' });
    for (const x of r.problemas) avisos.push(`Promoção › ${p.nome}: ${x.mensagem}`);
  }
  const e = site.empresa || {};
  const fab = paginas.fabricanteDoArtigo(p) || { nome: e.nome, morada: [e.morada, e.codigoPostal, e.localidade].filter(Boolean).join(', '), email: site.contactos?.email };
  const categoria = EEE.has(p.categoria) || /find my|localizador|bluetooth|carregador|bateria/i.test(`${p.nome} ${p.resumo}`) ? 'eee' : 'geral';
  const r = verificarProduto({ nome: p.nome, preco: p.preco, comIva: true, aVenda: R.compravel(p), fabricante: fab, referencia: p.referencia, avisos: paginas.avisosDoArtigo(p), retoma: categoria === 'eee' }, { categoria, modo: 'avisar' });
  for (const x of r.problemas) avisos.push(`Ficha › ${p.nome}: ${x.mensagem}`);
}

// As páginas de texto (content/paginas/*.md) não passam pelo painel: só o Renato as muda.
// Conferem-se aqui as alegações e a fotografia.
for (const f of fs.readdirSync(path.join(CONTEUDO, 'paginas'))) {
  const t = lerTexto(`content/paginas/${f}`);
  const m = t.match(R.RE_ALEGACOES);
  if (m) erros.push(`Páginas › ${f}: «${m[0]}» é uma alegação que a lei só deixa fazer com prova (ou uma certificação que não temos). Tire a palavra.`);
}
if (erros.length) parar(`A publicação parou: ${erros.length} ${erros.length === 1 ? 'problema' : 'problemas'} no conteúdo.`, erros);

// ---------------------------------------------------------------- imagens
if (!semImagens) execFileSync('python3', [path.join(RAIZ, 'scripts/imagens.py')], { stdio: 'inherit' });
const manifesto = JSON.parse(fs.readFileSync(path.join(RAIZ, '.cache/imagens/manifesto.json'), 'utf8'));
const semVersoes = Object.keys(fotos).filter((f) => dadosRegras.ficheirosFotos.includes(f) && !manifesto.fotos[f]);
if (semVersoes.length) parar('A publicação parou: faltam as versões web de fotografias.', semVersoes.map((f) => `Fotografias: «${f}» não tem as versões web (scripts/imagens.py)`), { tecnico: true });

// ---------------------------------------------------------------- saída
fs.rmSync(SAIDA, { recursive: true, force: true });
fs.mkdirSync(path.join(SAIDA, 'assets/img'), { recursive: true });
const copiar = (de, para) => { fs.mkdirSync(path.dirname(para), { recursive: true }); fs.copyFileSync(de, para); };
const resumo = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);

for (const f of fs.readdirSync(path.join(RAIZ, '.cache/imagens'))) {
  if (f !== 'manifesto.json' && !f.endsWith('.resumo')) copiar(path.join(RAIZ, '.cache/imagens', f), path.join(SAIDA, 'assets/img', f));
}
for (const f of fs.readdirSync(path.join(RAIZ, 'src/fontes'))) copiar(path.join(RAIZ, 'src/fontes', f), path.join(SAIDA, 'assets/fontes', f));

// o aviso oficial da garantia: byte a byte o da Comissão (media/legal/LEIA.md)
const AVISO_SHA = {
  'aviso-garantia-legal-pt.svg': '9069bb0bc5e9f3cf655579038be5646181cc5447a25f3f8ccf2d018eacba0ac1',
  'aviso-garantia-legal-pt.pdf': 'b145a3014984f474d9bb81c60b5a492a376e64e55695eb089f0554adaa752877',
};
for (const [f, sha] of Object.entries(AVISO_SHA)) {
  const buf = fs.readFileSync(path.join(RAIZ, 'media/legal', f));
  if (crypto.createHash('sha256').update(buf).digest('hex') !== sha) parar('A publicação parou: o aviso da garantia foi alterado.', [`Garantia: media/legal/${f} foi alterado, e o aviso oficial da garantia não se pode editar`], { tecnico: true });
  copiar(path.join(RAIZ, 'media/legal', f), path.join(SAIDA, 'assets/legal', f));
}
const AVISO_ALT = 'GARANTIA LEGAL. Proteção da garantia legal mínima de dois anos para os bens vendidos na União Europeia. Os consumidores podem invocar os seus direitos ao abrigo da garantia legal de conformidade, por exemplo, se os bens: não corresponderem à descrição; não funcionarem como previsto. Os vendedores são responsáveis por qualquer falta de conformidade que exista no momento em que os bens forem entregues e se manifeste no período de garantia legal. Os vendedores nessa situação estão obrigados a oferecer: reparação gratuita ou substituição gratuita; em alguns casos, redução do preço ou reembolso integral. Alguns países têm um período de garantia legal mais longo. Para os bens em segunda mão, pode aplicar-se um período mais curto, mas não inferior a um ano. Para mais informações sobre os seus direitos num determinado país, digitalize o código QR abaixo ou consulte o vendedor. europa.eu/youreurope/garantias. O que fazer se receber bens não conformes: 1. Contactar o vendedor o mais rapidamente possível para expor o problema; 2. Apresentar uma prova de compra, como um recibo, uma fatura ou um extrato bancário. Os vendedores e os produtores também podem oferecer garantias comerciais, que se aplicam independentemente da garantia legal. Por exemplo, pode ver este rótulo GARAN, que representa uma garantia comercial de durabilidade oferecida pelo produtor sem custos adicionais e cobrindo a totalidade do bem.';

// vídeos: nome com resumo, para a cache de um ano nunca servir um vídeo antigo
const ficheirosVideo = {};
for (const f of listar('media/video', '.mp4').map((x) => `${x}.mp4`)) {
  const buf = fs.readFileSync(path.join(RAIZ, 'media/video', f));
  const nome = f.replace(/\.mp4$/, '');
  ficheirosVideo[nome] = `video/${nome}-${resumo(buf)}.mp4`;
  copiar(path.join(RAIZ, 'media/video', f), path.join(SAIDA, 'assets', ficheirosVideo[nome]));
}

// CSS e JS: um ficheiro cada, com o resumo no nome
/* A folha de estilos leva o CSS do Livro de Reclamações (legal-comum), ANTES do site.css: as regras do
   rodapé (.rodape__legal a) ganham, e o Livro fica com a letra e a cor das ligações vizinhas. (A fachada
   do mapa do Google saiu a 8 nov 2026: o mapa dos contactos é desenhado pelo site, scripts/mapa.mjs.) */
const css = Buffer.concat([
  Buffer.from(`/* legal-comum v${LEGAL_COMUM_VERSAO}: o Livro de Reclamações */\n${livroCss()}\n`),
  fs.readFileSync(path.join(RAIZ, 'src/estilos/site.css')),
]);
const js = Buffer.from(['site.js', 'carrinho.js', 'loja.js', 'reparacoes.js', 'retoma.js'].map((f) => `// ${f}\n${fs.readFileSync(path.join(RAIZ, 'src/scripts', f), 'utf8')}`).join('\n'));
const ficheiros = { css: `site-${resumo(css)}.css`, js: `site-${resumo(js)}.js`, videos: ficheirosVideo };
fs.writeFileSync(path.join(SAIDA, 'assets', ficheiros.css), css);
fs.writeFileSync(path.join(SAIDA, 'assets', ficheiros.js), js);

// ---------------------------------------------------------------- contexto dos modelos
const numero = numeroWhatsApp(site.contactos.whatsapp);
const escaloes = R.escaloesDe(site.entrega?.portes?.continente);
/* A escolha do modelo nas películas: as marcas da lista dos modelos (Apple e Samsung primeiro), com
   os telemóveis de cada uma e as sugestões de content/aparelhos.json (outrasMarcas: os modelos mais
   recentes e as marcas sem modelos na lista), sem repetir nomes. */
const modelosPorMarca = {};
for (const m of aparelhos.marcas) modelosPorMarca[m.nome] = aparelhos.modelos.filter((x) => x.marca === m.id && x.tipo === 'telemovel').map((x) => x.nome);
for (const o of aparelhos.outrasMarcas) {
  const k = Object.keys(modelosPorMarca).find((n) => n.toLowerCase() === o.nome.toLowerCase()) || o.nome;
  const vistos = new Set();
  modelosPorMarca[k] = [...o.modelos, ...(modelosPorMarca[k] || [])].filter((n) => { const c = n.toLowerCase(); if (vistos.has(c)) return false; vistos.add(c); return true; });
}
const ctx = {
  site, inicio, categorias, produtos, fotos, manifesto, hoje, producao, ficheiros, api: API, base,
  aparelhos, tiposReparacao, retoma, campanhas, escaloes, modelosPorMarca, marcasParaModelo: Object.keys(modelosPorMarca),
  dados: dadosRegras,
  videos: {},
  url: (c) => (/^https?:|^mailto:|^tel:|^#/.test(c) ? c : `${base}${c}`),
  asset: (rel) => `${base}/assets/${rel}`,
  absoluto: (c) => `${ORIGEM}${base}${c}`,
  // sem número ainda: o wa.me sem número abre o WhatsApp a pedir o contacto (dá para ensaiar)
  whatsapp: (texto) => `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`,
  numeroLegivel, custoChamada, notaChamada,
  marcador: (desc) => `<mark class="por-confirmar">[por confirmar: ${esc(desc)}]</mark>`,
  // o mapa da loja (scripts/mapa.mjs), escrito dentro da página dos contactos: aparece logo, sem pedidos
  mapaLoja: existe('media/mapa/loja.svg') ? fs.readFileSync(path.join(RAIZ, 'media/mapa/loja.svg'), 'utf8').trim() : '',
};
/* O horário para a faixa do topo dizer «Aberta · fecha às 19:00» (site.js): os dias (0 = domingo,
   como no Date do browser) e as horas de abrir e fechar, do mesmo horário que o Google lê. */
const DIA_JS = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
ctx.horarioSemana = paginas.horarioLd(ctx).filter((h) => h.opens !== h.closes).map((h) => ({ dias: h.dayOfWeek.map((d) => DIA_JS[d]), abre: h.opens, fecha: h.closes }));

// ---------------------------------------------------------------- catálogo do carrinho e do Worker
/* O que o carrinho e o Worker das encomendas lêem: os preços, as escolhas e a disponibilidade de cada
   artigo, as zonas e os portes da loja, o modo dos pagamentos e os endereços. O carrinho nunca guarda
   preços. Sai duas vezes: com o resumo no nome (a cache de um ano, para o site) e como
   assets/catalogo.json (nome fixo, para o Worker ler sempre o actual). */
/* A imagem pequena de um artigo (o carrinho, a procura): o recorte, quando o há. */
const fotoPequena = (f) => {
  const r = manifesto.recortes?.[f];
  if (r) { const w = r.larguras.find((x) => x >= 240) || r.larguras[0]; return ctx.asset(`img/recorte-${f}-${r.resumo}-${w}.webp`); }
  const m = manifesto.fotos[f]; const w = m.larguras.find((x) => x >= 360) || m.larguras[0]; return ctx.asset(`img/${f}-${m.resumo}-${w}.webp`);
};
const catalogo = {
  v: 3,
  marca: site.marca,
  whatsapp: numero,
  email: site.contactos.email || '',
  modo: site.pagamentos?.modo === 'online' ? 'online' : 'encomenda',
  api: API,
  zonas: site.entrega.zonas,
  transportadora: site.entrega.transportadora || '',
  // as categorias (o Worker diz o nome delas na frase dos cupões e confere as do painel)
  categorias: categorias.map((c) => ({ slug: c.slug, nome: c.nome })),
  // os portes de cada zona: os escalões de peso [{ ate: kg, preco: € }] (R.portesDoPeso)
  portes: {
    ...Object.fromEntries(R.ZONAS_ENVIO.map((z) => [z, R.escaloesDe(site.entrega.portes?.[z])])),
    gratisAPartirDe: Number.isFinite(site.entrega.portes?.gratisAPartirDe) ? site.entrega.portes.gratisAPartirDe : null,
  },
  levantamento: site.entrega.levantamento || '',
  prazo: site.entrega.prazo || '',
  pagamento: site.entrega.pagamento || '',
  carrinho: ctx.url('/carrinho/'),
  checkout: ctx.url('/checkout/'),
  obrigado: ctx.absoluto('/obrigado/'),
  loja: ctx.url('/loja/'),
  produtos: Object.fromEntries(produtos.map((p) => [p.slug, {
    nome: p.nome, nomeCurto: p.nomeCurto || p.nome, url: ctx.url(`/produtos/${p.slug}/`), foto: fotoPequena(p.fotos[0]),
    preco: typeof p.preco === 'number' ? p.preco : null, precoAnterior: p.precoAnterior || null, promocaoAte: p.promocaoAte || '',
    opcoes: R.opcoesDe(p), estado: R.estadoDe(p), disponibilidade: R.disponibilidadeDe(p), compravel: R.compravel(p), enviavel: R.enviavel(p),
    // a categoria do artigo e as de marca (Apple, Samsung): os cupões de uma categoria apanham as duas
    categoria: p.categoria, categorias: R.categoriasDoArtigo(p, categorias), peso: R.pesoDe(p, categorias), pedeModelo: p.pedeModelo === true, campanha: p.campanha || '',
  }])),
};
const catalogoBuf = Buffer.from(JSON.stringify(catalogo));
/* O ÍNDICE DA PROCURA (assets/busca-*.json, lido quando a pessoa toca na procura): os artigos (o nome,
   a marca, a categoria, o preço de hoje e a imagem pequena), os modelos para reparar e as páginas. */
const sem = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const busca = {
  artigos: produtos.map((p) => {
    const v = R.precoDe(p, hoje);
    const c = categorias.find((k) => k.slug === p.categoria);
    return { n: p.nome, u: ctx.url(`/produtos/${p.slug}/`), f: fotoPequena(p.fotos[0]), p: v.atual, c: c ? c.nome : '', t: sem(`${p.nome} ${p.marca || ''} ${c ? c.nome : ''} ${p.resumo || ''}`) };
  }),
  // «ps5» acha a PlayStation 5, e «consola» (o tipo da família) acha todas
  modelos: aparelhos.modelos.map((m) => ({ n: m.nome, u: ctx.url(`/reparacoes/${m.id}/`), t: sem(`${m.nome} ${m.nome.replace(/PlayStation\s*/i, 'PS')} ${aparelhos.familias.find((f) => f.id === m.familia)?.nome || ''} ${R.TIPOS_FAMILIA[m.tipo] || ''} reparacao reparar ecra bateria`) })),
  paginas: [
    ['Reparações', '/reparacoes/', 'reparacao reparar arranjar ecra bateria partido orcamento'],
    ['Retoma: quanto vale o seu telemóvel', '/retoma/', 'retoma vender usado trocar valor simular'],
    ['Películas', '/loja/peliculas/', 'pelicula peliculas vidro protetor protecao ecra hidrogel'],
    ['Recondicionados', '/loja/recondicionados/', 'recondicionado usado segunda mao'],
    ['Contactos e horário', '/contactos/', 'contactos horario morada telefone whatsapp email loja'],
    ['Envios e devoluções', '/envios-e-devolucoes/', 'envio envios portes nacex devolucao entrega'],
    ['Perguntas frequentes', '/perguntas-frequentes/', 'perguntas duvidas ajuda'],
  ].map(([n, u, t]) => ({ n, u: ctx.url(u), t: sem(`${n} ${t}`) })),
};
const buscaBuf = Buffer.from(JSON.stringify(busca));
ficheiros.busca = `busca-${resumo(buscaBuf)}.json`;
fs.writeFileSync(path.join(SAIDA, 'assets', ficheiros.busca), buscaBuf);
ficheiros.catalogo = `catalogo-${resumo(catalogoBuf)}.json`;
fs.writeFileSync(path.join(SAIDA, 'assets', ficheiros.catalogo), catalogoBuf);
fs.writeFileSync(path.join(SAIDA, 'assets', 'catalogo.json'), catalogoBuf);

// ---------------------------------------------------------------- marcadores das páginas de texto
/* Os portes da loja (por encomenda), numa frase que se lê depois de «Portes:» ou de «são por
   encomenda:» — «4,90 € para Portugal Continental (grátis a partir de 50 € em artigos). O levantamento
   na loja não tem custos, e os artigos «só na loja» não se enviam.» */
function textoPortes() {
  const p = site.entrega.portes || {};
  const t = site.entrega.transportadora;
  const zonas = site.entrega.zonas.filter((z) => z.morada);
  const partes = zonas.map((z) => {
    const e = R.escaloesDe(p[z.id]);
    if (!e.length) return ctx.marcador(`os portes para ${z.curto}`);
    const kg = (x) => `${String(x).replace('.', ',')} kg`;
    return `${e.map((x) => `${euros(x.preco)} até ${kg(x.ate)}`).join(' e ')} para ${esc(z.curto)}${t ? `, pela ${esc(t)}` : ''}; uma encomenda com mais de ${kg(e[e.length - 1].ate)} combina os portes connosco`;
  });
  const gratis = Number.isFinite(p.gratisAPartirDe) ? ` (grátis a partir de ${euros(p.gratisAPartirDe)} em artigos)` : '';
  return `${partes.join('; ')}${gratis}. O peso é o dos artigos da encomenda. O levantamento na loja não tem custos, e os artigos «só na loja» não se enviam.`;
}

function identificacao() {
  const e = site.empresa;
  const partes = [];
  partes.push(e.nome ? `<strong>${esc(e.nome)}</strong>` : ctx.marcador('o nome da empresa ou do empresário'));
  if (e.tipo) partes.push(esc(e.tipo));
  partes.push(e.nif ? `NIF ${esc(e.nif)}` : ctx.marcador('o NIF'));
  const morada = e.morada ? moradaCompleta(e) : '';
  partes.push(morada ? `com loja em ${esc(morada)}` : `com loja em ${ctx.marcador('a morada')}`);
  return `${partes.join(', ')}, que vende com a marca ${esc(site.marca)}.`;
}

function botoesDesistencia() {
  const texto = `Olá! Quero desistir da compra (direito de livre resolução).\n\nArtigo: \nEncomenda n.º: \nRecebido em: \nNome: \nMorada: `;
  const b = [];
  if (numero) b.push(`<a class="botao botao--whatsapp" href="${ctx.whatsapp(texto)}">Desistir pelo WhatsApp</a>`);
  if (site.contactos.email) b.push(`<a class="botao botao--contorno" href="mailto:${esc(site.contactos.email)}?subject=${encodeURIComponent('Desistência da compra (livre resolução)')}&amp;body=${encodeURIComponent(texto)}">Desistir por email</a>`);
  return `<div class="botoes">${b.join('')}</div><p class="nota">Respondemos a confirmar que recebemos a sua desistência.</p>`;
}

/* Quem recebe dados (destinatariosHtml, da legal-comum): a Cloudflare (o alojamento e o Worker das
   encomendas; na pré-visualização, o GitHub Pages), o GitHub (o código e a publicação), a Stripe (os
   pagamentos), o Resend (os emails das encomendas), a Meta (WhatsApp, Instagram, Facebook) e o Renato,
   que mantém o site e o painel (RGPD, art. 28.º). O mapa dos contactos é desenhado pelo
   próprio site (scripts/mapa.mjs) e não manda nada a ninguém. */
const CONFIG_PRIVACIDADE = {
  alojamento: 'cloudflare', dns: dominio ? 'cloudflare' : undefined,
  whatsapp: true, instagram: true, facebookPage: true,
  // a Stripe só recebe dados com o pagamento no site ligado (modo «online»)
  pagamentos: site.pagamentos?.modo === 'online' ? 'stripe' : undefined, envioEmails: 'resend',
  manutencao: { nome: 'Renato Valente', papel: 'subcontratante' },
  repositorioPublico: true,
};
const TRANSFERENCIA = { DPF: 'EUA: consta da lista do Data Privacy Framework (decisão de adequação da Comissão Europeia)', UE: 'Sem transferência: os dados ficam na União Europeia' };
function destinatariosComExtras() {
  const d = CATALOGO_DESTINATARIOS.github;
  const extra = `<tr><td>${esc(d.nome)}</td><td>${esc('código do site e publicação automática (GitHub Actions): o painel grava lá as mudanças da loja; não leva dados de clientes')}</td><td>${esc(d.pais)}</td><td>${esc(TRANSFERENCIA[d.transferencia] || 'Por confirmar')}</td></tr>`;
  return destinatariosHtml(CONFIG_PRIVACIDADE).replace('</tbody>', `${extra}\n</tbody>`);
}

/* O PAGAMENTO, como se diz nas páginas, segue o modo da loja (site.json, pagamentos.modo). Com o
   pagamento no site ligado («online», a Stripe), o texto da loja e os passos da legal-comum, que acabam
   no botão «Encomendar e pagar». Enquanto não está («encomenda», até a Stripe da LF Mobile se ligar, no
   fim): a encomenda envia-se, e a disponibilidade, a entrega e a forma de pagamento combinam-se depois;
   prometer o cartão ou o Multibanco seria falso. */
const pagamentoOnline = site.pagamentos?.modo === 'online';
const PAGAMENTO_EM_MODO_ENCOMENDA = 'Envia a encomenda no site e nós confirmamos consigo, por email ou WhatsApp, a disponibilidade, a entrega e a forma de pagamento. Só paga depois dessa confirmação.';
function comoEncomendarSemPagamentoNoSite() {
  const passos = [
    'Escolhe os artigos e junta-os ao carrinho.',
    'Antes de enviar, vê o resumo com os artigos, as quantidades, o preço total com IVA e os portes, e pode corrigir qualquer erro.',
    'Envia a encomenda no botão «Enviar encomenda» e recebe por email o resumo do que encomendou.',
    'Confirmamos consigo, por email ou WhatsApp, a disponibilidade, a entrega e a forma de pagamento. A encomenda fica feita com essa confirmação, que lhe enviamos por email com as condições inteiras.',
    'O contrato é feito em português. Guardamos a encomenda e a confirmação durante 10 anos e pode pedir-nos uma cópia a qualquer momento.',
    `As condições gerais podem ser guardadas e impressas: <a href="${esc(ctx.url('/termos-e-condicoes/'))}">condições gerais</a>.`,
  ];
  return `<ol class="como-encomendar" lang="pt">\n${passos.map((p) => `<li>${p}</li>`).join('\n')}\n</ol>`;
}

function resolverMarcadores(fonte, onde) {
  const c = site.contactos;
  const tokens = [];
  const guardar = (html) => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
  const garantiaUsados = R.GARANTIAS_USADOS.includes(site.garantias?.recondicionados) ? site.garantias.recondicionados : null;
  const valores = {
    marca: () => esc(site.marca),
    localidade: () => esc(site.local.localidade),
    concelho: () => esc(site.local.concelho),
    email: () => (c.email ? guardar(`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`) : guardar(ctx.marcador('o email'))),
    // o WhatsApp só como ligação, sem o número (o Renato, 17 out 2026); o telefone com o número e a nota
    whatsapp: () => (c.whatsapp ? guardar(`<a href="https://wa.me/${numero}">WhatsApp</a>`) : guardar(`WhatsApp ${ctx.marcador('o número')}`)),
    telefone: () => (R.numeroPortugues(c.telefone) ? guardar(`<a href="tel:+351${R.numeroPortugues(c.telefone)}">${esc(numeroLegivel(c.telefone))}</a> ${notaChamada(c.telefone)}`) : guardar(ctx.marcador('o telefone'))),
    morada: () => (site.empresa.morada ? esc(moradaCompleta(site.empresa)) : guardar(ctx.marcador('a morada da loja'))),
    horario: () => guardar(`<ul>${(Array.isArray(site.horario) ? site.horario : []).filter((l) => l && l.dias && l.horas).map((l) => `<li>${esc(l.dias)}: ${esc(l.horas)}</li>`).join('') || `<li>${ctx.marcador('o horário')}</li>`}</ul>`),
    'empresa.identificacao': () => guardar(identificacao()),
    'empresa.iva': () => (site.empresa.iva ? esc(site.empresa.iva) : guardar(ctx.marcador('se os preços incluem IVA'))),
    prazo: () => (site.entrega.prazo ? esc(site.entrega.prazo) : guardar(ctx.marcador('o prazo de entrega'))),
    pagamento: () => (!pagamentoOnline ? esc(PAGAMENTO_EM_MODO_ENCOMENDA) : site.entrega.pagamento ? esc(site.entrega.pagamento) : guardar(ctx.marcador('as formas de pagamento'))),
    levantamento: () => esc(site.entrega.levantamento || ''),
    pagamentoStripe: () => (pagamentoOnline ? ' O pagamento no site é feito na página segura da Stripe, que não nos dá acesso aos dados do seu cartão.' : ''),
    pagamentoNaStripe: () => (pagamentoOnline ? ' O pagamento é feito na página da Stripe, para onde segue a partir da encomenda.' : ''),
    'privacidade.pagamento': () => esc(pagamentoOnline
      ? 'O pagamento é feito na Stripe, na página dela: a Stripe recebe o seu email e o valor, e trata os dados do cartão ou do MB WAY segundo a sua própria política; nós nunca vemos os dados do cartão. O NIF e as observações não são enviados para a Stripe.'
      : 'O pagamento combina-se consigo depois de confirmarmos a encomenda: o site não recebe dados de pagamento.'),
    portes: () => guardar(textoPortes()),
    botoesDesistencia: () => guardar(botoesDesistencia()),
    comoSeFazAEncomenda: () => guardar(pagamentoOnline
      ? pecaLegal('como-encomendar', COMO_SE_FAZ_A_ENCOMENDA({ canal: 'site', pagamentos: ['cartão', 'MB WAY', 'Multibanco'], urlTermos: ctx.url('/termos-e-condicoes/') }))
      : comoEncomendarSemPagamentoNoSite()),
    formularioLivreResolucao: () => guardar(pecaLegal('formulario-livre-resolucao', `<pre class="formulario-legal">${esc(formularioLivreResolucao({ nome: site.empresa.nome || `[${site.marca}]`, morada: site.empresa.morada ? moradaCompleta(site.empresa) : '[morada]', email: c.email || '[email]' }))}</pre>`)),
    avisoRetoma: () => guardar(pecaLegal('retoma', `<p>${esc(AVISO_RETOMA({ tipos: ['eee', 'pilhas', 'baterias'], como: { eee: 'diga-nos nas observações da encomenda ou pelo WhatsApp, e entregue-o na loja ou junte-o à devolução', pilhas: 'basta trazê-las à loja', baterias: 'diga-nos ao comprar e entregue-a na loja' } }))}</p>`)),
    garantiaRecondicionados: () => (garantiaUsados === 18
      ? guardar(pecaLegal('garantia-usados', `<p>${esc('Nos telemóveis e equipamentos recondicionados ou usados, a garantia é de 18 meses a contar da entrega, por acordo entre as partes antes da venda (artigo 12.º, n.º 3, do Decreto-Lei n.º 84/2021); nesse caso presume-se, durante o primeiro ano, que o defeito já existia. Cada ficha diz o estado do equipamento e esta garantia.')}</p>`))
      : garantiaUsados === 36
        ? guardar(`<p>Nos telemóveis e equipamentos recondicionados ou usados, a garantia é a mesma dos novos: 3 anos a contar da entrega.</p>`)
        : guardar(`<p>${ctx.marcador('a garantia dos recondicionados e usados: 18 meses por acordo, ou os 3 anos da lei')}</p>`)),
    garantia: () => guardar(pecaLegal('garantia', textoGarantia({ usados: garantiaUsados === 18, comercial: true }).split('\n\n').map((t) => `<p>${esc(t)}</p>`).join(''))),
    ral: () => guardar(pecaLegal('ral', ralHtml({ ambito: 'local', concelhos: [site.local.concelho], comCec: false }))),
    'privacidade.destinatarios': () => guardar(pecaLegal('privacidade-destinatarios', destinatariosComExtras())),
    'privacidade.prazos': () => guardar(pecaLegal('privacidade-prazos', `<ul>${[
      PRAZOS_LEGAIS.pedidosDeContacto.texto,
      PRAZOS_LEGAIS.encomendas.texto,
      'Dados de uma encomenda guardados no servidor das encomendas (Cloudflare): 400 dias depois da encomenda.',
      PRAZOS_LEGAIS.registosTecnicos.texto,
    ].map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`)),
    'privacidade.frases': () => guardar(pecaLegal('privacidade-frases', frasesPrivacidade(CONFIG_PRIVACIDADE).map((t) => `<p>${esc(t)}</p>`).join(''))),
    avisoGarantia: () => guardar(`<figure class="aviso-garantia"><img src="${ctx.asset('legal/aviso-garantia-legal-pt.svg')}" width="600" height="848" alt="${esc(AVISO_ALT)}" loading="lazy"><figcaption><a href="${ctx.asset('legal/aviso-garantia-legal-pt.pdf')}">Descarregar o aviso oficial (PDF)</a> · <a href="https://europa.eu/youreurope/garantias" target="_blank" rel="noopener">europa.eu/youreurope/garantias</a></figcaption></figure>`),
  };
  const texto = fonte.replace(/\{\{([\w.]+)\}\}/g, (todo, chave) => {
    if (!valores[chave]) { erros.push(`${onde}: o marcador «${todo}» não existe (existem: ${Object.keys(valores).join(', ')})`); return todo; }
    return valores[chave]();
  });
  return { texto, tokens };
}

function paginaMarkdown(ficheiro) {
  const fonte = fs.readFileSync(path.join(CONTEUDO, 'paginas', ficheiro), 'utf8');
  const [cabeca, ...corpo] = fonte.split(/\n---\n/);
  const meta = Object.fromEntries(cabeca.split('\n').filter(Boolean).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  const { texto, tokens } = resolverMarcadores(corpo.join('\n---\n'), `Páginas › ${ficheiro}`);
  // um marcador sozinho num parágrafo (quadro, figura, botões) sai do <p> que o Markdown lhe põe
  let html = markdown(texto, ctx.url).replace(/<p>\u0000(\d+)\u0000<\/p>/g, (_, i) => tokens[Number(i)]);
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
  const slug = ficheiro.replace(/\.md$/, '');
  if (meta.foto && !fotoExiste(meta.foto)) erros.push(`Páginas › ${ficheiro}: a fotografia «${meta.foto}» não existe`);
  // «indexar: não» no cabeçalho tira a página do Google (noindex e fora do sitemap); continua no site
  const indexar = !/^(n[ãa]o|false)$/i.test(meta.indexar || '');
  return { caminho: `/${slug}/`, titulo: meta.titulo, tituloSeo: meta.tituloSeo, subtitulo: meta.subtitulo, modelo: meta.modelo, descricao: meta.descricao, atualizado: meta.atualizado, foto: meta.foto, indexar, html };
}

// ---------------------------------------------------------------- páginas
const saidas = [];
saidas.push(paginas.inicio(ctx));
saidas.push(paginas.loja(ctx));
for (const c of categorias) saidas.push(paginas.loja(ctx, c.slug));
for (const p of produtos) saidas.push(paginas.produto(ctx, p));
saidas.push(reparacoes.reparacoes(ctx));
for (const f of aparelhos.familias) if (aparelhos.modelos.some((m) => m.familia === f.id)) saidas.push(reparacoes.familia(ctx, f));
for (const m of aparelhos.modelos) saidas.push(reparacoes.modelo(ctx, m));
saidas.push(paginaRetoma(ctx));
for (const c of campanhas) saidas.push(paginas.campanha(ctx, c));
saidas.push(paginas.carrinho(ctx));
saidas.push(paginas.checkout(ctx));
saidas.push(paginas.obrigado(ctx));
saidas.push(paginas.contactos(ctx));
for (const f of fs.readdirSync(path.join(CONTEUDO, 'paginas')).filter((x) => x.endsWith('.md'))) saidas.push(paginas.texto(ctx, paginaMarkdown(f)));
saidas.push(paginas.erro404(ctx));

if (erros.length) parar(`A publicação parou: ${erros.length} ${erros.length === 1 ? 'problema' : 'problemas'}.`, erros, { tecnico: true });

for (const s of saidas) {
  const html = pagina(ctx, s);
  const destino = s.caminho.endsWith('.html') ? path.join(SAIDA, s.caminho) : path.join(SAIDA, s.caminho, 'index.html');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, html);
}

// ---------------------------------------------------------------- robots, sitemap, _headers
const FORA_DO_MAPA = new Set(['/404.html', '/carrinho/', '/checkout/', '/obrigado/']);
const indexaveis = saidas.filter((s) => !FORA_DO_MAPA.has(s.caminho) && s.indexar !== false);
let lastmod = {};
try {
  // a data da última alteração de cada página sai do git (o conteúdo de que ela é feita), com a hora
  const data = (ficheirosFonte) => execFileSync('git', ['log', '-1', '--format=%cI', '--', ...ficheirosFonte], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  for (const s of indexaveis) {
    let fontes = ['content/site.json'];
    if (s.caminho === '/') fontes = ['content/inicio.json', 'content/produtos', 'content/reparacoes.json', 'content/site.json'];
    else if (s.caminho.startsWith('/produtos/')) fontes = [`content/produtos/${s.caminho.split('/')[2]}.json`];
    else if (s.caminho.startsWith('/loja/')) fontes = ['content/produtos', 'content/categorias.json'];
    else if (s.caminho.startsWith('/reparacoes/')) fontes = ['content/reparacoes.json', 'content/aparelhos.json'];
    else if (s.caminho === '/retoma/') fontes = ['content/retoma.json', 'content/aparelhos.json'];
    else if (s.caminho.startsWith('/campanhas/')) fontes = ['content/campanhas.json'];
    else if (existe(`content/paginas${s.caminho.replace(/\/$/, '')}.md`)) fontes = [`content/paginas${s.caminho.replace(/\/$/, '')}.md`, 'content/site.json'];
    lastmod[s.caminho] = data(fontes) || hoje;
  }
} catch { lastmod = {}; }
fs.writeFileSync(path.join(SAIDA, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexaveis.map((s) => `  <url><loc>${ctx.absoluto(s.caminho)}</loc><lastmod>${lastmod[s.caminho] || hoje}</lastmod></url>`).join('\n')}
</urlset>
`);
// Pré-visualização: fechada aos motores de busca, mas aberta aos robôs que fazem a pré-visualização
// das ligações no WhatsApp e no Facebook (sem isto, partilhar o link mostra-se sem imagem).
fs.writeFileSync(path.join(SAIDA, 'robots.txt'), producao
  ? `User-agent: *\nAllow: /\nDisallow: /checkout/\nDisallow: /obrigado/\n\nSitemap: ${ctx.absoluto('/sitemap.xml')}\n`
  : 'User-agent: facebookexternalhit\nAllow: /\n\nUser-agent: WhatsApp\nAllow: /\n\nUser-agent: *\nDisallow: /\n');
// Em produção (Cloudflare): a cache dos ficheiros com o resumo no nome, e os cabeçalhos de segurança
// em todas as respostas. O catalogo.json sem resumo fica fora (o Worker lê-o sempre fresco).
if (dominio) {
  const umAno = '  Cache-Control: public, max-age=31536000, immutable\n';
  const seguranca = '/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: SAMEORIGIN\n  Content-Security-Policy: frame-ancestors \'self\'\n  Referrer-Policy: strict-origin-when-cross-origin\n  Strict-Transport-Security: max-age=86400\n';
  fs.writeFileSync(path.join(SAIDA, '_headers'), seguranca + ['/assets/site-*', '/assets/catalogo-*', '/assets/busca-*', '/assets/video/*'].map((r) => `${r}\n${umAno}`).join(''));
}
fs.writeFileSync(path.join(SAIDA, '.nojekyll'), '');

// ---------------------------------------------------------------- verificação do que saiu
const problemas = [];
const todosHtml = [];
(function andar(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) andar(p); else if (f.endsWith('.html')) todosHtml.push(p); } })(SAIDA);
for (const f of todosHtml) {
  const html = fs.readFileSync(f, 'utf8');
  const onde = path.relative(SAIDA, f);
  for (const lixo of ['{{', 'undefined', 'NaN', '[object Object]']) if (html.includes(lixo)) problemas.push(`${onde}: contém «${lixo}»`);
  if (producao && html.includes('por-confirmar')) problemas.push(`${onde}: ainda tem texto por confirmar`);
  if (!html.includes('<!-- legal-comum:livro ')) problemas.push(`${onde}: falta o botão do Livro de Reclamações`);
  if (/obriga[çc][ãa]o de pagar/i.test(html)) problemas.push(`${onde}: tem a fórmula «obrigação de pagar», que o Renato não quer em nenhum site`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(m[0])) problemas.push(`${onde}: imagem sem alt: ${m[0].slice(0, 80)}`);
  for (const m of html.matchAll(/\s(?:href|src|poster)="([^"]+)"/g)) {
    let u = m[1].replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|tel:|#|data:)/.test(u)) continue;
    if (base && !u.startsWith(base + '/')) { problemas.push(`${onde}: ligação sem o prefixo ${base}: ${u}`); continue; }
    u = u.slice(base.length).split(/[?#]/)[0];
    const alvo = path.join(SAIDA, decodeURIComponent(u));
    const ok = fs.existsSync(alvo) && (fs.statSync(alvo).isFile() || fs.existsSync(path.join(alvo, 'index.html')));
    if (!ok) problemas.push(`${onde}: ligação partida: ${m[1]}`);
  }
  for (const m of html.matchAll(/\ssrcset="([^"]+)"/g)) {
    for (const parte of m[1].split(',')) {
      const u = parte.trim().split(/\s+/)[0].slice(base.length);
      if (!fs.existsSync(path.join(SAIDA, u))) problemas.push(`${onde}: imagem em falta no srcset: ${u}`);
    }
  }
  const og = html.match(/property="og:image" content="([^"]+)"/)?.[1];
  if (og && !fs.existsSync(path.join(SAIDA, og.replace(ORIGEM + base, '')))) problemas.push(`${onde}: o cartão de partilha não existe: ${og}`);
}
if (problemas.length) parar(`A publicação parou: o site saiu com ${problemas.length} problemas.`, [...new Set(problemas)].slice(0, 60).map((p) => `Gerador: ${p}`), { tecnico: true });

for (const a of avisos) console.warn(`  ! ${a}`);
console.log(`site: ${saidas.length} páginas em _site/ (${producao ? `produção, ${DOMINIO}` : dominio ? `${DOMINIO}, ainda fechado aos motores de busca` : base ? `pré-visualização, ${ORIGEM}${base}/` : 'local'}), ${produtos.length} artigos, ${aparelhos.modelos.length} modelos, ${campanhas.length} campanhas a correr, hoje ${hoje}`);
