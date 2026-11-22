// PENTE FINO DOS PAGAMENTOS NO SITE, NO BROWSER (18 nov 2026). Não corre na CI: precisa de três servidores locais
// e do Playwright. O checkout com cada método, a página /pagar/, o pagamento (a ifthenpay de faz-de-conta) e a
// encomenda paga; o cartão que volta cancelado, o MB WAY recusado e o «Tentar outra vez» na MESMA encomenda.
//
// 1. A ifthenpay de faz-de-conta:        node scripts/ifthenpay-de-ensaio.mjs 8795
// 2. O Worker das encomendas (na pasta worker/encomendas):
//    wrangler dev --config wrangler.toml --port 8791 --local-protocol https --var ENCOMENDAS_LOCAL:1
//      --var ALLOWED_ORIGINS:https://localhost:8792,http://localhost:8792 --var SITE_URL:https://localhost:8792
//      --var CATALOGO_URL:http://localhost:8795/catalogo.json --var STORE_EMAIL:dono@example.com
//      --var PAINEL_SEGREDO:segredo-local-de-teste --var GOOGLE_CLIENTE:123456789012-ensaiolocal.apps.googleusercontent.com
//      --var IFTHENPAY_API:http://localhost:8795 --var "IFTHENPAY_ACCOUNTS:MBWAY|MBW-111111;MB|MBK-222222;CCARD|CCK-333333"
//      --var IFTHENPAY_BACKOFFICE_KEY:1111-2222-3333-4444 --var IFTHENPAY_ANTIPHISHING_KEY:antiphishing-de-teste-0123456789
//    (as chaves são as de ensaio dos testes do Worker: test/ajuda.mjs, CHAVES)
// 3. O site com os pagamentos ligados: uma cópia do content/ com "pagamentos": { "modo": "online" } no site.json,
//    node scripts/build.mjs --conteudo=<a cópia> --api=https://localhost:8791
//    (as duas em https: o WebKit não deixa uma página https pedir nada a http://localhost)
//    wrangler dev --config wrangler.jsonc --port 8792 --local-protocol https
// 4. PLAYWRIGHT=<pasta do pacote playwright> node scripts/pente-fino-pagamentos.mjs <pasta das capturas> [chromium,webkit]
//    (sem a variável: ~/Websites/carimbo/node_modules/playwright)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';   // o certificado do wrangler dev --local-protocol https
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT || path.join(os.homedir(), 'Websites', 'carimbo', 'node_modules', 'playwright'));

const B = 'https://localhost:8792';
const W = 'https://localhost:8791';
const F = 'http://localhost:8795';
const ANTI = 'antiphishing-de-teste-0123456789';
const S = process.argv[2] || path.join(os.tmpdir(), 'pente-fino-pagamentos');
const MOTORES = (process.argv[3] || 'chromium,webkit').split(',');
const RUN = Date.now().toString(36).slice(-5);
const EMAILS_DIR = path.join(RAIZ, 'worker', 'encomendas', '.wrangler', 'tmp', 'email');
fs.mkdirSync(S, { recursive: true });

