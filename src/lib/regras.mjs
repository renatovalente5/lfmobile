/* AS REGRAS DOS DADOS DA LF MOBILE, NUM SÓ SÍTIO.
 *
 * Três leitores, e os três têm de ouvir o mesmo:
 *   · o gerador do site (scripts/build.mjs), antes de escrever as páginas;
 *   · o painel, no browser (o erro aparece por baixo do campo, antes de gravar);
 *   · o Worker do painel, ao gravar (recusa os problemas NOVOS que não sejam
 *     lembretes).
 * O painel usa uma CÓPIA BYTE A BYTE deste ficheiro (estatico/js/regras.js no
 * repositório lfmobile-painel), com um teste de SHA-256 que falha se divergirem.
 * Por isso é um ES module puro: nenhum import, nada de node:*, fs, process ou
 * require. Corre tal e qual no browser, num Worker e no Node.
 * (A forma vem das regras da Mimices, que vieram da Pokóto Wood e da AMMA.)
 *
 * CADA PROBLEMA TEM UMA CLASSE:
 *   · bloqueia   — a publicação pára e o site fica como estava. Só a estrutura
 *                  (um JSON que não se lê, um ficheiro sem a forma que o gerador
 *                  precisa) e o que todas as páginas usam (contactos, zonas de
 *                  entrega, a página inicial). Em PRODUÇÃO, também os dados que a
 *                  lei pede (identificação, NIF, morada — DL 7/2004, art. 10.º;
 *                  prazos, portes e pagamento — DL 24/2014, art. 4.º).
 *   · neutraliza — um artigo, só na cópia que o gerador lê (o ficheiro do
 *                  repositório não muda — ver neutralizar()): sem nome, sem texto,
 *                  sem fotografia, numa categoria que não existe — e, em produção,
 *                  sem preço — fica escondido do site; uma fotografia que não
 *                  existe não aparece. Um problema de UM artigo nunca pára a
 *                  publicação dos outros.
 *   · avisa      — só aviso. No painel, os que não são lembrete são erro de campo
 *                  (valor fora da lista, número fora dos limites, texto comprido de
 *                  mais): o painel não os deixa gravar. Os LEMBRETES (lembrete:
 *                  true) não são erro de ninguém: o painel grava na mesma e
 *                  mostra-os no Início.
 *
 * dados = {
 *   site:       texto | objecto | null,               content/site.json
 *   inicio:     texto | objecto | null,               content/inicio.json
 *   categorias: texto | objecto | null,               content/categorias.json
 *   servicos:   texto | objecto | null,               content/servicos.json
 *   fotos:      texto | objecto | null,               content/fotos.json
 *   artigos:    { <nome>: texto | objecto | null },   content/produtos/<nome>.json
 *   ficheirosFotos: [nome],  os nomes (sem .jpg) dos ficheiros em media/fotos/
 *   videos:         [nome],  os nomes (sem .mp4) dos vídeos em media/video/
 * }
 *   <nome> é o nome do ficheiro sem «.json», que é o endereço da página
 *   (/produtos/<nome>/). texto = o conteúdo do ficheiro; null = não existe.
 *   Uma chave de topo AUSENTE não se confere (o painel pode conferir só um
 *   artigo); presente e null é «falta o ficheiro».
 *
 * problema = {
 *   classe:   'bloqueia' | 'neutraliza' | 'avisa',
 *   chave:    estável ('artigo:<slug>:<regra>', 'site:<campo>[:<regra>]'…). O Worker
 *             compara as chaves do HEAD com as da gravação e recusa só as novas;
 *             por isso UMA CHAVE TEM SEMPRE A MESMA CLASSE (o que muda com a
 *             produção tem uma chave própria, com «:producao» ou «:previa»).
 *   ficheiro: o caminho do ficheiro;
 *   ecra:     o ecrã do painel onde se corrige («Artigos › iPhone 13»);
 *   mensagem: para o dono, em português simples, sem caminhos de JSON;
 *   campo?:   o campo onde o painel mostra o erro ('preco', 'opcoes.0.nome');
 *   efeito?:  só nos «neutraliza»: 'esconder' | 'sem_fotografia';
 *   slug?, foto?, indice?, lembrete?
 * }
 *
 * «NÃO FOI DITO» E NULL SÃO O MESMO. E o vazio testa-se ANTES de converter:
 * Number(null) é 0, e 0 é uma escolha (memória numero-zero-nao-e-nao-foi-dito).
 */

/* ------------------------------------------------------------------ */
/* Onde estão as coisas                                                */
/* ------------------------------------------------------------------ */

export const FICHEIROS = Object.freeze({
  site: 'content/site.json',
  inicio: 'content/inicio.json',
  categorias: 'content/categorias.json',
  servicos: 'content/servicos.json',
  fotos: 'content/fotos.json',
});
export const PASTAS = Object.freeze({ artigos: 'content/produtos', fotos: 'media/fotos', videos: 'media/video' });
export const ficheiroDoArtigo = (nome) => `${PASTAS.artigos}/${nome}.json`;
export const ficheiroDaFoto = (nome) => `${PASTAS.fotos}/${nome}.jpg`;

/* As zonas de envio (as de content/site.json, entrega.zonas, menos o
   levantamento). A LF Mobile envia só para Portugal Continental (o dono, set 2026:
   «Apenas Portugal Continental»). Os portes são da encomenda, não de cada artigo. */
export const ZONAS_ENVIO = Object.freeze(['continente']);
export const NOMES_ZONAS = Object.freeze({ continente: 'Portugal Continental' });

/* Os campos de um artigo, PELA ORDEM DO FORMULÁRIO. Uma chave nova entra por esta
   ordem (ordenarComo()); as que já estão no ficheiro ficam onde estão. */
export const CAMPOS_ARTIGO = Object.freeze([
  'nome', 'nomeCurto', 'marca', 'fotos', 'resumo', 'descricao',
  'preco', 'precoAnterior', 'promocaoDesde', 'promocaoAte',
  'estado', 'disponibilidade', 'caracteristicas', 'inclui', 'opcoes', 'video',
  'referencia', 'fabricante', 'avisos',
  'categoria', 'destaque', 'novidade', 'publicado', 'ordem',
]);
/* A informação legal de cada artigo, toda opcional e só mostrada na ficha quando está
   preenchida: a referência e o fabricante (Regulamento (UE) 2023/988, art. 19.º: nome, morada e
   email — vazio, a ficha diz os dados da loja) e os avisos de segurança (um por linha). E a data
   de início da promoção (DL 70/2007, art. 5.º: o período e o preço mais baixo dos 30 dias
   anteriores). */
export const CAMPOS_FABRICANTE = Object.freeze(['nome', 'morada', 'email']);
/* Sempre escritos pelo painel, com o valor explícito. Ausentes valem o valor por
   omissão (é o que o gerador faz). */
export const BOOLEANOS_ARTIGO = Object.freeze(['destaque', 'novidade', 'publicado']);
export const POR_OMISSAO = Object.freeze({ publicado: true, novidade: false, destaque: false, estado: 'novo', disponibilidade: 'disponivel', ordem: 500 });

/* O estado de um artigo (novo, recondicionado, usado) muda a garantia que a ficha diz e o que o
   Google lê (itemCondition). A disponibilidade decide o botão da ficha:
   · disponivel — compra-se no site (envio ou levantamento);
   · confirmar  — peça única ou stock incerto: pergunta-se antes (o botão abre o WhatsApp);
   · loja       — só na loja (uma película aplicada na hora): compra-se para levantar, não se envia;
   · esgotado   — a ficha fica, sem botão de compra. */
export const ESTADOS = Object.freeze({ novo: 'Novo', recondicionado: 'Recondicionado', usado: 'Usado' });
export const DISPONIBILIDADES = Object.freeze({
  disponivel: 'Disponível (compra-se no site)',
  confirmar: 'Confirmar antes de comprar (pergunta pelo WhatsApp)',
  loja: 'Só na loja (levantamento, sem envio)',
  esgotado: 'Esgotado (fica na loja, sem botão de compra)',
});

export const NOMES_CAMPOS = Object.freeze({
  nome: 'Nome do artigo', nomeCurto: 'Nome curto', marca: 'Marca', fotos: 'Fotografias', resumo: 'Frase curta', descricao: 'Descrição',
  preco: 'Preço', precoAnterior: 'Preço anterior', promocaoAte: 'Fim da promoção', promocaoDesde: 'Início da promoção',
  estado: 'Estado', disponibilidade: 'Disponibilidade', caracteristicas: 'Características', inclui: 'O que inclui', opcoes: 'Escolhas', video: 'Vídeo',
  referencia: 'Referência', fabricante: 'Fabricante', avisos: 'Avisos de segurança',
  categoria: 'Categoria', destaque: 'Em destaque na página inicial', novidade: 'Novidade', publicado: 'Publicado no site', ordem: 'Posição na lista',
});

/* ------------------------------------------------------------------ */
/* Limites                                                             */
/* ------------------------------------------------------------------ */

/* Os números: [mínimo, máximo]. */
export const LIMITES = Object.freeze({ preco: [0.01, 100000], suplemento: [0, 10000], portes: [0, 10000], ordem: [0, 9999], opinioes: [0, 100000] });
/* Tamanhos máximos dos textos, em caracteres. */
export const TAMANHOS = Object.freeze({
  nome: 120, nomeCurto: 40, marca: 60, resumo: 300, descricao: 6000,
  referencia: 40, avisos: 600, fabricanteNome: 120, fabricanteMorada: 200,
  caracteristicas: 16, caracteristicaTexto: 120, inclui: 12, incluiTexto: 120,
  opcoes: 4, valores: 16, opcaoNome: 40, valorNome: 60,
  fotos: 16, nomeFoto: 120, alt: 300,
  marcaSite: 60, descricaoSite: 300, assinatura: 100, email: 160, telefone: 20, rede: 60,
  horario: 6, horarioDias: 40, horarioHoras: 60,
  empresaNome: 160, empresaTipo: 80, nif: 20, morada: 160, codigoPostal: 12, localidade: 60, concelho: 60, iva: 200, ligacao: 300,
  avisoTexto: 140, prazo: 400, pagamento: 400, levantamento: 300,
  nota: 4, fidelidade: 200,
  catNome: 40, catTitulo: 80, catResumo: 2000,
  servicos: 12, servicoNome: 60, servicoResumo: 300, servicoItens: 12, servicoItem: 100, servicoPreco: 60,
  inicioCurto: 60, inicioTitulo: 120, inicioTexto: 600,
});
/* O que o Worker do painel aceita gravar (recusa acima); aqui só se lembra, a
   partir de 80 %. */
export const TECTOS = Object.freeze({ artigoBytes: 64 * 1024, siteBytes: 64 * 1024, aviso: 0.8 });

/* As palavras que a lei só deixa usar com prova (Diretiva (UE) 2024/825,
   aplicável desde 27 set 2026: alegações ambientais genéricas) e as
   certificações que a loja não nos mostrou. */
export const RE_ALEGACOES = /\b(ecol[óo]gic[oa]s?|sustent[áa]ve(l|is)|sustentabilidade|amig[oa]s? do ambiente|eco-?friendly|biodegrad[áa]ve(l|is)|neutr[oa]s? em carbono|certificad[oa]s?)\b/i;

