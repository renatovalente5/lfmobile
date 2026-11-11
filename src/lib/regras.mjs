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
 *   fotos:      texto | objecto | null,               content/fotos.json
 *   aparelhos:  texto | objecto | null,               content/aparelhos.json (as marcas, as famílias e os modelos)
 *   reparacoes: texto | objecto | null,               content/reparacoes.json (os tipos e os preços por modelo)
 *   retoma:     texto | objecto | null,               content/retoma.json (os valores e as perguntas)
 *   campanhas:  texto | objecto | null,               content/campanhas.json
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
  fotos: 'content/fotos.json',
  aparelhos: 'content/aparelhos.json',
  reparacoes: 'content/reparacoes.json',
  retoma: 'content/retoma.json',
  campanhas: 'content/campanhas.json',
});
export const PASTAS = Object.freeze({ artigos: 'content/produtos', fotos: 'media/fotos', videos: 'media/video' });
export const ficheiroDoArtigo = (nome) => `${PASTAS.artigos}/${nome}.json`;
export const ficheiroDaFoto = (nome) => `${PASTAS.fotos}/${nome}.jpg`;

/* As zonas de envio (as de content/site.json, entrega.zonas, menos o
   levantamento). A LF Mobile envia só para Portugal Continental (o dono, set 2026:
   «Apenas Portugal Continental»). Os portes são da encomenda, não de cada artigo: pela
   Nacex, por escalões de PESO (o dono, 9 nov 2026: «pack até 5 kg 5,90 €, até 30 kg
   14,90 €») — entrega.portes.<zona> é a lista dos escalões, [{ ate: kg, preco: € }]. */
export const ZONAS_ENVIO = Object.freeze(['continente']);
export const NOMES_ZONAS = Object.freeze({ continente: 'Portugal Continental' });

/* Os campos de um artigo, PELA ORDEM DO FORMULÁRIO. Uma chave nova entra por esta
   ordem (ordenarComo()); as que já estão no ficheiro ficam onde estão. */
export const CAMPOS_ARTIGO = Object.freeze([
  'nome', 'nomeCurto', 'marca', 'fotos', 'resumo', 'descricao',
  'preco', 'precoAnterior', 'promocaoDesde', 'promocaoAte',
  'estado', 'disponibilidade', 'caracteristicas', 'inclui', 'opcoes', 'pedeModelo', 'video',
  'referencia', 'fabricante', 'avisos', 'peso',
  'categoria', 'destaque', 'novidade', 'publicado', 'ordem',
]);
/* A informação legal de cada artigo, toda opcional e só mostrada na ficha quando está
   preenchida: a referência e o fabricante (Regulamento (UE) 2023/988, art. 19.º: nome, morada e
   email — incompleto, a ficha não o mostra) e os avisos de segurança (um por linha). E a data
   de início da promoção (DL 70/2007, art. 5.º: o período e o preço mais baixo dos 30 dias
   anteriores). */
export const CAMPOS_FABRICANTE = Object.freeze(['nome', 'morada', 'email']);
/* Sempre escritos pelo painel, com o valor explícito. Ausentes valem o valor por
   omissão (é o que o gerador faz). */
export const BOOLEANOS_ARTIGO = Object.freeze(['destaque', 'novidade', 'publicado', 'pedeModelo']);
export const POR_OMISSAO = Object.freeze({ publicado: true, novidade: false, destaque: false, pedeModelo: false, estado: 'novo', disponibilidade: 'disponivel', ordem: 500 });
/* «PEDE O MODELO» (as películas, 9 nov 2026: «A pessoa ao comprar a película tem de dizer qual é
   o modelo do telemóvel»): a ficha pede a marca e o modelo (de qualquer marca, com sugestões ou
   escrito à mão) e não junta ao carrinho sem ele; o modelo segue na linha da encomenda.
   O PESO (kg) decide o escalão dos portes; vazio, vale o da categoria (categorias.json, peso) e,
   sem esse, PESO_POR_OMISSAO. */
export const PESO_POR_OMISSAO = 0.3;

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
  pedeModelo: 'Pede o modelo do telemóvel', peso: 'Peso (kg)',
});

/* ------------------------------------------------------------------ */
/* Limites                                                             */
/* ------------------------------------------------------------------ */

/* Os números: [mínimo, máximo]. */
export const LIMITES = Object.freeze({ preco: [0.01, 100000], suplemento: [0, 10000], portes: [0, 10000], ordem: [0, 9999], opinioes: [0, 100000], peso: [0.01, 30], escalao: [0.1, 1000], desconto: [1, 90], reparacao: [0.01, 5000], retoma: [1, 5000], fator: [0, 1], ano: [2000, 2100] });
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
  inicioCurto: 60, inicioTitulo: 120, inicioTexto: 600,
  transportadora: 40, escaloes: 6,
  modeloNome: 60, modelos: 1200, capacidades: 8, outrasMarcas: 30, modelosDaMarca: 60,
  tipoNome: 40, tipoTitulo: 80, tipoResumo: 200, sintomas: 8, sintoma: 120, niveis: 3, nivelNome: 40, nivelTexto: 160,
  pergunta: 120, perguntaAjuda: 240, respostas: 6, resposta: 60, respostaAjuda: 80, perguntas: 12, opcoesRetoma: 6, opcaoRetoma: 80,
  campanhas: 20, campanhaNome: 60, campanhaFaixa: 140, campanhaTitulo: 120, campanhaTexto: 600,
});
/* O que o Worker do painel aceita gravar (recusa acima); aqui só se lembra, a
   partir de 80 %. */
export const TECTOS = Object.freeze({ artigoBytes: 64 * 1024, siteBytes: 64 * 1024, aviso: 0.8 });

/* As palavras que a lei só deixa usar com prova (Diretiva (UE) 2024/825,
   aplicável desde 27 set 2026: alegações ambientais genéricas) e as
   certificações que a loja não nos mostrou. */
export const RE_ALEGACOES = /\b(ecol[óo]gic[oa]s?|sustent[áa]ve(l|is)|sustentabilidade|amig[oa]s? do ambiente|eco-?friendly|biodegrad[áa]ve(l|is)|neutr[oa]s? em carbono|certificad[oa]s?)\b/i;

/* Os desenhos que um tipo de reparação pode ter (a grelha de ícones do painel; o site
   desenha-os em src/templates/icones.mjs). */
export const ICONES_REPARACAO = Object.freeze(['ecra', 'bateria', 'traseira', 'camara', 'camara-frontal', 'lente', 'conector', 'botoes', 'som', 'rosto', 'agua', 'software', 'diagnostico', 'pelicula', 'temperatura', 'ventoinha', 'hdmi', 'disco', 'fonte', 'comando', 'placa']);
/* Os tipos de aparelho (o desenho de cada modelo nas reparações e na retoma). */
export const DESENHOS = Object.freeze(['iphone-botao', 'iphone-entalhe', 'iphone-ilha', 'iphone-duo', 'galaxy', 'galaxy-flip', 'galaxy-fold', 'tablet', 'relogio', 'consola']);
export const TIPOS_FAMILIA = Object.freeze({ telemovel: 'Telemóvel', tablet: 'Tablet', relogio: 'Relógio', consola: 'Consola' });

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
   (o da promoção, quando há uma) e «precoAnterior» o normal. A promoção só vale
   entre «promocaoDesde» e «promocaoAte» (os dois incluídos): antes de começar e
   depois de acabar, vale o preço normal (uma promoção agendada para daqui a duas
   semanas já se cobrava hoje: revisão de 11 nov 2026). Um preço anterior que não é
   maior do que o de venda não conta (esquecido depois de uma promoção, mandava no
   preço). Sem preço (ainda por dizer), atual é null. A MESMA regra está no carrinho
   do site (src/scripts/carrinho.js, precoDe) e no Worker das encomendas
   (worker/encomendas/contas.js): o site, o carrinho e a Stripe nunca discordam. */
