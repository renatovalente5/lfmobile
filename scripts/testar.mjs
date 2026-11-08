#!/usr/bin/env node
// Testes do site (Node, sem browser). Correm no CI antes de cada publicação.
//
//   node scripts/testar.mjs          (precisa da cache das imagens: python3 scripts/imagens.py)
//
// Cada guarda prova-se nos dois sentidos: o site normal passa, e uma cópia estragada de propósito pára
// com a mensagem certa. As cópias fazem-se numa pasta temporária (nunca se mexe no repositório).
// Os testes do Worker das encomendas são dele (worker/encomendas/test/); os do painel são do painel.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as R from '../src/lib/regras.mjs';
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
teste('o conteúdo do repositório não tem problemas que bloqueiem a pré-visualização', () => {
  const dados = {
    site: ler('content/site.json'), inicio: ler('content/inicio.json'), categorias: ler('content/categorias.json'),
    servicos: ler('content/servicos.json'), fotos: ler('content/fotos.json'),
    artigos: Object.fromEntries(fs.readdirSync(path.join(RAIZ, 'content/produtos')).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), ler(`content/produtos/${f}`)])),
    ficheirosFotos: fs.readdirSync(path.join(RAIZ, 'media/fotos')).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)),
    videos: [],
  };
  const lista = R.problemas(dados, { hoje: hojeEmLisboa(), producao: false });
  assert.deepEqual(lista.filter((p) => p.classe === 'bloqueia').map((p) => p.mensagem), []);
  // os lembretes legais existem enquanto os dados não estão preenchidos (é o que a pré-visualização mostra)
  assert.ok(lista.some((p) => p.lembrete), 'faltam os lembretes dos dados legais');
});
teste('um artigo sem nome é escondido do site (neutralizado), não pára a publicação; um são não tem problemas', () => {
  const base = { nome: 'Coisa', categoria: 'acessorios', preco: 10, fotos: ['loja-fachada'] };
  const ctx = { nome: 'coisa', categorias: ler('content/categorias.json'), fotos: ler('content/fotos.json'), videos: [], hoje: hojeEmLisboa() };
  const semNome = R.problemasDoArtigo({ ...base, nome: '' }, ctx);
  assert.ok(semNome.some((p) => p.neutralizacao === 'esconder' || /escondid/i.test(p.mensagem)), JSON.stringify(semNome));
  assert.deepEqual(R.problemasDoArtigo(base, ctx).filter((p) => p.classe === 'bloqueia'), []);
});
teste('markdown e euros', () => {
  assert.match(markdown('## Título\n\nTexto com **negrito**.\n\n- um\n- dois'), /<h2 id="titulo">Título<\/h2>/);
  assert.match(markdown('<script>x</script>'), /&lt;script&gt;/);
  assert.equal(euros(12.5).replace(/\u00a0/g, ' '), '12,50 €');
  assert.equal(euros(300).replace(/\u00a0/g, ' '), '300 €');
});

// ---------------------------------------------------------------- os scripts do browser
console.log('scripts do browser');
for (const f of ['src/scripts/site.js', 'src/scripts/carrinho.js']) {
  teste(`${f} compila`, () => {
    const r = spawnSync(process.execPath, ['--check', path.join(RAIZ, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
}
teste('o carrinho usa a mesma regra de preço das regras (precoDe copiada) e a chave de armazenamento prometida na política de cookies', () => {
  const js = fs.readFileSync(path.join(RAIZ, 'src/scripts/carrinho.js'), 'utf8');
  assert.match(js, /const CHAVE = 'lfmobile:carrinho'/);
  assert.match(fs.readFileSync(path.join(RAIZ, 'content/paginas/politica-de-cookies.md'), 'utf8'), /lfmobile:carrinho/);
  assert.match(js, /p\.precoAnterior > p\.preco && \(!p\.promocaoAte \|\| hoje <= p\.promocaoAte\)/);
  assert.doesNotMatch(js, /obriga[çc][ãa]o de pagar/i);
});

// ---------------------------------------------------------------- construções numa cópia
if (!fs.existsSync(path.join(RAIZ, '.cache', 'imagens', 'manifesto.json'))) {
  console.error('\nFaltam as imagens: corre primeiro «python3 scripts/imagens.py».');
  process.exit(1);
}
const temporaria = fs.mkdtempSync(path.join(os.tmpdir(), 'lfmobile-teste-'));
function copia(nome, mexer = () => {}) {
  const destino = path.join(temporaria, nome);
  fs.cpSync(RAIZ, destino, { recursive: true, filter: (f) => !/\/(\.git|_site|_cliente|node_modules|\.wrangler)(\/|$)/.test(f.slice(RAIZ.length)) });
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
  s.entrega.portes.continente = 4.9;
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
  assert.match(fs.readFileSync(path.join(pasta, '_site/termos-e-condicoes/index.html'), 'utf8'), /por confirmar: o NIF/);
  assert.ok(fs.existsSync(path.join(pasta, '_site/404.html')));
  assert.ok(fs.existsSync(path.join(pasta, '_site/assets/catalogo.json')));
  const cat = JSON.parse(fs.readFileSync(path.join(pasta, '_site/assets/catalogo.json'), 'utf8'));
  assert.equal(cat.v, 2);
  assert.equal(cat.modo, 'encomenda');
  for (const [slug, p] of Object.entries(cat.produtos)) {
    if (p.compravel) assert.equal(typeof p.preco, 'number', `${slug} comprável sem preço`);
    assert.ok(fs.existsSync(path.join(pasta, '_site/produtos', slug, 'index.html')), `${slug} sem ficha`);
  }
  for (const f of todosHtml(pasta)) {
    const html = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(html, /obriga[çc][ãa]o de pagar/i, f);
    assert.match(html, /<html lang="pt-PT">/, f);
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
teste('a produção pára sem os dados legais, e diz quais', () => {
  const pasta = copia('producao-falha');
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
  assert.ok(fs.existsSync(path.join(pasta, '_site/sitemap.xml')));
  for (const f of todosHtml(pasta)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /por confirmar:/, f);
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
teste('uma ligação interna partida pára a construção', () => {
  const pasta = copia('ligacao', (p) => fs.appendFileSync(path.join(p, 'content/paginas/garantia.md'), '\n\n[Ligação partida](/nao-existe/)\n'));
  const r = construir(pasta);
  assert.notEqual(r.codigo, 0);
  assert.match(r.saida, /nao-existe/);
});

fs.rmSync(temporaria, { recursive: true, force: true });
console.log(process.exitCode ? '\nHá testes a falhar.' : `\n${feitos} testes passaram.`);
