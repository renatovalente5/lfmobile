// PENTE FINO DA CONTA DO CLIENTE NO BROWSER (16 nov 2026; 99 provas no Chromium e no WebKit). Não corre na CI: precisa
// dos dois Workers locais e do Playwright. Encomendas novas, para emails novos, a cada corrida; os travões (5 por minuto
// por IP: código, entrar, checkout, desistir, Google) respeitam-se aqui, por isso demora uns 8 minutos por motor.
//
// 1. O Worker das encomendas, primeiro (na pasta worker/encomendas):
//    wrangler dev --config wrangler.toml --port 8791 --var ENCOMENDAS_LOCAL:1
//      --var ALLOWED_ORIGINS:https://localhost:8792,http://localhost:8792,https://lfmobile.pt,http://lfmobile.pt
//      --var SITE_URL:https://localhost:8792 --var CATALOGO_URL:https://lfmobile.pt/assets/catalogo.json
//      --var STORE_EMAIL:dono@example.com --var PAINEL_SEGREDO:segredo-local-de-teste
//      --var GOOGLE_CLIENTE:123456789012-ensaiolocal.apps.googleusercontent.com
// 2. O site, em https (o WebKit não guarda cookies Secure em http://localhost), depois de `node scripts/build.mjs`:
//    wrangler dev --config wrangler.jsonc --port 8792 --local-protocol https
//    (ao reiniciar um dos dois, parar ambos e apagar ~/.wrangler/registry/lfmobile-*: a ligação entre eles fica velha)
// 3. PLAYWRIGHT=<pasta do pacote playwright> JSQR=<jsQR.js do painel> node scripts/pente-fino-conta.mjs <pasta das capturas> [chromium,webkit]
//    (sem as variáveis: ~/Websites/carimbo/node_modules/playwright e ../lfmobile-painel/estatico/js/vendor/jsQR.js)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';   // o certificado do wrangler dev --local-protocol https
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT || path.join(os.homedir(), 'Websites', 'carimbo', 'node_modules', 'playwright'));

const B = 'https://localhost:8792';
const W = 'http://localhost:8791';
const ORIGEM = 'https://localhost:8792';
const SEGREDO = 'segredo-local-de-teste';
const GOOGLE = '123456789012-ensaiolocal.apps.googleusercontent.com';
const S = process.argv[2] || path.join(os.tmpdir(), 'pente-fino-conta');
const MOTORES = (process.argv[3] || 'chromium,webkit').split(',');
const RUN = Date.now().toString(36).slice(-5);
const EMAILS_DIR = path.join(RAIZ, 'worker', 'encomendas', '.wrangler', 'tmp', 'email');   // o send_email local escreve aqui
const JSQR = fs.readFileSync(process.env.JSQR || path.join(RAIZ, '..', 'lfmobile-painel', 'estatico', 'js', 'vendor', 'jsQR.js'), 'utf8');
fs.mkdirSync(S, { recursive: true });

