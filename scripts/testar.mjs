#!/usr/bin/env node
// Testes do site (Node, sem browser). Correm no CI antes de cada publicação.
//
//   node scripts/testar.mjs          (precisa da cache das imagens: python3 scripts/imagens.py)
//
// Cada guarda prova-se nos dois sentidos: o site normal passa, e uma cópia estragada de propósito pára
// com a mensagem certa. As cópias fazem-se numa pasta temporária (nunca se mexe no repositório).
// Os testes do Worker das encomendas são dele (worker/encomendas/test/); os do painel são do painel.
//
// O CONTEÚDO DE ENSAIO: os testes usam scripts/testes/conteudo (uma cópia congelada do conteúdo a 9 nov
// 2026, com seis artigos, três modelos, duas reparações e a retoma) e scripts/testes/fotos, NUNCA o
// content/ do commit. O content/ é do dono,
// que o muda no painel: preencher o NIF, ligar a Stripe ou esconder um artigo não pode parar a
// publicação neste passo (achado ao fazer o painel). Um problema no conteúdo verdadeiro pára no passo
// seguinte, o do gerador, que escreve as razões para o painel (::error).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as R from '../src/lib/regras.mjs';
import { precoDe as precoDoWorker } from '../worker/encomendas/contas.js';
import { markdown, euros, hojeEmLisboa } from '../src/templates/util.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let feitos = 0;
const teste = (nome, fn) => {
  try {
    fn();
    feitos++;
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    console.error(`  ✗ ${nome}\n${e.stack}`);
    process.exitCode = 1;
  }
};
const ler = (rel) => JSON.parse(fs.readFileSync(path.join(RAIZ, rel), 'utf8'));

// ---------------------------------------------------------------- regras (as mesmas do painel)
console.log('regras');
teste('precoDe: a promoção vale até ao dia; depois volta o preço normal; sem preço é null', () => {
  const p = { preco: 80, precoAnterior: 100, promocaoAte: '2026-12-01' };
  assert.deepEqual(R.precoDe(p, '2026-11-30'), { atual: 80, anterior: 100, ate: '2026-12-01' });
  assert.deepEqual(R.precoDe(p, '2026-12-02'), { atual: 100, anterior: null, ate: '' });
  assert.deepEqual(R.precoDe({ preco: 50, precoAnterior: 40 }, '2026-11-08'), { atual: 50, anterior: null, ate: '' }); // «anterior» mais baixo não é promoção
  assert.equal(R.precoDe({}, '2026-11-08').atual, null);
});
teste('nifValido: o dígito de controlo', () => {
  assert.ok(R.nifValido('123456789'));
  assert.ok(!R.nifValido('123456780'));
  assert.ok(!R.nifValido('12345678'));
  assert.ok(!R.nifValido('000000000') || R.nifValido('000000000') === false);
});
teste('compravel e enviavel: só com preço e disponível; a película «só na loja» não se envia', () => {
  assert.ok(R.compravel({ preco: 10, disponibilidade: 'disponivel' }));
  assert.ok(R.compravel({ preco: 10, disponibilidade: 'loja' }));
  assert.ok(!R.compravel({ preco: 10, disponibilidade: 'confirmar' }));
  assert.ok(!R.compravel({ preco: 10, disponibilidade: 'esgotado' }));
  assert.ok(!R.compravel({ disponibilidade: 'disponivel' }));
  assert.ok(!R.enviavel({ disponibilidade: 'loja' }));
  assert.ok(R.enviavel({ disponibilidade: 'disponivel' }));
});
teste('opcoesDe: um grupo precisa de dois valores; o acréscimo só conta se for positivo', () => {
  const o = R.opcoesDe({ opcoes: [{ nome: 'Cor', valores: [{ nome: 'Preto' }, { nome: 'Prateado', suplemento: 5 }, { nome: 'Mau', suplemento: -2 }] }, { nome: 'Só um', valores: [{ nome: 'x' }] }] });
  assert.equal(o.length, 1);
  assert.deepEqual(o[0].valores.map((v) => v.suplemento), [0, 5, 0]);
});
teste('o conteúdo de ensaio não tem problemas que bloqueiem a pré-visualização, e tem os lembretes dos dados legais', () => {
  const E = 'scripts/testes/conteudo';
  const dados = {
    site: ler(`${E}/site.json`), inicio: ler(`${E}/inicio.json`), categorias: ler(`${E}/categorias.json`), fotos: ler(`${E}/fotos.json`),
    aparelhos: ler(`${E}/aparelhos.json`), reparacoes: ler(`${E}/reparacoes.json`), retoma: ler(`${E}/retoma.json`), campanhas: ler(`${E}/campanhas.json`),
    artigos: Object.fromEntries(fs.readdirSync(path.join(RAIZ, E, 'produtos')).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), ler(`${E}/produtos/${f}`)])),
    ficheirosFotos: fs.readdirSync(path.join(RAIZ, 'scripts/testes/fotos')).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)),
    videos: [],
  };
  const lista = R.problemas(dados, { hoje: hojeEmLisboa(), producao: false });
  assert.deepEqual(lista.filter((p) => p.classe === 'bloqueia').map((p) => p.mensagem), []);
  // os lembretes legais existem enquanto os dados não estão preenchidos (é o que a pré-visualização mostra)
  assert.ok(lista.some((p) => p.lembrete), 'faltam os lembretes dos dados legais');
});
teste('um artigo sem nome é escondido do site (neutralizado), não pára a publicação; um são não tem problemas', () => {
  const base = { nome: 'Coisa', categoria: 'acessorios', preco: 10, fotos: ['loja-fachada'] };
  const ctx = { nome: 'coisa', categorias: ler('scripts/testes/conteudo/categorias.json'), fotos: ler('scripts/testes/conteudo/fotos.json'), videos: [], hoje: hojeEmLisboa() };
  const semNome = R.problemasDoArtigo({ ...base, nome: '' }, ctx);
  assert.ok(semNome.some((p) => p.neutralizacao === 'esconder' || /escondid/i.test(p.mensagem)), JSON.stringify(semNome));
  assert.deepEqual(R.problemasDoArtigo(base, ctx).filter((p) => p.classe === 'bloqueia'), []);
});
teste('os portes pelo peso: o escalão que aguenta a encomenda; acima do último, combina-se', () => {
  const e = [{ ate: 30, preco: 14.9 }, { ate: 5, preco: 5.9 }];
  assert.equal(R.portesDoPeso(0.6, e), 5.9);
  assert.equal(R.portesDoPeso(5, e), 5.9);
  assert.equal(R.portesDoPeso(8, e), 14.9);
  assert.equal(R.portesDoPeso(31, e), null);
  assert.equal(R.pesoDe({ peso: 2 }, []), 2);
  assert.equal(R.pesoDe({ categoria: 'tablets' }, [{ slug: 'tablets', peso: 1 }]), 1);
  assert.equal(R.pesoDe({ categoria: 'x' }, []), R.PESO_POR_OMISSAO);
});
teste('a retoma: o máximo × os fatores, aos 5 € para baixo; «avaliar» e abaixo do mínimo dão «avaliamos na loja»', () => {
  const r = R.retomaDe(ler('scripts/testes/conteudo/retoma.json'));
  assert.deepEqual(R.valorDaRetoma(r, 'iphone-13', 128, {}), { maximo: 190, valor: 190, avaliar: false, descontos: [] });
  assert.equal(R.valorDaRetoma(r, 'iphone-13', 128, { corpo: 1 }).valor, 170, '190 × 0,9 = 171 → 170');
  assert.equal(R.valorDaRetoma(r, 'iphone-13', 128, { funciona: 1 }).avaliar, true);
  assert.equal(R.valorDaRetoma(r, 'galaxy-s24', 128, {}).avaliar, true, 'sem valor para o modelo');
  assert.equal(R.valorDaRetoma({ ...r, minimo: 200 }, 'iphone-13', 128, {}).avaliar, true, 'abaixo do mínimo');
  assert.deepEqual(R.retomaDe(ler('scripts/testes/conteudo/retoma.json'), { mostrarPorConfirmar: false }).valores, {}, 'em produção, os valores por confirmar não aparecem');
});
teste('as campanhas: só a publicada e dentro das datas; o desconto no preço, o normal riscado, a promoção própria ganha', () => {
  const c = [{ slug: 'bf', nome: 'Black Friday', publicada: true, desde: '2026-11-20', ate: '2026-11-30', faixa: 'BF', titulo: 'BF', desconto: 10, categorias: ['audio'] }];
  assert.equal(R.campanhasActivas(c, '2026-11-19').length, 0);
  assert.equal(R.campanhasActivas(c, '2026-11-30').length, 1);
  assert.equal(R.campanhasActivas([{ ...c[0], publicada: false }], '2026-11-25').length, 0);
  const act = R.campanhasActivas(c, '2026-11-25');
  const a = R.comCampanha({ categoria: 'audio', preco: 59.9 }, 'fones', act, '2026-11-25');
  assert.equal(a.preco, 53.91);
  assert.equal(a.precoAnterior, 59.9);
  assert.equal(a.promocaoDesde, '2026-11-20');
  assert.equal(a.promocaoAte, '2026-11-30');
  assert.equal(a.campanha, 'bf');
  const propria = R.comCampanha({ categoria: 'audio', preco: 49.9, precoAnterior: 59.9, promocaoAte: '2026-12-31' }, 'x', act, '2026-11-25');
  assert.equal(propria.preco, 49.9, 'os descontos não se somam');
  assert.equal(R.comCampanha({ categoria: 'peliculas', preco: 10 }, 'p', act, '2026-11-25').preco, 10);
});
teste('as regras novas: a lista dos modelos, as reparações e as campanhas avisam o que está mal', () => {
  assert.equal(R.problemasDosAparelhos('{x').some((p) => p.classe === 'bloqueia'), true);
  const ap = R.aparelhosDe(ler('scripts/testes/conteudo/aparelhos.json'));
  assert.equal(ap.modelos.length, 3);
  const rep = ler('scripts/testes/conteudo/reparacoes.json');
  rep.precos['iphone-13'].bateria = '69 €';
  rep.precos['nao-existe'] = { bateria: 10 };
  const l = R.problemasDasReparacoes(rep, { aparelhos: ap });
  assert.ok(l.some((p) => /só o número/.test(p.mensagem)), JSON.stringify(l));
  assert.ok(l.some((p) => /não está na lista dos modelos/.test(p.mensagem)));
  assert.ok(R.problemasDasReparacoes(ler('scripts/testes/conteudo/reparacoes.json'), { aparelhos: ap }).some((p) => p.lembrete && /não estão confirmados/.test(p.mensagem)));
  const cs = R.problemasDasCampanhas([{ slug: 'x', nome: 'X', faixa: 'X', titulo: 'X', desde: '2026-12-10', ate: '2026-12-01', desconto: 95 }]);
  assert.ok(cs.some((p) => /acaba antes de começar/.test(p.mensagem)));
  assert.ok(cs.some((p) => /de 1 a 90/.test(p.mensagem)));
  const reps = R.reparacoesDoModelo(ler('scripts/testes/conteudo/reparacoes.json'), ap.porId.get('iphone-13'));
  assert.deepEqual(reps.map((r) => [r.id, r.preco, r.desde]), [['ecra', 129.9, true], ['bateria', 69.9, false], ['diagnostico', null, false]]);
  assert.equal(R.reparacoesDoModelo(ler('scripts/testes/conteudo/reparacoes.json'), ap.porId.get('iphone-13'), { mostrarPorConfirmar: false })[0].preco, null, 'em produção, os preços por confirmar não aparecem');
});
teste('markdown e euros', () => {
  assert.match(markdown('## Título\n\nTexto com **negrito**.\n\n- um\n- dois'), /<h2 id="titulo">Título<\/h2>/);
  assert.match(markdown('<script>x</script>'), /&lt;script&gt;/);
  assert.equal(euros(12.5).replace(/\u00a0/g, ' '), '12,50 €');
  assert.equal(euros(300).replace(/\u00a0/g, ' '), '300 €');
});