/* Os desenhos que um serviço pode ter (a grelha de ícones do painel; o site desenha-os em
   src/templates/icones.mjs). */
export const ICONES_SERVICO = Object.freeze(['telemovel', 'tablet', 'portatil', 'computador', 'consola', 'impressora3d', 'bateria', 'ecra', 'agua', 'ferramentas', 'camiao', 'presente']);

/* ------------------------------------------------------------------ */
/* Ajudantes que o painel e o Worker também usam                      */
/* ------------------------------------------------------------------ */

const eObjecto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const ausente = (x) => x === null || x === undefined;
const vazio = (x) => ausente(x) || (typeof x === 'string' && x.trim() === '') || (Array.isArray(x) && x.length === 0);
const temTexto = (x) => typeof x === 'string' && x.trim() !== '';
const tem = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const duasCasas = (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
const bytesDe = (s) => new TextEncoder().encode(s).length;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
export const dataValida = (s) => {
  if (typeof s !== 'string' || !RE_DATA.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  const x = new Date(Date.UTC(a, m - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
};

export const terminacaoDe = (texto) => (typeof texto === 'string' && texto.endsWith('\n') ? '\n' : '');
/* Como os ficheiros estão escritos: 2 espaços e a terminação de cada um (todos
   com \n no fim). Abrir e gravar sem mexer deixa o ficheiro igual, byte a byte. */
export function serializar(obj, terminacao = '\n') { return JSON.stringify(obj, null, 2) + (terminacao || ''); }

/* O endereço da página, a partir do nome do ficheiro — IGUAL ao do gerador, que
   usa o nome tal e qual. */
export const slugDoFicheiro = (nome) => String(nome).replace(/\.json$/, '');
const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugValido = (s) => typeof s === 'string' && s.length <= 100 && RE_SLUG.test(s);

/* NIF português: 9 algarismos (com ou sem espaços), o primeiro nunca é 0, e o de
   controlo (módulo 11). */
export function nifValido(nif) {
  const s = String(nif ?? '').replace(/\s/g, '');
  if (!/^[1-9][0-9]{8}$/.test(s)) return false;
  let soma = 0;
  for (let i = 0; i < 8; i++) soma += Number(s[i]) * (9 - i);
  const resto = soma % 11;
  return (resto < 2 ? 0 : 11 - resto) === Number(s[8]);
}

/* O SLUG DE UM ARTIGO NOVO: gerado UMA vez, ao criar, a partir do nome, e nunca
   mais muda — é o endereço da página que a loja partilha no WhatsApp e no
   Instagram. Minúsculas, sem acentos, o resto passa a hífen («iPhone 13 128 GB» →
   iphone-13-128-gb). Repetido: -2, -3… */
export function gerarSlug(nome, existentes = []) {
  const ja = existentes instanceof Set ? existentes : new Set(existentes);
  let base = String(ausente(nome) ? '' : nome)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 80).replace(/-+$/, '');
  if (!base) base = 'artigo';
  let slug = base;
  for (let n = 2; ja.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/* O NOME DE UMA FOTOGRAFIA: o do ficheiro em media/fotos/, sem «.jpg». Só
   minúsculas, algarismos e hífens (um espaço num nome parte o srcset — memória
   srcset-nome-com-espaco). */
export const nomeDeFotoValido = (n) => typeof n === 'string' && n.length <= TAMANHOS.nomeFoto && RE_SLUG.test(n);

/* Caracteres de controlo, por escape e nunca literais no código. */
const RE_CONTROLO_LINHA = /[\u0000-\u001F\u007F]/;
const RE_CONTROLO_TEXTO = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
/* «</script» e «<!--»: dentro de um <script> do JSON-LD, um fecha o elemento a
   meio e o outro muda a forma como o browser o lê. Não há texto honesto que os
   precise. */
const RE_PARTE_A_PAGINA = /<\/script|<!--/i;

export const RE_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
export const emailValido = (v) => typeof v === 'string' && v.length <= TAMANHOS.email && RE_EMAIL.test(v.trim());

/* Um número português de 9 algarismos, ou com o indicativo (+351, 00351, 351).
   → os 9 algarismos, ou null. O WhatsApp dos orçamentos é um telemóvel. */
export function numeroPortugues(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  let d = String(v).replace(/[\s.-]/g, '');
  if (d.startsWith('+351')) d = d.slice(4); else if (d.startsWith('00351')) d = d.slice(5); else if (/^351\d{9}$/.test(d)) d = d.slice(3);
  return /^[29]\d{8}$/.test(d) ? d : null;
}
export const eTelemovel = (v) => /^9[1236]\d{7}$/.test(numeroPortugues(v) ?? '');

/* Uma ligação para fora do site (o mapa, as opiniões do Google): https e pouco mais. */
export const ligacaoExternaValida = (v) => typeof v === 'string' && v.length <= TAMANHOS.ligacao && /^https:\/\/[^\s"'<>]+$/.test(v);

/* O preço que vale num dia («AAAA-MM-DD», em Lisboa). «preco» é o preço de venda
   (o da promoção, quando há uma) e «precoAnterior» o normal. Acabada a promoção,
   volta o preço normal. Sem preço (ainda por dizer), atual é null. A MESMA regra
   está no carrinho do site (src/scripts/carrinho.js, precoDe) e no Worker dos
   pagamentos: o site, o carrinho e a Stripe nunca discordam. */
export function precoDe(p, hoje) {
  if (typeof p.preco !== 'number') return { atual: null, anterior: null, ate: '' };
  const emPromocao = Boolean(p.precoAnterior) && p.precoAnterior > p.preco && (!p.promocaoAte || hoje <= p.promocaoAte);
  if (emPromocao) return { atual: p.preco, anterior: p.precoAnterior, ate: p.promocaoAte || '' };
  if (p.precoAnterior && p.promocaoAte && hoje > p.promocaoAte) return { atual: p.precoAnterior, anterior: null, ate: '' };
  return { atual: p.preco, anterior: null, ate: '' };
}

/* As escolhas de um artigo (a cor, a capacidade), já limpas: só os grupos com nome e
   com dois valores ou mais, e só os valores com nome. Cada valor tem o suplemento (0
   se não foi dito). O primeiro valor SEM suplemento é o que a ficha marca à partida:
   assim o preço anunciado é o que se paga (memória preco-anunciado-tem-de-ser-obtenivel). */
export function opcoesDe(a) {
  if (!eObjecto(a) || !Array.isArray(a.opcoes)) return [];
  return a.opcoes
    .filter((g) => eObjecto(g) && temTexto(g.nome) && Array.isArray(g.valores))
    .map((g) => ({
      nome: g.nome.trim(),
      valores: g.valores.filter((v) => eObjecto(v) && temTexto(v.nome)).map((v) => ({
        nome: v.nome.trim(),
        suplemento: typeof v.suplemento === 'number' && Number.isFinite(v.suplemento) && v.suplemento > 0 ? v.suplemento : 0,
      })),
    }))
    .filter((g) => g.valores.length >= 2);
}
/* «Desde»: só quando alguma escolha pode fazer o preço subir. */
export const temSuplementos = (a) => opcoesDe(a).some((g) => g.valores.some((v) => v.suplemento > 0));

/* O estado e a disponibilidade de um artigo, já com o valor por omissão. */
export const estadoDe = (a) => (eObjecto(a) && typeof a.estado === 'string' && tem(ESTADOS, a.estado) ? a.estado : POR_OMISSAO.estado);
export const disponibilidadeDe = (a) => (eObjecto(a) && typeof a.disponibilidade === 'string' && tem(DISPONIBILIDADES, a.disponibilidade) ? a.disponibilidade : POR_OMISSAO.disponibilidade);
/* Compra-se no site (vai para o carrinho)? Só «disponivel» e «loja». */
export const compravel = (a) => ['disponivel', 'loja'].includes(disponibilidadeDe(a)) && eObjecto(a) && typeof a.preco === 'number';
/* Envia-se? Um artigo «só na loja» (a película aplicada na hora) é só para levantar. */
export const enviavel = (a) => disponibilidadeDe(a) !== 'loja';

/* As linhas de uma lista de textos (as características, o que inclui), já limpas. */
export const linhasDe = (v) => (Array.isArray(v) ? v.filter((t) => temTexto(t)).map((t) => t.trim()) : []);

/* Igualdade de valores lidos de JSON, com null ≡ ausente e sem ligar à ordem
   das chaves. */
export function mesmoValor(a, b) {
  if (ausente(a) && ausente(b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => mesmoValor(x, b[i]));
  }
  if (eObjecto(a) || eObjecto(b)) {
    if (!eObjecto(a) || !eObjecto(b)) return false;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!mesmoValor(a[k], b[k])) return false;
    return true;
  }
  return a === b;
}

/* Os textos de um valor (em profundidade), com o caminho de cada um. */
function textosDe(v, caminho = '') {
  if (typeof v === 'string') return [[caminho, v]];
  const filhos = Array.isArray(v) ? Array.from(v, (x, i) => [i, x]) : eObjecto(v) ? Object.entries(v) : [];
  return filhos.flatMap(([k, x]) => textosDe(x, caminho ? `${caminho}.${k}` : String(k)));
}

/* Lê um ficheiro: o TEXTO (string), o objecto já lido, ou null/undefined. */
function lerJson(valor) {
  if (ausente(valor)) return { ausente: true };
  if (typeof valor !== 'string') return { obj: valor, texto: null };
  try { return { obj: JSON.parse(valor), texto: valor }; } catch (e) { return { ilegivel: String((e && e.message) || e).slice(0, 120), texto: valor }; }
}

/* As categorias de content/categorias.json: [{ slug, nome }], ou null se não se lê. */
export function categoriasDe(valor) {
  const l = lerJson(valor);
  if (!Array.isArray(l.obj)) return null;
  return l.obj.filter((c) => eObjecto(c) && temTexto(c.slug)).map((c) => ({ slug: c.slug, nome: temTexto(c.nome) ? c.nome.trim() : c.slug }));
}

/* As fotografias que existem para o site: as que têm ficheiro em media/fotos/ E
   entrada em content/fotos.json (o gerador precisa das duas: o ficheiro para as
   versões web, a entrada para o texto alternativo). → Set de nomes, ou null se
   não se sabe (sem a lista dos ficheiros). */
export function fotosQueExistem(dados) {
  const d = eObjecto(dados) ? dados : {};
  if (!Array.isArray(d.ficheirosFotos)) return null;
  const f = lerJson(d.fotos);
  const meta = eObjecto(f.obj) ? f.obj : {};
  return new Set(d.ficheirosFotos.filter((n) => eObjecto(meta[n])));
}

/* ------------------------------------------------------------------ */
/* Um artigo                                                            */
/* ------------------------------------------------------------------ */

/* No site, como o gerador decide: tudo menos `publicado: false`. */
export const noSite = (a) => eObjecto(a) && a.publicado !== false;
/* O nome que o ecrã mostra, numa linha só, cortado a 80. */
export const nomeDoArtigo = (a, slug) => {
  const n = eObjecto(a) && temTexto(a.nome) ? a.nome.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const curto = n.length > 80 ? `${n.slice(0, 79)}…` : n;
  return curto || slug || 'artigo sem nome';
};
const ecraDoArtigo = (a, slug) => `Artigos › ${nomeDoArtigo(a, slug)}`;

/* Os problemas de UM artigo. O painel usa-o campo a campo.
   ctx = { nome, categorias?: [slug] | null, fotos?: Set | null (as que existem),
           videos?: [nome] | null, hoje?: 'AAAA-MM-DD', producao?: boolean }
   O que falta no ctx não se confere. */
export function problemasDoArtigo(a, ctx = {}) {
  const nome = typeof ctx.nome === 'string' ? ctx.nome : '';
  const slug = slugDoFicheiro(nome);
  const ficheiro = ficheiroDoArtigo(nome);
  const categorias = Array.isArray(ctx.categorias) ? ctx.categorias : null;
  const fotosExistem = ctx.fotos instanceof Set ? ctx.fotos : null;
  const videos = Array.isArray(ctx.videos) ? ctx.videos : null;
  const out = [];
  const ecra = ecraDoArtigo(a, slug);
  const base = { ficheiro, ecra, slug };
  const chave = (regra) => `artigo:${slug}:${regra}`;
  const neutraliza = (regra, efeito, campo, mensagem, extra = {}) => out.push({ classe: 'neutraliza', chave: chave(regra), campo, efeito, mensagem, ...base, ...extra });
  const avisa = (regra, campo, mensagem, extra = {}) => out.push({ classe: 'avisa', chave: chave(regra), campo, mensagem, ...base, ...extra });
  const lembra = (regra, campo, mensagem, extra = {}) => avisa(regra, campo, mensagem, { lembrete: true, ...extra });
  if (!eObjecto(a)) return out;   // a forma do ficheiro é do problemas(): bloqueia

  // --- neutraliza: o que o site não pode mostrar --------------------------
  for (const [campo, falta, genero] of [['nome', 'o nome do artigo', 'o'], ['resumo', 'a frase curta', 'a'], ['descricao', 'a descrição', 'a']]) {
    const x = a[campo];
    if (vazio(x)) neutraliza(campo, 'esconder', campo, `Falta ${falta}: o artigo fica escondido do site até estar preenchid${genero}.`);
    else if (typeof x !== 'string') neutraliza(campo, 'esconder', campo, `«${NOMES_CAMPOS[campo]}» tem de ser texto: o artigo fica escondido do site até ser corrigido.`);
  }
  const cat = a.categoria;
  if (vazio(cat)) neutraliza('categoria', 'esconder', 'categoria', 'Falta a categoria: o artigo fica escondido do site até escolher uma.');
  else if (typeof cat !== 'string' || (categorias && !categorias.includes(cat))) neutraliza('categoria', 'esconder', 'categoria', 'A categoria não é nenhuma das do site: o artigo fica escondido até escolher uma da lista.');

  /* O preço: sem ele, o cartão e o carrinho não têm o que mostrar. Um artigo «confirmar antes de
     comprar» pode não ter preço (pergunta-se pelo WhatsApp: a ficha diz «preço sob consulta» e não
     tem botão de compra — DL 138/90: um artigo À VENDA no site tem de ter o preço). Nos outros, na
     pré-visualização aparece «preço por confirmar»; no domínio fica escondido até haver um. */
  const p = a.preco;
  const disp = disponibilidadeDe(a);
  if (vazio(p)) {
    if (disp !== 'confirmar') {
      if (ctx.producao) neutraliza('preco:producao', 'esconder', 'preco', 'Falta o preço: o artigo fica escondido do site até o escrever (ou passe a disponibilidade a «confirmar antes de comprar», e a ficha diz «preço sob consulta»).');
      else lembra('preco:previa', 'preco', 'Falta o preço: na pré-visualização aparece «preço por confirmar», e no site a sério o artigo fica escondido até o escrever (ou até passar a «confirmar antes de comprar»).');
    }
  } else if (typeof p !== 'number' || !Number.isFinite(p) || p < LIMITES.preco[0] || p > LIMITES.preco[1] || !duasCasas(p)) {
    neutraliza('preco', 'esconder', 'preco', 'O preço é só o número, sem € (ex.: 45 ou 44,50): o artigo fica escondido do site até ser corrigido.');
  }

  const partem = [];
  for (const [caminho, t] of textosDe(a)) if (RE_PARTE_A_PAGINA.test(t)) partem.push(caminho.split('.')[0]);
  if (partem.length) {
    const campos = [...new Set(partem)];
    neutraliza('partia-a-pagina', 'esconder', campos[0], `${campos.map((c) => `«${NOMES_CAMPOS[c] || c}»`).join(', ')}: tem «</script» ou «<!--», que não podem ir para o site. O artigo fica escondido do site até isso ser corrigido.`, { campos });
  }
  const alegam = [];
  for (const [caminho, t] of textosDe(a)) { const m = t.match(RE_ALEGACOES); if (m) alegam.push([caminho.split('.')[0], m[0]]); }
  if (alegam.length) {
    neutraliza('alegacoes', 'esconder', alegam[0][0], `«${alegam[0][1]}» é uma palavra que a lei só deixa usar com prova (ou uma certificação que não temos): o artigo fica escondido do site até a tirar.`, { campos: [...new Set(alegam.map((x) => x[0]))] });
  }

  // --- fotografias ---------------------------------------------------------
  const fotos = a.fotos;
  const lista = Array.isArray(fotos) ? fotos : [];
  if (!ausente(fotos) && !Array.isArray(fotos)) avisa('fotos', 'fotos', 'As fotografias não estão gravadas como uma lista. Escolha-as outra vez.');
  const vistos = new Set();
  let boas = 0;
  lista.forEach((f, indice) => {
    const extra = { foto: f, indice };
    if (!nomeDeFotoValido(f)) {
      neutraliza(`foto-invalida:${String(f).slice(0, 80)}`, 'sem_fotografia', 'fotos', `«${String(f).slice(0, 60)}» não é uma fotografia da biblioteca: não aparece no site. Tire-a do artigo e escolha-a outra vez.`, extra);
      return;
    }
    if (vistos.has(f)) { avisa(`foto-repetida:${f}`, 'fotos', 'Há uma fotografia duas vezes no artigo. Tire uma delas.', extra); return; }
    vistos.add(f);
    if (fotosExistem && !fotosExistem.has(f)) {
      neutraliza(`foto-em-falta:${f}`, 'sem_fotografia', 'fotos', 'Uma das fotografias já não está na biblioteca: não aparece no site. Tire-a do artigo, ou carregue-a outra vez.', extra);
      return;
    }
    boas++;
  });
  if (lista.length > TAMANHOS.fotos) avisa('fotos-a-mais', 'fotos', `O artigo tem ${lista.length} fotografias; o máximo é ${TAMANHOS.fotos}. Tire as que estão a mais.`);
  /* Sem nenhuma fotografia boa, o cartão da loja e o cartão de partilha não têm
     imagem: o artigo fica escondido até ter uma. */
  if (!boas) neutraliza('sem-fotos', 'esconder', 'fotos', 'O artigo não tem fotografias: fica escondido do site até ter pelo menos uma (a primeira é a capa).');

  // --- interruptores e listas fechadas -----------------------------------------------
  for (const b of BOOLEANOS_ARTIGO) {
    if (!ausente(a[b]) && typeof a[b] !== 'boolean') avisa(b, b, `«${NOMES_CAMPOS[b]}» tem de ser sim ou não.`);
  }
  if (!ausente(a.estado) && a.estado !== '' && !tem(ESTADOS, a.estado)) avisa('estado', 'estado', `O estado tem de ser um da lista: ${Object.values(ESTADOS).join(', ').toLowerCase()}.`);
  if (!ausente(a.disponibilidade) && a.disponibilidade !== '' && !tem(DISPONIBILIDADES, a.disponibilidade)) avisa('disponibilidade', 'disponibilidade', 'A disponibilidade tem de ser uma da lista.');

  // --- números ----------------------------------------------------------------
  const pa = a.precoAnterior;
  if (!ausente(pa) && pa !== '') {
    if (typeof pa !== 'number' || !Number.isFinite(pa) || !duasCasas(pa) || pa > LIMITES.preco[1]) avisa('precoAnterior', 'precoAnterior', 'O preço anterior é só o número, sem € (ex.: 55).');
    else if (typeof p === 'number' && pa <= p) avisa('precoAnterior', 'precoAnterior', 'O preço anterior tem de ser maior do que o preço de agora (ou fica vazio, sem promoção).');
    else if (vazio(p)) avisa('precoAnterior:sem-preco', 'precoAnterior', 'Há preço anterior mas não há preço: escreva o preço de agora, ou apague o anterior.');
  }
  const ate = a.promocaoAte;
  if (!ausente(ate) && ate !== '') {
    if (!dataValida(ate)) avisa('promocaoAte', 'promocaoAte', 'A data do fim da promoção não é uma data válida.');
    else if (vazio(pa)) avisa('promocaoAte', 'promocaoAte', 'Há data de fim da promoção, mas não há preço anterior: escreva o preço anterior, ou apague a data.');
    else if (typeof ctx.hoje === 'string' && ate < ctx.hoje && noSite(a)) lembra('promocao-acabou', 'promocaoAte', `A promoção acabou a ${ate.split('-').reverse().join('/')}: o site já mostra o preço normal (${pa} €). Pode apagar o preço anterior e a data, ou pôr uma data nova.`);
  }
  /* O INÍCIO DA PROMOÇÃO (DL 70/2007, art. 5.º: a lei pede o período e o preço mais baixo dos 30
     dias anteriores ao início; o riscado tem de ser esse preço). Com a data, a ficha diz «Promoção
     de … a … · preço mais baixo nos 30 dias anteriores: …». Sem ela, numa promoção a correr, um
     lembrete (não pára nada). */
  const desde = a.promocaoDesde;
  const emPromocao = typeof p === 'number' && typeof pa === 'number' && pa > p;
  const acabou = dataValida(ate) && typeof ctx.hoje === 'string' && ate < ctx.hoje;
  if (!ausente(desde) && desde !== '') {
    if (!dataValida(desde)) avisa('promocaoDesde', 'promocaoDesde', 'A data de início da promoção não é uma data válida.');
    else if (vazio(pa)) avisa('promocaoDesde', 'promocaoDesde', 'Há data de início da promoção, mas não há preço anterior: escreva o preço anterior, ou apague a data.');
    else if (dataValida(ate) && desde > ate) avisa('promocaoDesde', 'promocaoDesde', 'A promoção começa depois de acabar: confira as duas datas.');
  } else if (emPromocao && !acabou && noSite(a)) {
    lembra('promocao-sem-inicio', 'promocaoDesde', 'Falta a data de início da promoção: a lei pede o período e o preço mais baixo dos 30 dias anteriores (DL 70/2007). Com a data, a ficha diz «Promoção de … a … · preço mais baixo nos 30 dias anteriores: …».');
  }
  if (emPromocao && vazio(ate) && noSite(a)) lembra('promocao-sem-fim', 'promocaoAte', 'Falta a data de fim da promoção: a lei pede o período da promoção (DL 70/2007). Escolha o último dia.');
  const o = a.ordem;
  if (!ausente(o) && o !== '' && (typeof o !== 'number' || !Number.isInteger(o) || o < LIMITES.ordem[0] || o > LIMITES.ordem[1])) {
    avisa('ordem', 'ordem', `A posição é um número inteiro de 0 a ${LIMITES.ordem[1]} (mais baixo aparece primeiro).`);
  }

  // --- as características e o que inclui -----------------------------------------------
  const listaDeTextos = (campo, rotulo, maxLinhas, maxTexto) => {
    const v = a[campo];
    if (ausente(v)) return;
    if (!Array.isArray(v)) { avisa(campo, campo, `«${rotulo}» não está gravado como uma lista. Escreva-o outra vez.`); return; }
    if (v.length > maxLinhas) avisa(`${campo}:quantos`, campo, `«${rotulo}» tem ${v.length} linhas; o máximo é ${maxLinhas}.`);
    v.forEach((t, i) => {
      if (typeof t !== 'string' || !t.trim()) avisa(`${campo}.${i}`, campo, `A linha ${i + 1} de «${rotulo}» está vazia: escreva-a ou tire-a.`);
      else if (t.length > maxTexto) avisa(`${campo}.${i}:tamanho`, campo, `A linha ${i + 1} de «${rotulo}» tem mais de ${maxTexto} caracteres.`);
      else if (RE_CONTROLO_LINHA.test(t)) avisa(`${campo}.${i}:controlo`, campo, `A linha ${i + 1} de «${rotulo}» tem caracteres invisíveis. Escreva-a outra vez.`);
    });
  };
  listaDeTextos('caracteristicas', NOMES_CAMPOS.caracteristicas, TAMANHOS.caracteristicas, TAMANHOS.caracteristicaTexto);
  listaDeTextos('inclui', NOMES_CAMPOS.inclui, TAMANHOS.inclui, TAMANHOS.incluiTexto);

  // --- escolhas (a cor, a capacidade; com ou sem acréscimo) ----------------------------
  const ops = a.opcoes;
  if (!ausente(ops)) {
    if (!Array.isArray(ops)) avisa('opcoes', 'opcoes', 'As escolhas não estão gravadas como uma lista. Escreva-as outra vez.');
    else {
      if (ops.length > TAMANHOS.opcoes) avisa('opcoes:quantas', 'opcoes', `O artigo tem ${ops.length} escolhas; o máximo é ${TAMANHOS.opcoes}.`);
      const nomesG = new Set();
      ops.forEach((g, i) => {
        const onde = `A escolha ${i + 1}`;
        if (!eObjecto(g) || !Array.isArray(g.valores)) { avisa(`opcoes.${i}`, `opcoes.${i}`, `${onde} não está como deve ser: escreva-a outra vez.`); return; }
        if (!temTexto(g.nome)) avisa(`opcoes.${i}.nome`, `opcoes.${i}.nome`, `${onde} não tem nome (ex.: Cor).`);
        else {
          if (g.nome.length > TAMANHOS.opcaoNome) avisa(`opcoes.${i}.nome:tamanho`, `opcoes.${i}.nome`, `O nome da escolha ${i + 1} tem mais de ${TAMANHOS.opcaoNome} caracteres.`);
          const k = g.nome.trim().toLowerCase();
          if (nomesG.has(k)) avisa(`opcoes.${i}.nome:repetido`, `opcoes.${i}.nome`, `Há duas escolhas com o nome «${g.nome.trim()}».`);
          nomesG.add(k);
        }
        if (g.valores.length < 2) avisa(`opcoes.${i}:poucos`, `opcoes.${i}.valores`, `${onde} tem de ter pelo menos dois valores para escolher (com um só não aparece).`);
        if (g.valores.length > TAMANHOS.valores) avisa(`opcoes.${i}:muitos`, `opcoes.${i}.valores`, `${onde} tem ${g.valores.length} valores; o máximo é ${TAMANHOS.valores}.`);
        const nomesV = new Set();
        g.valores.forEach((v, j) => {
          const ondeV = `opcoes.${i}.valores.${j}`;
          if (!eObjecto(v) || !temTexto(v.nome)) { avisa(`${ondeV}.nome`, ondeV, `${onde}: o valor ${j + 1} não tem nome.`); return; }
          if (v.nome.length > TAMANHOS.valorNome) avisa(`${ondeV}.nome:tamanho`, ondeV, `${onde}: o valor «${v.nome.slice(0, 30)}» tem mais de ${TAMANHOS.valorNome} caracteres.`);
          const kv = v.nome.trim().toLowerCase();
          if (nomesV.has(kv)) avisa(`${ondeV}.nome:repetido`, ondeV, `${onde}: o valor «${v.nome.trim()}» está repetido.`);
          nomesV.add(kv);
          const s = v.suplemento;
          if (!ausente(s) && s !== '' && (typeof s !== 'number' || !Number.isFinite(s) || s < LIMITES.suplemento[0] || s > LIMITES.suplemento[1] || !duasCasas(s))) {
            avisa(`${ondeV}.suplemento`, `${ondeV}.suplemento`, `${onde}: o acréscimo de «${v.nome.trim()}» é só o número, sem € (ex.: 5), ou fica vazio (sem acréscimo).`);
          }
        });
      });
    }
  }

  const v = a.video;
  if (!ausente(v) && v !== '' && (typeof v !== 'string' || (videos && !videos.includes(v)))) avisa('video', 'video', 'O vídeo escolhido não existe: escolha outro, ou nenhum.');

  // --- textos -------------------------------------------------------------
  const texto = (campo, max, { linha = true } = {}) => {
    const x = a[campo];
    if (ausente(x) || typeof x !== 'string') return;
    if (x.length > max) avisa(`${campo}:tamanho`, campo, `«${NOMES_CAMPOS[campo]}» tem mais de ${max} caracteres (tem ${x.length}).`);
    if ((linha ? RE_CONTROLO_LINHA : RE_CONTROLO_TEXTO).test(x)) avisa(`${campo}:controlo`, campo, `«${NOMES_CAMPOS[campo]}» tem caracteres invisíveis${linha ? ' (ex.: uma mudança de linha)' : ''}. Escreva-o outra vez.`);
  };
  texto('nome', TAMANHOS.nome);
  texto('nomeCurto', TAMANHOS.nomeCurto);
  texto('marca', TAMANHOS.marca);
  texto('resumo', TAMANHOS.resumo, { linha: false });
  texto('descricao', TAMANHOS.descricao, { linha: false });
  for (const campo of ['nomeCurto', 'marca']) {
    if (!ausente(a[campo]) && a[campo] !== '' && typeof a[campo] !== 'string') avisa(`${campo}:tipo`, campo, `«${NOMES_CAMPOS[campo]}» tem de ser texto.`);
  }

  // --- a informação legal do artigo (opcional) --------------------------------
  const fab = a.fabricante;
  if (!ausente(fab)) {
    if (!eObjecto(fab)) avisa('fabricante', 'fabricante', 'O fabricante não está gravado como deve ser: escreva-o outra vez.');
    else {
      for (const [k, max, rotulo] of [['nome', TAMANHOS.fabricanteNome, 'Nome do fabricante'], ['morada', TAMANHOS.fabricanteMorada, 'Morada do fabricante']]) {
        const x = fab[k];
        if (ausente(x) || x === '') continue;
        if (typeof x !== 'string' || x.length > max || RE_CONTROLO_LINHA.test(x)) avisa(`fabricante.${k}`, `fabricante.${k}`, `«${rotulo}» tem de ser um texto numa linha, até ${max} caracteres.`);
      }
      if (!vazio(fab.email) && !emailValido(fab.email)) avisa('fabricante.email', 'fabricante.email', 'O email do fabricante não parece estar certo (ex.: nome@exemplo.pt).');
      const dados = CAMPOS_FABRICANTE.filter((k) => temTexto(fab[k]));
      if (dados.length && dados.length < CAMPOS_FABRICANTE.length && noSite(a)) {
        lembra('fabricante:incompleto', `fabricante.${CAMPOS_FABRICANTE.find((k) => !temTexto(fab[k]))}`, 'O fabricante está incompleto: a lei pede o nome, a morada e o email (Regulamento (UE) 2023/988, art. 19.º). Até estar completo, a ficha mostra os dados da loja.');
      }
    }
  }
  texto('referencia', TAMANHOS.referencia);
  texto('avisos', TAMANHOS.avisos, { linha: false });
  for (const campo of ['referencia', 'avisos']) {
    if (!ausente(a[campo]) && a[campo] !== '' && typeof a[campo] !== 'string') avisa(`${campo}:tipo`, campo, `«${NOMES_CAMPOS[campo]}» tem de ser texto.`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* content/site.json                                                   */
/* ------------------------------------------------------------------ */

export const SECCOES_SITE = Object.freeze({ contactos: 'Contactos', horario: 'Horário', aviso: 'Aviso do topo', entrega: 'Entrega e pagamento', pagamentos: 'Loja online', empresa: 'Dados legais', marca: 'A marca', extras: 'Google, DIGI e fidelidade' });
/* O que o painel nunca muda: a marca (o nome comercial, nos textos legais e no
   Google), as zonas de entrega e a localidade. */
export const BLOQUEADOS_SITE = Object.freeze(['marca', 'entrega.zonas', 'local']);
/* Os modos da loja online: «encomenda» (o site regista a encomenda e a loja combina o pagamento
   com o cliente) e «online» (paga-se na Stripe, no próprio site). O Worker dos pagamentos lê o
   mesmo valor do site publicado. */
export const MODOS_PAGAMENTO = Object.freeze({ encomenda: 'Encomenda (a loja combina o pagamento com o cliente)', online: 'Pagamento no site (Stripe: cartão, MB WAY, Multibanco)' });
/* A garantia dos recondicionados e usados: 3 anos por lei (DL 84/2021, art. 12.º), ou 18 meses
   quando a loja o acorda com o cliente antes da compra (art. 12.º, n.º 3: é o que a ficha e os
   termos dizem). O dono escolhe; sem escolha, a produção pára. */
export const GARANTIAS_USADOS = Object.freeze([18, 36]);

export function problemasDoSite(d, { producao = false } = {}) {
  const ficheiro = FICHEIROS.site;
  const out = [];
  const ecraDe = (s) => `Dados da loja › ${SECCOES_SITE[s] || s}`;
  const bloqueia = (chave, s, campo, mensagem) => out.push({ classe: 'bloqueia', chave: `site:${chave}`, ficheiro, ecra: ecraDe(s), campo, mensagem });
  const avisa = (chave, s, campo, mensagem, extra = {}) => out.push({ classe: 'avisa', chave: `site:${chave}`, ficheiro, ecra: ecraDe(s), campo, mensagem, ...extra });
  const legal = (chave, s, campo, mensagem) => (producao ? bloqueia(`${chave}:producao`, s, campo, mensagem) : avisa(chave, s, campo, mensagem, { lembrete: true }));
  if (!eObjecto(d)) { bloqueia('forma', 'marca', undefined, 'Os dados da loja não têm a forma certa. Só o Renato os pode corrigir.'); return out; }

  if (!temTexto(d.marca)) bloqueia('marca', 'marca', 'marca', 'Falta o nome da marca. Só o Renato o pode repor.');
  for (const s of ['contactos', 'empresa', 'entrega', 'local']) {
    if (!eObjecto(d[s])) bloqueia(`${s}:forma`, s, s, `A secção «${SECCOES_SITE[s] || s}» não está gravada, e sem ela o site não se consegue gerar. Só o Renato a pode repor.`);
  }
  const c = eObjecto(d.contactos) ? d.contactos : {};
  const e = eObjecto(d.empresa) ? d.empresa : {};
  /* A localidade, o concelho e o distrito aparecem em quase todas as páginas. */
  if (eObjecto(d.local) && (!temTexto(d.local.localidade) || !temTexto(d.local.concelho) || !temTexto(d.local.distrito))) bloqueia('local', 'marca', 'local', 'Falta a localidade, o concelho ou o distrito. Só o Renato os pode repor.');
  if (eObjecto(d.local) && !vazio(d.local.mapa) && !ligacaoExternaValida(d.local.mapa)) avisa('local.mapa', 'extras', 'local.mapa', 'A ligação do mapa tem de ser um endereço https completo (o «Partilhar» do Google Maps).');
  const en = eObjecto(d.entrega) ? d.entrega : {};

  /* Textos simples: tamanho, caracteres invisíveis, «</script», alegações. */
  const textoSimples = (v, chave, s, campo, rotulo, max, { linha = true } = {}) => {
    if (ausente(v)) return;
    if (typeof v !== 'string') { avisa(`${chave}:tipo`, s, campo, `«${rotulo}» tem de ser texto.`); return; }
    if (v.length > max) avisa(`${chave}:tamanho`, s, campo, `«${rotulo}» tem mais de ${max} caracteres (tem ${v.length}).`);
    if ((linha ? RE_CONTROLO_LINHA : RE_CONTROLO_TEXTO).test(v)) avisa(`${chave}:controlo`, s, campo, `«${rotulo}» tem caracteres invisíveis. Escreva-o outra vez.`);
    if (RE_PARTE_A_PAGINA.test(v)) bloqueia(`${chave}:parte`, s, campo, `«${rotulo}» tem «</script» ou «<!--», que não podem ir para o site.`);
    const m = v.match(RE_ALEGACOES);
    if (m) bloqueia(`${chave}:alegacao`, s, campo, `«${rotulo}»: «${m[0]}» é uma palavra que a lei só deixa usar com prova (ou uma certificação que não temos). Tire-a.`);
  };

  // --- contactos ---------------------------------------------------------------
  if (!ausente(c.email) && c.email !== '' && !emailValido(c.email)) bloqueia('contactos.email', 'contactos', 'contactos.email', 'O email não parece estar certo (ex.: geral@lfmobile.pt).');
  if (vazio(c.email)) legal('contactos.email:vazio', 'contactos', 'contactos.email', 'Falta o email: a lei pede um contacto por escrito no site, e é para lá que vão as encomendas.');
  if (!vazio(c.whatsapp) && !eTelemovel(c.whatsapp)) bloqueia('contactos.whatsapp', 'contactos', 'contactos.whatsapp', 'O WhatsApp tem de ser um telemóvel português de 9 algarismos (ex.: 916 537 957).');
  if (vazio(c.whatsapp)) legal('contactos.whatsapp:vazio', 'contactos', 'contactos.whatsapp', 'Falta o número de WhatsApp: é para lá que vão os pedidos de orçamento e de retoma.');
  if (!vazio(c.telefone) && !numeroPortugues(c.telefone)) avisa('contactos.telefone', 'contactos', 'contactos.telefone', 'O telefone tem de ser um número português de 9 algarismos; até lá, a página de contactos não o mostra.');
  for (const [k, rotulo] of [['instagram', 'Instagram'], ['facebook', 'Facebook']]) {
    const v = c[k];
    if (!vazio(v) && (typeof v !== 'string' || !/^[A-Za-z0-9._/-]{1,80}$/.test(v))) avisa(`contactos.${k}`, 'contactos', `contactos.${k}`, `${rotulo}: escreva só o nome da conta, sem @ nem endereço (ex.: lfmobile.store).`);
  }

  // --- horário ---------------------------------------------------------------------
  const h = d.horario;
  if (!ausente(h)) {
    if (!Array.isArray(h)) avisa('horario:forma', 'horario', 'horario', 'O horário não está gravado como uma lista de linhas. Escreva-o outra vez.');
    else {
      if (h.length > TAMANHOS.horario) avisa('horario:quantas', 'horario', 'horario', `O horário tem ${h.length} linhas; o máximo é ${TAMANHOS.horario}.`);
      h.forEach((l, i) => {
        if (!eObjecto(l) || !temTexto(l.dias) || !temTexto(l.horas)) { avisa(`horario.${i}`, 'horario', `horario.${i}`, `A linha ${i + 1} do horário está incompleta: escreva os dias (ex.: Segunda a sexta) e as horas (ex.: 10:00–13:00 · 14:30–19:00).`); return; }
        textoSimples(l.dias, `horario.${i}.dias`, 'horario', `horario.${i}.dias`, 'Dias', TAMANHOS.horarioDias);
        textoSimples(l.horas, `horario.${i}.horas`, 'horario', `horario.${i}.horas`, 'Horas', TAMANHOS.horarioHoras);
      });
    }
  }
  if (vazio(h)) avisa('horario:vazio', 'horario', 'horario', 'Falta o horário da loja: aparece nos contactos e no rodapé.', { lembrete: true });

  // --- empresa (os dados que a lei pede) ----------------------------------------
  if (vazio(e.nome)) legal('empresa.nome:vazio', 'empresa', 'empresa.nome', 'Falta o nome da empresa ou do empresário em nome individual (a lei pede-o no site).');
  if (!vazio(e.nif) && !nifValido(e.nif)) bloqueia('empresa.nif', 'empresa', 'empresa.nif', 'O NIF não é um NIF português válido: confira os 9 algarismos.');
  if (vazio(e.nif)) legal('empresa.nif:vazio', 'empresa', 'empresa.nif', 'Falta o NIF: a lei pede-o no site (DL 7/2004, art. 10.º).');
  if (vazio(e.morada) || vazio(e.codigoPostal) || vazio(e.localidade)) legal('empresa.morada:vazio', 'empresa', vazio(e.morada) ? 'empresa.morada' : vazio(e.codigoPostal) ? 'empresa.codigoPostal' : 'empresa.localidade', 'Falta a morada da loja (rua e número, código postal e localidade): a lei pede-a no site.');
  if (!vazio(e.codigoPostal) && !/^\d{4}-\d{3}$/.test(String(e.codigoPostal).trim())) avisa('empresa.codigoPostal', 'empresa', 'empresa.codigoPostal', 'O código postal tem a forma 3720-684.');
  if (vazio(e.iva)) avisa('empresa.iva:vazio', 'empresa', 'empresa.iva', 'Falta dizer se os preços incluem IVA (ex.: «Os preços incluem IVA à taxa legal em vigor»): os termos dizem-no ao cliente.', { lembrete: true });
  for (const [k, max, rotulo] of [['nome', TAMANHOS.empresaNome, 'Nome'], ['tipo', TAMANHOS.empresaTipo, 'Tipo'], ['morada', TAMANHOS.morada, 'Morada'], ['localidade', TAMANHOS.localidade, 'Localidade'], ['concelho', TAMANHOS.concelho, 'Concelho'], ['iva', TAMANHOS.iva, 'IVA']]) {
    textoSimples(e[k], `empresa.${k}`, 'empresa', `empresa.${k}`, rotulo, max);
  }

  // --- aviso do topo ------------------------------------------------------------
  const av = d.aviso;
  if (!ausente(av)) {
    if (!eObjecto(av)) avisa('aviso:forma', 'aviso', 'aviso', 'O aviso do topo não está gravado como deve ser: escreva-o outra vez.');
    else {
      textoSimples(av.texto, 'aviso.texto', 'aviso', 'aviso.texto', 'Texto do aviso', TAMANHOS.avisoTexto);
      if (!vazio(av.ate) && !dataValida(av.ate)) avisa('aviso.ate', 'aviso', 'aviso.ate', 'A data até quando o aviso aparece não é uma data válida.');
      if (!vazio(av.ligacao) && (typeof av.ligacao !== 'string' || !/^\/[a-z0-9/-]*$/.test(av.ligacao))) avisa('aviso.ligacao', 'aviso', 'aviso.ligacao', 'A ligação do aviso tem de ser uma página do site (ex.: /loja/).');
    }
  }

  // --- entrega -------------------------------------------------------------------
  const zonas = en.zonas;
  if (!Array.isArray(zonas) || !zonas.some((z) => eObjecto(z) && z.id === 'levantamento') || !ZONAS_ENVIO.every((id) => zonas.some((z) => eObjecto(z) && z.id === id && temTexto(z.nome) && temTexto(z.curto)))) {
    bloqueia('entrega.zonas', 'entrega', 'entrega.zonas', 'As zonas de entrega não estão como deviam. Só o Renato as pode corrigir.');
  }
  const portes = eObjecto(en.portes) ? en.portes : {};
  if (!ausente(en.portes) && !eObjecto(en.portes)) avisa('entrega.portes', 'entrega', 'entrega.portes', 'Os portes não estão gravados como deve ser. Escreva-os outra vez.');
  const faltamPortes = [];
  for (const z of ZONAS_ENVIO) {
    const v = portes[z];
    if (ausente(v) || v === '') { faltamPortes.push(z); continue; }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < LIMITES.portes[0] || v > LIMITES.portes[1] || !duasCasas(v)) avisa(`entrega.portes.${z}`, 'entrega', `entrega.portes.${z}`, `Portes para ${NOMES_ZONAS[z]}: só o número, sem € (ex.: 5), ou vazio («a confirmar»).`);
  }
  const gratis = portes.gratisAPartirDe;
  if (!ausente(gratis) && gratis !== '' && (typeof gratis !== 'number' || !Number.isFinite(gratis) || gratis < 0 || gratis > LIMITES.portes[1] || !duasCasas(gratis))) {
    avisa('entrega.portes.gratisAPartirDe', 'entrega', 'entrega.portes.gratisAPartirDe', 'Portes grátis a partir de: só o número, sem € (ex.: 100), ou vazio (sem portes grátis).');
  }
  /* Sem portes, no site a sério, não se pode pagar um envio (DL 24/2014, art. 4.º: o preço total
     com os portes antes de encomendar): a produção pára. Na pré-visualização, «a confirmar». */
  if (faltamPortes.length) legal('entrega.portes:por-preencher', 'entrega', `entrega.portes.${faltamPortes[0]}`, `Faltam os portes para ${faltamPortes.map((z) => NOMES_ZONAS[z]).join(' e ')}: o cliente tem de saber o custo do envio antes de encomendar.`);
  if (vazio(en.prazo)) legal('entrega.prazo:vazio', 'entrega', 'entrega.prazo', 'Falta o prazo de entrega: a lei pede que o cliente o saiba antes de encomendar.');
  if (vazio(en.pagamento)) legal('entrega.pagamento:vazio', 'entrega', 'entrega.pagamento', 'Faltam as formas de pagamento: a lei pede que o cliente as saiba antes de encomendar.');
  textoSimples(en.prazo, 'entrega.prazo', 'entrega', 'entrega.prazo', 'Prazo', TAMANHOS.prazo, { linha: false });
  textoSimples(en.pagamento, 'entrega.pagamento', 'entrega', 'entrega.pagamento', 'Pagamento', TAMANHOS.pagamento, { linha: false });
  textoSimples(en.levantamento, 'entrega.levantamento', 'entrega', 'entrega.levantamento', 'Levantamento', TAMANHOS.levantamento, { linha: false });

  // --- a loja online (o modo dos pagamentos) ----------------------------------------------
  const pg = d.pagamentos;
  if (!ausente(pg)) {
    if (!eObjecto(pg)) bloqueia('pagamentos:forma', 'pagamentos', 'pagamentos', 'A secção «Loja online» não está gravada como deve ser. Só o Renato a pode repor.');
    else if (!tem(MODOS_PAGAMENTO, pg.modo)) bloqueia('pagamentos.modo', 'pagamentos', 'pagamentos.modo', 'O modo da loja online tem de ser «encomenda» ou «online».');
  }

  // --- as garantias ---------------------------------------------------------------------
  const g = d.garantias;
  if (!ausente(g)) {
    if (!eObjecto(g)) avisa('garantias:forma', 'extras', 'garantias', 'As garantias não estão gravadas como deve ser.');
    else if (!vazio(g.recondicionados) && !GARANTIAS_USADOS.includes(g.recondicionados)) avisa('garantias.recondicionados', 'extras', 'garantias.recondicionados', 'A garantia dos recondicionados e usados é 18 ou 36 meses.');
  }
  if (!eObjecto(g) || vazio(g.recondicionados)) legal('garantias.recondicionados:vazio', 'extras', 'garantias.recondicionados', 'Falta a garantia dos recondicionados e usados (18 meses por acordo, ou os 3 anos da lei): a ficha e os termos dizem-na ao cliente.');

  // --- Google, DIGI e fidelidade -------------------------------------------------------------
  const go = d.google;
  if (!ausente(go)) {
    if (!eObjecto(go)) avisa('google:forma', 'extras', 'google', 'Os dados do Google não estão gravados como deve ser.');
    else {
      if (!vazio(go.ligacao) && !ligacaoExternaValida(go.ligacao)) avisa('google.ligacao', 'extras', 'google.ligacao', 'A ligação das opiniões do Google tem de ser um endereço https completo.');
      if (!vazio(go.nota) && !/^[1-5](?:[,.]\d)?$/.test(String(go.nota).trim())) avisa('google.nota', 'extras', 'google.nota', 'A nota do Google é um número de 1 a 5, com uma casa decimal (ex.: 5,0).');
      if (!vazio(go.opinioes) && (!Number.isInteger(go.opinioes) || go.opinioes < LIMITES.opinioes[0] || go.opinioes > LIMITES.opinioes[1])) avisa('google.opinioes', 'extras', 'google.opinioes', 'O número de opiniões é um número inteiro.');
      if (!vazio(go.nota) && vazio(go.ligacao)) avisa('google:sem-ligacao', 'extras', 'google.ligacao', 'Há nota do Google mas não há ligação: o site só mostra a nota com a ligação para as opiniões, para quem quiser conferir.', { lembrete: true });
    }
  }
  const pa = d.parcerias;
  if (!ausente(pa) && (!eObjecto(pa) || (!ausente(pa.digi) && typeof pa.digi !== 'boolean'))) avisa('parcerias', 'extras', 'parcerias.digi', '«Vendedor Oficial DIGI» tem de ser sim ou não.');
  const fi = d.fidelidade;
  if (!ausente(fi)) {
    if (!eObjecto(fi)) avisa('fidelidade:forma', 'extras', 'fidelidade', 'O cartão de fidelidade não está gravado como deve ser.');
    else textoSimples(fi.texto, 'fidelidade.texto', 'extras', 'fidelidade.texto', 'Cartão de fidelidade', TAMANHOS.fidelidade, { linha: false });
  }

  // --- a marca ----------------------------------------------------------------------
  textoSimples(d.descricao, 'descricao', 'marca', 'descricao', 'Descrição da marca', TAMANHOS.descricaoSite, { linha: false });
  textoSimples(d.assinatura, 'assinatura', 'marca', 'assinatura', 'Frase do rodapé', TAMANHOS.assinatura);
  return out;
}

/* ------------------------------------------------------------------ */
/* content/categorias.json                                             */
/* ------------------------------------------------------------------ */

export function problemasDasCategorias(valor, { fotos = null } = {}) {
  const ficheiro = FICHEIROS.categorias;
  const out = [];
  const bloqueia = (chave, campo, mensagem) => out.push({ classe: 'bloqueia', chave: `categorias:${chave}`, ficheiro, ecra: 'Categorias', campo, mensagem });
  const avisa = (chave, campo, mensagem) => out.push({ classe: 'avisa', chave: `categorias:${chave}`, ficheiro, ecra: 'Categorias', campo, mensagem });
  const l = lerJson(valor);
  if (!Array.isArray(l.obj) || !l.obj.length) { bloqueia('forma', undefined, 'As categorias não se conseguem ler: sem elas o site não se consegue gerar. Só o Renato as pode corrigir.'); return out; }
  const slugs = new Set();
  l.obj.forEach((c, i) => {
    if (!eObjecto(c) || !slugValido(c.slug)) { bloqueia(`${i}:forma`, `${i}`, `A categoria ${i + 1} não tem a forma certa. Só o Renato a pode corrigir.`); return; }
    if (slugs.has(c.slug)) bloqueia(`${c.slug}:repetida`, `${i}`, `A categoria «${c.slug}» está repetida. Só o Renato a pode corrigir.`);
    slugs.add(c.slug);
    for (const [k, max, rotulo, obrigatorio] of [['nome', TAMANHOS.catNome, 'Nome', true], ['titulo', TAMANHOS.catTitulo, 'Título da página', true], ['resumo', TAMANHOS.catResumo, 'Texto da página', false]]) {
      const v = c[k];
      if (vazio(v)) { if (obrigatorio) bloqueia(`${c.slug}.${k}:vazio`, `${i}.${k}`, `«${rotulo}» da categoria ${c.nome || c.slug} está vazio.`); continue; }
      if (typeof v !== 'string') { bloqueia(`${c.slug}.${k}:tipo`, `${i}.${k}`, `«${rotulo}» da categoria ${c.slug} tem de ser texto.`); continue; }
      if (v.length > max) avisa(`${c.slug}.${k}:tamanho`, `${i}.${k}`, `«${rotulo}» da categoria ${c.nome || c.slug} tem mais de ${max} caracteres.`);
      if (RE_CONTROLO_TEXTO.test(v) || RE_PARTE_A_PAGINA.test(v)) bloqueia(`${c.slug}.${k}:controlo`, `${i}.${k}`, `«${rotulo}» da categoria ${c.nome || c.slug} tem caracteres que não podem ir para o site.`);
      const m = v.match(RE_ALEGACOES);
      if (m) bloqueia(`${c.slug}.${k}:alegacao`, `${i}.${k}`, `«${rotulo}» da categoria ${c.nome || c.slug}: «${m[0]}» é uma palavra que a lei só deixa usar com prova. Tire-a.`);
    }
    /* A fotografia da categoria é opcional (o menu da LF Mobile é só texto); se estiver escrita, tem de existir. */
    if (!vazio(c.foto) && (!nomeDeFotoValido(c.foto) || (fotos && !fotos.has(c.foto)))) bloqueia(`${c.slug}.foto`, `${i}.foto`, `A fotografia da categoria ${c.nome || c.slug} não existe na biblioteca: escolha outra, ou nenhuma.`);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* content/servicos.json                                               */
/* ------------------------------------------------------------------ */

/* Os serviços de reparação e manutenção (a página /reparacoes/ e a secção da página inicial):
   [{ slug, nome, icone, resumo, itens: [texto], preco?: texto }]. O «preco» é uma frase
   («Orçamento gratuito», «Desde 20 €»), nunca um número: cada reparação é orçamentada. */
export function problemasDosServicos(valor) {
  const ficheiro = FICHEIROS.servicos;
  const out = [];
  const ecra = 'Serviços';
  const bloqueia = (chave, campo, mensagem) => out.push({ classe: 'bloqueia', chave: `servicos:${chave}`, ficheiro, ecra, campo, mensagem });
  const avisa = (chave, campo, mensagem) => out.push({ classe: 'avisa', chave: `servicos:${chave}`, ficheiro, ecra, campo, mensagem });
  const l = lerJson(valor);
  if (!Array.isArray(l.obj)) { bloqueia('forma', undefined, 'Os serviços não se conseguem ler. Só o Renato os pode corrigir.'); return out; }
  if (l.obj.length > TAMANHOS.servicos) avisa('quantos', undefined, `Há ${l.obj.length} serviços; o máximo é ${TAMANHOS.servicos}.`);
  const slugs = new Set();
  l.obj.forEach((s, i) => {
    if (!eObjecto(s) || !slugValido(s.slug)) { bloqueia(`${i}:forma`, `${i}`, `O serviço ${i + 1} não tem a forma certa. Só o Renato o pode corrigir.`); return; }
    if (slugs.has(s.slug)) bloqueia(`${s.slug}:repetido`, `${i}`, `O serviço «${s.slug}» está repetido. Só o Renato o pode corrigir.`);
    slugs.add(s.slug);
    const rotulo = s.nome || s.slug;
    if (!temTexto(s.nome)) bloqueia(`${s.slug}.nome:vazio`, `${i}.nome`, `O serviço ${i + 1} não tem nome.`);
    for (const [k, max, nomeCampo, { linha = true } = {}] of [['nome', TAMANHOS.servicoNome, 'Nome'], ['resumo', TAMANHOS.servicoResumo, 'Frase curta', { linha: false }], ['preco', TAMANHOS.servicoPreco, 'Preço']]) {
      const v = s[k];
      if (ausente(v) || v === '') continue;
      if (typeof v !== 'string') { bloqueia(`${s.slug}.${k}:tipo`, `${i}.${k}`, `«${nomeCampo}» do serviço ${rotulo} tem de ser texto.`); continue; }
      if (v.length > max) avisa(`${s.slug}.${k}:tamanho`, `${i}.${k}`, `«${nomeCampo}» do serviço ${rotulo} tem mais de ${max} caracteres.`);
      if ((linha ? RE_CONTROLO_LINHA : RE_CONTROLO_TEXTO).test(v) || RE_PARTE_A_PAGINA.test(v)) bloqueia(`${s.slug}.${k}:controlo`, `${i}.${k}`, `«${nomeCampo}» do serviço ${rotulo} tem caracteres que não podem ir para o site.`);
      const m = v.match(RE_ALEGACOES);
      if (m) bloqueia(`${s.slug}.${k}:alegacao`, `${i}.${k}`, `«${nomeCampo}» do serviço ${rotulo}: «${m[0]}» é uma palavra que a lei só deixa usar com prova. Tire-a.`);
    }
    if (!vazio(s.icone) && !ICONES_SERVICO.includes(s.icone)) avisa(`${s.slug}.icone`, `${i}.icone`, `O desenho do serviço ${rotulo} não é nenhum dos do site: escolha um da grelha.`);
    const it = s.itens;
    if (!ausente(it)) {
      if (!Array.isArray(it)) avisa(`${s.slug}.itens`, `${i}.itens`, `A lista do serviço ${rotulo} não está gravada como uma lista.`);
      else {
        if (it.length > TAMANHOS.servicoItens) avisa(`${s.slug}.itens:quantos`, `${i}.itens`, `O serviço ${rotulo} tem ${it.length} linhas; o máximo é ${TAMANHOS.servicoItens}.`);
        it.forEach((t, j) => {
          if (typeof t !== 'string' || !t.trim()) avisa(`${s.slug}.itens.${j}`, `${i}.itens`, `A linha ${j + 1} do serviço ${rotulo} está vazia: escreva-a ou tire-a.`);
          else if (t.length > TAMANHOS.servicoItem || RE_CONTROLO_LINHA.test(t) || RE_PARTE_A_PAGINA.test(t)) avisa(`${s.slug}.itens.${j}:tamanho`, `${i}.itens`, `A linha ${j + 1} do serviço ${rotulo} é comprida de mais ou tem caracteres que não podem ir para o site.`);
        });
      }
    }
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* content/inicio.json                                                 */
/* ------------------------------------------------------------------ */

/* As secções da página inicial, pela ordem da página: a capa, os destaques da loja, as
   reparações, a retoma e a loja (a fotografia da fachada). Poucas e curtas. */
export const SECCOES_INICIO = Object.freeze(['seo', 'capa', 'destaques', 'reparacoes', 'retoma', 'loja']);

/* As fotografias que a página inicial usa (para saber se uma se pode apagar). */
export function fotosDoInicio(h) {
  if (!eObjecto(h)) return [];
  const out = [];
  for (const k of ['capa', 'loja']) if (eObjecto(h[k])) out.push(h[k].foto);
  return out.filter((x) => typeof x === 'string');
}

export function problemasDoInicio(valor, { fotos = null } = {}) {
  const ficheiro = FICHEIROS.inicio;
  const out = [];
  const ecra = 'Página inicial';
  const bloqueia = (chave, campo, mensagem) => out.push({ classe: 'bloqueia', chave: `inicio:${chave}`, ficheiro, ecra, campo, mensagem });
  const avisa = (chave, campo, mensagem, extra = {}) => out.push({ classe: 'avisa', chave: `inicio:${chave}`, ficheiro, ecra, campo, mensagem, ...extra });
  const l = lerJson(valor);
  if (l.ilegivel || !eObjecto(l.obj)) { bloqueia('forma', undefined, 'A página inicial não se consegue ler. Só o Renato a pode corrigir.'); return out; }
  const h = l.obj;
  const seccao = (k) => (eObjecto(h[k]) ? h[k] : null);
  for (const k of SECCOES_INICIO) {
    if (!seccao(k)) bloqueia(`${k}:forma`, k, `A secção «${k}» da página inicial não está gravada. Só o Renato a pode repor.`);
  }
  if (out.length) return out;
  /* Os textos todos: obrigatórios onde o gerador os escreve sem perguntar. Poucos e curtos. */
  const textos = [
    ['seo.titulo', TAMANHOS.inicioTitulo, true], ['seo.descricao', TAMANHOS.inicioTexto, true],
    ['capa.titulo', TAMANHOS.inicioTitulo, true], ['capa.texto', TAMANHOS.inicioTexto, false], ['capa.botao', TAMANHOS.inicioCurto, true], ['capa.botao2', TAMANHOS.inicioCurto, false],
    ['destaques.titulo', TAMANHOS.inicioTitulo, true], ['destaques.texto', TAMANHOS.inicioTexto, false], ['destaques.botao', TAMANHOS.inicioCurto, true],
    ['reparacoes.titulo', TAMANHOS.inicioTitulo, true], ['reparacoes.texto', TAMANHOS.inicioTexto, false], ['reparacoes.botao', TAMANHOS.inicioCurto, true],
    ['retoma.titulo', TAMANHOS.inicioTitulo, true], ['retoma.texto', TAMANHOS.inicioTexto, false], ['retoma.botao', TAMANHOS.inicioCurto, true],
    ['loja.titulo', TAMANHOS.inicioTitulo, true], ['loja.texto', TAMANHOS.inicioTexto, false],
  ];
  const valorEm = (caminho) => caminho.split('.').reduce((o, k) => (eObjecto(o) || Array.isArray(o) ? o[k] : undefined), h);
  const umTexto = (caminho, max, obrigatorio) => {
    const v = valorEm(caminho);
    if (vazio(v)) { if (obrigatorio) bloqueia(`${caminho}:vazio`, caminho, 'Este texto da página inicial está vazio: escreva-o.'); return; }
    if (typeof v !== 'string') { bloqueia(`${caminho}:tipo`, caminho, 'Este texto da página inicial não está gravado como texto.'); return; }
    if (v.length > max) avisa(`${caminho}:tamanho`, caminho, `Este texto tem mais de ${max} caracteres (tem ${v.length}).`);
    if (RE_CONTROLO_TEXTO.test(v) || RE_PARTE_A_PAGINA.test(v)) bloqueia(`${caminho}:controlo`, caminho, 'Este texto tem caracteres que não podem ir para o site. Escreva-o outra vez.');
    const m = v.match(RE_ALEGACOES);
    if (m) bloqueia(`${caminho}:alegacao`, caminho, `«${m[0]}» é uma palavra que a lei só deixa usar com prova (ou uma certificação que não temos). Tire-a.`);
  };
  for (const [c, max, ob] of textos) umTexto(c, max, ob);
  for (const k of ['capa.ligacao', 'capa.ligacao2']) {
    const v = valorEm(k);
    if (!vazio(v) && (typeof v !== 'string' || !/^\/[a-z0-9/-]*$/.test(v))) avisa(k, k, 'A ligação do botão tem de ser uma página do site (ex.: /loja/).');
  }
  /* As fotografias: a da capa é obrigatória; a da loja é opcional (sem ela a secção sai sem fotografia). */
  if (!nomeDeFotoValido(h.capa.foto) || (fotos && !fotos.has(h.capa.foto))) bloqueia('capa.foto:foto', 'capa.foto', 'A fotografia da capa já não está na biblioteca: escolha outra.');
  if (!vazio(h.loja.foto) && (!nomeDeFotoValido(h.loja.foto) || (fotos && !fotos.has(h.loja.foto)))) bloqueia('loja.foto:foto', 'loja.foto', 'A fotografia da loja já não está na biblioteca: escolha outra, ou nenhuma.');
  return out;
}

/* ------------------------------------------------------------------ */
/* content/fotos.json                                                  */
/* ------------------------------------------------------------------ */

/* Cada fotografia tem o texto alternativo (o que um leitor de ecrã diz, e o que o
   Google lê) e o ponto de foco (onde se corta, em «x% y%»). */
const RE_FOCO = /^(\d{1,3})% (\d{1,3})%$/;
export const focoValido = (f) => { const m = RE_FOCO.exec(String(f ?? '')); return Boolean(m) && Number(m[1]) <= 100 && Number(m[2]) <= 100; };

export function problemasDasFotos(valor, ficheirosFotos = null) {
  const ficheiro = FICHEIROS.fotos;
  const out = [];
  const bloqueia = (chave, campo, mensagem, extra = {}) => out.push({ classe: 'bloqueia', chave: `fotos:${chave}`, ficheiro, ecra: 'Fotografias', campo, mensagem, ...extra });
  const avisa = (chave, campo, mensagem, extra = {}) => out.push({ classe: 'avisa', chave: `fotos:${chave}`, ficheiro, ecra: 'Fotografias', campo, mensagem, ...extra });
  const l = lerJson(valor);
  if (l.ilegivel || !eObjecto(l.obj)) { bloqueia('forma', undefined, 'A lista das fotografias não se consegue ler. Só o Renato a pode corrigir.'); return out; }
  for (const [nome, f] of Object.entries(l.obj)) {
    if (!nomeDeFotoValido(nome)) { bloqueia(`${nome.slice(0, 60)}:nome`, nome, `«${nome.slice(0, 60)}» não é um nome de fotografia válido. Só o Renato o pode corrigir.`); continue; }
    if (!eObjecto(f)) { bloqueia(`${nome}:forma`, nome, `A fotografia «${nome}» não tem a forma certa.`); continue; }
    if (!temTexto(f.alt)) bloqueia(`${nome}:alt`, `${nome}.alt`, 'Uma fotografia não tem descrição (o que um leitor de ecrã diz): escreva-a.', { foto: nome });
    else {
      if (f.alt.length > TAMANHOS.alt) avisa(`${nome}:alt:tamanho`, `${nome}.alt`, `A descrição de uma fotografia tem mais de ${TAMANHOS.alt} caracteres.`, { foto: nome });
      if (RE_CONTROLO_LINHA.test(f.alt) || RE_PARTE_A_PAGINA.test(f.alt)) bloqueia(`${nome}:alt:controlo`, `${nome}.alt`, 'A descrição de uma fotografia tem caracteres que não podem ir para o site.', { foto: nome });
    }
    if (!ausente(f.foco) && !focoValido(f.foco)) avisa(`${nome}:foco`, `${nome}.foco`, 'O ponto de foco de uma fotografia não está como devia.', { foto: nome });
  }
  if (Array.isArray(ficheirosFotos)) {
    for (const n of ficheirosFotos) {
      /* Um ficheiro com um nome que o site não aceita (posto à mão: «Foto 1.jpg»): o painel não lhe
         consegue dar descrição — é do Renato. */
      if (!nomeDeFotoValido(n)) { bloqueia(`${String(n).slice(0, 60)}:nome-do-ficheiro`, undefined, `Há uma fotografia na biblioteca com um nome que o site não aceita («${String(n).slice(0, 60)}»: só minúsculas, algarismos e hífens). Só o Renato a pode corrigir.`, { foto: n }); continue; }
      if (!tem(l.obj, n)) bloqueia(`${n}:sem-entrada`, n, `A fotografia «${n}» não tem descrição: escreva-a.`, { foto: n });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Todos                                                               */
/* ------------------------------------------------------------------ */

/* problemas(dados, opcoes) → [problema]
 *   opcoes: { hoje?: 'AAAA-MM-DD', producao?: boolean } */
export function problemas(dados = {}, opcoes = {}) {
  const lista = [];
  const d = eObjecto(dados) ? dados : {};
  const fotos = fotosQueExistem(d);
  const videos = Array.isArray(d.videos) ? d.videos : null;
  let categorias = null;
  if (tem(d, 'categorias')) { const cs = categoriasDe(d.categorias); if (cs) categorias = cs.map((c) => c.slug); }

  const umFicheiro = (k, rotulo, fn) => {
    if (!tem(d, k)) return;
    const l = lerJson(d[k]);
    const ficheiro = FICHEIROS[k];
    if (l.ausente) lista.push({ classe: 'bloqueia', chave: `${k}:ausente`, ficheiro, ecra: rotulo, mensagem: `Falta o ficheiro ${ficheiro}: sem ele o site não se consegue gerar. Só o Renato o pode repor.` });
    else if (l.ilegivel) lista.push({ classe: 'bloqueia', chave: `${k}:ilegivel`, ficheiro, ecra: rotulo, mensagem: `${rotulo}: o ficheiro não se consegue ler (JSON inválido: ${l.ilegivel}). Só o Renato o pode corrigir.` });
    else lista.push(...fn(l.obj));
  };
  umFicheiro('site', 'Dados da loja', (o) => problemasDoSite(o, { producao: Boolean(opcoes.producao) }));
  umFicheiro('fotos', 'Fotografias', (o) => problemasDasFotos(o, Array.isArray(d.ficheirosFotos) ? d.ficheirosFotos : null));
  umFicheiro('categorias', 'Categorias', (o) => problemasDasCategorias(o, { fotos }));
  umFicheiro('servicos', 'Serviços', (o) => problemasDosServicos(o));
  umFicheiro('inicio', 'Página inicial', (o) => problemasDoInicio(o, { fotos }));

  const mapa = d.artigos;
  if (eObjecto(mapa)) {
    for (const nome of Object.keys(mapa).sort()) {
      const valor = mapa[nome];
      if (ausente(valor)) continue;
      const slug = slugDoFicheiro(nome);
      const ficheiro = ficheiroDoArtigo(nome);
      const ecra = `Artigos › ${slug}`;
      const base = { ficheiro, slug };
      const l = lerJson(valor);
      if (l.ilegivel) { lista.push({ classe: 'bloqueia', chave: `artigo:${slug}:ilegivel`, ecra, ...base, mensagem: `O ficheiro deste artigo não se consegue ler (JSON inválido: ${l.ilegivel}). Só o Renato o pode corrigir.` }); continue; }
      if (!eObjecto(l.obj)) { lista.push({ classe: 'bloqueia', chave: `artigo:${slug}:forma`, ecra, ...base, mensagem: 'O ficheiro deste artigo não tem a forma de um artigo. Só o Renato o pode corrigir.' }); continue; }
      if (!slugValido(slug)) { lista.push({ classe: 'bloqueia', chave: `artigo:${slug}:endereco`, ecra, ...base, mensagem: `O nome do ficheiro («${nome}») não é um endereço válido (só minúsculas, algarismos e hífenes). Só o Renato o pode corrigir.` }); continue; }
      lista.push(...problemasDoArtigo(l.obj, { nome, categorias, fotos, videos, hoje: opcoes.hoje, producao: Boolean(opcoes.producao) }));
      const bytes = l.texto !== null ? bytesDe(l.texto) : bytesDe(serializar(l.obj));
      if (bytes > TECTOS.artigoBytes * TECTOS.aviso) lista.push({ classe: 'avisa', lembrete: true, chave: `artigo:${slug}:tecto`, ecra: ecraDoArtigo(l.obj, slug), ...base, mensagem: `Este artigo está a chegar ao limite do painel (${Math.round(bytes / 1024)} de ${TECTOS.artigoBytes / 1024} KB): encurte a descrição.` });
    }
  }
  return lista;
}

/* ------------------------------------------------------------------ */
/* A cópia que o gerador lê                                            */
/* ------------------------------------------------------------------ */

/* neutralizar(dados, lista) → { artigos: { <nome>: objecto }, efeitos, mudou }
 *   Os problemas «neutraliza» aplicados a uma CÓPIA dos artigos (o repositório
 *   não muda):
 *     · esconder       — publicado: false (sai do site, como um rascunho);
 *     · sem_fotografia — a fotografia sai da lista.
 *   efeitos: o que muda NO SITE, por artigo: [{ ficheiro, slug, nome, efeitos, motivos }] */
export function neutralizar(dados = {}, lista = []) {
  const d = eObjecto(dados) ? dados : {};
  const porFicheiro = new Map();
  for (const p of Array.isArray(lista) ? lista : []) {
    if (p && p.classe === 'neutraliza' && typeof p.ficheiro === 'string') porFicheiro.set(p.ficheiro, [...(porFicheiro.get(p.ficheiro) || []), p]);
  }
  const artigos = {};
  const efeitos = [];
  let mudou = false;
  const mapa = eObjecto(d.artigos) ? d.artigos : {};
  for (const nome of Object.keys(mapa).sort()) {
    const l = lerJson(mapa[nome]);
    if (!eObjecto(l.obj)) continue;
    const a = JSON.parse(JSON.stringify(l.obj));
    const prs = porFicheiro.get(ficheiroDoArtigo(nome)) || [];
    const feitos = []; const motivos = [];
    if (prs.some((p) => p.efeito === 'esconder')) {
      if (a.publicado !== false) { a.publicado = false; feitos.push('esconder'); mudou = true; }
      motivos.push(...prs.filter((p) => p.efeito === 'esconder').map((p) => p.mensagem));
    }
    const tirar = new Set(prs.filter((p) => p.efeito === 'sem_fotografia').map((p) => String(p.foto)));
    if (tirar.size && Array.isArray(a.fotos)) {
      a.fotos = a.fotos.filter((f) => !tirar.has(String(f)));
      mudou = true;
      if (!feitos.includes('esconder')) { feitos.push('sem_fotografia'); motivos.push(...prs.filter((p) => p.efeito === 'sem_fotografia').map((p) => p.mensagem)); }
    }
    artigos[nome] = a;
    if (feitos.length) efeitos.push({ ficheiro: ficheiroDoArtigo(nome), slug: slugDoFicheiro(nome), nome: nomeDoArtigo(l.obj, slugDoFicheiro(nome)), efeitos: feitos, motivos });
  }
  return { artigos, efeitos, mudou };
}

const DESCRICAO_EFEITOS = { esconder: 'escondido do site', sem_fotografia: 'com fotografias que não aparecem' };
export const descreverEfeitos = (e) => e.efeitos.map((x) => DESCRICAO_EFEITOS[x] || x).join(' e ');

/* ------------------------------------------------------------------ */
/* O que o painel não pode mudar ao gravar                             */
/* ------------------------------------------------------------------ */

const valorEmCaminho = (o, caminho) => caminho.split('.').reduce((x, k) => (eObjecto(x) ? x[k] : undefined), o);

/* mudancasBloqueadas(antes, depois, qual) → [{ caminho, motivo }] ([] = pode gravar)
 *   'artigo':     as chaves que não são CAMPOS_ARTIGO não mudam;
 *   'site':       BLOQUEADOS_SITE não mudam, e não aparecem secções novas;
 *   'categorias': as categorias são as mesmas, pela mesma ordem (o slug);
 *   'servicos':   os serviços podem mudar de ordem, entrar e sair (são do dono);
 *   'inicio':     não aparecem nem desaparecem secções. */
export function mudancasBloqueadas(antes, depois, qual = 'site') {
  const out = [];
  if (qual === 'artigo') {
    const a = eObjecto(antes) ? antes : {}; const d = eObjecto(depois) ? depois : {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(d)])) {
      if (CAMPOS_ARTIGO.includes(k) || mesmoValor(a[k], d[k])) continue;
      out.push({ caminho: k, motivo: tem(a, k) ? 'mudou' : 'chave_nova' });
    }
    return out;
  }
  if (qual === 'categorias') {
    const a = Array.isArray(antes) ? antes : []; const d = Array.isArray(depois) ? depois : [];
    if (a.length !== d.length) return [{ caminho: 'categorias', motivo: 'quantas' }];
    a.forEach((c, i) => {
      if (!mesmoValor(eObjecto(c) ? c.slug : null, eObjecto(d[i]) ? d[i].slug : null)) out.push({ caminho: `${i}.slug`, motivo: 'mudou' });
    });
    return out;
  }
  if (qual === 'servicos') return out;
  const a = eObjecto(antes) ? antes : {}; const d = eObjecto(depois) ? depois : {};
  if (qual === 'inicio') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(d)])) if (!tem(a, k) || !tem(d, k)) out.push({ caminho: k, motivo: tem(a, k) ? 'saiu' : 'chave_nova' });
    return out;
  }
  for (const caminho of BLOQUEADOS_SITE) if (!mesmoValor(valorEmCaminho(a, caminho), valorEmCaminho(d, caminho))) out.push({ caminho, motivo: 'mudou' });
  const conhecidas = new Set([...Object.keys(a), ...Object.keys(SECCOES_SITE), 'descricao', 'assinatura', 'local', 'garantias', 'google', 'parcerias', 'fidelidade']);
  for (const k of Object.keys(d)) if (!conhecidas.has(k)) out.push({ caminho: k, motivo: 'chave_nova' });
  return out;
}

/* A ORDEM DAS CHAVES AO GRAVAR: as que já estavam no ficheiro ficam onde
   estavam; uma nova entra antes da primeira que, na ordem do formulário, vem
   depois dela (e no fim, se nenhuma vier); as que o formulário não conhece vão
   para o fim. As que saíram, saem. */
export function ordenarComo(antes, depois, ordem = CAMPOS_ARTIGO) {
  if (!eObjecto(depois)) return depois;
  const a = eObjecto(antes) ? antes : {};
  const chaves = Object.keys(a).filter((k) => tem(depois, k));
  const novas = Object.keys(depois).filter((k) => !chaves.includes(k));
  for (const k of novas.filter((x) => ordem.includes(x))) {
    const i = ordem.indexOf(k);
    const j = chaves.findIndex((x) => ordem.includes(x) && ordem.indexOf(x) > i);
    if (j < 0) chaves.push(k); else chaves.splice(j, 0, k);
  }
  chaves.push(...novas.filter((x) => !ordem.includes(x)));
  const out = {};
  for (const k of chaves) out[k] = depois[k];
  return out;
}

/* A fotografia de cada página de texto (content/paginas/*.md): a linha «foto: <nome>»
   do cabeçalho, antes do «---». `paginas`: { <nome>: texto }. → [nome] */
export function fotosDasPaginas(paginas = {}) {
  const out = [];
  for (const t of Object.values(eObjecto(paginas) ? paginas : {})) {
    if (typeof t !== 'string') continue;
    const cabeca = t.split(/\n---\n/)[0];
    const m = /^foto:\s*(\S+)\s*$/m.exec(cabeca);
    if (m) out.push(m[1]);
  }
  return out;
}

/* AS FOTOGRAFIAS EM USO, em todo o conteúdo: as dos artigos, das categorias, dos serviços,
   da página inicial e das páginas de texto (dados.paginas). Uma fotografia só sai da
   biblioteca se não estiver aqui. → Set */
export function fotosEmUso(dados = {}, extra = []) {
  const d = eObjecto(dados) ? dados : {};
  const usadas = new Set();
  /* Um nome com espaços à volta (escrito à mão) não aparece no site, mas conta como usado: na
     dúvida, uma fotografia nunca sai da biblioteca. */
  const juntar = (f) => { if (typeof f === 'string') { usadas.add(f); usadas.add(f.trim()); } };
  [...extra, ...fotosDasPaginas(d.paginas)].forEach(juntar);
  if (eObjecto(d.artigos)) for (const v of Object.values(d.artigos)) { const a = lerJson(v).obj; if (eObjecto(a) && Array.isArray(a.fotos)) a.fotos.forEach(juntar); }
  const cs = lerJson(d.categorias).obj;
  if (Array.isArray(cs)) for (const c of cs) if (eObjecto(c)) juntar(c.foto);
  const ss = lerJson(d.servicos).obj;
  if (Array.isArray(ss)) for (const s of ss) if (eObjecto(s)) juntar(s.foto);
  fotosDoInicio(lerJson(d.inicio).obj).forEach(juntar);
  return usadas;
}