/* ------------------------------------------------------------------ afirmações */
const res = [];
let grupoAtual = '';
const grupo = (n) => { grupoAtual = n; console.log(`\n▸ ${n}`); };
function certo(cond, nome, detalhe) {
  res.push({ ok: Boolean(cond), nome: `${grupoAtual} · ${nome}`, detalhe });
  console.log(`  ${cond ? '✓' : '✗'} ${nome}${cond || detalhe === undefined ? '' : `  — ${JSON.stringify(detalhe).slice(0, 400)}`}`);
  return Boolean(cond);
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ os travões (5 por 60 s, por tipo) */
const janelas = {};
async function vez(tipo) {
  for (;;) {
    janelas[tipo] = (janelas[tipo] || []).filter((t) => Date.now() - t < 61500);
    if (janelas[tipo].length < 5) break;
    const espera = 61500 - (Date.now() - janelas[tipo][0]) + 300;
    console.log(`    … o travão de «${tipo}»: ${Math.ceil(espera / 1000)} s`);
    await esperar(espera);
  }
  janelas[tipo].push(Date.now());
}

/* ------------------------------------------------------------------ os emails que o Worker local guarda */
function ficheirosDeEmail() {
  const out = [];
  if (!fs.existsSync(EMAILS_DIR)) return out;
  for (const d of fs.readdirSync(EMAILS_DIR)) {
    const p = path.join(EMAILS_DIR, d, 'email-text');
    if (!fs.existsSync(p)) continue;
    for (const f of fs.readdirSync(p)) { const c = path.join(p, f); out.push({ f: c, t: fs.statSync(c).mtimeMs }); }
  }
  return out;
}
const emailsDepois = (t) => ficheirosDeEmail().filter((x) => x.t > t).sort((a, b) => a.t - b.t).map((x) => fs.readFileSync(x.f, 'utf8'));
async function codigoDepois(t) {
  for (let i = 0; i < 60; i++) {
    for (const txt of emailsDepois(t).reverse()) { const m = /^ {4}(\d{3}) (\d{3})$/m.exec(txt); if (m) return m[1] + m[2]; }
    await esperar(200);
  }
  throw new Error('o código não chegou');
}

/* ------------------------------------------------------------------ o Worker: encomendas e painel */
const PRECOS = { 'pelicula-hidrogel': 1250, 'fones-p9': 5990, 'micflip-localizador-passaporte': 4690, 'pelicula-vidro-temperado': 490 };
async function encomendar(email, nome, linhas, entrega = 'levantamento') {
  await vez('checkout');
  const artigos = linhas.reduce((s, l) => s + PRECOS[l.produto] * l.qtd, 0);
  const cliente = { nome, email, telefone: '912345678', ...(entrega === 'continente' ? { morada: 'Rua de Ensaio, 1', codigoPostal: '4700-001', localidade: 'Braga' } : {}) };
  const corpo = { linhas: linhas.map((l) => ({ opcoes: [], ...(l.produto.startsWith('pelicula-') ? { modelo: 'iPhone 15' } : {}), ...l })), entrega, cliente, termos: true, total_cents: artigos + (entrega === 'continente' ? 590 : 0) };
  let r = await fetch(`${W}/checkout`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: ORIGEM }, body: JSON.stringify(corpo) });
  if (r.status === 429) { console.log('    … o travão do checkout (de antes): 62 s'); await esperar(62000); janelas.checkout = [Date.now()]; r = await fetch(`${W}/checkout`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: ORIGEM }, body: JSON.stringify(corpo) }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.encomenda) throw new Error(`checkout ${r.status} ${JSON.stringify(j)}`);
  return j.encomenda;
}
async function painel(caminho, corpo) {
  const r = await fetch(`${W}/painel${caminho}`, { method: corpo ? 'POST' : 'GET', headers: { Authorization: `Bearer ${SEGREDO}`, ...(corpo ? { 'content-type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, j: await r.json().catch(() => null) };
}
async function marcar(id, ...estados) {
  for (const e of estados) { const r = await painel(`/encomendas/${id}/estado`, { estado: e, por: 'ensaio@exemplo.pt', ...(e === 'enviada' ? { nota: 'CTT RR000000000PT' } : {}) }); if (r.status !== 200) throw new Error(`estado ${e}: ${r.status} ${JSON.stringify(r.j)}`); }
}
const idDaConta = (conta) => crypto.createHash('sha256').update(`lfmobile-conta:${conta}`).digest('hex');

/* ------------------------------------------------------------------ datas como a página as escreve (Lisboa) */
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function lisboa(d) { const o = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(d).forEach((x) => { o[x.type] = x.value; }); return { dia: Number(o.day), mes: Number(o.month), ano: Number(o.year) }; }
const longa = (d) => { const p = lisboa(d); return `${p.dia} de ${MESES[p.mes - 1]} de ${p.ano}`; };
const curta = (d) => { const p = lisboa(d); return `${p.dia} ${MESES[p.mes - 1].slice(0, 3)} ${p.ano}`; };
function maisMeses(d, meses) { const p = lisboa(d); const alvo = new Date(Date.UTC(p.ano, p.mes - 1 + meses, 1)); const ult = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate(); alvo.setUTCDate(Math.min(p.dia, ult)); return new Date(alvo.getTime() + 12 * 3600e3); }

/* ------------------------------------------------------------------ o browser */
let browser = null;
let motor = '';
const erros = [];
async function contexto({ viewport = { width: 1280, height: 860 }, storageState } = {}) {
  const tel = viewport.width < 768;
  const ctx = await browser.newContext({ viewport, locale: 'pt-PT', timezoneId: 'Europe/Lisbon', ignoreHTTPSErrors: true, ...(tel ? { hasTouch: true, ...(motor === 'chromium' ? { isMobile: true, deviceScaleFactor: 2 } : {}) } : {}), ...(storageState ? { storageState } : {}) });
  await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Google</title><p>Google de ensaio</p>' }));
  const p = await ctx.newPage();
  const quem = `${motor} ${viewport.width}`;
  p.on('pageerror', (e) => erros.push(`${quem}: ${e.message}`));
  p.on('dialog', (d) => { erros.push(`${quem}: dialog ${d.message()}`); d.dismiss().catch(() => {}); });
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource: the server responded with a status of (400|401|404|409|429)/.test(t)) return;
    erros.push(`${quem}: ${t}`);
  });
  return { ctx, p };
}
const largura = (p) => p.evaluate(() => ({ doc: document.documentElement.scrollWidth, janela: innerWidth }));
const cabe = async (p) => { const l = await largura(p); return l.doc <= l.janela; };
const caixa = (p, sel) => p.$eval(sel, (e) => { const x = e.getBoundingClientRect(); return { esq: Math.round(x.left), dir: Math.round(innerWidth - x.right), cima: Math.round(x.top), baixo: Math.round(innerHeight - x.bottom) }; });
const visivel = (p, sel) => p.isVisible(sel).catch(() => false);
const texto = async (p, sel) => ((await p.textContent(sel).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const foto = (p, nome, inteira = false) => p.screenshot({ path: `${S}/${motor}-${nome}.png`, fullPage: inteira }).catch(() => {});

async function irConta(p, q = '') {
  await p.goto(`${B}/conta/${q}`, { waitUntil: 'networkidle' });
  await p.waitForSelector('[data-conta-entrar]:not([hidden]), [data-conta-lista]:not([hidden]), [data-conta-ficha]:not([hidden]), [data-conta-falha]:not([hidden])', { timeout: 15000 });
}
async function pedirCodigoNaPagina(p, email) {
  if (await visivel(p, '[data-conta-form-codigo]')) await p.click('[data-conta-mudar]');
  const t = Date.now() - 300;
  await vez('codigo');
  await p.fill('#conta-email', email);
  await p.click('[data-conta-form-email] button[type="submit"]');
  await p.waitForSelector('[data-conta-form-codigo]:not([hidden]), [data-conta-form-email] [data-conta-erro]:not([hidden])');
  return t;
}
async function entrar(p, email, q = '', colar = (c) => c) {
  await irConta(p, q);
  if (await visivel(p, '[data-conta-lista]')) return;
  const t = await pedirCodigoNaPagina(p, email);
  const codigo = await codigoDepois(t);
  await vez('entrar');
  await p.fill('#conta-codigo', colar(codigo));
  await p.waitForSelector('[data-conta-lista]:not([hidden]), [data-conta-ficha]:not([hidden])', { timeout: 15000 });
  await esperar(250);
}
async function lerQR(ctx, svg) {
  const q = await ctx.newPage();
  await q.setContent('<!doctype html><body></body>');
  await q.addScriptTag({ content: JSQR });
  const lido = await q.evaluate(async (s) => {
    const img = new Image(); img.src = `data:image/svg+xml;base64,${btoa(s)}`; await img.decode();
    const c = document.createElement('canvas'); c.width = 480; c.height = 480; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 480, 480); x.drawImage(img, 0, 0, 480, 480);
    return window.jsQR(x.getImageData(0, 0, 480, 480).data, 480, 480)?.data ?? null;
  }, svg);
  await q.close();
  return lido;
}
async function fecharJanela(p, valor = 'nao') { await p.click(`[data-conta-janela][open] button[value="${valor}"]`); await p.waitForSelector('[data-conta-janela][open]', { state: 'detached' }).catch(() => {}); await esperar(150); }

/* ================================================================== as provas, num motor */
async function correr() {
  const sufixo = `${RUN}${motor[0]}`;
  const A = `pf-a-${sufixo}@exemplo.pt`;
  const Bm = `pf-b-${sufixo}@exemplo.pt`;
  const Cpedido = `pente.fino.${sufixo}@gmail.com`;          // a encomenda, com pontos
  const Centra = `PenteFino.${sufixo.toUpperCase()}+Loja@GMAIL.com`;   // entra assim: a mesma conta
  const Cconta = `pentefino${sufixo}@gmail.com`;
  const D = `pf-d-${sufixo}@exemplo.pt`;
  const E = `pf-e-${sufixo}@exemplo.pt`;
  const Dmais2 = `pf-d-${sufixo}+dois@exemplo.pt`;
  const HOSTIL = '<img src=x onerror="window.__xss=1">Hostil';

  /* -------- as encomendas */
  grupo('preparar as encomendas');
  const O1 = await encomendar(Bm, 'Bruno Pente', [{ produto: 'pelicula-hidrogel', qtd: 2 }]);
  const O2 = await encomendar(Bm, 'Bruno Pente', [{ produto: 'micflip-localizador-passaporte', qtd: 1 }]);
  const O3 = await encomendar(Bm, 'Bruno Pente', [{ produto: 'fones-p9', qtd: 1 }], 'continente');
  const O4 = await encomendar(Bm, 'Bruno Pente', [{ produto: 'pelicula-vidro-temperado', qtd: 1 }]);
  await marcar(O1, 'paga', 'pronta', 'levantada');
  await marcar(O3, 'paga', 'enviada');
  await marcar(O4, 'anulada');
  const O6 = await encomendar(Bm, HOSTIL, [{ produto: 'pelicula-vidro-temperado', qtd: 2 }]);
  const O5 = await encomendar(Cpedido, 'Carla Fino', [{ produto: 'pelicula-hidrogel', qtd: 1 }]);
  await marcar(O5, 'paga');
  const O7 = await encomendar(D, 'Duarte', [{ produto: 'pelicula-vidro-temperado', qtd: 1 }]);
  const O8 = await encomendar(E, 'Eva Apagar', [{ produto: 'pelicula-hidrogel', qtd: 1 }]);
  await marcar(O8, 'paga');
  const entregaO1 = new Date();
  certo(true, `8 encomendas: ${[O1, O2, O3, O4, O6, O5, O7, O8].join(' ')}`);

  /* -------- A: entrar com o código */
  grupo('A · entrar com o código');
  {
    const { ctx, p } = await contexto();
    let pedidosCodigo = 0;
    p.on('request', (q) => { if (q.url().endsWith('/conta/api/codigo')) pedidosCodigo++; });
    await irConta(p);
    certo(await visivel(p, '[data-conta-google-botao]') && await visivel(p, '#conta-email'), 'a entrada: «Continuar com o Google» e o email');
    const atr = await p.evaluate(() => { const e = document.querySelector('#conta-email'); const c = document.querySelector('#conta-codigo'); return { email: [e.type, e.autocomplete], codigo: [c.getAttribute('autocomplete'), c.getAttribute('inputmode')] }; });
    certo(atr.email[0] === 'email' && atr.email[1] === 'email' && atr.codigo[0] === 'one-time-code' && atr.codigo[1] === 'numeric', 'os campos: type=email com autocomplete; o código com one-time-code e teclado numérico', atr);
    await p.fill('#conta-email', 'sem-arroba');
    await p.click('[data-conta-form-email] button[type="submit"]');
    await p.waitForSelector('[data-conta-form-email] [data-conta-erro]:not([hidden])');
    certo(/Escreva um email válido/.test(await texto(p, '[data-conta-form-email] [data-conta-erro]')) && pedidosCodigo === 0 && await p.getAttribute('#conta-email', 'aria-invalid') === 'true', 'um email sem @: a frase, o campo marcado, e nenhum pedido ao Worker');
    await foto(p, 'A1-email-invalido');
    // o email com maiúsculas e espaços
    const t1 = await pedirCodigoNaPagina(p, `  ${A.toUpperCase()}  `);
    certo(await visivel(p, '[data-conta-form-codigo]') && await p.evaluate(() => document.activeElement?.id) === 'conta-codigo', 'o passo do código, com o foco no campo');
    certo((await texto(p, '[data-conta-enviado]')).includes(A.toUpperCase()), 'a frase diz para onde foi o código', await texto(p, '[data-conta-enviado]'));
    const c1 = await codigoDepois(t1);
    await foto(p, 'A2-passo-codigo');
    // o código errado, cinco vezes
    const tentar = async (codigo) => {
      await vez('entrar');
      await p.fill('#conta-codigo', '');
      const [r] = await Promise.all([p.waitForResponse((x) => x.url().endsWith('/conta/api/entrar')), p.fill('#conta-codigo', codigo)]);
      await esperar(250);
      return r.status();
    };
    const errados = [];
    for (let i = 0; i < 5; i++) {
      const st = await tentar(c1 === '000000' ? '111111' : '000000');
      errados.push(`${st} ${await texto(p, '[data-conta-form-codigo] [data-conta-erro]')}`);
    }
    certo(errados.length === 5 && errados.every((x) => /^4\d\d \S/.test(x)), 'cinco códigos errados: cada um é recusado e diz o que se passa', errados);
    certo(/código novo|outro código/i.test(errados[4]) && (await p.inputValue('#conta-codigo')) === '', 'à 5.ª: pede um código novo e limpa o campo', { frase: errados[4], campo: await p.inputValue('#conta-codigo') });
    await foto(p, 'A3-quinta-errada');
    // o código certo já não vale
    const stCerto = await tentar(c1);
    certo(stCerto >= 400 && !(await visivel(p, '[data-conta-lista]')), 'depois das 5 erradas, o código certo já não entra', `${stCerto} ${await texto(p, '[data-conta-form-codigo] [data-conta-erro]')}`);
    // «Enviar outro código»
    const t2 = Date.now() - 300;
    await vez('codigo');
    await p.click('[data-conta-reenviar]');
    const c2 = await codigoDepois(t2);
    certo(await p.isDisabled('[data-conta-reenviar]'), '«Enviar outro código» fica parado uns segundos (não dispara vários emails)');
    // o código antigo não serve para o pedido novo
    if (c1 !== c2) {
      const stVelho = await tentar(c1);
      certo(stVelho >= 400 && !(await visivel(p, '[data-conta-lista]')), 'o código do email anterior não entra no pedido novo', stVelho);
    }
    // o certo, colado como vem no email («123 456»)
    await vez('entrar');
    await p.fill('#conta-codigo', `${c2.slice(0, 3)} ${c2.slice(3)}`);
    await p.waitForSelector('[data-conta-lista]:not([hidden])', { timeout: 15000 });
    certo(true, 'o código certo colado como vem no email («123 456») entra sozinho');
    const ck = (await ctx.cookies()).find((c) => c.name === '__Host-lf-sessao');
    const dias = ck ? (ck.expires * 1000 - Date.now()) / 86400e3 : 0;
    certo(ck && ck.httpOnly && ck.secure && ck.sameSite === 'Lax' && ck.path === '/' && !ck.domain.startsWith('.') && dias > 29 && dias < 31, 'o cookie: __Host-, HttpOnly, Secure, SameSite=Lax, Path=/, sem Domain, 30 dias', ck && { ...ck, value: '…', dias: dias.toFixed(1) });
    const armaz = await p.evaluate(() => ({ cookie: document.cookie, sinal: localStorage.getItem('lfmobile:conta'), pedido: sessionStorage.getItem('lfmobile:conta-codigo') }));
    certo(!/lf-sessao/.test(armaz.cookie) && armaz.sinal === '1' && armaz.pedido === null, 'o script não vê a sessão; o sinal «entrou» fica; o pedido do código sai', armaz);
    certo(await p.evaluate(() => scrollY === 0 && document.activeElement?.matches?.('h1')), 'a conta abre no topo, com o foco no título');
    certo((await texto(p, '[data-conta-quem]')).toLowerCase() === A, 'a conta é a do email em minúsculas', await texto(p, '[data-conta-quem]'));
    certo(await visivel(p, '[data-conta-vazia]'), 'sem encomendas: a conta diz que ainda não há');
    await foto(p, 'A4-conta-vazia', true);
    await p.click('[data-conta-sair]');
    await p.waitForSelector('[data-conta-entrar]:not([hidden])');
    // dois toques em «Receber o código»: um pedido só
    const t3 = Date.now() - 300;
    pedidosCodigo = 0;
    await vez('codigo');
    await p.fill('#conta-email', A);
    await p.dblclick('[data-conta-form-email] button[type="submit"]');
    await p.waitForSelector('[data-conta-form-codigo]:not([hidden])');
    await esperar(1500);
    certo(pedidosCodigo === 1 && emailsDepois(t3).length === 1, 'dois toques em «Receber o código»: um pedido e um email', { pedidosCodigo, emails: emailsDepois(t3).length });
    // recarregar no passo do código: continua lá
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForSelector('[data-conta-form-codigo]:not([hidden])');
    certo((await texto(p, '[data-conta-enviado]')).includes(A) && !(await visivel(p, '[data-conta-google]')), 'recarregar a página no passo do código: continua no código (a pessoa foi ver o email)');
    await p.click('[data-conta-mudar]');
    certo(await visivel(p, '#conta-email') && await p.evaluate(() => sessionStorage.getItem('lfmobile:conta-codigo')) === null && await visivel(p, '[data-conta-google]'), '«Usar outro email» volta ao início e esquece o pedido');
    // o 4.º código da hora passa; o 5.º não (dois pedidos em menos de 20 s são o mesmo: espera-se)
    await esperar(21000);
    await pedirCodigoNaPagina(p, A);
    certo(await visivel(p, '[data-conta-form-codigo]'), 'o 4.º código da hora ainda vai');
    await p.click('[data-conta-mudar]');
    await esperar(21000);
    await pedirCodigoNaPagina(p, A);
    const travado = await texto(p, '[data-conta-form-email] [data-conta-erro]');
    certo(/vários códigos/i.test(travado) && !(await visivel(p, '[data-conta-form-codigo]')), 'o 5.º na mesma hora: «Já enviámos vários códigos…», e fica no email', travado);
    await foto(p, 'A5-travao-email');
    await ctx.close();
  }

  /* -------- B: a conta com encomendas, duas sessões, sair */
  grupo('B · a conta com encomendas');
  const P1 = await contexto();
  const p1 = P1.p;
  await entrar(p1, Bm);
  {
    const ola = await texto(p1, '[data-conta-ola]');
    const pagina = await p1.evaluate(() => document.querySelector('[data-area-cliente]').innerText);
    certo(ola === 'A minha conta' && !pagina.includes('Hostil') && !pagina.includes('912 345 678'), 'os dados escritos numa encomenda (por quem usou este email) não aparecem na conta: sem nome no «Olá», sem telefone', { ola });
    const cartoes = await p1.$$eval('.conta-encomenda', (as) => as.map((a) => a.innerText.replace(/\s+/g, ' ')));
    certo(cartoes.length === 5 && [O1, O2, O3, O4, O6].every((id) => cartoes.some((c) => c.includes(id))), 'as 5 encomendas do email, nenhuma de outro', cartoes);
    const estados = Object.fromEntries(await p1.$$eval('.conta-encomenda', (as) => as.map((a) => [a.querySelector('strong')?.textContent, a.querySelector('.estado')?.textContent])));
    certo(estados[O1] === 'Levantada' && estados[O2] === 'Recebida' && estados[O3] === 'Enviada' && estados[O4] === 'Anulada', 'os estados como o cliente os lê', estados);
    const casas = await p1.$$eval('.cartao-peliculas__casa--cheia', (x) => x.length);
    certo(casas === 2, 'o cartão: as 2 películas de hidrogel da levantada (a anulada e as por pagar não contam)', casas);
    const gs = await p1.$$eval('[data-conta-garantias-lista] li', (ls) => ls.map((l) => l.innerText.replace(/\s+/g, ' ')));
    const ate36 = curta(maisMeses(entregaO1, 36));
    certo(gs.length === 2 && gs.every((g) => g.includes(`até ${ate36}`)) && gs.some((g) => /Hidrogel/.test(g)) && gs.some((g) => /Fones P9/.test(g)), `as garantias: a levantada e a enviada, até ${ate36} (3 anos)`, gs);
    const sug = await texto(p1, '[data-conta-dados-resumo]');
    certo(/Ainda sem dados/.test(sug) && await texto(p1, '[data-conta-dados-editar]') === 'Preencher', 'os meus dados: vazios até o cliente os gravar («Preencher»)', sug);
    certo(await cabe(p1), 'cabe na largura (computador)');
    await foto(p1, 'B1-conta', true);
  }
  grupo('B · a ficha: garantias e desistir');
  {
    await irConta(p1, `?e=${O1}`);
    await p1.waitForSelector('[data-conta-ficha]:not([hidden])');
    const g = await p1.$$eval('.conta__garantia', (x) => x.map((e) => e.textContent));
    certo(g.join() === `Garantia até ${longa(maisMeses(entregaO1, 36))}`, 'a levantada: «Garantia até …» (3 anos da entrega)', g);
    const prazo = await texto(p1, '[data-conta-desistir]');
    const ate14 = longa(new Date(entregaO1.getTime() + 14 * 86400e3));
    certo(prazo.includes(`Pode desistir até ${ate14}.`) && await visivel(p1, '[data-conta-desistir-botao]'), `pode desistir até ${ate14} (14 dias)`, prazo);
    let pedidosDes = 0;
    p1.on('request', (q) => { if (q.url().endsWith('/conta/api/desistir')) pedidosDes++; });
    // pelo teclado (no Safari um clique não dá o foco ao botão, e então não há para onde o devolver)
    await p1.focus('[data-conta-desistir-botao]');
    await p1.keyboard.press('Enter');
    await p1.waitForSelector('[data-conta-janela][open] #desistir-nota');
    const cx = await caixa(p1, '[data-conta-janela][open]');
    certo(Math.abs(cx.esq - cx.dir) <= 2 && Math.abs(cx.cima - cx.baixo) <= 2, 'a janela no meio do ecrã', cx);
    await p1.keyboard.press('Escape');
    await esperar(300);
    certo(pedidosDes === 0 && !(await visivel(p1, '[data-conta-janela][open]')) && await p1.evaluate(() => document.activeElement?.matches?.('[data-conta-desistir-botao]')), 'Escape fecha sem pedir nada, e o foco volta ao botão');
    await p1.click('[data-conta-desistir-botao]');
    await p1.waitForSelector('[data-conta-janela][open] #desistir-nota');
    await fecharJanela(p1, 'nao');
    certo(pedidosDes === 0, '«Cancelar» não pede nada');
    await p1.click('[data-conta-desistir-botao]');
    await p1.waitForSelector('[data-conta-janela][open] #desistir-nota');
    await p1.fill('#desistir-nota', 'Mudei de ideias <b>já</b>');
    const t = Date.now() - 300;
    await vez('desistir');
    await fecharJanela(p1, 'sim');
    await p1.waitForSelector('.conta__desistir--pedido');
    const depois = await texto(p1, '[data-conta-desistir]');
    certo(/Pediu para desistir a \d+ de \w+ de \d{4}\./.test(depois) && pedidosDes === 1, 'confirmado: «Pediu para desistir a …», um pedido só', depois);
    let novos = [];
    for (let i = 0; i < 30 && novos.length < 2; i++) { novos = emailsDepois(t); if (novos.length < 2) await esperar(200); }
    const aoCliente = novos.find((x) => /Recebemos o seu pedido para desistir/.test(x));
    const aLoja = novos.find((x) => /O CLIENTE PEDIU PARA DESISTIR/.test(x));
    certo(aoCliente && /, às \d{2}:\d{2}\./.test(aoCliente) && /Escreveu: «Mudei de ideias <b>já<\/b>»/.test(aoCliente) && aLoja && /Mudei de ideias/.test(aLoja) && !/anule a encomenda/.test(aLoja), 'os dois emails: o recibo com a hora e o que escreveu; o da loja sem «anule» (levantada)', novos.map((x) => x.slice(0, 200)));
    await foto(p1, 'B2-desistiu', true);
    await p1.reload({ waitUntil: 'networkidle' });
    await p1.waitForSelector('.conta__desistir--pedido');
    const g2 = await p1.$$eval('.conta__garantia', (x) => x.map((e) => e.textContent));
    certo(g2.join() === g.join(), 'depois do pedido, a garantia não muda de data (conta da entrega)', { antes: g, depois: g2 });
    const fichaPainel = await painel(`/encomendas/${O1}`);
    certo(fichaPainel.j?.estado === 'levantada' && fichaPainel.j?.desistencias?.length === 1, 'no Worker: o pedido fica na encomenda e o estado não muda', fichaPainel.j && { estado: fichaPainel.j.estado, desistencias: fichaPainel.j.desistencias });
    // a registada, a enviada, a anulada
    await irConta(p1, `?e=${O2}`);
    certo((await texto(p1, '[data-conta-desistir]')).includes('Pode desistir até 14 dias depois de receber a encomenda.') && (await p1.$$('.conta__garantia')).length === 0, 'a registada: pode desistir (antes de receber) e não tem garantia a contar');
    await irConta(p1, `?e=${O3}`);
    const ate21 = longa(new Date(Date.now() + 21 * 86400e3));
    certo((await texto(p1, '[data-conta-desistir]')).includes(`Pode desistir até ${ate21}.`) && (await p1.$$('.conta__garantia')).length === 1, `a enviada: até ${ate21} (mais uma semana) e com garantia`, await texto(p1, '[data-conta-desistir]'));
    await irConta(p1, `?e=${O4}`);
    certo(!(await p1.$('[data-conta-desistir]')) && (await p1.$$('.conta__garantia')).length === 0, 'a anulada: sem desistir e sem garantia');
    // a de outra pessoa, e um número que não existe
    for (const [q, n] of [[`?e=${O5}`, 'de outra pessoa'], ['?e=LF-20261116-XXXXXX', 'que não existe'], ['?e=lixo<script>', 'com lixo']]) {
      await irConta(p1, q);
      const f = await texto(p1, '[data-conta-falha]');
      certo(/Não encontrámos esta encomenda na sua conta/.test(f) && !(await visivel(p1, '[data-conta-ficha]')), `a encomenda ${n}: «Não encontrámos…»`, f);
    }
    const api = await p1.evaluate(async (o) => ({ outra: (await fetch(`/conta/api/encomenda?e=${o}`)).status, desistir: (await fetch('/conta/api/desistir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ e: o }) })).status }), O5);
    certo(api.outra === 404 && api.desistir === 404, 'pela API: a encomenda de outra pessoa não se lê nem se desiste (404)', api);
  }
  grupo('B · os meus dados e o checkout');
  {
    await irConta(p1);
    await p1.click('[data-conta-dados-editar]');
    await p1.waitForSelector('[data-conta-dados-form]:not([hidden])');
    certo(await p1.evaluate(() => document.activeElement?.name) === 'nome', 'editar: o foco no nome');
    const f = (n) => `[data-conta-dados-form] [name="${n}"]`;
    const gravar = async () => { await p1.click('[data-conta-dados-form] button[type="submit"]'); await esperar(700); };
    certo((await p1.inputValue(f('nome'))) === '' && (await p1.inputValue(f('telefone'))) === '', 'o formulário abre vazio (nada vem das encomendas)');
    // um nome com HTML: grava-se e mostra-se como texto
    await p1.fill(f('nome'), HOSTIL);
    await gravar();
    await p1.waitForSelector('[data-conta-dados-form]', { state: 'hidden' });
    await p1.reload({ waitUntil: 'networkidle' });
    await p1.waitForSelector('[data-conta-lista]:not([hidden])');
    certo(await texto(p1, '[data-conta-ola]') === 'Olá, <img' && (await texto(p1, '[data-conta-dados-resumo]')).includes('<img src=x') && !(await p1.evaluate(() => window.__xss === 1 || Boolean(document.querySelector('[data-area-cliente] img[src="x"]')))),
      'um nome gravado com HTML aparece como texto («Olá, <img»), sem correr nada', await texto(p1, '[data-conta-ola]'));
    await p1.click('[data-conta-dados-editar]');
    await p1.waitForSelector('[data-conta-dados-form]:not([hidden])');
    await p1.fill(f('nome'), 'Bruno <b>Pente</b> Fino');
    await p1.fill(f('telefone'), '123');
    await gravar();
    certo(/telemóvel/i.test(await texto(p1, '[data-conta-dados-erro]')) && await p1.evaluate(() => document.activeElement?.name) === 'telefone', 'um telemóvel curto: a frase e o foco no campo', await texto(p1, '[data-conta-dados-erro]'));
    await p1.fill(f('telefone'), '+351 912 345 678');
    await p1.fill(f('codigoPostal'), '4700');
    await gravar();
    certo(/0000-000/.test(await texto(p1, '[data-conta-dados-erro]')) && await p1.evaluate(() => document.activeElement?.name) === 'codigoPostal', 'um código postal incompleto: a frase e o foco', await texto(p1, '[data-conta-dados-erro]'));
    await p1.fill(f('codigoPostal'), '4700-123');
    await p1.fill(f('nif'), '123456780');
    await gravar();
    certo(/NIF/.test(await texto(p1, '[data-conta-dados-erro]')), 'um NIF errado: a frase');
    await p1.fill(f('nif'), '123 456 789');
    await p1.fill(f('morada'), 'Rua do Pente, 1');
    await p1.fill(f('localidade'), 'Braga');
    await gravar();
    await p1.waitForSelector('[data-conta-dados-form]', { state: 'hidden' });
    const resumo = await texto(p1, '[data-conta-dados-resumo]');
    certo(resumo.includes('Bruno <b>Pente</b> Fino') && resumo.includes('123456789') && resumo.includes('4700-123 Braga'), 'gravados: o resumo com o HTML como texto e o NIF sem espaços', resumo);
    await p1.reload({ waitUntil: 'networkidle' });
    await p1.waitForSelector('[data-conta-lista]:not([hidden])');
    certo(await texto(p1, '[data-conta-ola]') === 'Olá, Bruno', 'o «Olá» passa a usar o nome gravado', await texto(p1, '[data-conta-ola]'));
    // o checkout: só os campos vazios (escreve-se o nome antes de os dados chegarem)
    await p1.evaluate(() => localStorage.setItem('lfmobile:carrinho', JSON.stringify({ v: 2, linhas: [{ produto: 'micflip-localizador-passaporte', opcoes: [], qtd: 1 }], zona: 'levantamento', cupao: null })));
    let solta = null;
    const atrasado = new Promise((r) => { solta = r; });
    await p1.route('**/conta/api/dados', async (route) => { await atrasado; await route.continue(); });
    await p1.goto(`${B}/checkout/`, { waitUntil: 'domcontentloaded' });
    await p1.waitForSelector('form[data-checkout] [name="nome"]', { state: 'visible' });
    await p1.fill('form[data-checkout] [name="nome"]', 'Escrito à mão');
    solta();
    await p1.waitForSelector('[data-checkout-conta]:not([hidden])', { timeout: 10000 }).catch(() => {});
    await p1.unroute('**/conta/api/dados');
    const ck = await p1.evaluate(() => { const fm = document.querySelector('form[data-checkout]'); return Object.fromEntries(['nome', 'email', 'telefone', 'nif'].map((k) => [k, fm.elements[k].value])); });
    certo(ck.nome === 'Escrito à mão' && ck.email === Bm && ck.telefone === '+351 912 345 678' && ck.nif === '123456789' && await visivel(p1, '[data-checkout-conta]'), 'o checkout: o que já estava escrito fica; os outros vêm da conta; a nota diz de onde', ck);
    await foto(p1, 'B3-checkout', true);
    // gravar tudo vazio
    await irConta(p1);
    await p1.click('[data-conta-dados-editar]');
    for (const n of ['nome', 'telefone', 'nif', 'morada', 'codigoPostal', 'localidade']) await p1.fill(f(n), '');
    await gravar();
    await p1.waitForSelector('[data-conta-dados-form]', { state: 'hidden' }).catch(() => {});
    const vazio = await texto(p1, '[data-conta-dados-resumo]');
    const botaoDados = await texto(p1, '[data-conta-dados-editar]');
    const apiDados = await p1.evaluate(() => fetch('/conta/api/dados').then((r) => r.json()));
    certo(/Ainda sem dados/.test(vazio) && botaoDados === 'Preencher' && apiDados.dados === null, 'gravar tudo vazio: a conta fica sem dados («Ainda sem dados», «Preencher»), não uma caixa vazia', { vazio, botaoDados, apiDados });
    await foto(p1, 'B4-dados-vazios', true);
  }
  grupo('B · duas sessões, o código QR, sair e sair em todos');
  {
    const P2 = await contexto({ viewport: { width: 375, height: 812 } });
    const p2 = P2.p;
    await entrar(p2, Bm);
    certo(await cabe(p2), 'telemóvel 375: a conta cabe');
    await p2.focus('[data-conta-mostrar-codigo]');
    await p2.keyboard.press('Enter');
    await p2.waitForFunction(() => { const i = document.querySelector('[data-conta-janela][open] img.conta-janela__qr'); return i && i.complete && i.naturalWidth > 0; });
    const cx = await caixa(p2, '[data-conta-janela][open]');
    certo(cx.esq >= 16 && Math.abs(cx.esq - cx.dir) <= 2, 'telemóvel: a janela do código ao centro, com margem', cx);
    await foto(p2, 'B5-codigo-telemovel');
    const svg = await p2.evaluate(() => fetch('/conta/api/cartao.svg').then((r) => r.text()));
    const lido = await lerQR(P2.ctx, svg);
    certo(lido === `https://backoffice.lfmobile.pt/#/cartoes?conta=${idDaConta(Bm)}`, 'o código lê-se: o endereço do cartão no painel com o id desta conta', lido);
    const noPainel = await painel(`/cartoes?conta=${idDaConta(Bm)}`);
    certo(noPainel.status === 200 && noPainel.j?.email === Bm && noPainel.j?.cartao?.site === 2, 'o painel abre o cartão por esse id (2 do site)', noPainel);
    await p2.keyboard.press('Escape');
    await esperar(300);
    certo(await p2.evaluate(() => document.activeElement?.matches?.('[data-conta-mostrar-codigo]')), 'fechar a janela (teclado) devolve o foco a «Mostrar o código»');
    // a ficha e de volta à lista (a página pode vir da memória do browser), e sair
    await p2.click(`.conta-encomenda[href*="${O1}"]`);
    await p2.waitForSelector('[data-conta-ficha]:not([hidden])');
    await p2.goBack({ waitUntil: 'networkidle' });
    await p2.waitForSelector('[data-conta-lista]:not([hidden])');
    // sair num aparelho não tira o outro
    await p2.click('[data-conta-sair]');
    await p2.waitForSelector('[data-conta-entrar]:not([hidden])');
    const depoisDeSair = { p2: await p2.evaluate(async () => ({ eu: (await fetch('/conta/api/eu')).status, sinal: localStorage.getItem('lfmobile:conta') })), p1: await p1.evaluate(async () => (await fetch('/conta/api/eu')).status) };
    certo(depoisDeSair.p2.eu === 401 && depoisDeSair.p2.sinal === null && depoisDeSair.p1 === 200, '«Sair» no telemóvel: ele fica de fora (e esquece o sinal); o computador continua dentro', depoisDeSair);
    await p2.goForward({ waitUntil: 'networkidle' }).catch(() => {});
    await p2.waitForTimeout(1000);
    certo(new URL(p2.url()).searchParams.get('e') === O1 && !(await visivel(p2, '[data-conta-ficha]')) && await visivel(p2, '[data-conta-entrar]'), 'depois de sair, «avançar» para a ficha (guardada pelo browser) não a mostra: pede para entrar', p2.url());
    // checkout de quem saiu: não pede os dados
    let pediuDados = 0;
    const pendentes = new Map();
    p2.on('request', (q) => { if (q.url().includes('/conta/api/dados')) pediuDados++; pendentes.set(q, `${q.method()} ${q.url()}`); });
    p2.on('requestfinished', (q) => pendentes.delete(q));
    p2.on('requestfailed', (q) => pendentes.delete(q));
    await p2.goto(`${B}/checkout/`, { waitUntil: 'load' });
    await esperar(2500);
    certo(pendentes.size === 0, 'o checkout não deixa pedidos pendurados', [...pendentes.values()]);
    certo(pediuDados === 0, 'o checkout de quem saiu não pede nada à conta');
    // de novo dentro; sair em todos (no computador) tira o telemóvel
    await entrar(p2, Bm);
    await p1.reload({ waitUntil: 'networkidle' });
    await p1.waitForSelector('[data-conta-lista]:not([hidden])');
    await p1.click('[data-conta-sair-todos]');
    await p1.waitForSelector('[data-conta-janela][open]');
    await foto(p1, 'B6-sair-todos-janela');
    await fecharJanela(p1, 'sim');
    await p1.waitForSelector('[data-conta-entrar]:not([hidden])');
    await p2.click(`.conta-encomenda[href*="${O1}"]`);
    await p2.waitForSelector('[data-conta-entrar]:not([hidden])', { timeout: 15000 });
    certo(new URL(p2.url()).searchParams.get('e') === O1, 'sair em todos: o telemóvel, ao abrir uma encomenda, vai para a entrada (e o endereço guarda a encomenda)', p2.url());
    // o sinal velho no checkout: 401, e esquece-o
    await p2.evaluate(() => localStorage.setItem('lfmobile:conta', '1'));
    await p2.goto(`${B}/checkout/`, { waitUntil: 'load' });
    await esperar(1500);
    certo(await p2.evaluate(() => localStorage.getItem('lfmobile:conta')) === null, 'um sinal velho no checkout: o 401 apaga-o, sem erro na página');
    await P2.ctx.close();
  }
  await P1.ctx.close();

  /* -------- C: o Gmail escrito de outra maneira; a sessão que acaba a meio */
  grupo('C · Gmail com pontos, maiúsculas e +etiqueta');
  {
    const { ctx, p } = await contexto({ viewport: { width: 390, height: 844 } });
    await entrar(p, Centra);
    const lista = await p.$$eval('.conta-encomenda', (as) => as.map((a) => a.querySelector('strong')?.textContent));
    certo(lista.length === 1 && lista[0] === O5, `entrar como «${Centra}» mostra a encomenda feita como «${Cpedido}»`, lista);
    certo(await p.$$eval('.cartao-peliculas__casa--cheia', (x) => x.length) === 1, 'e o cartão conta a película paga');
    const svg = await p.evaluate(() => fetch('/conta/api/cartao.svg').then((r) => r.text()));
    certo(await lerQR(ctx, svg) === `https://backoffice.lfmobile.pt/#/cartoes?conta=${idDaConta(Cconta)}`, 'o código leva o id da conta do Gmail sem pontos nem etiqueta');
    // a sessão acaba a meio (noutro aparelho, ou passou o prazo): gravar os dados leva à entrada, sem ficar presa
    await ctx.clearCookies();
    await p.click('[data-conta-dados-editar]');
    await p.fill('[data-conta-dados-form] [name="nome"]', 'Carla');
    await p.click('[data-conta-dados-form] button[type="submit"]');
    await p.waitForSelector('[data-conta-entrar]:not([hidden])', { timeout: 10000 }).catch(() => {});
    certo(await visivel(p, '[data-conta-entrar]') && !(await visivel(p, '[data-conta-lista]')) && await visivel(p, '#conta-email') && !(await visivel(p, '[data-conta-form-codigo]')), 'sessão acabada a meio: «Gravar» leva à entrada, no email (não fica o código antigo nem a rodar)');
    await foto(p, 'C1-sessao-acabou');
    certo(await cabe(p), 'telemóvel 390: a entrada cabe');
    await ctx.close();
  }
  grupo('D · fora do Gmail, o +etiqueta é outra conta');
  {
    const { ctx, p } = await contexto();
    const Dmais = D.replace('@', '+x@');
    await entrar(p, Dmais, '', (c) => `${c}${c}`);   // o código em dobro, como o iPhone às vezes o mete
    certo(await visivel(p, '[data-conta-lista]'), 'o código metido em dobro («123456123456») entra');
    certo(await visivel(p, '[data-conta-vazia]') && (await p.$$('.conta-encomenda')).length === 0, `«${Dmais}» não vê as encomendas de «${D}»`);
    await ctx.close();
  }

  /* -------- E: apagar a conta */
  grupo('E · apagar a conta');
  {
    const { ctx, p } = await contexto();
    await entrar(p, E);
    await p.click('[data-conta-dados-editar]');
    await p.fill('[data-conta-dados-form] [name="nome"]', 'Eva Gravada');
    await p.click('[data-conta-dados-form] button[type="submit"]');
    await p.waitForSelector('[data-conta-dados-form]', { state: 'hidden' });
    const m = await painel('/cartoes/carimbo', { email: E, n: 2, por: 'ensaio@exemplo.pt' });
    certo(m.status === 200 && m.j?.cartao?.total === 3, 'a loja marca 2 (o cartão fica com 3: 1 do site + 2 da loja)', m.j?.cartao);
    let pedidosApagar = 0;
    p.on('request', (q) => { if (q.url().endsWith('/conta/api/apagar')) pedidosApagar++; });
    await p.click('[data-conta-apagar]');
    await p.waitForSelector('[data-conta-janela][open]');
    const txt = await texto(p, '[data-conta-janela][open]');
    certo(/películas marcadas na loja/.test(txt) && /Ficam as encomendas/.test(txt) && /ofertas já entregues/.test(txt), 'a janela diz o que se perde e o que fica', txt);
    await fecharJanela(p, 'nao');
    certo(pedidosApagar === 0 && (await p.evaluate(() => fetch('/conta/api/eu').then((r) => r.status))) === 200, '«Cancelar» não apaga');
    await p.click('[data-conta-apagar]');
    await p.waitForSelector('[data-conta-janela][open]');
    await fecharJanela(p, 'sim');
    await p.waitForSelector('[data-conta-entrar]:not([hidden])');
    const porId = await painel(`/cartoes?conta=${idDaConta(E)}`);
    const porEmail = await painel(`/cartoes?email=${encodeURIComponent(E)}`);
    certo(porId.status === 404 && porEmail.j?.cartao?.loja === 0 && porEmail.j?.cartao?.site === 1, 'apagada: o código já não abre nada; as da loja foram-se; a do site conta da encomenda', { porId: porId.status, cartao: porEmail.j?.cartao });
    await entrar(p, E);
    const resumo = await texto(p, '[data-conta-dados-resumo]');
    const lista = await p.$$eval('.conta-encomenda', (as) => as.map((a) => a.querySelector('strong')?.textContent));
    certo(!resumo.includes('Eva Gravada') && lista.join() === O8 && await p.$$eval('.cartao-peliculas__casa--cheia', (x) => x.length) === 1, 'entrar outra vez: conta nova (sem os dados gravados), a encomenda continua, o cartão só com a do site', { resumo, lista });
    await ctx.close();
  }

  /* -------- G: a volta do Google */
  grupo('G · entrar com o Google (a volta, sem o Google verdadeiro)');
  {
    const { ctx, p } = await contexto();
    let posts = 0;
    p.on('request', (q) => { if (q.url().endsWith('/conta/api/google') && q.method() === 'POST') posts++; });
    await irConta(p, `?e=${O1}`);
    certo(await visivel(p, '[data-conta-google-botao]'), 'numa ficha, sem sessão: a entrada com o Google aparece');
    await vez('google-inicio');
    await Promise.all([p.waitForURL(/accounts\.google\.com/), p.click('[data-conta-google-botao]')]);
    const u = new URL(p.url());
    const g = Object.fromEntries(u.searchParams);
    certo(g.client_id === GOOGLE && g.redirect_uri === `${B}/conta/` && g.response_type === 'id_token' && g.scope === 'openid email' && g.prompt === 'select_account' && g.state?.length >= 20 && /^[0-9a-f]{64}$/.test(g.nonce || '') && !g.response_mode, 'o pedido ao Google: o cliente, o regresso, id_token, openid email, o state deste separador e o nonce do bilhete', g);
    const bilhete = (await ctx.cookies()).find((c) => c.name === '__Host-lf-google');
    certo(bilhete && bilhete.httpOnly && bilhete.secure && bilhete.sameSite === 'Lax' && bilhete.path === '/' && (bilhete.expires * 1000 - Date.now()) < 16 * 60 * 1000, 'o bilhete: um cookie __Host-, HttpOnly, de 15 minutos', bilhete && { ...bilhete, value: '…' });
    await vez('google');
    await p.goto(`${B}/conta/#id_token=aaa.bbb.ccc&state=${encodeURIComponent(g.state)}`, { waitUntil: 'networkidle' });
    await p.waitForSelector('[data-conta-google-erro]:not([hidden])');
    certo(posts === 1 && /Não conseguimos entrar com o Google/.test(await texto(p, '[data-conta-google-erro]')) && new URL(p.url()).search === `?e=${O1}` && !p.url().includes('#') && await p.evaluate(() => sessionStorage.getItem('lfmobile:conta-google')) === null,
      'um token que o Worker recusa: a frase; volta à ficha de onde se partiu; o token sai do endereço e o state é esquecido', { posts, url: p.url() });
    certo(!(await ctx.cookies()).some((c) => c.name === '__Host-lf-google'), 'e o bilhete sai (serve uma vez)');
    // outro state
    await vez('google-inicio');
    await Promise.all([p.waitForURL(/accounts\.google\.com/), p.click('[data-conta-google-botao]')]);
    await p.goto(`${B}/conta/#id_token=aaa.bbb.ccc&state=um-state-que-nao-e-meu`, { waitUntil: 'networkidle' });
    await p.waitForSelector('[data-conta-google-erro]:not([hidden])');
    certo(posts === 1 && /não se concluiu/.test(await texto(p, '[data-conta-google-erro]')), 'um state que não é deste separador: «não se concluiu», sem ir ao Worker');
    // passou o prazo (15 min)
    await vez('google-inicio');
    await Promise.all([p.waitForURL(/accounts\.google\.com/), p.click('[data-conta-google-botao]')]);
    const g3 = Object.fromEntries(new URL(p.url()).searchParams);
    await p.goto(`${B}/conta/`, { waitUntil: 'networkidle' });
    await p.evaluate(() => { const v = JSON.parse(sessionStorage.getItem('lfmobile:conta-google')); v.em -= 16 * 60 * 1000; sessionStorage.setItem('lfmobile:conta-google', JSON.stringify(v)); });
    await p.goto('about:blank');   // a volta do Google é uma página nova (de /conta/ para /conta/#… seria um salto na mesma página)
    await p.goto(`${B}/conta/#id_token=aaa.bbb.ccc&state=${encodeURIComponent(g3.state)}`, { waitUntil: 'networkidle' });
    await p.waitForSelector('[data-conta-google-erro]:not([hidden])');
    certo(posts === 1 && /não se concluiu/.test(await texto(p, '[data-conta-google-erro]')), 'uma volta 16 minutos depois: «não se concluiu», sem ir ao Worker');
    // cancelar no Google; e um erro do Google
    await vez('google-inicio');
    await Promise.all([p.waitForURL(/accounts\.google\.com/), p.click('[data-conta-google-botao]')]);
    await p.goto(`${B}/conta/#error=access_denied&state=x`, { waitUntil: 'networkidle' });
    await esperar(400);
    certo(posts === 1 && !(await visivel(p, '[data-conta-google-erro]')) && !p.url().includes('#'), 'cancelar no Google: volta sem frase e sem o erro no endereço');
    await vez('google-inicio');
    await Promise.all([p.waitForURL(/accounts\.google\.com/), p.click('[data-conta-google-botao]')]);
    await p.goto(`${B}/conta/#error=server_error&state=x`, { waitUntil: 'networkidle' });
    await p.waitForSelector('[data-conta-google-erro]:not([hidden])');
    certo(posts === 1, 'um erro do Google: diz-se, sem ir ao Worker', await texto(p, '[data-conta-google-erro]'));
    // um token metido noutro browser (sem o pedido dele)
    const outro = await contexto();
    let postsOutro = 0;
    outro.p.on('request', (q) => { if (q.url().endsWith('/conta/api/google')) postsOutro++; });
    await outro.p.goto(`${B}/conta/#id_token=aaa.bbb.ccc&state=qualquer`, { waitUntil: 'networkidle' });
    await outro.p.waitForSelector('[data-conta-google-erro]:not([hidden])');
    certo(postsOutro === 0, 'um token metido num browser que não fez o pedido: não segue para o Worker');
    await outro.ctx.close();
    const evil = await fetch(`${B}/conta/api/google`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://exemplo-mau.pt' }, body: JSON.stringify({ id_token: 'a.b.c', nonce: 'x'.repeat(20) }) }).catch((e) => ({ status: String(e.message) }));
    certo(evil.status === 403, 'o POST do Google vindo de outro site: 403', evil.status);
    await ctx.close();
  }

  /* -------- T: dois separadores, e entrou-se noutra conta no segundo */
  grupo('T · outra conta noutro separador');
  {
    const { ctx, p } = await contexto();
    await entrar(p, D);                       // o separador 1 mostra a conta D
    const p2 = await ctx.newPage();
    p2.on('pageerror', (e) => erros.push(`${motor} sep2: ${e.message}`));
    await p2.goto(`${B}/conta/`, { waitUntil: 'networkidle' });
    await p2.waitForSelector('[data-conta-lista]:not([hidden])');
    await p2.click('[data-conta-sair]');
    await p2.waitForSelector('[data-conta-entrar]:not([hidden])');
    await entrar(p2, Dmais2);                 // e o separador 2 entra noutra conta (o cookie é o mesmo)
    // o separador 1 ainda mostra D: gravar, o código e apagar não podem ir parar à outra
    await p.click('[data-conta-dados-editar]');
    await p.fill('[data-conta-dados-form] [name="nome"]', 'Duarte');
    await p.click('[data-conta-dados-form] button[type="submit"]');
    await p.waitForSelector('[data-conta-dados-erro]:not([hidden])');
    certo(/noutra conta noutro separador/.test(await texto(p, '[data-conta-dados-erro]')), '«Gravar» no separador velho: «Entrou noutra conta noutro separador. Recarregue a página.»', await texto(p, '[data-conta-dados-erro]'));
    await p.click('[data-conta-dados-cancelar]');
    await p.click('[data-conta-mostrar-codigo]');
    await p.waitForSelector('[data-conta-janela][open]');
    await p.waitForFunction(() => /Não foi possível mostrar o código/.test(document.querySelector('[data-conta-janela][open]')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
    certo(/Não foi possível mostrar o código/.test(await texto(p, '[data-conta-janela][open]')), 'o código QR no separador velho: não mostra o da outra conta', await texto(p, '[data-conta-janela][open]'));
    await fecharJanela(p, 'nao');
    await p.click('[data-conta-apagar]');
    await p.waitForSelector('[data-conta-janela][open]');
    await fecharJanela(p, 'sim');
    await p.waitForSelector('[data-conta-janela][open]');
    const aviso = await texto(p, '[data-conta-janela][open]');
    certo(/A conta não foi apagada/.test(aviso) && /noutra conta/.test(aviso), '«Apagar a conta» no separador velho: não apaga a outra, e diz porquê', aviso);
    await fecharJanela(p, 'nao');
    certo((await p2.evaluate(() => fetch('/conta/api/eu').then((r) => r.status))) === 200 && (await texto(p2, '[data-conta-quem]')).toLowerCase() === Dmais2, 'a outra conta continua lá, intacta');
    // a sessão acaba antes de «Sair em todos»: não finge que saiu em todos
    await ctx.clearCookies();
    await p2.click('[data-conta-sair-todos]');
    await p2.waitForSelector('[data-conta-janela][open]');
    await fecharJanela(p2, 'sim');
    await p2.waitForSelector('[data-conta-janela][open]');
    certo(/A sessão terminou/.test(await texto(p2, '[data-conta-janela][open]')), '«Sair em todos» com a sessão já acabada: diz que não se fez e manda entrar', await texto(p2, '[data-conta-janela][open]'));
    await fecharJanela(p2, 'nao');
    certo(await visivel(p2, '#conta-email'), 'e fica na entrada');
    await ctx.close();
  }

  /* -------- L: o ecrã pequeno */
  grupo('L · 320 px');
  {
    const { ctx, p } = await contexto({ viewport: { width: 320, height: 640 } });
    await irConta(p);
    certo(await cabe(p), '320: a entrada cabe', await largura(p));
    await foto(p, 'L1-entrada-320');
    await entrar(p, D);
    certo(await cabe(p), '320: a conta cabe', await largura(p));
    await p.click('[data-conta-mostrar-codigo]');
    await p.waitForSelector('[data-conta-janela][open]');
    const cx = await caixa(p, '[data-conta-janela][open]');
    certo(cx.esq >= 8 && cx.dir >= 8 && cx.cima >= 0 && cx.baixo >= 0, '320: a janela do código cabe no ecrã', cx);
    await foto(p, 'L2-codigo-320');
    await ctx.close();
  }
}

for (const m of MOTORES) {
  motor = m;
  console.log(`\n================ ${m} ================`);
  browser = await pw[m].launch();
  try { await correr(); } catch (e) { certo(false, `a corrida no ${m} chegou ao fim`, String(e?.stack || e).split('\n').slice(0, 6).join(' | ')); }
  await browser.close();
  grupo(`erros nas páginas (${m})`);
  certo(erros.length === 0, 'nenhum erro de JavaScript nem janela do browser', erros.slice(0, 10));
  erros.length = 0;
}
const mal = res.filter((r) => !r.ok);
console.log(`\n${res.length - mal.length} certas, ${mal.length} erradas`);
for (const r of mal) console.log(`  ✗ ${r.nome}  — ${JSON.stringify(r.detalhe ?? '').slice(0, 300)}`);
fs.writeFileSync(`${S}/resultado.json`, JSON.stringify(res, null, 1));