// ---------------------------------------------------------------- os scripts do browser
console.log('scripts do browser');
for (const f of ['src/scripts/site.js', 'src/scripts/carrinho.js', 'src/scripts/loja.js', 'src/scripts/reparacoes.js', 'src/scripts/retoma.js']) {
  teste(`${f} compila`, () => {
    const r = spawnSync(process.execPath, ['--check', path.join(RAIZ, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
}
teste('o carrinho e o Worker usam a mesma regra de preço das regras (precoDe), e a chave de armazenamento prometida na política de cookies', () => {
  const js = fs.readFileSync(path.join(RAIZ, 'src/scripts/carrinho.js'), 'utf8');
  assert.match(js, /const CHAVE = 'lfmobile:carrinho'/);
  assert.match(fs.readFileSync(path.join(RAIZ, 'content/paginas/politica-de-cookies.md'), 'utf8'), /lfmobile:carrinho/);
  // a função do carrinho, tirada do ficheiro e corrida aqui, contra a das regras e a do Worker, numa tabela de casos
  const doCarrinho = new Function(`${js.match(/function precoDe\(p, hoje\) \{[\s\S]*?\n  \}/)[0]}; return precoDe;`)();
  const casos = [
    [{ preco: 40, precoAnterior: 60, promocaoDesde: '2026-11-27', promocaoAte: '2026-11-30' }, ['2026-11-11', '2026-11-27', '2026-11-30', '2026-12-01']],
    [{ preco: 45, precoAnterior: 55, promocaoAte: '2026-10-31' }, ['2026-10-31', '2026-11-11']],
    [{ preco: 60, precoAnterior: 55, promocaoAte: '2026-10-31' }, ['2026-11-11']],
    [{ preco: 45, precoAnterior: 55 }, ['2026-11-11']],
    [{ preco: 9.9 }, ['2026-11-11']],
    [{ preco: null }, ['2026-11-11']],
  ];
  for (const [p, dias] of casos) {
    for (const d of dias) {
      const r = R.precoDe(p, d);
      assert.deepEqual(doCarrinho(p, d), { atual: r.atual, anterior: r.anterior }, `carrinho ${JSON.stringify(p)} ${d}`);
      assert.deepEqual(precoDoWorker(p, d), { atual: r.atual, anterior: r.anterior }, `Worker ${JSON.stringify(p)} ${d}`);
    }
  }
  assert.deepEqual(R.precoDe(casos[0][0], '2026-11-11'), { atual: 60, anterior: null, ate: '' }, 'uma promoção agendada ainda não vale');
  assert.deepEqual(R.precoDe(casos[2][0], '2026-11-11'), { atual: 60, anterior: null, ate: '' }, 'um preço anterior esquecido, mais baixo, não manda');
  assert.doesNotMatch(js, /obriga[çc][ãa]o de pagar/i);
});
teste('a retoma desce aos 5 € depois de arredondar ao cêntimo (400 × 0,95 × 0,75 = 285 €, não 280 €)', () => {
  const r = { valores: { x: { 256: 400 } }, perguntas: [{ id: 'a', respostas: [{ fator: 1 }, { fator: 0.95, texto: 'riscos' }] }, { id: 'b', respostas: [{ fator: 1 }, { fator: 0.75, texto: 'bateria' }] }], minimo: 10 };
  assert.equal(R.valorDaRetoma(r, 'x', 256, { a: 1, b: 1 }).valor, 285);
  const js = fs.readFileSync(path.join(RAIZ, 'src/scripts/retoma.js'), 'utf8');
  assert.match(js, /Math\.floor\(Math\.round\(maximo \* fator \* 100\) \/ 500\) \* 5/, 'o simulador faz a mesma conta');
});

// ---------------------------------------------------------------- construções numa cópia
/* A base: o site (o gerador, os modelos, o media/ que não é do dono) com o conteúdo e as fotografias de
   ensaio no lugar do content/ e do media/fotos/, e as imagens feitas uma vez. Cada teste copia a base. */
const temporaria = fs.mkdtempSync(path.join(os.tmpdir(), 'lfmobile-teste-'));
const base = path.join(temporaria, 'base');
fs.cpSync(RAIZ, base, {
  recursive: true,
  filter: (f) => { const rel = f.slice(RAIZ.length); return !/^\/(\.git|_site|_cliente|node_modules|\.wrangler|\.cache|content|media\/fotos)(\/|$)/.test(rel); },
});
fs.cpSync(path.join(RAIZ, 'scripts/testes/conteudo'), path.join(base, 'content'), { recursive: true });
fs.cpSync(path.join(RAIZ, 'scripts/testes/fotos'), path.join(base, 'media/fotos'), { recursive: true });
{
  const r = spawnSync(process.env.PYTHON || 'python3', ['scripts/imagens.py'], { cwd: base, encoding: 'utf8' });
  if (r.status !== 0) { console.error(`\nAs imagens do conteúdo de ensaio falharam (precisa do Pillow):\n${r.stdout}\n${r.stderr}`); process.exit(1); }
}
/* O cabeçalho sem o menu da loja (o painel por baixo de «Loja», com divs dentro de divs): tira o bloco inteiro. */
function semMenuDaLoja(html) {
  const i = html.indexOf('<div class="topo__mega"');
  if (i < 0) return html;
  let n = 0;
  const re = /<\/?div\b/g;
  re.lastIndex = i;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    n += m[0] === '<div' ? 1 : -1;
    if (n === 0) return html.slice(0, i) + html.slice(html.indexOf('>', m.index) + 1);
  }
  return html;
}
function copia(nome, mexer = () => {}) {
  const destino = path.join(temporaria, nome);
  fs.cpSync(base, destino, { recursive: true });
  mexer(destino);
  return destino;
}
function construir(pasta, ...args) {
  const r = spawnSync(process.execPath, ['scripts/build.mjs', '--sem-imagens', ...args], { cwd: pasta, encoding: 'utf8' });
  return { codigo: r.status, saida: `${r.stdout}\n${r.stderr}` };
}
const json = (pasta, rel, mudar) => {
  const f = path.join(pasta, rel);
  const dados = JSON.parse(fs.readFileSync(f, 'utf8'));
  mudar(dados);
  fs.writeFileSync(f, JSON.stringify(dados, null, 2));
};
const todosHtml = (pasta) => {
  const out = [];
  (function andar(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) andar(p); else if (f.endsWith('.html')) out.push(p); } })(path.join(pasta, '_site'));
  return out;
};
/* Os dados legais que o dono ainda não deu, preenchidos de faz-de-conta: é com isto que se prova
   que a produção (--producao) vai construir no fim, quando os der. */
const preencherDadosLegais = (s) => {
  s.contactos.email = 'geral@lfmobile-teste.pt';
  Object.assign(s.empresa, { nome: 'Nome de Teste', tipo: 'Empresário em nome individual', nif: '123456789', iva: 'Os preços incluem IVA à taxa legal em vigor.' });
  s.entrega.portes.continente = [{ ate: 5, preco: 4.9 }, { ate: 30, preco: 12.9 }];
  s.garantias.recondicionados = 18;
};

console.log('construção');
teste('a pré-visualização constrói com --base, fecha-se aos motores de busca e deixa os lembretes à vista', () => {
  const pasta = copia('previa');
  const r = construir(pasta, '--base=/lfmobile');
  assert.equal(r.codigo, 0, r.saida);
  const index = fs.readFileSync(path.join(pasta, '_site/index.html'), 'utf8');
  assert.match(index, /<meta name="robots" content="noindex/);
  assert.match(index, /href="\/lfmobile\/assets\/site-[0-9a-f]+\.css"/);
  // o espaço do cabeçalho (scroll-padding-top) só quando o foco não está no cabeçalho: com o foco no campo da procura,
  // a página subia ~60 px a cada letra (13 nov 2026)
  const css = fs.readFileSync(path.join(pasta, '_site/assets', index.match(/assets\/(site-[0-9a-f]+\.css)/)[1]), 'utf8');
  assert.doesNotMatch(css, /(?:^|\})\s*html\s*\{[^}]*scroll-padding-top/);
  assert.match(css, /html:not\(:has\(\.topo:focus-within\)\)\s*\{\s*scroll-padding-top/);
  assert.match(fs.readFileSync(path.join(pasta, '_site/termos-e-condicoes/index.html'), 'utf8'), /por confirmar: o NIF/);
  assert.ok(fs.existsSync(path.join(pasta, '_site/404.html')));
  assert.ok(fs.existsSync(path.join(pasta, '_site/assets/catalogo.json')));
  const cat = JSON.parse(fs.readFileSync(path.join(pasta, '_site/assets/catalogo.json'), 'utf8'));
  assert.equal(cat.v, 3);
  assert.equal(cat.modo, 'encomenda');
  assert.deepEqual(cat.portes.continente, [{ ate: 5, preco: 5.9 }, { ate: 30, preco: 14.9 }]);
  assert.equal(cat.transportadora, 'Nacex');
  assert.equal(cat.produtos['pelicula-vidro'].pedeModelo, true);
  assert.equal(cat.produtos['fones-p9'].peso, 0.3, 'o peso da categoria (Áudio)');
  assert.ok(cat.categorias.some((c) => c.slug === 'peliculas'));
  const busca = fs.readdirSync(path.join(pasta, '_site/assets')).find((f) => /^busca-[0-9a-f]+\.json$/.test(f));
  assert.ok(busca, 'falta o índice da procura');
  const ind = JSON.parse(fs.readFileSync(path.join(pasta, '_site/assets', busca), 'utf8'));
  assert.ok(ind.modelos.some((m) => m.n === 'iPhone 13' && m.u === '/lfmobile/reparacoes/iphone-13/'));
  assert.ok(ind.artigos.some((a) => a.n === 'Auscultadores P9'));
  for (const [slug, p] of Object.entries(cat.produtos)) {
    if (p.compravel) assert.equal(typeof p.preco, 'number', `${slug} comprável sem preço`);
    assert.ok(fs.existsSync(path.join(pasta, '_site/produtos', slug, 'index.html')), `${slug} sem ficha`);
  }
  for (const f of todosHtml(pasta)) {
    const html = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(html, /obriga[çc][ãa]o de pagar/i, f);
    assert.match(html, /<html lang="pt-PT"( class="na-capa")?>/, f);
  }
});
teste('a ficha de um artigo comprável tem o formulário do carrinho; a de um «confirmar» pergunta pelo WhatsApp; a película não se envia', () => {
  const pasta = copia('fichas');
  assert.equal(construir(pasta).codigo, 0);
  const comp = fs.readFileSync(path.join(pasta, '_site/produtos/huawei-watch-d2/index.html'), 'utf8');
  assert.match(comp, /data-comprar="huawei-watch-d2"/);
  const conf = fs.readFileSync(path.join(pasta, '_site/produtos/samsung-galaxy-s25-128gb/index.html'), 'utf8');
  assert.doesNotMatch(conf, /data-comprar=/);
  assert.match(conf, /wa\.me\//);
  const pel = fs.readFileSync(path.join(pasta, '_site/produtos/pelicula-hidrogel/index.html'), 'utf8');
  assert.match(pel, /data-comprar="pelicula-hidrogel"/);
  assert.match(pel, /Só na loja/);
});
teste('a película que pede o modelo tem a escolha da marca e do modelo, com as sugestões', () => {
  const pasta = copia('modelo-pelicula');
  assert.equal(construir(pasta).codigo, 0);
  const html = fs.readFileSync(path.join(pasta, '_site/produtos/pelicula-vidro/index.html'), 'utf8');
  assert.match(html, /data-escolha-modelo/);
  assert.match(html, /<option>Apple<\/option><option>Samsung<\/option><option>Xiaomi<\/option>/);
  // os modelos agrupados pela família, como na escolha da capa; uma marca só com sugestões leva o nome dela
  assert.match(html, /id="dados-modelos">\{"Apple":\[\["iPhone",\["iPhone 15 Pro","iPhone 13"\]\]\],"Samsung":\[\["Galaxy S",\["Galaxy S24"\]\]\],"Xiaomi":\[\["Xiaomi",\["Redmi Note 13"\]\]\]\}<\/script>/);
  // duas listas (a do modelo enche-se no browser); sem JavaScript fica só o campo escrito, e nada de <datalist>
  assert.match(html, /<div class="campo" data-modelo-lista-campo hidden><label for="m-lista-pelicula-vidro">Modelo<\/label><select id="m-lista-pelicula-vidro" data-modelo-lista disabled>/);
  assert.match(html, /<div class="campo" data-modelo-nome-campo><label for="m-modelo-pelicula-vidro" data-modelo-nome-rotulo>Modelo<\/label><input id="m-modelo-pelicula-vidro" name="modelo" type="text"/);
  assert.doesNotMatch(html, /<datalist|list="/);
  assert.doesNotMatch(fs.readFileSync(path.join(pasta, '_site/produtos/fones-p9/index.html'), 'utf8'), /data-escolha-modelo/);
});
teste('as reparações: a página geral, a da família e a do modelo, com os preços «por confirmar» na pré-visualização', () => {
  const pasta = copia('reparacoes');
  assert.equal(construir(pasta).codigo, 0);
  const ler2 = (rel) => fs.readFileSync(path.join(pasta, '_site', rel), 'utf8');
  const hub = ler2('reparacoes/index.html');
  assert.match(hub, /data-seletor="reparacoes"/);
  assert.match(hub, /href="\/reparacoes\/iphone-13\/"/);
  assert.match(hub, /data-problema="ecra"/);
  assert.match(ler2('reparacoes/iphone/index.html'), /Reparação iPhone/);
  const m = ler2('reparacoes/iphone-13/index.html');
  assert.match(m, /desde 129,90/);
  assert.match(m, /69,90/);
  assert.match(m, /Ecrã original/);
  assert.match(m, /por confirmar: preços de referência/);
  assert.match(m, /data-por-confirmar="sim"/);
  assert.match(ler2('reparacoes/galaxy-s24/index.html'), /59,90/);
  assert.match(ler2('reparacoes/iphone-15-pro/index.html'), /Orçamento grátis/);
});
teste('as reparações de outras marcas: «Outras» abre as marcas, a família e o modelo têm página, e as películas juntam as sugestões sem repetir', () => {
  const pasta = copia('reparacoes-marcas', (p) => {
    json(p, 'content/aparelhos.json', (a) => {
      a.marcas.push({ id: 'xiaomi', nome: 'Xiaomi' });
      a.familias.push({ id: 'redmi', marca: 'xiaomi', nome: 'Redmi', tipo: 'telemovel' });
      a.modelos.push({ id: 'redmi-note-13', nome: 'Redmi Note 13', familia: 'redmi', desenho: 'galaxy' });
    });
    json(p, 'content/reparacoes.json', (r) => {
      for (const t of r.tipos) t.familias.push('redmi');
      r.precos['redmi-note-13'] = { ecra: { compativel: 79.9 } };
    });
  });
  assert.equal(construir(pasta).codigo, 0);
  const ler2 = (rel) => fs.readFileSync(path.join(pasta, '_site', rel), 'utf8');
  const hub = ler2('reparacoes/index.html');
  assert.match(hub, /data-marca="apple" aria-pressed="true">Apple<\/button><button class="seletor__marca" type="button" data-marca="samsung"|data-marca="samsung" aria-pressed="false">Samsung/);
  assert.match(hub, /data-outras aria-pressed="false" aria-expanded="false" aria-controls="escolher-outras">Outras<span class="visualmente-escondido"> marcas<\/span>/);
  assert.match(hub, /<div class="seletor__outras" id="escolher-outras" role="group" aria-label="Outras marcas" hidden>\s*<button class="seletor__outra" type="button" data-marca="xiaomi" aria-pressed="false">Xiaomi<\/button>/);
  assert.match(hub, /Outra marca ou modelo\?/);
  assert.match(hub, /data-familia="redmi" data-marca-da-familia="xiaomi"/);
  assert.match(hub, /<li data-familia="redmi" data-marca="xiaomi" data-nome="redmi note 13">/);
  assert.match(ler2('reparacoes/redmi/index.html'), /Reparação Redmi/);
  const m = ler2('reparacoes/redmi-note-13/index.html');
  assert.match(m, /Xiaomi · Redmi/);
  assert.match(m, /79,90/);
  // o rodapé já não lista as reparações (o Renato, 12 nov 2026: «essa lista de reparações está aí a mais»);
  // a família chega-se pelo seletor das reparações
  assert.doesNotMatch(ler2('index.html').match(/<footer class="rodape">[\s\S]*?<\/footer>/)[0], /\/reparacoes\//);
  assert.match(hub, /<a class="seletor__familia" href="\/reparacoes\/redmi\/"/);
  // a escolha do modelo nas películas: a sugestão e o modelo da lista com o mesmo nome aparecem uma vez
  const dados = JSON.parse(ler2('produtos/pelicula-vidro/index.html').match(/id="dados-modelos">(.*?)<\/script>/)[1]);
  assert.deepEqual(dados.Xiaomi, [['Redmi', ['Redmi Note 13']]]);
});
teste('as categorias em dois níveis: a mãe junta as filhas, a loja tem a fila das filhas, e o menu, o do telemóvel e o rodapé com as de cima, todas (as vazias fora do Google)', () => {
  const pasta = copia('dois-niveis', (p) => json(p, 'content/categorias.json', (cs) => {
    const i = cs.findIndex((c) => c.slug === 'iphone');
    cs[i] = { slug: 'apple', nome: 'Apple', titulo: 'iPhone', resumo: 'iPhone novos e recondicionados.', marca: 'Apple', grupo: 'telemoveis' };
    cs.find((c) => c.slug === 'samsung').grupo = 'telemoveis';
    cs.find((c) => c.slug === 'recondicionados').grupo = 'telemoveis';
    cs.find((c) => c.slug === 'smartwatches').marca = 'Huawei';
    cs.find((c) => c.slug === 'audio').grupo = 'gadgets';
    cs.find((c) => c.slug === 'smartwatches').grupo = 'gadgets';
    cs.unshift({ slug: 'telemoveis', nome: 'Telemóveis', titulo: 'Telemóveis', resumo: 'Novos e recondicionados.' });
    cs.push({ slug: 'gadgets', nome: 'Gadgets', titulo: 'Gadgets', resumo: 'Áudio e smartwatches.' });
  }));
  const r = construir(pasta);
  assert.equal(r.codigo, 0, r.saida);
  const ler = (rel) => fs.readFileSync(path.join(pasta, '_site', rel), 'utf8');
  const cartoes = (html) => [...html.matchAll(/<article class="cartao[^"]*" data-artigo="([^"]+)"/g)].map((m) => m[1]).sort();
  // a mãe junta os artigos das filhas (e o iPhone recondicionado, que é da Apple, também na Apple)
  assert.deepEqual(cartoes(ler('loja/telemoveis/index.html')), ['iphone-13-128gb-recondicionado', 'samsung-galaxy-s25-128gb']);
  assert.deepEqual(cartoes(ler('loja/apple/index.html')), ['iphone-13-128gb-recondicionado']);
  assert.deepEqual(cartoes(ler('loja/gadgets/index.html')), ['fones-p9', 'huawei-watch-d2']);
  // o catálogo leva a mãe nas categorias de cada artigo (as campanhas e os cupões da mãe apanham as filhas)
  const cat = JSON.parse(ler('assets/catalogo.json'));
  assert.deepEqual(cat.produtos['iphone-13-128gb-recondicionado'].categorias, ['recondicionados', 'telemoveis', 'apple']);
  // uma marca com mãe só junta a marca dentro dela: o Huawei Watch não entra numa «Huawei» de outra mãe
  assert.deepEqual(cat.produtos['huawei-watch-d2'].categorias, ['smartwatches', 'gadgets']);
  // a loja: a fila de cima só com as de cima (a mãe assinalada numa filha) e a fila das filhas com «Todos»
  const apple = ler('loja/apple/index.html');
  const fila = (html, classe) => [...(html.match(new RegExp(`<ul${classe ? ` class="${classe}"` : ''}[^>]*>([\\s\\S]*?)</ul>`)) || ['', ''])[1].matchAll(/<a class="chip[^"]*" href="([^"]+)"( aria-current="(page|true)")?>([^<]+)<\/a>/g)].map((m) => `${m[4]}${m[3] ? `:${m[3]}` : ''}`);
  const chipsApple = apple.match(/<nav class="chips"[\s\S]*?<\/nav>/)[0];
  // todas, mesmo as que ainda não têm artigos (o Leandro, 13 nov 2026: «aquelas categorias e subcategorias todas»)
  assert.deepEqual(fila(chipsApple, ''), ['Tudo', 'Telemóveis:true', 'Tablets', 'Películas', 'Acessórios', 'Gadgets']);
  assert.deepEqual(fila(chipsApple, 'chips__filhas'), ['Todos', 'Apple:page', 'Samsung', 'Recondicionados']);
  assert.match(apple, /"name":"Telemóveis","item":"[^"]*\/loja\/telemoveis\/"/);
  // o menu da loja no cabeçalho: as de cima e as filhas das mães
  const mega = apple.match(/<div class="topo__mega"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...mega.match(/<ul class="topo__mega-cima">([\s\S]*?)<\/ul>/)[1].matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]), ['Toda a loja', 'Telemóveis', 'Tablets', 'Películas', 'Acessórios', 'Gadgets']);
  assert.deepEqual([...mega.matchAll(/<p class="topo__mega-titulo">([^<]+)<\/p>/g)].map((m) => m[1]), ['Telemóveis', 'Gadgets']);
  // o menu do telemóvel e o rodapé: só as de cima
  const grelha = apple.match(/<ul class="menu__grelha"[\s\S]*?<\/ul>/)[0];
  assert.deepEqual([...grelha.matchAll(/<span>([^<]+)<\/span><\/a>/g)].map((m) => m[1]), ['Telemóveis', 'Tablets', 'Películas', 'Acessórios', 'Gadgets', 'Toda a loja']);
  // uma categoria ainda sem artigos: a página existe e diz que ainda não há (fora do Google: no teste da produção)
  assert.match(ler('loja/tablets/index.html'), /Ainda não há artigos nesta categoria/);
  const rodape = apple.match(/<footer class="rodape">[\s\S]*?<\/footer>/)[0];
  assert.match(rodape, /<a href="\/loja\/telemoveis\/">Telemóveis<\/a>/);
  assert.doesNotMatch(rodape, /\/loja\/apple\//);
  // a fila redonda da página inicial: as que não têm filhas (sem as mães)
  const inicio = ler('index.html');
  const redonda = [...inicio.match(/<nav class="cat-fila"[\s\S]*?<\/nav>/)[0].matchAll(/<span class="cat-fila__nome">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(redonda, ['Apple', 'Samsung', 'Recondicionados', 'Smartwatches', 'Áudio', 'Películas', 'Reparações']);
});
teste('as regras das categorias-mãe: a mãe tem de existir e não pode ter mãe', () => {
  const base = [{ slug: 'a', nome: 'A', titulo: 'A' }, { slug: 'b', nome: 'B', titulo: 'B', grupo: 'a' }];
  assert.ok(!R.problemasDasCategorias(JSON.stringify(base)).some((x) => x.classe === 'bloqueia'));
  for (const mal of [[{ slug: 'b', nome: 'B', titulo: 'B', grupo: 'x' }], [{ slug: 'a', nome: 'A', titulo: 'A', grupo: 'a' }], [...base, { slug: 'c', nome: 'C', titulo: 'C', grupo: 'b' }]]) {
    assert.ok(R.problemasDasCategorias(JSON.stringify(mal)).some((x) => x.classe === 'bloqueia' && /grupo/.test(x.chave)), JSON.stringify(mal));
  }
  // o painel não muda a mãe de uma categoria
  assert.deepEqual(R.mudancasBloqueadas(base, [base[0], { ...base[1], grupo: undefined }], 'categorias').map((x) => x.caminho), ['1.grupo']);
});
teste('a arrumação: Apple e Samsung juntam os artigos da marca, os serviços juntos no topo, a página inicial curta, a retoma com vender e retoma, o menu em grelha', () => {
  const pasta = copia('arrumacao', (p) => {
    json(p, 'content/categorias.json', (cs) => {
      const i = cs.findIndex((c) => c.slug === 'iphone');
      cs[i] = { slug: 'apple', nome: 'Apple', titulo: 'Apple', resumo: 'iPhone novos e recondicionados.', marca: 'Apple' };
      cs.find((c) => c.slug === 'samsung').marca = 'Samsung';
    });
    json(p, 'content/retoma.json', (r) => { r.receber = ['Em dinheiro, na loja', 'Por transferência bancária', 'Em desconto numa compra na loja']; });
  });
  assert.equal(construir(pasta).codigo, 0);
  const ler2 = (rel) => fs.readFileSync(path.join(pasta, '_site', rel), 'utf8');
  // a categoria de marca: o iPhone recondicionado aparece em Apple (e continua em Recondicionados)
  const apple = ler2('loja/apple/index.html');
  assert.match(apple, /data-artigo="iphone-13-128gb-recondicionado"/);
  assert.doesNotMatch(apple, /data-artigo="samsung-galaxy-s25-128gb"/);
  assert.match(ler2('loja/recondicionados/index.html'), /data-artigo="iphone-13-128gb-recondicionado"/);
  const inicio = ler2('index.html');
  assert.match(ler2('loja/index.html'), /<a class="chip" href="\/loja\/apple\/">Apple<\/a><\/li><li><a class="chip" href="\/loja\/samsung\/">Samsung<\/a>/);
  // o catálogo leva as categorias de cada artigo (os cupões de uma categoria de marca apanham-nas)
  const cat = JSON.parse(fs.readFileSync(path.join(pasta, '_site/assets/catalogo.json'), 'utf8'));
  assert.deepEqual(cat.produtos['iphone-13-128gb-recondicionado'].categorias, ['recondicionados', 'apple']);
  assert.deepEqual(cat.produtos['fones-p9'].categorias, ['audio']);
  // o cabeçalho, o mesmo em todas as páginas (o Renato, 12 nov 2026: «está aqui informação repetida…»):
  // as quatro ligações, com a página onde se está assinalada (a loja nas suas páginas e nas fichas), a
  // lupa e o carrinho; sem a procura larga, sem os botões Reparações e Retoma e sem a fila das
  // categorias (estão nas pílulas da loja); sem a faixa de cima quando não há campanha nem aviso
  const lojaPag = ler2('loja/index.html');
  const ligacoes = (html) => [...semMenuDaLoja(html.match(/<nav class="topo__ligacoes"[\s\S]*?<\/nav>/)[0]).matchAll(/<a href="([^"]+)"( aria-current="page")?>([^<]+)<\/a>/g)].map((m) => [m[1], m[3], Boolean(m[2])]);
  assert.match(lojaPag, /<header class="topo" data-topo>/);
  assert.deepEqual(ligacoes(lojaPag), [['/loja/', 'Loja', true], ['/reparacoes/', 'Reparações', false], ['/retoma/', 'Retoma', false], ['/contactos/', 'Contactos', false]]);
  assert.deepEqual(ligacoes(ler2('produtos/fones-p9/index.html')).filter((x) => x[2]).map((x) => x[1]), ['Loja']);
  assert.deepEqual(ligacoes(ler2('reparacoes/iphone-13/index.html')).filter((x) => x[2]).map((x) => x[1]), ['Reparações']);
  assert.deepEqual(ligacoes(ler2('contactos/index.html')).filter((x) => x[2]).map((x) => x[1]), ['Contactos']);
  for (const html of [lojaPag, inicio, ler2('produtos/fones-p9/index.html')]) {
    assert.doesNotMatch(html, /topo__fila|topo__servicos|topo__accao|class="faixa-topo"/);
    // a barra da procura grande ao lado do logótipo (computador) e a lupa para o telemóvel
    assert.match(html, /<\/a>\s*<div class="topo__procura"><form class="busca" role="search"[\s\S]*?id="busca-topo"/);
    assert.match(html, /class="topo__botao topo__lupa"[^>]*data-abrir="procurar"/);
    // o texto do campo sem «iPhone», «telemóvel», «mobile», «nome» nem «email»: o Safari lia «phone» em «iPhone» e
    // punha o número de telemóvel de quem procurava por cima do teclado (13 nov 2026)
    for (const [, t] of html.matchAll(/<input[^>]*type="search"[^>]*placeholder="([^"]*)"/g)) assert.doesNotMatch(t, /phone|telem|mobile|nome|e-?mail|morada/i, t);
    // na folha do telemóvel, o «Fechar» na linha do campo
    assert.match(html, /<div class="busca__linha">[\s\S]*?id="busca-folha"[\s\S]*?<button class="folha-procura__fechar" type="button" data-fechar>Fechar<\/button>\s*<\/div>/);
  }
  assert.doesNotMatch(inicio, /Vender o meu</);
  // os cartões levam à ficha, onde se compra: sem o carrinho nem o «Escolher», com a seta em todos (13 nov 2026)
  assert.doesNotMatch(lojaPag, /data-juntar|cartao__juntar|cartao__escolher/);
  // mudar de separador não volta ao topo: o script em linha logo a seguir à loja repõe o lugar da fila (13 nov 2026)
  assert.match(lojaPag, /<\/div>\s*<script>\(function\(\)\{try\{var k='lfmobile:lugar-da-loja'/);
  // envios e devoluções: os portes numa tabela (um escalão por linha) e as ligações do fim dos cartões como botões
  const envios = ler2('envios-e-devolucoes/index.html');
  assert.match(envios, /<p class="portes__titulo">Portes<\/p><dl class="portes"><div><dt>Até \d/);
  assert.match(envios, /<div><dt>Mais de [\d,]+ kg<\/dt><dd>A combinar<\/dd><\/div><\/dl>/);
  assert.match(envios, /<p class="nota-cartao__accoes"><a href="https:\/\/www\.google\.com\/maps\/[^"]*" target="_blank" rel="noopener">Como chegar<\/a><\/p>/);
  assert.match(envios, /<p class="nota-cartao__accoes"><a href="\/desistir\/">Como desistir<\/a> <a href="\/garantia\/">Garantia<\/a><\/p>/);
  assert.doesNotMatch(envios, /\{\{|O levantamento na loja não tem custos/);
  assert.equal((lojaPag.match(/<span class="cartao__seta" aria-hidden="true">/g) || []).length, (lojaPag.match(/<article class="cartao/g) || []).length);
  // o rodapé alto: a marca e as colunas da Loja e da Ajuda (a das reparações saiu: «está aí a mais»)
  const rodape = inicio.match(/<footer class="rodape">[\s\S]*?<\/footer>/)[0];
  assert.deepEqual([...rodape.matchAll(/<div class="rodape__coluna">\s*<h2>([^<]+)<\/h2>/g)].map((m) => m[1]), ['Loja', 'Ajuda']);
  assert.match(rodape, /<a href="\/loja\/apple\/">Apple<\/a>/);
  assert.doesNotMatch(rodape, /\/reparacoes\//);
  // a loja aberta ou fechada fica junto do horário (na página inicial e nos contactos)
  assert.match(ler2('contactos/index.html'), /Horário<\/h3>\s*<p class="estado-loja" data-estado-loja hidden><\/p>/);
  assert.match(inicio, /Horário<\/p><p class="estado-loja" data-estado-loja hidden><\/p>/);
  // a página inicial (o Leandro e o Renato, 12 nov 2026): a capa a ocupar o ecrã, com o cabeçalho por
  // cima (transparente, quatro ligações e a lupa); sem a faixa de cima (sem campanha nem aviso), sem a
  // fila das categorias no cabeçalho e sem os cartões da reparação, da retoma e dos recondicionados
  assert.match(inicio, /<html lang="pt-PT" class="na-capa">/);
  assert.match(inicio, /<header class="topo topo--capa" data-topo>/);
  assert.deepEqual([...semMenuDaLoja(inicio.match(/<nav class="topo__ligacoes"[\s\S]*?<\/nav>/)[0]).matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]),
    [['/loja/', 'Loja'], ['/reparacoes/', 'Reparações'], ['/retoma/', 'Retoma'], ['/contactos/', 'Contactos']]);
  assert.doesNotMatch(inicio, /class="faixa-topo"|topo__fila|class="mosaico|class="rapido|data-rapido|faixa-retoma|data-problemas/);
  assert.match(inicio, /<section class="capa" aria-labelledby="capa-titulo">/);
  assert.match(inicio, /<p class="capa__rotulo">Mais que tecnologia<\/p>\s*<h1 class="capa__titulo" id="capa-titulo">Sempre contigo<\/h1>/);
  assert.equal((inicio.match(/<h1[\s>]/g) || []).length, 1, 'um só h1');
  assert.match(inicio, /<a class="botao botao--ouro" href="\/loja\/">Ver a loja<svg/);
  assert.match(inicio, /<figure class="capa__foto"><picture[^>]*>[^]*?fetchpriority="high"[^]*?<\/figure>/);
  assert.deepEqual([...inicio.match(/<ul class="capa__vantagens">[\s\S]*?<\/ul>/)[0].matchAll(/<strong>([^<]+)<\/strong>/g)].map((m) => m[1]), ['Envio rápido', 'Garantia', 'Apoio ao cliente']);
  assert.match(inicio, /<\/section>\s*<div class="contentor inicio">\s*<nav class="cat-fila"/);
  assert.match(ler2('reparacoes/index.html'), /data-problemas/);
  // a retoma: vender (em dinheiro ou por transferência) e retoma (desconto numa compra)
  const ret = ler2('retoma/index.html');
  assert.match(ret, /<strong>Vender<\/strong>Compramos o seu e pagamos em dinheiro ou por transferência\./);
  assert.match(ret, /<strong>Retoma<\/strong>O valor fica como desconto numa compra na loja\./);
  // o menu do telemóvel: os dois serviços, a loja em grelha, a ajuda em linhas
  const menu = inicio.match(/<dialog class="menu"[\s\S]*?<\/dialog>/)[0];
  assert.match(menu, /<strong>Retoma<\/strong><small>Compramos o seu<\/small>/);
  assert.match(menu, /<ul class="menu__grelha" aria-labelledby="menu-loja">\s*<li><a href="\/loja\/apple\/">/);
  assert.match(menu, /id="menu-ajuda">Ajuda</);
  // as garantias uma vez só, em cartões no fim da página inicial, depois da loja (o Renato, 11 nov
  // 2026): a nota do Google em primeiro, com as estrelas da nota e a ligação para as opiniões; cada
  // cartão leva ao sítio onde isso se explica. Nem a faixa de cima da loja, nem a do rodapé.
  assert.doesNotMatch(inicio, /confianca-faixa|Retoma do seu usado|rodape__garantias/);
  assert.match(inicio, /<section class="loja-casa"[\s\S]*?<\/section>\s*<section class="garantias" aria-labelledby="garantias-titulo">\s*<h2 class="visualmente-escondido" id="garantias-titulo">Porquê a LF Mobile<\/h2>/);
  const lis = inicio.match(/<section class="garantias"[\s\S]*?<\/section>/)[0].match(/<li>[\s\S]*?<\/li>/g);
  // os envios só na capa (nas três vantagens), não outra vez aqui (13 nov 2026, sem informação repetida)
  assert.deepEqual(lis.map((li) => li.match(/<strong class="garantia__titulo">(.*?)<\/strong>/)[1]), ['5,0 no Google', 'Orçamento grátis', 'Levantamento grátis']);
  assert.equal((inicio.match(/24\/48 h/g) || []).length, 1);
  assert.match(lis[0], /<a class="garantia" href="https:\/\/www\.google\.com\/maps\/place\/LF\+Mobile\/[^"]*!9m1!1b1[^"]*" target="_blank" rel="noopener">/);
  assert.match(lis[0], /<span class="estrelas" style="--nota: 5" aria-hidden="true">/);
  assert.match(lis[0], /<\/span><\/span>20 opiniões\.<\/span>/);
  assert.deepEqual(lis.slice(1).map((li) => li.match(/href="([^"]*)"/)[1]), ['/reparacoes/', '/contactos/']);
  for (const c of ['reparacoes/index.html', 'contactos/index.html', 'loja/index.html', 'envios-e-devolucoes/index.html']) {
    assert.doesNotMatch(ler2(c), /class="garantias|rodape__garantias|no Google<\/strong>/, c);
  }
});
teste('as estrelas seguem a nota do Google (4,6 → 4,6 estrelas), e sem a ligação das opiniões a nota não aparece', () => {
  const pasta = copia('nota-google', (p) => json(p, 'content/site.json', (s) => { s.google.nota = '4,6'; }));
  assert.equal(construir(pasta).codigo, 0);
  const g1 = fs.readFileSync(path.join(pasta, '_site/index.html'), 'utf8').match(/<section class="garantias"[\s\S]*?<\/section>/)[0];
  assert.match(g1, /<strong class="garantia__titulo">4,6 no Google<\/strong>/);
  assert.match(g1, /<span class="estrelas" style="--nota: 4.6" aria-hidden="true">/);
  const pasta2 = copia('sem-google', (p) => json(p, 'content/site.json', (s) => { delete s.google.ligacao; }));
  assert.equal(construir(pasta2).codigo, 0);
  const g2 = fs.readFileSync(path.join(pasta2, '_site/index.html'), 'utf8').match(/<section class="garantias"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(g2, /no Google|estrelas/);
  assert.match(g2, /<strong class="garantia__titulo">Orçamento grátis<\/strong>/);
});
teste('a revisão de 11 nov: a promoção agendada ainda não se mostra, as películas só nos telemóveis, a peça do ecrã na linha, e as categorias vazias fora do mapa', () => {
  const amanha2 = (() => { const x = new Date(`${hojeEmLisboa()}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 14); return x.toISOString().slice(0, 10); })();
  const pasta = copia('revisao', (p) => {
    json(p, 'content/produtos/fones-p9.json', (a) => { a.precoAnterior = a.preco; a.preco = Math.round(a.preco * 80) / 100; a.promocaoDesde = amanha2; a.promocaoAte = amanha2; });
    json(p, 'content/aparelhos.json', (a) => {
      a.familias.push({ id: 'ipad', marca: 'apple', nome: 'iPad', tipo: 'tablet' });
      a.modelos.push({ id: 'ipad-air-teste', nome: 'iPad Air Teste', familia: 'ipad', ano: 2024, desenho: 'tablet' });
    });
    json(p, 'content/reparacoes.json', (r) => { r.precos['iphone-13'].ecra = { compativel: 129.9 }; });
    json(p, 'content/categorias.json', (cs) => { cs.push({ slug: 'vazia', nome: 'Vazia', titulo: 'Categoria vazia', resumo: 'Ainda sem artigos.' }); });
  });
  assert.equal(construir(pasta).codigo, 0);
  const ler2 = (rel) => fs.readFileSync(path.join(pasta, '_site', rel), 'utf8');
  // a promoção começa daqui a duas semanas: a ficha mostra o preço normal, sem riscado nem nota, e o
  // catálogo leva a data de início (o carrinho e o Worker também esperam por ela)
  const ficha = ler2('produtos/fones-p9/index.html');
  const p9 = JSON.parse(ler2('assets/catalogo.json')).produtos['fones-p9'];
  assert.equal(p9.promocaoDesde, amanha2);
  assert.doesNotMatch(ficha, /preco__promocao|<s\b|<del\b/, 'nada de preço riscado antes de começar');
  assert.match(ficha, new RegExp(euros(p9.precoAnterior).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'o preço normal');
  // as películas são para telemóveis: a página do iPad não as sugere, a do iPhone sim
  assert.doesNotMatch(ler2('reparacoes/ipad-air-teste/index.html'), /modelo-peliculas/);
  assert.match(ler2('reparacoes/iphone-13/index.html'), /modelo-peliculas/);
  // o ecrã com um nível só (o compatível): a linha diz qual é
  assert.match(ler2('reparacoes/iphone-13/index.html'), /<span class="rep__nome">Substituição do ecrã <span class="rep__nivel">\(compatível\)<\/span><\/span>/);
  assert.match(ler2('reparacoes/index.html'), /Ecrã compatível ou original, conforme o modelo/);
  // o mapa do site: as categorias com artigos sim, a vazia não (a página existe na mesma)
  const mapa = ler2('sitemap.xml');
  assert.doesNotMatch(mapa, /\/loja\/vazia\//);
  assert.ok(fs.existsSync(path.join(pasta, '_site/loja/vazia/index.html')));
  assert.match(mapa, /\/loja\/audio\//);
});
teste('as consolas: a PlayStation tem os problemas dela (não os dos telemóveis), diz-se «da PlayStation», sem películas, e a procura acha «ps5»', () => {
  const pasta = copia('consolas', (p) => {
    json(p, 'content/aparelhos.json', (a) => {
      a.marcas.push({ id: 'sony', nome: 'Sony' });
      a.familias.push({ id: 'playstation', marca: 'sony', nome: 'PlayStation', tipo: 'consola' });
      a.modelos.push({ id: 'playstation-5', nome: 'PlayStation 5', familia: 'playstation', ano: 2020, desenho: 'consola' });
    });
    json(p, 'content/reparacoes.json', (r) => {
      r.tipos.splice(2, 0, { id: 'hdmi', nome: 'Porta HDMI', titulo: 'Reparação da porta HDMI', icone: 'hdmi', resumo: 'Sem imagem na televisão.', familias: ['playstation'] });
      r.tipos.find((t) => t.id === 'diagnostico').familias.push('playstation');
      r.precos['playstation-5'] = { hdmi: 89.9 };
    });
  });
  assert.equal(construir(pasta).codigo, 0);
  const ler2 = (rel) => fs.readFileSync(path.join(pasta, '_site', rel), 'utf8');
  const ps5 = ler2('reparacoes/playstation-5/index.html');
  assert.match(ps5, /<span class="rep__nome">Reparação da porta HDMI<\/span>[\s\S]*?89,90/);
  assert.doesNotMatch(ps5, /data-rep="ecra"|data-rep="bateria"/, 'só os problemas da consola');
  assert.match(ps5, /<legend class="visualmente-escondido">Reparações da PlayStation 5<\/legend>/);
  assert.match(ps5, /<meta name="description" content="Reparação da PlayStation 5 /);
  assert.match(ps5, /<title>Reparação PlayStation 5 — porta HDMI, limpeza e mais/);
  assert.doesNotMatch(ps5, /modelo-peliculas/, 'películas não, numa consola');
  assert.match(ps5, /<use href="#ap-consola"\/>/);
  assert.match(ler2('reparacoes/playstation/index.html'), /reparar%20a%20minha%20PlayStation/);
  // a grelha dos problemas é a dos telemóveis; a PlayStation aparece no seletor das famílias
  const rep = ler2('reparacoes/index.html');
  assert.doesNotMatch(rep.match(/<ul class="problemas__grelha"[\s\S]*?<\/ul>/)[0], /data-problema="hdmi"/);
  assert.match(rep, /<a class="seletor__familia" href="\/reparacoes\/playstation\/"[^>]*>PlayStation<\/a>/);
  // a procura: «ps5» e «consola»
  const busca = JSON.parse(fs.readFileSync(path.join(pasta, '_site/assets', fs.readdirSync(path.join(pasta, '_site/assets')).find((x) => /^busca-[0-9a-f]+\.json$/.test(x))), 'utf8'));
  const m = busca.modelos.find((x) => x.n === 'PlayStation 5');
  assert.ok(m && m.t.includes('ps5') && m.t.includes('consola'), JSON.stringify(m));
});
teste('em produção, os preços das reparações e os valores da retoma por confirmar não aparecem; confirmados, aparecem', () => {
  const pasta = copia('reparacoes-producao', (p) => json(p, 'content/site.json', preencherDadosLegais));
  assert.equal(construir(pasta, '--producao').codigo, 0);
  const m = fs.readFileSync(path.join(pasta, '_site/reparacoes/iphone-13/index.html'), 'utf8');
  assert.doesNotMatch(m, /129,90|69,90/);
  assert.match(m, /Orçamento grátis/);
  const dados = (html) => JSON.parse(html.match(/<script type="application\/json" id="dados-retoma">(.*?)<\/script>/)[1]);
  assert.deepEqual(dados(fs.readFileSync(path.join(pasta, '_site/retoma/index.html'), 'utf8')).valores, {});
  const conf = copia('reparacoes-confirmadas', (p) => {
    json(p, 'content/site.json', preencherDadosLegais);
    json(p, 'content/reparacoes.json', (r) => { r.confirmado = true; });
    json(p, 'content/retoma.json', (r) => { r.confirmado = true; });
  });
  assert.equal(construir(conf, '--producao').codigo, 0);
  const m2 = fs.readFileSync(path.join(conf, '_site/reparacoes/iphone-13/index.html'), 'utf8');
  assert.match(m2, /desde 129,90/);
  assert.doesNotMatch(m2, /por confirmar/);
  assert.match(m2, /"@type":"Offer","priceCurrency":"EUR","price":"129.90"/);
  assert.deepEqual(dados(fs.readFileSync(path.join(conf, '_site/retoma/index.html'), 'utf8')).valores, { 'iphone-13': { 128: 190, 256: 210 } });
});
teste('uma campanha a correr: a faixa do topo, a página dela, o preço com desconto e o normal riscado, e o catálogo igual', () => {
  const hoje = hojeEmLisboa();
  const daqui = (dias) => new Date(Date.parse(`${hoje}T12:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
  const pasta = copia('campanha', (p) => json(p, 'content/campanhas.json', (c) => {
    c.push({ slug: 'black-friday', nome: 'Black Friday', publicada: true, desde: daqui(-1), ate: daqui(6), faixa: 'Black Friday: 10% no áudio', titulo: 'Black Friday na LF Mobile', texto: '', desconto: 10, categorias: ['audio'], marcas: [], artigos: [] });
    c.push({ slug: 'rascunho', nome: 'Rascunho', publicada: false, desde: daqui(-1), ate: daqui(6), faixa: 'X', titulo: 'X', desconto: 50, categorias: ['peliculas'] });
  }));
  assert.equal(construir(pasta).codigo, 0);
  const ler2 = (rel) => fs.readFileSync(path.join(pasta, '_site', rel), 'utf8');
  const index = ler2('index.html');
  assert.match(index, /class="faixa-topo__campanha" href="\/campanhas\/black-friday\/"/);
  assert.ok(fs.existsSync(path.join(pasta, '_site/campanhas/black-friday/index.html')));
  assert.ok(!fs.existsSync(path.join(pasta, '_site/campanhas/rascunho/index.html')), 'o rascunho não aparece');
  const ficha = ler2('produtos/fones-p9/index.html');
  assert.match(ficha, /53,91/);
  assert.match(ficha, /<s class="preco__antes"><span class="visualmente-escondido">em vez de <\/span>59,90/);
  assert.match(ficha, /Black Friday: de /, 'a nota legal do período (DL 70/2007)');
  const cat = JSON.parse(ler2('assets/catalogo.json'));
  assert.equal(cat.produtos['fones-p9'].preco, 53.91);
  assert.equal(cat.produtos['fones-p9'].precoAnterior, 59.9);
  assert.equal(cat.produtos['fones-p9'].campanha, 'black-friday');
  assert.equal(cat.produtos['pelicula-vidro'].preco, 9.9, 'o rascunho não mexe nos preços');
});
teste('o WhatsApp é um botão flutuante (fora da barra de cima), e não aparece no carrinho nem na encomenda', () => {
  const pasta = copia('whatsapp');
  assert.equal(construir(pasta).codigo, 0);
  const ler = (rel) => fs.readFileSync(path.join(pasta, '_site', rel), 'utf8');
  for (const pagina of ['index.html', 'loja/index.html', 'produtos/fones-p9/index.html', 'reparacoes/index.html', 'contactos/index.html']) {
    const html = ler(pagina);
    assert.match(html, /class="whatsapp-flutuante" href="https:\/\/wa\.me\/351\d{9}"/, pagina);
    assert.doesNotMatch(html.slice(html.indexOf('<header'), html.indexOf('</header>')), /wa\.me/, `${pagina}: o WhatsApp voltou à barra de cima`);
  }
  for (const pagina of ['carrinho/index.html', 'checkout/index.html', 'obrigado/index.html']) assert.doesNotMatch(ler(pagina), /data-whatsapp-flutuante/, pagina);
  // o total por cima do botão de enviar (no telemóvel o resumo fica depois dele)
  assert.match(ler('checkout/index.html'), /<p class="checkout__total" data-checkout-total hidden><span>Total<\/span><strong><\/strong><\/p>\s*<button class="botao botao--cheio botao--largo" type="submit" data-botao-checkout>/);
});
teste('os contactos têm o mapa desenhado dentro da página (sem o Google, sem cookies), com o crédito do OpenStreetMap', () => {
  const pasta = copia('mapa');
  assert.equal(construir(pasta).codigo, 0);
  const ler = (rel) => fs.readFileSync(path.join(pasta, '_site', rel), 'utf8');
  const html = ler('contactos/index.html');
  assert.match(html, /<svg class="mapa-loja__desenho"[^>]*role="img"/);
  assert.match(html, /class="mapa-loja__ligacao" href="https:\/\/www\.google\.com\/maps\//);
  assert.match(html, /© OpenStreetMap/);
  assert.doesNotMatch(html, /<iframe|maps\?q=|data-fachada-mapa/);
  for (const pagina of ['politica-de-cookies/index.html', 'politica-de-privacidade/index.html']) assert.doesNotMatch(ler(pagina), /lfmobile-mapa|Carregar o mapa/, pagina);
});
teste('a produção pára sem os dados legais, e diz quais', () => {
  // sem os escalões dos portes, também (o conteúdo de ensaio já tem os da Nacex)
  const pasta = copia('producao-falha', (p) => json(p, 'content/site.json', (s) => { s.entrega.portes.continente = []; }));
  const r = construir(pasta, '--producao');
  assert.notEqual(r.codigo, 0);
  assert.match(r.saida, /A publicação parou/);
  assert.match(r.saida, /NIF/);
  assert.match(r.saida, /email/);
  assert.match(r.saida, /portes/);
});
teste('a produção constrói com os dados legais preenchidos: aberta aos motores de busca, sem lembretes, com sitemap', () => {
  const pasta = copia('producao', (p) => json(p, 'content/site.json', preencherDadosLegais));
  const r = construir(pasta, '--producao');
  assert.equal(r.codigo, 0, r.saida);
  const index = fs.readFileSync(path.join(pasta, '_site/index.html'), 'utf8');
  assert.doesNotMatch(index, /noindex/);
  assert.match(index, /https:\/\/lfmobile\.pt\//);
  // as películas de um modelo levam-no no fragmento (#modelo=), não num parâmetro: para o Google não são outras
  // páginas (com ?modelo= eram 2416 endereços repetidos); os antigos ficam fora do rastreio
  for (const f of todosHtml(pasta)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /href="[^"]*\?modelo=/, f);
  assert.match(fs.readFileSync(path.join(pasta, '_site/reparacoes/iphone-13/index.html'), 'utf8'), /href="\/produtos\/[a-z0-9-]+\/#modelo=Apple%7CiPhone%2013"/);
  assert.match(fs.readFileSync(path.join(pasta, '_site/robots.txt'), 'utf8'), /^Disallow: \/\*\?modelo=$/m);
  // o nome do site para o Google: «LF Mobile», com a forma colada como alternativa (só na página inicial)
  assert.match(index, /"@type":"WebSite","@id":"https:\/\/lfmobile\.pt\/#site","name":"LF Mobile","alternateName":\["LFMobile"\],"url":"https:\/\/lfmobile\.pt\/"/);
  assert.ok(fs.existsSync(path.join(pasta, '_site/sitemap.xml')));
  for (const f of todosHtml(pasta)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /por confirmar:/, f);
  // o rodapé só com «© ano marca» (o Renato, 12 nov 2026: o nome, o NIF e a morada «não precisam de
  // estar lá»); a identificação de quem vende fica nos Contactos e nos Termos
  assert.match(index, /<p class="rodape__direitos">© \d{4} LF Mobile<\/p>/);
  for (const f of todosHtml(pasta)) assert.doesNotMatch((fs.readFileSync(f, 'utf8').match(/<footer class="rodape">[\s\S]*?<\/footer>/) || [''])[0], /123456789|Nome de Teste/, f);
  assert.match(fs.readFileSync(path.join(pasta, '_site/contactos/index.html'), 'utf8'), /Nome de Teste[\s\S]{0,80}123456789/);
  assert.match(fs.readFileSync(path.join(pasta, '_site/termos-e-condicoes/index.html'), 'utf8'), /123456789/);
  // fora do Google (noindex e fora do sitemap): as páginas legais e a dos envios. A Loja, as Reparações, a Retoma, os
  // Contactos, o Sobre e as Perguntas ficam (o Renato, 13 nov 2026: as legais «não vale a pena» aparecerem na pesquisa)
  const mapa = fs.readFileSync(path.join(pasta, '_site/sitemap.xml'), 'utf8');
  for (const c of ['termos-e-condicoes', 'politica-de-privacidade', 'politica-de-cookies', 'resolucao-de-litigios', 'garantia', 'desistir', 'envios-e-devolucoes']) {
    assert.match(fs.readFileSync(path.join(pasta, `_site/${c}/index.html`), 'utf8'), /<meta name="robots" content="noindex">/, c);
    assert.ok(!mapa.includes(`/${c}/<`), `${c} não devia estar no sitemap`);
  }
  for (const c of ['', 'loja/', 'reparacoes/', 'retoma/', 'contactos/', 'sobre-nos/', 'perguntas-frequentes/']) {
    assert.doesNotMatch(fs.readFileSync(path.join(pasta, `_site/${c}index.html`), 'utf8'), /name="robots"/, c);
    assert.ok(mapa.includes(`<loc>https://lfmobile.pt/${c}</loc>`), `${c || '/'} devia estar no sitemap`);
  }
  // uma categoria ainda sem artigos (Tablets, nos dados de ensaio) fica com noindex e fora do mapa; uma com artigos, não
  assert.match(fs.readFileSync(path.join(pasta, '_site/loja/tablets/index.html'), 'utf8'), /<meta name="robots" content="noindex">/);
  assert.ok(!mapa.includes('/loja/tablets/<'));
  assert.doesNotMatch(fs.readFileSync(path.join(pasta, '_site/loja/audio/index.html'), 'utf8'), /name="robots"/);
  // a conta do cliente: fora do Google (noindex, fora do mapa), mas não no robots.txt — o Google tem de ler o noindex
  assert.match(fs.readFileSync(path.join(pasta, '_site/conta/index.html'), 'utf8'), /<meta name="robots" content="noindex">/);
  assert.ok(!mapa.includes('/conta/'), 'a conta não vai ao sitemap');
  assert.doesNotMatch(fs.readFileSync(path.join(pasta, '_site/robots.txt'), 'utf8'), /conta/);
  // uma categoria cujo título é só o nome leva o resumo no <title>; a descrição diz onde é a loja e como se recebe
  const smart = fs.readFileSync(path.join(pasta, '_site/loja/smartwatches/index.html'), 'utf8');
  assert.match(smart, /<title>Smartwatches — Relógios inteligentes para o dia a dia e o desporto \| LF Mobile<\/title>/);
  assert.match(smart, /<meta name="description" content="Relógios inteligentes para o dia a dia e o desporto\. Na LF Mobile, em São Roque: envios para Portugal Continental e levantamento grátis na loja\.">/);
});
teste('em modo «online» o botão diz «Encomendar e pagar» (como os termos), e o catálogo leva o modo', () => {
  const pasta = copia('online', (p) => json(p, 'content/site.json', (s) => { s.pagamentos.modo = 'online'; }));
  assert.equal(construir(pasta).codigo, 0);
  assert.match(fs.readFileSync(path.join(pasta, '_site/checkout/index.html'), 'utf8'), /Encomendar e pagar/);
  assert.match(fs.readFileSync(path.join(pasta, '_site/termos-e-condicoes/index.html'), 'utf8'), /Encomendar e pagar/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(pasta, '_site/assets/catalogo.json'), 'utf8')).modo, 'online');
});
teste('um artigo sem nome sai do site e a construção avisa, sem parar (o resto da loja publica-se)', () => {
  const pasta = copia('sem-nome', (p) => json(p, 'content/produtos/fones-p9.json', (a) => { a.nome = ''; }));
  const r = construir(pasta);
  assert.equal(r.codigo, 0, r.saida);
  assert.ok(!fs.existsSync(path.join(pasta, '_site/produtos/fones-p9/index.html')), 'a ficha sem nome não devia existir');
  assert.match(r.saida, /fones-p9/);
});
teste('uma fotografia que não existe pára a construção', () => {
  const pasta = copia('foto', (p) => json(p, 'content/inicio.json', (t) => { t.capa.foto = 'nao-existe'; }));
  const r = construir(pasta);
  assert.notEqual(r.codigo, 0);
  assert.match(r.saida, /fotografia da capa/i);
});
teste('a frase «obrigação de pagar» numa página de texto pára a construção', () => {
  const pasta = copia('frase', (p) => fs.appendFileSync(path.join(p, 'content/paginas/perguntas-frequentes.md'), '\n\n## Teste\n\nEncomenda com obrigação de pagar.\n'));
  const r = construir(pasta);
  assert.notEqual(r.codigo, 0);
  assert.match(r.saida, /obriga[çc][ãa]o de pagar/i);
});
teste('um marcador desconhecido numa página de texto pára a construção', () => {
  const pasta = copia('marcador', (p) => fs.appendFileSync(path.join(p, 'content/paginas/garantia.md'), '\n\n{{inexistente}}\n'));
  const r = construir(pasta);
  assert.notEqual(r.codigo, 0);
  assert.match(r.saida, /inexistente/);
});
teste('a conta do cliente: a página /conta/, a ligação no cabeçalho, no menu do telemóvel e no «obrigado», o gancho próprio do script e a sessão na política de cookies', () => {
  const pasta = copia('conta');
  const r = construir(pasta);
  assert.equal(r.codigo, 0, r.saida);
  const conta = fs.readFileSync(path.join(pasta, '_site/conta/index.html'), 'utf8');
  assert.match(conta, /<meta name="robots" content="noindex/);
  assert.match(conta, /<title>A minha conta \| LF Mobile<\/title>/);
  assert.match(conta, /<div class="contentor conta" data-area-cliente /);
  assert.match(conta, /<input id="conta-codigo"[^>]*inputmode="numeric" autocomplete="one-time-code"/);
  assert.match(conta, /<input id="conta-email"[^>]*type="email" autocomplete="email"/);
  // [data-conta] é o número do carrinho no cabeçalho (carrinho.js, desenharConta, que lhe troca o texto): a página da
  // conta não o pode usar, senão os dois scripts apanham o elemento um do outro (13 nov 2026)
  assert.doesNotMatch(conta.replace(/<header[\s\S]*?<\/header>/, ''), /data-conta[\s>]/);
  assert.match(fs.readFileSync(path.join(RAIZ, 'src/scripts/conta.js'), 'utf8'), /querySelector\('\[data-area-cliente\]'\)/);
  const index = fs.readFileSync(path.join(pasta, '_site/index.html'), 'utf8');
  assert.match(index, /<a class="topo__botao topo__pessoa" href="\/conta\/"><svg[^>]*>[\s\S]*?<\/svg><span class="visualmente-escondido">A minha conta<\/span><\/a>/);
  assert.match(index, /<li><a href="\/conta\/">As minhas encomendas/);
  assert.match(fs.readFileSync(path.join(pasta, '_site/obrigado/index.html'), 'utf8'), /<a class="botao botao--contorno" href="\/conta\/">/);
  assert.ok(!fs.readFileSync(path.join(pasta, '_site/sitemap.xml'), 'utf8').includes('/conta/'));
  // o que a política de cookies promete é o que o site e o Worker usam
  const cookies = fs.readFileSync(path.join(RAIZ, 'content/paginas/politica-de-cookies.md'), 'utf8');
  assert.match(cookies, /«__Host-lf-sessao»/);
  assert.match(cookies, /«lfmobile:conta-codigo»/);
  assert.match(fs.readFileSync(path.join(RAIZ, 'worker/encomendas/conta.js'), 'utf8'), /export const COOKIE = '__Host-lf-sessao';/);
  assert.match(fs.readFileSync(path.join(RAIZ, 'src/scripts/conta.js'), 'utf8'), /const CHAVE = 'lfmobile:conta-codigo';/);
});
teste('uma ligação interna partida pára a construção', () => {
  const pasta = copia('ligacao', (p) => fs.appendFileSync(path.join(p, 'content/paginas/garantia.md'), '\n\n[Ligação partida](/nao-existe/)\n'));
  const r = construir(pasta);
  assert.notEqual(r.codigo, 0);
  assert.match(r.saida, /nao-existe/);
});

// o Worker do site (worker/www.js) passa /conta/api/… ao Worker das encomendas, pela service binding do wrangler.jsonc
{
  const nome = 'o Worker do site passa /conta/api/… ao Worker das encomendas (o cookie vai e vem) e diz 503 sem a ligação; o resto são os ficheiros';
  try {
    const { default: www } = await import('../worker/www.js');
    const pedidos = [];
    const env = {
      ASSETS: { fetch: async () => new Response('ficheiro') },
      ENCOMENDAS: { fetch: async (r) => { pedidos.push(r); return new Response('{"ok":true}', { headers: { 'set-cookie': '__Host-lf-sessao=x; Path=/; HttpOnly; Secure; SameSite=Lax' } }); } },
    };
    const r1 = await www.fetch(new Request('https://lfmobile.pt/conta/api/eu', { headers: { cookie: '__Host-lf-sessao=abc' } }), env);
    assert.equal(await r1.text(), '{"ok":true}');
    assert.match(r1.headers.get('set-cookie'), /^__Host-lf-sessao=x; Path=\//);
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0].headers.get('cookie'), '__Host-lf-sessao=abc');
    assert.equal(await (await www.fetch(new Request('https://lfmobile.pt/conta/'), env)).text(), 'ficheiro', 'a página da conta é um ficheiro do site');
    assert.equal(pedidos.length, 1);
    assert.equal((await www.fetch(new Request('https://lfmobile.pt/conta/api/eu'), { ASSETS: env.ASSETS })).status, 503);
    assert.equal((await www.fetch(new Request('https://www.lfmobile.pt/conta/api/eu'), env)).status, 301, 'o www vai primeiro para o domínio');
    const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
    assert.deepEqual(cfg.services, [{ binding: 'ENCOMENDAS', service: 'lfmobile-encomendas' }]);
    feitos++;
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    console.error(`  ✗ ${nome}\n${e.stack}`);
    process.exitCode = 1;
  }
}

fs.rmSync(temporaria, { recursive: true, force: true });
console.log(process.exitCode ? '\nHá testes a falhar.' : `\n${feitos} testes passaram.`);