export function precoDe(p, hoje) {
  if (typeof p.preco !== 'number') return { atual: null, anterior: null, ate: '' };
  const normal = typeof p.precoAnterior === 'number' && p.precoAnterior > p.preco ? p.precoAnterior : null;
  if (normal === null) return { atual: p.preco, anterior: null, ate: '' };
  const foraDoPrazo = (p.promocaoDesde && hoje < p.promocaoDesde) || (p.promocaoAte && hoje > p.promocaoAte);
  return foraDoPrazo ? { atual: normal, anterior: null, ate: '' } : { atual: p.preco, anterior: normal, ate: p.promocaoAte || '' };
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
    else if (emPromocao && typeof ctx.hoje === 'string' && desde > ctx.hoje && noSite(a)) lembra('promocao-agendada', 'promocaoDesde', `A promoção começa a ${desde.split('-').reverse().join('/')}: até lá, o site mostra e cobra o preço normal (${pa} €).`);
  } else if (emPromocao && !acabou && noSite(a)) {
    lembra('promocao-sem-inicio', 'promocaoDesde', 'Falta a data de início da promoção: a lei pede o período e o preço mais baixo dos 30 dias anteriores (DL 70/2007). Com a data, a ficha diz «Promoção de … a … · preço mais baixo nos 30 dias anteriores: …».');
  }
  if (emPromocao && vazio(ate) && noSite(a)) lembra('promocao-sem-fim', 'promocaoAte', 'Falta a data de fim da promoção: a lei pede o período da promoção (DL 70/2007). Escolha o último dia.');
  const o = a.ordem;
  if (!ausente(o) && o !== '' && (typeof o !== 'number' || !Number.isInteger(o) || o < LIMITES.ordem[0] || o > LIMITES.ordem[1])) {
    avisa('ordem', 'ordem', `A posição é um número inteiro de 0 a ${LIMITES.ordem[1]} (mais baixo aparece primeiro).`);
  }
  const kg = a.peso;
  if (!ausente(kg) && kg !== '' && (typeof kg !== 'number' || !Number.isFinite(kg) || kg < LIMITES.peso[0] || kg > LIMITES.peso[1])) {
    avisa('peso', 'peso', `O peso é em quilos, de ${String(LIMITES.peso[0]).replace('.', ',')} a ${LIMITES.peso[1]} (ex.: 0,4 para um telemóvel), ou fica vazio (vale o da categoria).`);
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
        lembra('fabricante:incompleto', `fabricante.${CAMPOS_FABRICANTE.find((k) => !temTexto(fab[k]))}`, 'O fabricante está incompleto: a lei pede o nome, a morada e o email (Regulamento (UE) 2023/988, art. 19.º). Até estar completo, a ficha não mostra o fabricante.');
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

export const SECCOES_SITE = Object.freeze({ contactos: 'Contactos', horario: 'Horário', aviso: 'Aviso do topo', entrega: 'Entrega e pagamento', pagamentos: 'Loja online', empresa: 'Dados legais', marca: 'A marca', extras: 'Garantia, Google e fidelidade' });
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
  /* Os portes de cada zona: os escalões de peso da transportadora, do mais leve ao mais pesado
     ([{ ate: 5, preco: 5.9 }, { ate: 30, preco: 14.9 }]: até 5 kg, 5,90 €; até 30 kg, 14,90 €).
     Uma encomenda mais pesada do que o último escalão combina os portes pelo WhatsApp. */
  const faltamPortes = [];
  for (const z of ZONAS_ENVIO) {
    const v = portes[z];
    if (ausente(v) || (Array.isArray(v) && !v.length)) { faltamPortes.push(z); continue; }
    if (!Array.isArray(v)) { avisa(`entrega.portes.${z}`, 'entrega', `entrega.portes.${z}`, `Portes para ${NOMES_ZONAS[z]}: escreva os escalões de peso (até quantos kg, e o preço).`); continue; }
    if (v.length > TAMANHOS.escaloes) avisa(`entrega.portes.${z}:quantos`, 'entrega', `entrega.portes.${z}`, `Há ${v.length} escalões de portes; o máximo é ${TAMANHOS.escaloes}.`);
    let antes = 0;
    v.forEach((e, i) => {
      const onde = `entrega.portes.${z}.${i}`;
      if (!eObjecto(e) || typeof e.ate !== 'number' || !Number.isFinite(e.ate) || e.ate < LIMITES.escalao[0] || e.ate > LIMITES.escalao[1]) { avisa(`${onde}.ate`, 'entrega', `${onde}.ate`, `Escalão ${i + 1} dos portes: o peso máximo é um número de quilos (ex.: 5).`); return; }
      if (typeof e.preco !== 'number' || !Number.isFinite(e.preco) || e.preco < LIMITES.portes[0] || e.preco > LIMITES.portes[1] || !duasCasas(e.preco)) avisa(`${onde}.preco`, 'entrega', `${onde}.preco`, `Escalão ${i + 1} dos portes: o preço é só o número, sem € (ex.: 5,90).`);
      if (e.ate <= antes) avisa(`${onde}:ordem`, 'entrega', `${onde}.ate`, 'Os escalões dos portes vão do mais leve para o mais pesado, sem repetir o peso.');
      antes = e.ate;
    });
  }
  textoSimples(en.transportadora, 'entrega.transportadora', 'entrega', 'entrega.transportadora', 'Transportadora', TAMANHOS.transportadora);
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

  // --- Google e fidelidade -------------------------------------------------------------------
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
    const kg = c.peso;
    if (!ausente(kg) && kg !== '' && (typeof kg !== 'number' || !Number.isFinite(kg) || kg < LIMITES.peso[0] || kg > LIMITES.peso[1])) avisa(`${c.slug}.peso`, `${i}.peso`, `O peso da categoria ${c.nome || c.slug} é em quilos (ex.: 0,4), ou fica vazio.`);
    /* A fotografia da categoria é opcional (o menu da LF Mobile é só texto); se estiver escrita, tem de existir. */
    if (!vazio(c.foto) && (!nomeDeFotoValido(c.foto) || (fotos && !fotos.has(c.foto)))) bloqueia(`${c.slug}.foto`, `${i}.foto`, `A fotografia da categoria ${c.nome || c.slug} não existe na biblioteca: escolha outra, ou nenhuma.`);
    /* Uma categoria de marca (Apple, Samsung) junta os artigos dessa marca de todas as categorias. */
    if (!ausente(c.marca) && (typeof c.marca !== 'string' || !temTexto(c.marca) || c.marca.length > TAMANHOS.marca)) avisa(`${c.slug}.marca`, `${i}.marca`, `A marca da categoria ${c.nome || c.slug} é um nome curto (ex.: Apple), ou fica vazia.`);
  });
  return out;
}

/* AS CATEGORIAS DE UM ARTIGO: a dele, e as de marca que lhe tocam (a categoria Apple junta os artigos
   da Apple de todas as categorias: um iPhone recondicionado aparece em Recondicionados e em Apple).
   A loja, as campanhas, o catálogo e os cupões (o Worker) usam esta lista. */