const res = [];
let grupoAtual = '';
const grupo = (n) => { grupoAtual = n; console.log(`\n▸ ${n}`); };
function certo(cond, nome, detalhe) {
  res.push({ ok: Boolean(cond), nome: `${grupoAtual} · ${nome}` });
  console.log(`  ${cond ? '✓' : '✗'} ${nome}${cond || detalhe === undefined ? '' : `  — ${JSON.stringify(detalhe).slice(0, 400)}`}`);
  return Boolean(cond);
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* O travão do checkout: 5 por minuto, por IP (aqui, todos do localhost). */
/* O travão do Worker (5 por minuto por IP) conta o /checkout E o /pagar (a página /pagar/ pede o pagamento logo ao
   abrir) e o /cupao: cada encomenda gasta duas vezes. As vezes contam-se pelos pedidos que a página faz (o «request»
   de cada página, mais abaixo); antes de uma encomenda espera-se até haver lugar para as duas (22 nov 2026: só se
   contava o /checkout, e a 3.ª encomenda dentro de um minuto levava 429 e o ensaio parava no «computador»). */
const vezes = [];
const contarVez = (r) => { if (r.method() === 'POST' && /^https:\/\/localhost:8791\/(checkout|pagar|cupao)(\?|$)/.test(r.url())) vezes.push(Date.now()); };
async function vez(precisa = 2) {
  for (;;) {
    while (vezes.length && Date.now() - vezes[0] > 61500) vezes.shift();
    if (vezes.length + precisa <= 5) break;
    const espera = 61500 - (Date.now() - vezes[0]) + 300;
    console.log(`    … o travão do checkout: ${Math.ceil(espera / 1000)} s`);
    await esperar(espera);
  }
}

const json = async (url, init) => { const r = await fetch(url, init); return { estado: r.status, dados: await r.json().catch(() => null) }; };
const encomenda = async (e, c) => (await json(`${W}/encomenda?e=${encodeURIComponent(e)}&c=${encodeURIComponent(c)}`)).dados;
const idDePagamento = (numero) => numero.replace(/^LF-20(\d{6})-/, 'LF$1');
const ifthenpay = async () => (await json(`${F}/_estado`)).dados;
const pagar = (orderId, metodo, cents, requestId) => json(`${F}/_pagar`, { method: 'POST', body: JSON.stringify({ orderId, metodo, cents, requestId }) });
const valor = (cents) => `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const ficheirosDeEmail = () => (fs.existsSync(EMAILS_DIR) ? fs.readdirSync(EMAILS_DIR) : [])
  .flatMap((d) => { const p = path.join(EMAILS_DIR, d, 'email-text'); return fs.existsSync(p) ? fs.readdirSync(p).map((f) => path.join(p, f)) : []; });
async function emailsCom(texto, desde, quantos, ms = 8000) {
  for (const fim = Date.now() + ms; ;) {
    const l = ficheirosDeEmail().filter((f) => fs.statSync(f).mtimeMs > desde).map((f) => fs.readFileSync(f, 'utf8')).filter((t) => t.includes(texto));
    if (l.length >= quantos || Date.now() > fim) return l;
    await esperar(300);
  }
}

/* Uma encomenda até ao botão: o carrinho (um artigo), os dados, o levantamento, o método, os termos. */
async function finalizar(p, { metodo, email }) {
  await vez();
  await p.goto(`${B}/`, { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => localStorage.setItem('lfmobile:carrinho', JSON.stringify({ v: 2, linhas: [{ produto: 'micflip-localizador-passaporte', opcoes: [], qtd: 1 }], zona: 'levantamento', cupao: null })));
  await p.goto(`${B}/checkout/`, { waitUntil: 'load' });
  await p.fill('#c-nome', 'Ana Ensaio');
  await p.fill('#c-email', email);
  await p.fill('#c-telefone', '912345678');
  await p.check('input[name="entrega"][value="levantamento"]');
  await p.check(`input[name="metodo"][value="${metodo}"]`);
  await p.check('input[name="termos"]');
  await p.click('[data-botao-checkout]');
  await p.waitForURL(metodo === 'CCARD' ? /localhost:8795\/cartao\// : /\/pagar\/\?e=/, { timeout: 15000 });
  const u = new URL(metodo === 'CCARD' ? (await ultimoCartao()).successUrl : p.url());
  return { e: u.searchParams.get('e'), c: u.searchParams.get('c') };
}
const ultimoCartao = async () => ((await ifthenpay()).cartoes.at(-1) || [])[1] || {};
const ultimoMbway = async () => ((await ifthenpay()).mbway.at(-1) || [])[0];
const pago = async (p) => { await p.waitForURL(/\/obrigado\/\?e=/, { timeout: 20000 }); await p.waitForFunction(() => /pagamento foi recebido/.test(document.querySelector('[data-obrigado-texto]')?.textContent || ''), null, { timeout: 10000 }); };

for (const motor of MOTORES) {
  console.log(`\n=========== ${motor}`);
  const b = await pw[motor].launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ignoreHTTPSErrors: true, locale: 'pt-PT' });
  const p = await ctx.newPage();
  p.on('request', contarVez);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  const foto = (n) => p.screenshot({ path: path.join(S, `${motor}-${n}.png`), fullPage: false });

  grupo(`${motor}: o checkout com o pagamento no site`);
  await vez();
  await p.goto(`${B}/`, { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => localStorage.setItem('lfmobile:carrinho', JSON.stringify({ v: 2, linhas: [{ produto: 'micflip-localizador-passaporte', opcoes: [], qtd: 1 }], zona: 'levantamento', cupao: null })));
  await p.goto(`${B}/checkout/`, { waitUntil: 'load' });
  const ck = await p.evaluate(() => ({
    metodos: [...document.querySelectorAll('[data-metodo]')].filter((x) => !x.hidden).map((x) => x.dataset.metodo),
    botao: document.querySelector('[data-botao-checkout]').textContent.trim(),
    sem: document.querySelector('[data-sem-metodos]').hidden,
  }));
  certo(ck.metodos.join() === 'MBWAY,MB,CCARD' && ck.sem, 'os três métodos que o Worker tem ligados (GET /metodos), e nenhum aviso', ck);
  certo(/pagar/i.test(ck.botao), `o botão diz que obriga a pagar («${ck.botao}»)`, ck);
  await p.locator('[data-metodos]').scrollIntoViewIfNeeded();
  await foto('1-checkout-metodos');

  grupo(`${motor}: MB WAY, aceite na app`);
  const t1 = Date.now();
  const m = await finalizar(p, { metodo: 'MBWAY', email: `mbway-${RUN}-${motor}@exemplo.pt` });
  await p.waitForSelector('[data-pagar-bloco="mbway"]:not([hidden])', { timeout: 10000 });
  const espera = await p.evaluate(() => ({ valor: document.querySelector('[data-pagar-valor]').textContent, relogio: document.querySelector('[data-pagar-relogio]').textContent, numero: document.querySelector('[data-pagar-numero] strong').textContent }));
  const e1 = await encomenda(m.e, m.c);
  certo(e1?.estado === 'pendente' && e1?.pagamento?.metodo === 'MBWAY' && espera.numero === m.e, 'a encomenda fica «pendente», com o MB WAY pedido', { estado: e1?.estado, pg: e1?.pagamento?.metodo });
  certo(/^[34]:\d\d$/.test(espera.relogio) && /€/.test(espera.valor), `a espera: o valor e o relógio dos 4 minutos (${espera.valor}, ${espera.relogio})`, espera);
  await foto('2-mbway-a-espera');
  const rid = await ultimoMbway();
  await pagar(idDePagamento(m.e), 'MBWAY', e1.total_cents, rid);
  await pago(p);
  const e1b = await encomenda(m.e, m.c);
  certo(e1b?.estado === 'paga', 'aceite na app, a página segue sozinha para «O pagamento foi recebido», e a encomenda fica «paga»', e1b?.estado);
  await foto('3-mbway-pago');
  const mails1 = await emailsCom(m.e, t1, 3);
  certo(mails1.some((t) => /Recebemos o seu pagamento/.test(t)) && mails1.some((t) => /ENCOMENDA PAGA/.test(t)), 'os emails: «Pagamento recebido» ao cliente e «Encomenda paga» ao dono', mails1.length);

  grupo(`${motor}: referência Multibanco, paga e avisada pelo callback`);
  const m2 = await finalizar(p, { metodo: 'MB', email: `mb-${RUN}-${motor}@exemplo.pt` });
  await p.waitForSelector('[data-pagar-bloco="mb"]:not([hidden])', { timeout: 10000 });
  const ref = await p.evaluate(() => ({ entidade: document.querySelector('[data-pagar-entidade]').textContent, referencia: document.querySelector('[data-pagar-referencia]').textContent, valor: document.querySelector('[data-pagar-valor-mb]').textContent }));
  certo(ref.entidade === '12345' && /^\d{3} \d{3} \d{3}$/.test(ref.referencia) && /€/.test(ref.valor), `a referência em grupos de três (${ref.entidade} · ${ref.referencia} · ${ref.valor})`, ref);
  await foto('4-multibanco-referencia');
  const e2 = await encomenda(m2.e, m2.c);
  await pagar(idDePagamento(m2.e), 'MB', e2.total_cents);
  const cb = await fetch(`${W}/ifthenpay/callback?key=${ANTI}&orderId=${idDePagamento(m2.e)}&amount=${valor(e2.total_cents)}&requestId=CB${RUN}`);
  const cbErrado = await fetch(`${W}/ifthenpay/callback?key=outra-chave&orderId=${idDePagamento(m2.e)}&amount=${valor(e2.total_cents)}&requestId=CB${RUN}`);
  certo(cb.status === 200 && (await encomenda(m2.e, m2.c))?.estado === 'paga', 'o callback com a chave anti-phishing: confirmado na ifthenpay, a encomenda fica «paga»', cb.status);
  certo(cbErrado.status === 403, `o callback com outra chave é recusado (HTTP ${cbErrado.status})`, cbErrado.status);
  await p.reload({ waitUntil: 'load' });
  await pago(p);
  certo(true, 'a página da referência, aberta outra vez, segue para «O pagamento foi recebido»');

  grupo(`${motor}: cartão, pago na página segura`);
  const m3 = await finalizar(p, { metodo: 'CCARD', email: `cartao-${RUN}-${motor}@exemplo.pt` });
  certo(/localhost:8795\/cartao\//.test(p.url()), 'o cartão sai do site para a página segura da ifthenpay', p.url());
  await p.click('[data-cartao-pagar]');
  await pago(p);
  certo((await encomenda(m3.e, m3.c))?.estado === 'paga', 'pago, volta ao site e segue para «O pagamento foi recebido»; a encomenda fica «paga»');

  grupo(`${motor}: cartão cancelado, e paga-se com Multibanco na MESMA encomenda`);
  const m4 = await finalizar(p, { metodo: 'CCARD', email: `cancela-${RUN}-${motor}@exemplo.pt` });
  await p.click('[data-cartao-cancelar]');
  await p.waitForURL(/\/pagar\/\?e=/, { timeout: 15000 });
  await p.waitForSelector('[data-pagar-escolha]:not([hidden])', { timeout: 10000 });
  const outros = await p.evaluate(() => [...document.querySelectorAll('[data-pagar-metodo]')].filter((x) => !x.hidden).map((x) => x.dataset.pagarMetodo));
  certo(outros.includes('MB') && outros.includes('MBWAY'), `cancelado, a página oferece as outras formas (${outros.join(', ')})`, outros);
  await foto('5-cartao-cancelado');
  const escolha = p.locator('[data-pagar-escolha]');
  if (!(await escolha.evaluate((d) => d.open))) await p.click('[data-pagar-escolha-titulo]');
  await vez(1); // outro /pagar na mesma encomenda
  await p.click('[data-pagar-metodo="MB"]');
  await p.waitForSelector('[data-pagar-bloco="mb"]:not([hidden])', { timeout: 10000 });
  const e4 = await encomenda(m4.e, m4.c);
  certo(e4?.estado === 'pendente' && e4?.pagamento?.metodo === 'MB' && e4?.encomenda === m4.e, 'a referência sai na MESMA encomenda', { estado: e4?.estado, metodo: e4?.pagamento?.metodo });

  grupo(`${motor}: MB WAY recusado na app`);
  const m5 = await finalizar(p, { metodo: 'MBWAY', email: `recusa-${RUN}-${motor}@exemplo.pt` });
  await p.waitForSelector('[data-pagar-bloco="mbway"]:not([hidden])', { timeout: 10000 });
  await json(`${F}/_mbway`, { method: 'POST', body: JSON.stringify({ requestId: await ultimoMbway(), estado: '020' }) });
  await p.waitForSelector('[data-pagar-bloco="falhou"]:not([hidden])', { timeout: 15000 });
  const falha = await p.evaluate(() => ({ titulo: document.querySelector('[data-pagar-falhou-titulo]').textContent, texto: document.querySelector('[data-pagar-falhou-texto]').textContent, aberta: document.querySelector('[data-pagar-escolha]').open }));
  certo(/recusado/.test(falha.titulo) && /Nada foi cobrado/.test(falha.texto) && falha.aberta, `recusado: «${falha.titulo}», e o «Tentar outra vez» aberto`, falha);
  certo((await encomenda(m5.e, m5.c))?.estado === 'pendente', 'a encomenda continua à espera (pode pagar outra vez)');
  await foto('6-mbway-recusado');

  grupo(`${motor}: computador`);
  await p.setViewportSize({ width: 1280, height: 800 });
  const m6 = await finalizar(p, { metodo: 'MB', email: `computador-${RUN}-${motor}@exemplo.pt` });
  await p.waitForSelector('[data-pagar-bloco="mb"]:not([hidden])', { timeout: 10000 });
  const larg = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  certo(larg && Boolean(m6.e), 'a página da referência a 1280 px, sem nada a sair de lado');
  // a campainha sem pagamento: o callback diz «pago», a ifthenpay não confirma, e nada muda
  const e6 = await encomenda(m6.e, m6.c);
  const falso = await fetch(`${W}/ifthenpay/callback?key=${ANTI}&orderId=${idDePagamento(m6.e)}&amount=${valor(e6.total_cents)}&requestId=FALSO${RUN}`);
  certo(falso.status === 409 && (await encomenda(m6.e, m6.c))?.estado === 'pendente', `um callback sem pagamento na ifthenpay não paga nada (HTTP ${falso.status}, continua «pendente»)`, falso.status);
  await foto('7-multibanco-computador');

  certo(erros.length === 0, 'nenhum erro de JavaScript nas páginas', erros);
  await b.close();
}

const errados = res.filter((x) => !x.ok);
console.log(`\n${res.length - errados.length} certas, ${errados.length} erradas`);
for (const x of errados) console.log(`  ✗ ${x.nome}`);
process.exit(errados.length ? 1 : 0);