export function categoriasDoArtigo(a, categorias) {
  if (!eObjecto(a)) return [];
  const out = temTexto(a.categoria) ? [a.categoria] : [];
  const marca = temTexto(a.marca) ? a.marca.trim().toLowerCase() : '';
  if (marca && Array.isArray(categorias)) {
    for (const c of categorias) {
      if (eObjecto(c) && slugValido(c.slug) && temTexto(c.marca) && c.marca.trim().toLowerCase() === marca && !out.includes(c.slug)) out.push(c.slug);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* content/aparelhos.json — as marcas, as famílias e os modelos         */
/* ------------------------------------------------------------------ */

/* Os aparelhos que a loja repara e retoma (9 nov 2026: repara todas as marcas; a retoma é só de
   Apple e Samsung, as famílias de content/retoma.json):
   { marcas: [{ id, nome }], familias: [{ id, marca, nome, tipo }],
     modelos: [{ id, nome, familia, ano?, capacidades?: [GB], desenho? }],
     outrasMarcas?: [{ nome, modelos: [texto] }] }   (só sugestões na escolha do modelo das películas)
   O id de um modelo é o endereço da página dele (/reparacoes/<id>/) e a chave dos preços e dos
   valores da retoma: não muda depois de criado. Um modelo com problemas fica de fora (avisa). */
export function problemasDosAparelhos(valor) {
  const ficheiro = FICHEIROS.aparelhos;
  const out = [];
  const ecra = 'Modelos';
  const bloqueia = (chave, campo, mensagem) => out.push({ classe: 'bloqueia', chave: `aparelhos:${chave}`, ficheiro, ecra, campo, mensagem });
  const avisa = (chave, campo, mensagem) => out.push({ classe: 'avisa', chave: `aparelhos:${chave}`, ficheiro, ecra, campo, mensagem });
  const l = lerJson(valor);
  const d = l.obj;
  if (l.ilegivel || !eObjecto(d) || !Array.isArray(d.marcas) || !Array.isArray(d.familias) || !Array.isArray(d.modelos)) {
    bloqueia('forma', undefined, 'A lista dos modelos não se consegue ler: sem ela as reparações e a retoma não se geram. Só o Renato a pode corrigir.');
    return out;
  }
  const marcas = new Set(d.marcas.filter((m) => eObjecto(m) && slugValido(m.id) && temTexto(m.nome)).map((m) => m.id));
  if (!marcas.size) bloqueia('marcas', 'marcas', 'Não há nenhuma marca na lista dos modelos. Só o Renato a pode repor.');
  const familias = new Set();
  d.familias.forEach((f, i) => {
    if (!eObjecto(f) || !slugValido(f.id) || !temTexto(f.nome) || !marcas.has(f.marca) || !tem(TIPOS_FAMILIA, f.tipo)) { bloqueia(`familias.${i}`, `familias.${i}`, `A família ${i + 1} dos modelos não tem a forma certa. Só o Renato a pode corrigir.`); return; }
    if (familias.has(f.id)) bloqueia(`familias.${f.id}:repetida`, `familias.${i}`, `A família «${f.id}» está repetida.`);
    familias.add(f.id);
  });
  if (d.modelos.length > TAMANHOS.modelos) avisa('modelos:quantos', 'modelos', `Há ${d.modelos.length} modelos; o máximo é ${TAMANHOS.modelos}.`);
  const ids = new Set();
  d.modelos.forEach((m, i) => {
    const onde = `modelos.${i}`;
    if (!eObjecto(m) || !slugValido(m.id)) { avisa(`${onde}:forma`, onde, `O modelo ${i + 1} não tem um endereço válido: fica fora do site.`); return; }
    const rotulo = temTexto(m.nome) ? m.nome.trim() : m.id;
    if (ids.has(m.id)) { avisa(`${m.id}:repetido`, onde, `O modelo «${rotulo}» está repetido: só o primeiro aparece.`); return; }
    ids.add(m.id);
    if (!temTexto(m.nome) || m.nome.length > TAMANHOS.modeloNome || RE_CONTROLO_LINHA.test(m.nome) || RE_PARTE_A_PAGINA.test(m.nome)) avisa(`${m.id}.nome`, `${onde}.nome`, `O modelo «${m.id}» precisa de um nome numa linha, até ${TAMANHOS.modeloNome} caracteres: fica fora do site até o ter.`);
    if (!familias.has(m.familia)) avisa(`${m.id}.familia`, `${onde}.familia`, `O modelo «${rotulo}» não é de nenhuma família da lista: fica fora do site.`);
    if (!ausente(m.ano) && (!Number.isInteger(m.ano) || m.ano < LIMITES.ano[0] || m.ano > LIMITES.ano[1])) avisa(`${m.id}.ano`, `${onde}.ano`, `O ano do modelo «${rotulo}» é um número de quatro algarismos (ex.: 2024).`);
    if (!ausente(m.capacidades) && (!Array.isArray(m.capacidades) || m.capacidades.length > TAMANHOS.capacidades || !m.capacidades.every((c) => Number.isInteger(c) && c > 0 && c <= 4096))) avisa(`${m.id}.capacidades`, `${onde}.capacidades`, `As capacidades do modelo «${rotulo}» são números de GB (ex.: 128, 256; 1 TB é 1024).`);
    if (!ausente(m.desenho) && !DESENHOS.includes(m.desenho)) avisa(`${m.id}.desenho`, `${onde}.desenho`, `O desenho do modelo «${rotulo}» não é nenhum dos do site.`);
  });
  const om = d.outrasMarcas;
  if (!ausente(om)) {
    if (!Array.isArray(om)) avisa('outrasMarcas', 'outrasMarcas', 'As outras marcas não estão gravadas como uma lista.');
    else {
      if (om.length > TAMANHOS.outrasMarcas) avisa('outrasMarcas:quantas', 'outrasMarcas', `Há ${om.length} outras marcas; o máximo é ${TAMANHOS.outrasMarcas}.`);
      om.forEach((x, i) => {
        if (!eObjecto(x) || !temTexto(x.nome) || x.nome.length > TAMANHOS.modeloNome || !Array.isArray(x.modelos) || x.modelos.length > TAMANHOS.modelosDaMarca || !x.modelos.every((t) => temTexto(t) && t.length <= TAMANHOS.modeloNome && !RE_CONTROLO_LINHA.test(t) && !RE_PARTE_A_PAGINA.test(t))) {
          avisa(`outrasMarcas.${i}`, `outrasMarcas.${i}`, `A marca ${i + 1} das sugestões das películas não está como devia: fica de fora.`);
        }
      });
    }
  }
  return out;
}

/* Os modelos que o site usa: só os que passam nas regras, com a família e a marca ao lado.
   → { marcas, familias, modelos, porId: Map, outrasMarcas } */
export function aparelhosDe(valor) {
  const d = lerJson(valor).obj;
  const vazioA = { marcas: [], familias: [], modelos: [], porId: new Map(), outrasMarcas: [] };
  if (!eObjecto(d) || !Array.isArray(d.marcas) || !Array.isArray(d.familias) || !Array.isArray(d.modelos)) return vazioA;
  const marcas = d.marcas.filter((m) => eObjecto(m) && slugValido(m.id) && temTexto(m.nome)).map((m) => ({ id: m.id, nome: m.nome.trim() }));
  const idsMarcas = new Set(marcas.map((m) => m.id));
  const familias = [];
  for (const f of d.familias) {
    if (eObjecto(f) && slugValido(f.id) && temTexto(f.nome) && idsMarcas.has(f.marca) && tem(TIPOS_FAMILIA, f.tipo) && !familias.some((x) => x.id === f.id)) familias.push({ id: f.id, marca: f.marca, nome: f.nome.trim(), tipo: f.tipo });
  }
  const porFamilia = new Map(familias.map((f) => [f.id, f]));
  const porId = new Map();
  const modelos = [];
  for (const m of d.modelos) {
    if (!eObjecto(m) || !slugValido(m.id) || porId.has(m.id) || !porFamilia.has(m.familia)) continue;
    if (!temTexto(m.nome) || m.nome.length > TAMANHOS.modeloNome || RE_CONTROLO_LINHA.test(m.nome) || RE_PARTE_A_PAGINA.test(m.nome)) continue;
    const f = porFamilia.get(m.familia);
    const x = {
      id: m.id, nome: m.nome.trim(), familia: f.id, marca: f.marca, tipo: f.tipo,
      ano: Number.isInteger(m.ano) ? m.ano : null,
      capacidades: Array.isArray(m.capacidades) && m.capacidades.every((c) => Number.isInteger(c) && c > 0 && c <= 4096) ? [...m.capacidades] : [],
      desenho: DESENHOS.includes(m.desenho) ? m.desenho : (['tablet', 'relogio', 'consola'].includes(f.tipo) ? f.tipo : 'galaxy'),
    };
    porId.set(x.id, x);
    modelos.push(x);
  }
  const outrasMarcas = (Array.isArray(d.outrasMarcas) ? d.outrasMarcas : [])
    .filter((x) => eObjecto(x) && temTexto(x.nome) && x.nome.length <= TAMANHOS.modeloNome && Array.isArray(x.modelos))
    .map((x) => ({ nome: x.nome.trim(), modelos: x.modelos.filter((t) => temTexto(t) && t.length <= TAMANHOS.modeloNome && !RE_CONTROLO_LINHA.test(t) && !RE_PARTE_A_PAGINA.test(t)).map((t) => t.trim()) }));
  return { marcas, familias, modelos, porId, outrasMarcas };
}
/* A capacidade como se diz: 1024 GB é «1 TB». */
export const capacidadeTexto = (gb) => (gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb} GB`);

/* ------------------------------------------------------------------ */
/* content/reparacoes.json — os tipos de reparação e os preços          */
/* ------------------------------------------------------------------ */

/* { confirmado: bool,
     tipos: [{ id, nome, titulo, icone, resumo, sintomas: [texto], familias: [id], excluir?: [modelo],
               niveis?: [{ id, nome, texto }], foto?, orcamento?: bool, gratis?: bool }],
     precos: { <modelo>: { <tipo>: preço | { <nível>: preço } } } }
   O preço de um tipo com níveis (o ecrã: compatível e original) é por nível; sem níveis, um número.
   Sem preço, a página diz «Orçamento grátis». «orcamento»: o preço só se sabe depois de ver (os
   líquidos); «gratis»: o diagnóstico. CONFIRMADO: os preços que vieram do mercado (referências, 9
   nov 2026) só aparecem na pré-visualização, marcados «por confirmar»; no site a sério só depois
   de o dono os confirmar no painel. */
export function problemasDasReparacoes(valor, { aparelhos = null, fotos = null, producao = false } = {}) {
  const ficheiro = FICHEIROS.reparacoes;
  const out = [];
  const ecra = 'Reparações';
  const bloqueia = (chave, campo, mensagem) => out.push({ classe: 'bloqueia', chave: `reparacoes:${chave}`, ficheiro, ecra, campo, mensagem });
  const avisa = (chave, campo, mensagem, extra = {}) => out.push({ classe: 'avisa', chave: `reparacoes:${chave}`, ficheiro, ecra, campo, mensagem, ...extra });
  const l = lerJson(valor);
  const d = l.obj;
  if (l.ilegivel || !eObjecto(d) || !Array.isArray(d.tipos)) { bloqueia('forma', undefined, 'As reparações não se conseguem ler: sem elas a página das reparações não se gera. Só o Renato as pode corrigir.'); return out; }
  if (!ausente(d.confirmado) && typeof d.confirmado !== 'boolean') avisa('confirmado', 'confirmado', '«Confirmo os preços» tem de ser sim ou não.');
  const familias = aparelhos ? new Set(aparelhos.familias.map((f) => f.id)) : null;
  const tipos = new Map();
  d.tipos.forEach((t, i) => {
    const onde = `tipos.${i}`;
    if (!eObjecto(t) || !slugValido(t.id)) { bloqueia(`${onde}:forma`, onde, `A reparação ${i + 1} não tem a forma certa. Só o Renato a pode corrigir.`); return; }
    if (tipos.has(t.id)) { bloqueia(`${t.id}:repetida`, onde, `A reparação «${t.id}» está repetida.`); return; }
    tipos.set(t.id, t);
    const rotulo = temTexto(t.nome) ? t.nome.trim() : t.id;
    for (const [k, max, nome, obrigatorio, linha] of [['nome', TAMANHOS.tipoNome, 'Nome', true, true], ['titulo', TAMANHOS.tipoTitulo, 'Título', false, true], ['resumo', TAMANHOS.tipoResumo, 'Frase curta', true, false]]) {
      const v = t[k];
      if (vazio(v)) { if (obrigatorio) bloqueia(`${t.id}.${k}:vazio`, `${onde}.${k}`, `«${nome}» da reparação ${rotulo} está vazio.`); continue; }
      if (typeof v !== 'string') { bloqueia(`${t.id}.${k}:tipo`, `${onde}.${k}`, `«${nome}» da reparação ${rotulo} tem de ser texto.`); continue; }
      if (v.length > max) avisa(`${t.id}.${k}:tamanho`, `${onde}.${k}`, `«${nome}» da reparação ${rotulo} tem mais de ${max} caracteres.`);
      if ((linha ? RE_CONTROLO_LINHA : RE_CONTROLO_TEXTO).test(v) || RE_PARTE_A_PAGINA.test(v)) bloqueia(`${t.id}.${k}:controlo`, `${onde}.${k}`, `«${nome}» da reparação ${rotulo} tem caracteres que não podem ir para o site.`);
      const m = v.match(RE_ALEGACOES);
      if (m) bloqueia(`${t.id}.${k}:alegacao`, `${onde}.${k}`, `«${nome}» da reparação ${rotulo}: «${m[0]}» é uma palavra que a lei só deixa usar com prova. Tire-a.`);
    }
    if (!vazio(t.icone) && !ICONES_REPARACAO.includes(t.icone)) avisa(`${t.id}.icone`, `${onde}.icone`, `O desenho da reparação ${rotulo} não é nenhum dos do site.`);
    if (!Array.isArray(t.familias) || !t.familias.length) bloqueia(`${t.id}.familias`, `${onde}.familias`, `A reparação ${rotulo} não diz em que aparelhos se faz.`);
    else if (familias) for (const f of t.familias) if (!familias.has(f)) avisa(`${t.id}.familias.${f}`, `${onde}.familias`, `A reparação ${rotulo} fala da família «${f}», que não existe na lista dos modelos.`);
    if (!ausente(t.sintomas) && (!Array.isArray(t.sintomas) || t.sintomas.length > TAMANHOS.sintomas || !t.sintomas.every((x) => temTexto(x) && x.length <= TAMANHOS.sintoma && !RE_CONTROLO_LINHA.test(x) && !RE_PARTE_A_PAGINA.test(x)))) avisa(`${t.id}.sintomas`, `${onde}.sintomas`, `Os sintomas da reparação ${rotulo} são até ${TAMANHOS.sintomas} linhas curtas.`);
    if (!ausente(t.niveis)) {
      if (!Array.isArray(t.niveis) || t.niveis.length > TAMANHOS.niveis) avisa(`${t.id}.niveis`, `${onde}.niveis`, `A reparação ${rotulo} tem até ${TAMANHOS.niveis} níveis (ex.: compatível e original).`);
      else t.niveis.forEach((n, j) => {
        if (!eObjecto(n) || !slugValido(n.id) || !temTexto(n.nome) || n.nome.length > TAMANHOS.nivelNome || (!ausente(n.texto) && (typeof n.texto !== 'string' || n.texto.length > TAMANHOS.nivelTexto || RE_PARTE_A_PAGINA.test(n.texto)))) avisa(`${t.id}.niveis.${j}`, `${onde}.niveis.${j}`, `O nível ${j + 1} da reparação ${rotulo} não está como devia.`);
        else { const m = `${n.nome} ${n.texto || ''}`.match(RE_ALEGACOES); if (m) bloqueia(`${t.id}.niveis.${j}:alegacao`, `${onde}.niveis.${j}`, `O nível «${n.nome}» da reparação ${rotulo}: «${m[0]}» é uma palavra que a lei só deixa usar com prova. Tire-a.`); }
      });
    }
    if (!vazio(t.foto) && (!nomeDeFotoValido(t.foto) || (fotos && !fotos.has(t.foto)))) avisa(`${t.id}.foto`, `${onde}.foto`, `A fotografia da reparação ${rotulo} já não está na biblioteca: não aparece.`);
  });
  const precos = d.precos;
  if (!ausente(precos) && !eObjecto(precos)) bloqueia('precos:forma', 'precos', 'Os preços das reparações não estão gravados como deve ser. Só o Renato os pode corrigir.');
  else if (eObjecto(precos)) {
    const precoBom = (x) => typeof x === 'number' && Number.isFinite(x) && x >= LIMITES.reparacao[0] && x <= LIMITES.reparacao[1] && duasCasas(x);
    for (const [mid, porTipo] of Object.entries(precos)) {
      const modelo = aparelhos ? aparelhos.porId.get(mid) : null;
      if (aparelhos && !modelo) { avisa(`precos.${mid}:modelo`, `precos.${mid}`, `Há preços para o modelo «${mid}», que não está na lista dos modelos: não aparecem.`); continue; }
      if (!eObjecto(porTipo)) { avisa(`precos.${mid}:forma`, `precos.${mid}`, `Os preços do modelo ${modelo ? modelo.nome : mid} não estão como deviam: não aparecem.`); continue; }
      for (const [tid, v] of Object.entries(porTipo)) {
        const t = tipos.get(tid);
        const nomeM = modelo ? modelo.nome : mid;
        if (!t) { avisa(`precos.${mid}.${tid}:tipo`, `precos.${mid}.${tid}`, `${nomeM}: há um preço para a reparação «${tid}», que não existe.`); continue; }
        if (v === null || v === '') continue;
        if (Array.isArray(t.niveis) && t.niveis.length) {
          if (!eObjecto(v)) { avisa(`precos.${mid}.${tid}:forma`, `precos.${mid}.${tid}`, `${nomeM} › ${t.nome}: o preço é por nível (${t.niveis.map((n) => n.nome).join(', ')}).`); continue; }
          for (const [nid, x] of Object.entries(v)) {
            if (!t.niveis.some((n) => n.id === nid)) avisa(`precos.${mid}.${tid}.${nid}:nivel`, `precos.${mid}.${tid}.${nid}`, `${nomeM} › ${t.nome}: o nível «${nid}» não existe.`);
            else if (x !== null && x !== '' && !precoBom(x)) avisa(`precos.${mid}.${tid}.${nid}`, `precos.${mid}.${tid}.${nid}`, `${nomeM} › ${t.nome}: o preço é só o número, sem € (ex.: 89,90).`);
          }
        } else if (!precoBom(v)) avisa(`precos.${mid}.${tid}`, `precos.${mid}.${tid}`, `${nomeM} › ${t.nome}: o preço é só o número, sem € (ex.: 49,90).`);
        if (modelo && !(Array.isArray(t.familias) && t.familias.includes(modelo.familia))) avisa(`precos.${mid}.${tid}:familia`, `precos.${mid}.${tid}`, `${nomeM} › ${t.nome}: esta reparação não se faz neste aparelho, e o preço não aparece.`);
      }
    }
  }
  const temPrecos = eObjecto(precos) && Object.values(precos).some((x) => eObjecto(x) && Object.keys(x).length);
  if (temPrecos && d.confirmado !== true) {
    avisa(producao ? 'confirmado:producao' : 'confirmado:previa', 'confirmado', producao
      ? 'Os preços das reparações ainda não estão confirmados: o site mostra «Orçamento grátis» em vez deles até os confirmar.'
      : 'Os preços das reparações ainda não estão confirmados: na pré-visualização aparecem marcados «por confirmar», e no site a sério só depois de os confirmar.', { lembrete: true });
  }
  return out;
}

/* Os tipos de reparação já limpos: os que o site mostra, pela ordem do ficheiro. */
export function tiposDeReparacao(valor) {
  const d = lerJson(valor).obj;
  if (!eObjecto(d) || !Array.isArray(d.tipos)) return [];
  const vistos = new Set();
  const out = [];
  for (const t of d.tipos) {
    if (!eObjecto(t) || !slugValido(t.id) || vistos.has(t.id) || !temTexto(t.nome) || !temTexto(t.resumo) || !Array.isArray(t.familias)) continue;
    vistos.add(t.id);
    out.push({
      id: t.id, nome: t.nome.trim(), titulo: temTexto(t.titulo) ? t.titulo.trim() : t.nome.trim(), resumo: t.resumo.trim(),
      icone: ICONES_REPARACAO.includes(t.icone) ? t.icone : 'diagnostico',
      sintomas: linhasDe(t.sintomas).slice(0, TAMANHOS.sintomas),
      familias: t.familias.filter((f) => typeof f === 'string'),
      excluir: Array.isArray(t.excluir) ? t.excluir.filter((x) => typeof x === 'string') : [],
      niveis: Array.isArray(t.niveis) ? t.niveis.filter((n) => eObjecto(n) && slugValido(n.id) && temTexto(n.nome)).slice(0, TAMANHOS.niveis).map((n) => ({ id: n.id, nome: n.nome.trim(), texto: temTexto(n.texto) ? n.texto.trim() : '' })) : [],
      foto: nomeDeFotoValido(t.foto) ? t.foto : '',
      orcamento: t.orcamento === true, gratis: t.gratis === true,
    });
  }
  return out;
}
/* As reparações de um modelo, com o preço de cada nível (null = orçamento). `mostrarPorConfirmar`:
   na pré-visualização os preços por confirmar aparecem (marcados); em produção não.
   → [{ ...tipo, niveis: [{ id, nome, texto, preco }], preco: o mais baixo | null, desde: bool }] */
export function reparacoesDoModelo(valor, modelo, { mostrarPorConfirmar = true } = {}) {
  const d = lerJson(valor).obj;
  const tipos = tiposDeReparacao(valor);
  const confirmado = eObjecto(d) && d.confirmado === true;
  const usar = confirmado || mostrarPorConfirmar;
  const doModelo = usar && eObjecto(d) && eObjecto(d.precos) && eObjecto(d.precos[modelo.id]) ? d.precos[modelo.id] : {};
  const precoBom = (x) => typeof x === 'number' && Number.isFinite(x) && x >= LIMITES.reparacao[0] && x <= LIMITES.reparacao[1] && duasCasas(x);
  return tipos.filter((t) => t.familias.includes(modelo.familia) && !t.excluir.includes(modelo.id)).map((t) => {
    const v = doModelo[t.id];
    let niveis;
    if (t.niveis.length) niveis = t.niveis.map((n) => ({ ...n, preco: eObjecto(v) && precoBom(v[n.id]) ? v[n.id] : null }));
    else niveis = [{ id: 'unico', nome: t.nome, texto: '', preco: precoBom(v) ? v : null }];
    const comPreco = niveis.filter((n) => n.preco !== null);
    const preco = comPreco.length ? Math.min(...comPreco.map((n) => n.preco)) : null;
    return { ...t, niveis, preco, desde: comPreco.length > 1, porConfirmar: !confirmado && comPreco.length > 0 };
  });
}

/* ------------------------------------------------------------------ */
/* content/retoma.json — o simulador da retoma                          */
/* ------------------------------------------------------------------ */

/* { confirmado: bool, familias: [id], minimo: €,
     valores: { <modelo>: { <capacidade GB>: valor máximo em € } },
     perguntas: [{ id, texto, ajuda?, respostas: [{ texto, ajuda?, fator?: 0–1, avaliar?: true }] }],
     receber: [texto], entregar: [texto] }
   O VALOR (a mesma conta no simulador, src/scripts/retoma.js): o máximo do modelo e da capacidade
   × o fator de cada resposta, arredondado aos 5 € para baixo. Uma resposta «avaliar» (não liga,
   molhou) e um valor abaixo do mínimo dão «avaliamos na loja». Sem valor para o modelo, também. */
export function problemasDaRetoma(valor, { aparelhos = null, producao = false } = {}) {
  const ficheiro = FICHEIROS.retoma;
  const out = [];
  const ecra = 'Retoma';
  const bloqueia = (chave, campo, mensagem) => out.push({ classe: 'bloqueia', chave: `retoma:${chave}`, ficheiro, ecra, campo, mensagem });
  const avisa = (chave, campo, mensagem, extra = {}) => out.push({ classe: 'avisa', chave: `retoma:${chave}`, ficheiro, ecra, campo, mensagem, ...extra });
  const l = lerJson(valor);
  const d = l.obj;
  if (l.ilegivel || !eObjecto(d) || !Array.isArray(d.perguntas) || !Array.isArray(d.familias)) { bloqueia('forma', undefined, 'A retoma não se consegue ler: sem ela a página da retoma não se gera. Só o Renato a pode corrigir.'); return out; }
  if (!ausente(d.confirmado) && typeof d.confirmado !== 'boolean') avisa('confirmado', 'confirmado', '«Confirmo os valores» tem de ser sim ou não.');
  if (!ausente(d.minimo) && (typeof d.minimo !== 'number' || !Number.isFinite(d.minimo) || d.minimo < 0 || d.minimo > LIMITES.retoma[1])) avisa('minimo', 'minimo', 'O valor mínimo da retoma é um número de euros (abaixo dele, «avaliamos na loja»).');
  if (aparelhos) for (const f of d.familias) if (!aparelhos.familias.some((x) => x.id === f)) avisa(`familias.${f}`, 'familias', `A retoma fala da família «${f}», que não existe na lista dos modelos.`);
  if (d.perguntas.length > TAMANHOS.perguntas) avisa('perguntas:quantas', 'perguntas', `Há ${d.perguntas.length} perguntas; o máximo é ${TAMANHOS.perguntas}.`);
  const ids = new Set();
  d.perguntas.forEach((q, i) => {
    const onde = `perguntas.${i}`;
    if (!eObjecto(q) || !slugValido(q.id) || ids.has(q.id) || !temTexto(q.texto) || !Array.isArray(q.respostas)) { bloqueia(`${onde}:forma`, onde, `A pergunta ${i + 1} da retoma não tem a forma certa. Só o Renato a pode corrigir.`); return; }
    ids.add(q.id);
    if (q.texto.length > TAMANHOS.pergunta || RE_PARTE_A_PAGINA.test(q.texto) || RE_CONTROLO_LINHA.test(q.texto)) avisa(`${q.id}.texto`, `${onde}.texto`, `A pergunta «${q.texto.slice(0, 40)}» é comprida de mais ou tem caracteres que não podem ir para o site.`);
    if (!ausente(q.ajuda) && (typeof q.ajuda !== 'string' || q.ajuda.length > TAMANHOS.perguntaAjuda || RE_PARTE_A_PAGINA.test(q.ajuda))) avisa(`${q.id}.ajuda`, `${onde}.ajuda`, `A ajuda da pergunta «${q.texto.slice(0, 40)}» é comprida de mais.`);
    if (q.respostas.length < 2 || q.respostas.length > TAMANHOS.respostas) bloqueia(`${q.id}.respostas`, `${onde}.respostas`, `A pergunta «${q.texto.slice(0, 40)}» tem de ter de 2 a ${TAMANHOS.respostas} respostas.`);
    q.respostas.forEach((r, j) => {
      const ondeR = `${onde}.respostas.${j}`;
      if (!eObjecto(r) || !temTexto(r.texto) || r.texto.length > TAMANHOS.resposta || RE_PARTE_A_PAGINA.test(r.texto)) { bloqueia(`${q.id}.${j}`, ondeR, `A resposta ${j + 1} da pergunta «${q.texto.slice(0, 40)}» não tem texto.`); return; }
      if (!ausente(r.ajuda) && (typeof r.ajuda !== 'string' || r.ajuda.length > TAMANHOS.respostaAjuda || RE_PARTE_A_PAGINA.test(r.ajuda))) avisa(`${q.id}.${j}.ajuda`, `${ondeR}.ajuda`, `A ajuda da resposta «${r.texto}» é comprida de mais.`);
      const fatorBom = typeof r.fator === 'number' && Number.isFinite(r.fator) && r.fator >= LIMITES.fator[0] && r.fator <= LIMITES.fator[1];
      if (r.avaliar !== true && !fatorBom) bloqueia(`${q.id}.${j}.fator`, `${ondeR}.fator`, `A resposta «${r.texto}» precisa da percentagem do valor que fica (de 0 a 100 %), ou de «avaliamos na loja».`);
    });
  });
  for (const [k, rotulo] of [['receber', 'Como recebe'], ['entregar', 'Como entrega']]) {
    const v = d[k];
    if (ausente(v)) continue;
    if (!Array.isArray(v) || v.length > TAMANHOS.opcoesRetoma || !v.every((t) => temTexto(t) && t.length <= TAMANHOS.opcaoRetoma && !RE_PARTE_A_PAGINA.test(t))) avisa(k, k, `«${rotulo}» é uma lista de até ${TAMANHOS.opcoesRetoma} frases curtas.`);
  }
  const valores = d.valores;
  if (!ausente(valores) && !eObjecto(valores)) bloqueia('valores:forma', 'valores', 'Os valores da retoma não estão gravados como deve ser. Só o Renato os pode corrigir.');
  else if (eObjecto(valores)) {
    for (const [mid, porCap] of Object.entries(valores)) {
      const modelo = aparelhos ? aparelhos.porId.get(mid) : null;
      if (aparelhos && !modelo) { avisa(`valores.${mid}:modelo`, `valores.${mid}`, `Há valores de retoma para o modelo «${mid}», que não está na lista dos modelos: não aparecem.`); continue; }
      if (!eObjecto(porCap)) { avisa(`valores.${mid}:forma`, `valores.${mid}`, `Os valores do modelo ${modelo ? modelo.nome : mid} não estão como deviam.`); continue; }
      for (const [cap, x] of Object.entries(porCap)) {
        const nomeM = modelo ? modelo.nome : mid;
        if (modelo && !modelo.capacidades.includes(Number(cap))) avisa(`valores.${mid}.${cap}:capacidade`, `valores.${mid}.${cap}`, `${nomeM}: não há a capacidade ${cap} GB na lista do modelo, e o valor não aparece.`);
        if (x !== null && x !== '' && (typeof x !== 'number' || !Number.isFinite(x) || x < LIMITES.retoma[0] || x > LIMITES.retoma[1])) avisa(`valores.${mid}.${cap}`, `valores.${mid}.${cap}`, `${nomeM} ${cap} GB: o valor é só o número de euros (ex.: 190).`);
      }
    }
  }
  const temValores = eObjecto(valores) && Object.values(valores).some((x) => eObjecto(x) && Object.keys(x).length);
  if (temValores && d.confirmado !== true) {
    avisa(producao ? 'confirmado:producao' : 'confirmado:previa', 'confirmado', producao
      ? 'Os valores da retoma ainda não estão confirmados: o simulador diz «avaliamos na loja» até os confirmar.'
      : 'Os valores da retoma ainda não estão confirmados: na pré-visualização aparecem marcados «por confirmar», e no site a sério só depois de os confirmar.', { lembrete: true });
  }
  return out;
}

/* A retoma como o site a usa: as perguntas e respostas limpas, e os valores (só os confirmados, ou
   todos na pré-visualização). → { familias, minimo, valores, perguntas, receber, entregar, porConfirmar } */
export function retomaDe(valor, { mostrarPorConfirmar = true } = {}) {
  const d = lerJson(valor).obj;
  if (!eObjecto(d) || !Array.isArray(d.perguntas)) return null;
  const confirmado = d.confirmado === true;
  const perguntas = d.perguntas
    .filter((q) => eObjecto(q) && slugValido(q.id) && temTexto(q.texto) && Array.isArray(q.respostas))
    .map((q) => ({
      id: q.id, texto: q.texto.trim(), ajuda: temTexto(q.ajuda) ? q.ajuda.trim() : '',
      respostas: q.respostas.filter((r) => eObjecto(r) && temTexto(r.texto)).map((r) => ({
        texto: r.texto.trim(), ajuda: temTexto(r.ajuda) ? r.ajuda.trim() : '',
        ...(r.avaliar === true ? { avaliar: true } : { fator: typeof r.fator === 'number' && r.fator >= 0 && r.fator <= 1 ? r.fator : 1 }),
      })),
    }))
    .filter((q) => q.respostas.length >= 2);
  const valores = {};
  if ((confirmado || mostrarPorConfirmar) && eObjecto(d.valores)) {
    for (const [mid, porCap] of Object.entries(d.valores)) {
      if (!eObjecto(porCap)) continue;
      const bons = Object.entries(porCap).filter(([, x]) => typeof x === 'number' && Number.isFinite(x) && x >= LIMITES.retoma[0] && x <= LIMITES.retoma[1]);
      if (bons.length) valores[mid] = Object.fromEntries(bons);
    }
  }
  const lista = (v) => (Array.isArray(v) ? v.filter((t) => temTexto(t)).map((t) => t.trim()) : []);
  return {
    familias: Array.isArray(d.familias) ? d.familias.filter((f) => typeof f === 'string') : [],
    minimo: typeof d.minimo === 'number' && d.minimo >= 0 ? d.minimo : 0,
    valores, perguntas, receber: lista(d.receber), entregar: lista(d.entregar),
    porConfirmar: !confirmado && Object.keys(valores).length > 0,
  };
}
/* O valor de uma simulação (o mesmo cálculo do simulador no browser).
   respostas: { <pergunta>: índice da resposta }. → { maximo, valor, avaliar, descontos } */
export function valorDaRetoma(retoma, modeloId, capacidade, respostas = {}) {
  const maximo = retoma && retoma.valores[modeloId] ? retoma.valores[modeloId][String(capacidade)] : undefined;
  if (typeof maximo !== 'number') return { maximo: null, valor: null, avaliar: true, descontos: [] };
  let fator = 1;
  let avaliar = false;
  const descontos = [];
  for (const q of retoma.perguntas) {
    const r = q.respostas[respostas[q.id]];
    if (!r) continue;
    if (r.avaliar) avaliar = true;
    else if (r.fator < 1) { fator *= r.fator; descontos.push({ pergunta: q.texto, resposta: r.texto, fator: r.fator }); }
  }
  // ao cêntimo antes de descer aos 5 €: em vírgula flutuante, 400 × 0,95 × 0,75 dá 284,999…, e 280 € em vez de 285 €
  let valor = avaliar ? null : Math.floor(Math.round(maximo * fator * 100) / 500) * 5;
  if (valor !== null && valor < retoma.minimo) { valor = null; avaliar = true; }
  return { maximo, valor, avaliar, descontos };
}

/* ------------------------------------------------------------------ */
/* content/campanhas.json — as campanhas (Black Friday, Natal…)         */
/* ------------------------------------------------------------------ */

/* [{ slug, nome, publicada: bool, desde, ate, faixa, titulo, texto, desconto: %, categorias: [slug],
      marcas: [texto], artigos: [slug] }]
   Uma campanha publicada e dentro das datas: a faixa no topo do site, o cartão na página
   inicial, a página /campanhas/<slug>/ e o desconto nos artigos que apanha (pela categoria, pela
   marca ou escolhidos um a um), com o preço normal riscado e o período (DL 70/2007, art. 5.º).
   O preço riscado TEM de ser o mais baixo dos 30 dias anteriores ao início: o painel lembra-o. Um
   artigo com uma promoção própria a correr fica com a dele (os descontos não se somam). A publicação
   de todas as noites liga e desliga as campanhas nas datas. */
export function problemasDasCampanhas(valor, { categorias = null, artigos = null, hoje = null } = {}) {
  const ficheiro = FICHEIROS.campanhas;
  const out = [];
  const ecra = 'Campanhas';
  const bloqueia = (chave, campo, mensagem) => out.push({ classe: 'bloqueia', chave: `campanhas:${chave}`, ficheiro, ecra, campo, mensagem });
  const avisa = (chave, campo, mensagem, extra = {}) => out.push({ classe: 'avisa', chave: `campanhas:${chave}`, ficheiro, ecra, campo, mensagem, ...extra });
  const l = lerJson(valor);
  if (l.ilegivel || !Array.isArray(l.obj)) { bloqueia('forma', undefined, 'As campanhas não se conseguem ler. Só o Renato as pode corrigir.'); return out; }
  if (l.obj.length > TAMANHOS.campanhas) avisa('quantas', undefined, `Há ${l.obj.length} campanhas; o máximo é ${TAMANHOS.campanhas}. Apague as antigas.`);
  const slugs = new Set();
  l.obj.forEach((c, i) => {
    const onde = `${i}`;
    if (!eObjecto(c) || !slugValido(c.slug)) { avisa(`${i}:forma`, onde, `A campanha ${i + 1} não tem um endereço válido: não aparece no site.`); return; }
    const rotulo = temTexto(c.nome) ? c.nome.trim() : c.slug;
    if (slugs.has(c.slug)) { avisa(`${c.slug}:repetida`, onde, `Há duas campanhas com o endereço «${c.slug}»: só a primeira aparece.`); return; }
    slugs.add(c.slug);
    for (const [k, max, nome, obrigatorio, linha] of [['nome', TAMANHOS.campanhaNome, 'Nome', true, true], ['faixa', TAMANHOS.campanhaFaixa, 'Frase da faixa do topo', true, true], ['titulo', TAMANHOS.campanhaTitulo, 'Título da página', true, true], ['texto', TAMANHOS.campanhaTexto, 'Texto da página', false, false]]) {
      const v = c[k];
      if (vazio(v)) { if (obrigatorio) avisa(`${c.slug}.${k}:vazio`, `${i}.${k}`, `Falta «${nome}» na campanha ${rotulo}: não aparece no site até o escrever.`); continue; }
      if (typeof v !== 'string') { avisa(`${c.slug}.${k}:tipo`, `${i}.${k}`, `«${nome}» da campanha ${rotulo} tem de ser texto.`); continue; }
      if (v.length > max) avisa(`${c.slug}.${k}:tamanho`, `${i}.${k}`, `«${nome}» da campanha ${rotulo} tem mais de ${max} caracteres.`);
      if ((linha ? RE_CONTROLO_LINHA : RE_CONTROLO_TEXTO).test(v) || RE_PARTE_A_PAGINA.test(v)) bloqueia(`${c.slug}.${k}:controlo`, `${i}.${k}`, `«${nome}» da campanha ${rotulo} tem caracteres que não podem ir para o site.`);
      const m = v.match(RE_ALEGACOES);
      if (m) bloqueia(`${c.slug}.${k}:alegacao`, `${i}.${k}`, `«${nome}» da campanha ${rotulo}: «${m[0]}» é uma palavra que a lei só deixa usar com prova. Tire-a.`);
    }
    if (!dataValida(c.desde) || !dataValida(c.ate)) avisa(`${c.slug}.datas`, `${i}.desde`, `A campanha ${rotulo} precisa das duas datas (início e fim): não aparece no site até as ter.`);
    else if (c.desde > c.ate) avisa(`${c.slug}.datas:ordem`, `${i}.ate`, `A campanha ${rotulo} acaba antes de começar: confira as datas.`);
    const d = c.desconto;
    if (!ausente(d) && d !== '' && d !== 0 && (!Number.isInteger(d) || d < LIMITES.desconto[0] || d > LIMITES.desconto[1])) avisa(`${c.slug}.desconto`, `${i}.desconto`, `O desconto da campanha ${rotulo} é uma percentagem inteira de ${LIMITES.desconto[0]} a ${LIMITES.desconto[1]} (ou nenhum, só a faixa).`);
    if (!ausente(c.publicada) && typeof c.publicada !== 'boolean') avisa(`${c.slug}.publicada`, `${i}.publicada`, `«Publicada» da campanha ${rotulo} tem de ser sim ou não.`);
    for (const [k, existentes, nome] of [['categorias', categorias, 'categoria'], ['artigos', artigos, 'artigo']]) {
      const v = c[k];
      if (ausente(v)) continue;
      if (!Array.isArray(v)) { avisa(`${c.slug}.${k}`, `${i}.${k}`, `A campanha ${rotulo}: «${k}» tem de ser uma lista.`); continue; }
      if (existentes) for (const x of v) if (!existentes.includes(x)) avisa(`${c.slug}.${k}.${x}`, `${i}.${k}`, `A campanha ${rotulo} fala de um${nome === 'categoria' ? 'a' : ''} ${nome} («${x}») que não existe.`);
    }
    if (!ausente(c.marcas) && (!Array.isArray(c.marcas) || !c.marcas.every((x) => temTexto(x) && x.length <= TAMANHOS.marca))) avisa(`${c.slug}.marcas`, `${i}.marcas`, `As marcas da campanha ${rotulo} são uma lista de nomes (ex.: Apple).`);
    if (c.publicada === true && Number.isInteger(c.desconto) && c.desconto > 0 && !(c.categorias || []).length && !(c.marcas || []).length && !(c.artigos || []).length) avisa(`${c.slug}:sem-alvo`, `${i}.categorias`, `A campanha ${rotulo} tem desconto mas não diz em quê: escolha as categorias, as marcas ou os artigos.`, { lembrete: true });
    if (c.publicada === true && typeof hoje === 'string' && dataValida(c.ate) && c.ate < hoje) avisa(`${c.slug}:acabou`, `${i}.ate`, `A campanha ${rotulo} acabou a ${c.ate.split('-').reverse().join('/')}: já não aparece. Pode apagá-la.`, { lembrete: true });
  });
  return out;
}

/* As campanhas que o site mostra HOJE (publicadas, completas e dentro das datas), limpas. */
export function campanhasActivas(valor, hoje) {
  const l = lerJson(valor);
  if (!Array.isArray(l.obj) || typeof hoje !== 'string') return [];
  const vistos = new Set();
  const out = [];
  for (const c of l.obj) {
    if (!eObjecto(c) || !slugValido(c.slug) || vistos.has(c.slug)) continue;
    vistos.add(c.slug);
    if (c.publicada !== true || !dataValida(c.desde) || !dataValida(c.ate) || c.desde > c.ate || hoje < c.desde || hoje > c.ate) continue;
    if (![c.nome, c.faixa, c.titulo].every((x) => temTexto(x) && !RE_PARTE_A_PAGINA.test(x))) continue;
    out.push({
      slug: c.slug, nome: c.nome.trim(), desde: c.desde, ate: c.ate, faixa: c.faixa.trim(), titulo: c.titulo.trim(),
      texto: temTexto(c.texto) ? c.texto.trim() : '',
      desconto: Number.isInteger(c.desconto) && c.desconto >= LIMITES.desconto[0] && c.desconto <= LIMITES.desconto[1] ? c.desconto : 0,
      categorias: Array.isArray(c.categorias) ? c.categorias.filter((x) => typeof x === 'string') : [],
      marcas: Array.isArray(c.marcas) ? c.marcas.filter((x) => temTexto(x)).map((x) => x.trim().toLowerCase()) : [],
      artigos: Array.isArray(c.artigos) ? c.artigos.filter((x) => typeof x === 'string') : [],
    });
  }
  return out;
}
/* A campanha que apanha um artigo (a primeira da lista), ou null. `categorias`: as do site, para as
   categorias de marca (categoriasDoArtigo); sem elas, só a categoria do artigo. */
export function campanhaDoArtigo(a, slug, activas, categorias = null) {
  if (!eObjecto(a)) return null;
  const marca = temTexto(a.marca) ? a.marca.trim().toLowerCase() : '';
  const cats = categoriasDoArtigo(a, categorias);
  return activas.find((c) => c.artigos.includes(slug) || c.categorias.some((k) => cats.includes(k)) || (marca && c.marcas.includes(marca))) || null;
}
/* O artigo como o site o mostra com a campanha: o preço com o desconto, o normal riscado e o
   período da campanha. Sem preço, sem desconto, ou com uma promoção própria a correr: igual. */
export function comCampanha(a, slug, activas, hoje, categorias = null) {
  const c = campanhaDoArtigo(a, slug, activas, categorias);
  if (!c) return a;
  const x = { ...a, campanha: c.slug };
  if (!c.desconto || typeof a.preco !== 'number') return x;
  const propria = precoDe(a, hoje);
  if (propria.anterior) return x;
  const base = propria.atual;
  return { ...x, preco: Math.round(base * (100 - c.desconto)) / 100, precoAnterior: base, promocaoDesde: c.desde, promocaoAte: c.ate };
}

/* ------------------------------------------------------------------ */
/* Os portes pelo peso                                                  */
/* ------------------------------------------------------------------ */

/* O peso de um artigo (kg): o dele, o da categoria, ou PESO_POR_OMISSAO. */
export function pesoDe(a, categorias = []) {
  const ok = (x) => typeof x === 'number' && Number.isFinite(x) && x >= LIMITES.peso[0] && x <= LIMITES.peso[1];
  if (eObjecto(a) && ok(a.peso)) return a.peso;
  const c = Array.isArray(categorias) && eObjecto(a) ? categorias.find((k) => eObjecto(k) && k.slug === a.categoria) : null;
  return c && ok(c.peso) ? c.peso : PESO_POR_OMISSAO;
}
/* Os escalões de uma zona, já limpos e por ordem: [{ ate, preco }]. */
export function escaloesDe(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((e) => eObjecto(e) && typeof e.ate === 'number' && Number.isFinite(e.ate) && e.ate > 0 && typeof e.preco === 'number' && Number.isFinite(e.preco) && e.preco >= 0)
    .map((e) => ({ ate: e.ate, preco: e.preco }))
    .sort((a, b) => a.ate - b.ate);
}
/* Os portes de uma encomenda com este peso: o preço do primeiro escalão que o aguenta, ou null
   (sem escalões, ou mais pesada do que o último: combina-se). A MESMA conta está no carrinho
   (carrinho.js) e no Worker (contas.js). */
export function portesDoPeso(kg, escaloes) {
  const e = escaloesDe(escaloes).find((x) => kg <= x.ate + 1e-9);
  return e ? e.preco : null;
}

/* ------------------------------------------------------------------ */
/* content/inicio.json                                                 */
/* ------------------------------------------------------------------ */

/* As secções da página inicial, pela ordem da página: a capa (com a escolha do modelo para
   reparar e o cartão da retoma), os destaques da loja, as películas e a loja (a fotografia da
   fachada). Poucas e curtas. A grelha dos problemas saiu para a página das reparações (o Renato, 10
   nov 2026: «para não ficar gigante»). */
export const SECCOES_INICIO = Object.freeze(['seo', 'capa', 'destaques', 'retoma', 'peliculas', 'loja']);

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
    ['capa.titulo', TAMANHOS.inicioTitulo, true], ['capa.texto', TAMANHOS.inicioTexto, false], ['capa.botao', TAMANHOS.inicioCurto, true],
    ['destaques.titulo', TAMANHOS.inicioTitulo, true], ['destaques.texto', TAMANHOS.inicioTexto, false], ['destaques.botao', TAMANHOS.inicioCurto, true],
    ['retoma.titulo', TAMANHOS.inicioTitulo, true], ['retoma.texto', TAMANHOS.inicioTexto, false], ['retoma.botao', TAMANHOS.inicioCurto, true],
    ['peliculas.titulo', TAMANHOS.inicioTitulo, true], ['peliculas.texto', TAMANHOS.inicioTexto, false], ['peliculas.botao', TAMANHOS.inicioCurto, true],
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
  const aparelhos = tem(d, 'aparelhos') ? aparelhosDe(d.aparelhos) : null;
  const nomesArtigos = eObjecto(d.artigos) ? Object.keys(d.artigos).map(slugDoFicheiro) : null;

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
  umFicheiro('inicio', 'Página inicial', (o) => problemasDoInicio(o, { fotos }));
  umFicheiro('aparelhos', 'Modelos', (o) => problemasDosAparelhos(o));
  umFicheiro('reparacoes', 'Reparações', (o) => problemasDasReparacoes(o, { aparelhos, fotos, producao: Boolean(opcoes.producao) }));
  umFicheiro('retoma', 'Retoma', (o) => problemasDaRetoma(o, { aparelhos, producao: Boolean(opcoes.producao) }));
  umFicheiro('campanhas', 'Campanhas', (o) => problemasDasCampanhas(o, { categorias, artigos: nomesArtigos, hoje: opcoes.hoje }));

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
 *   'categorias': as categorias são as mesmas, pela mesma ordem (o slug), com a mesma marca;
 *   'inicio':     não aparecem nem desaparecem secções;
 *   'aparelhos':  as marcas e as famílias são as mesmas; os modelos podem entrar (um id que já
 *                 existia não muda de família: os preços e os valores dependem dele);
 *   'reparacoes': os tipos são os mesmos, pela mesma ordem (o id), com os mesmos níveis;
 *   'retoma':     as perguntas são as mesmas (o id), cada uma com o mesmo número de respostas;
 *   'campanhas':  são do dono (entram, saem, mudam). */
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
      else if (!mesmoValor(eObjecto(c) ? c.marca ?? null : null, eObjecto(d[i]) ? d[i].marca ?? null : null)) out.push({ caminho: `${i}.marca`, motivo: 'mudou' });
    });
    return out;
  }
  if (qual === 'campanhas') return out;
  if (qual === 'aparelhos') {
    const a = eObjecto(antes) ? antes : {}; const d = eObjecto(depois) ? depois : {};
    for (const k of ['marcas', 'familias']) if (!mesmoValor(a[k], d[k])) out.push({ caminho: k, motivo: 'mudou' });
    const familiaAntes = new Map((Array.isArray(a.modelos) ? a.modelos : []).filter(eObjecto).map((m) => [m.id, m.familia]));
    (Array.isArray(d.modelos) ? d.modelos : []).forEach((m, i) => {
      if (eObjecto(m) && familiaAntes.has(m.id) && familiaAntes.get(m.id) !== m.familia) out.push({ caminho: `modelos.${i}.familia`, motivo: 'mudou' });
    });
    return out;
  }
  if (qual === 'reparacoes') {
    const ta = eObjecto(antes) && Array.isArray(antes.tipos) ? antes.tipos : []; const td = eObjecto(depois) && Array.isArray(depois.tipos) ? depois.tipos : [];
    if (ta.length !== td.length) return [{ caminho: 'tipos', motivo: 'quantos' }];
    ta.forEach((t, i) => {
      const u = td[i];
      if (!mesmoValor(eObjecto(t) ? t.id : null, eObjecto(u) ? u.id : null)) out.push({ caminho: `tipos.${i}.id`, motivo: 'mudou' });
      const ids = (x) => (eObjecto(x) && Array.isArray(x.niveis) ? x.niveis.map((n) => (eObjecto(n) ? n.id : null)) : []);
      if (!mesmoValor(ids(t), ids(u))) out.push({ caminho: `tipos.${i}.niveis`, motivo: 'mudou' });
    });
    return out;
  }
  if (qual === 'retoma') {
    const pa = eObjecto(antes) && Array.isArray(antes.perguntas) ? antes.perguntas : []; const pd = eObjecto(depois) && Array.isArray(depois.perguntas) ? depois.perguntas : [];
    if (pa.length !== pd.length) return [{ caminho: 'perguntas', motivo: 'quantas' }];
    pa.forEach((q, i) => {
      const u = pd[i];
      if (!mesmoValor(eObjecto(q) ? q.id : null, eObjecto(u) ? u.id : null)) out.push({ caminho: `perguntas.${i}.id`, motivo: 'mudou' });
      else if ((eObjecto(q) && Array.isArray(q.respostas) ? q.respostas.length : 0) !== (eObjecto(u) && Array.isArray(u.respostas) ? u.respostas.length : 0)) out.push({ caminho: `perguntas.${i}.respostas`, motivo: 'quantas' });
    });
    return out;
  }
  const a = eObjecto(antes) ? antes : {}; const d = eObjecto(depois) ? depois : {};
  if (qual === 'inicio') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(d)])) if (!tem(a, k) || !tem(d, k)) out.push({ caminho: k, motivo: tem(a, k) ? 'saiu' : 'chave_nova' });
    return out;
  }
  for (const caminho of BLOQUEADOS_SITE) if (!mesmoValor(valorEmCaminho(a, caminho), valorEmCaminho(d, caminho))) out.push({ caminho, motivo: 'mudou' });
  const conhecidas = new Set([...Object.keys(a), ...Object.keys(SECCOES_SITE), 'descricao', 'assinatura', 'local', 'garantias', 'google', 'fidelidade']);
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

/* AS FOTOGRAFIAS EM USO, em todo o conteúdo: as dos artigos, das categorias, das reparações,
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
  const rs = lerJson(d.reparacoes).obj;
  if (eObjecto(rs) && Array.isArray(rs.tipos)) for (const t of rs.tipos) if (eObjecto(t)) juntar(t.foto);
  fotosDoInicio(lerJson(d.inicio).obj).forEach(juntar);
  return usadas;
}
