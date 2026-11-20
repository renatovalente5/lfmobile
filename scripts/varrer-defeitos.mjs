// VARREDURA DOS DEFEITOS DO SITE NO BROWSER (20 nov 2026; o Renato: «resolver todos os bugs do site, incluindo os
// visuais»). Não corre na CI: abre cada página (e o menu, a procura, o carrinho e o mega-menu abertos) em várias
// larguras, no Chromium e no WebKit, e procura: a página mais larga do que o ecrã (com os culpados), peças a sair da
// caixa visível onde estão, campos de texto estreitos, texto cortado, coisas em que se carrega por cima umas das outras,
// imagens partidas, alvos pequenos, erros na consola e pedidos falhados. Tira capturas inteiras a 390, 1000 e 1280 px.
// As sobreposições são quase sempre falsas (listas que rolam dentro de si, <details> fechados, janelas por cima):
// confirmar com elementFromPoint antes de corrigir.
//   PLAYWRIGHT=<pasta do pacote> node scripts/varrer-defeitos.mjs [https://lfmobile.pt] [saída] [chromium,webkit] [320,390,…] [filtro]
//   (sem a variável: ~/Websites/carimbo/node_modules/playwright; os dois motores em paralelo, um processo cada, ~15 min)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT || path.join(os.homedir(), 'Websites', 'carimbo', 'node_modules', 'playwright'));

const BASE = (process.argv[2] || 'https://lfmobile.pt').replace(/\/$/, '');
const SAIDA = process.argv[3] || path.join(os.tmpdir(), 'varrer-defeitos');
const MOTORES = (process.argv[4] || 'chromium,webkit').split(',');
const LARGURAS = (process.argv[5] || '320,390,600,768,900,1000,1280,1440').split(',').map(Number);
const FILTRO = process.argv[6] ? new RegExp(process.argv[6]) : null;
const CAPTURAS = new Set([390, 1000, 1280]);
fs.mkdirSync(SAIDA, { recursive: true });

const CARRINHO = { v: 2, linhas: [
  { produto: 'pelicula-vidro-temperado', opcoes: [], qtd: 1, modelo: 'iPhone 15 Pro Max' },
  { produto: 'inpods-3', opcoes: [], qtd: 2 },
], zona: 'levantamento', cupao: null };

const PAGINAS = [
  ['inicio', '/'], ['loja', '/loja/'], ['loja-telemoveis', '/loja/telemoveis/'], ['loja-apple', '/loja/apple/'],
  ['loja-peliculas', '/loja/peliculas/'], ['loja-kids', '/loja/kids/'], ['loja-procura', '/loja/?q=iphone'],
  ['produto-pelicula', '/produtos/pelicula-vidro-temperado/'], ['produto-hidrogel', '/produtos/pelicula-hidrogel/'],
  ['produto-recondicionado', '/produtos/iphone-14-pro-max-256gb-recondicionado/'], ['produto-capas', '/produtos/capas/'],
  ['produto-misterio', '/produtos/encomendas-misterio/'], ['produto-a17', '/produtos/samsung-galaxy-a17/'],
  ['produto-relogio', '/produtos/huawei-watch-d2/'],
  ['reparacoes', '/reparacoes/'], ['reparacoes-iphone', '/reparacoes/iphone/'], ['reparacoes-iphone-15', '/reparacoes/iphone-15/'],
  ['reparacoes-ps5', '/reparacoes/playstation-5/'], ['reparacoes-pc', '/reparacoes/computadores/'],
  ['retoma', '/retoma/'], ['contactos', '/contactos/'], ['sobre', '/sobre-nos/'], ['faq', '/perguntas-frequentes/'],
  ['envios', '/envios-e-devolucoes/'], ['garantia', '/garantia/'], ['termos', '/termos-e-condicoes/'],
  ['privacidade', '/politica-de-privacidade/'], ['cookies', '/politica-de-cookies/'], ['desistir', '/desistir/'],
  ['litigios', '/resolucao-de-litigios/'], ['conta', '/conta/'], ['carrinho', '/carrinho/'], ['checkout', '/checkout/'],
  ['checkout-envio', '/checkout/', async (p) => { await p.getByText('Envio para Portugal Continental').first().click(); }],
  ['pagar-sem-encomenda', '/pagar/'], ['obrigado', '/obrigado/'], ['404', '/nao-existe-esta-pagina/'],
  // os que se abrem por cima
  ['aberto-menu', '/', async (p, w) => { if (w >= 900) return 'saltar'; await p.click('[data-abrir="menu"]'); }],
  ['aberto-procura', '/', async (p, w) => {
    if (w < 900) { await p.click('[data-abrir="procurar"]'); await p.waitForTimeout(400); await p.keyboard.type('iphone 15'); }
    else { await p.click('#busca-topo'); await p.keyboard.type('iphone 15'); }
  }],
  ['aberto-mega', '/loja/', async (p, w) => { if (w < 900) return 'saltar'; await p.hover('.topo__loja > a'); }],
  ['aberto-carrinho', '/', async (p) => { await p.click('[data-abrir="carrinho"]'); }],
];

/* ------------------------------------------------------------- o que se procura em cada página (no browser) */
function verificar() {
  const W = innerWidth;
  const out = [];
  const cs = (el) => getComputedStyle(el);
  const visivel = (el) => {
    for (let x = el; x && x !== document.documentElement; x = x.parentElement) {
      const s = cs(x);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0' || x.hidden) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };
  const nome = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.classList.length ? `.${[...el.classList].slice(0, 3).join('.')}` : '');
  const caminho = (el) => { const p = []; for (let x = el; x && x !== document.body && p.length < 4; x = x.parentElement) p.unshift(nome(x)); return p.join(' > '); };
  const txt = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const recortado = (el) => { for (let x = el.parentElement; x && x !== document.body && x !== document.documentElement; x = x.parentElement) { const s = cs(x); if (/(hidden|auto|scroll|clip)/.test(s.overflowX) || /(hidden|clip)/.test(s.overflow)) return x; } return null; };
  const temCaixa = (el) => { const s = cs(el); return parseFloat(s.borderLeftWidth) > 0 || parseFloat(s.borderRightWidth) > 0 || (s.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor)) || s.boxShadow !== 'none'; };
  const todos = [...document.body.querySelectorAll('*')].filter((el) => !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'BR', 'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'g', 'use', 'defs', 'symbol', 'polygon', 'ellipse'].includes(el.tagName) && !(el instanceof SVGElement && el.tagName !== 'svg'));
  const vis = todos.filter(visivel);

  // 1. a página mais larga do que o ecrã
  const sw = document.documentElement.scrollWidth;
  if (sw > W + 1) out.push({ tipo: 'pagina-transborda', sw, W, culpados: vis.filter((el) => el.getBoundingClientRect().right > W + 1 && !recortado(el)).slice(0, 6).map(caminho) });

  // 2. peças fora do cartão (a caixa visível mais próxima)
  for (const el of vis) {
    if (!/^(INPUT|SELECT|TEXTAREA|BUTTON|A|IMG|LABEL|H[1-6]|P|LI|SPAN|STRONG|SMALL|FIGURE|PICTURE|svg)$/i.test(el.tagName)) continue;
    const s = cs(el);
    if (s.position === 'fixed' || s.position === 'absolute' || s.position === 'sticky') continue;
    let a = el.parentElement;
    while (a && a !== document.body && !temCaixa(a)) a = a.parentElement;
    if (!a || a === document.body) continue;
    const sa = cs(a);
    if (/(hidden|auto|scroll|clip)/.test(sa.overflowX)) continue;
    const r = el.getBoundingClientRect(), ra = a.getBoundingClientRect();
    const fora = Math.max(r.right - ra.right, ra.left - r.left);
    if (fora > 2) out.push({ tipo: 'fora-do-cartao', el: caminho(el), cartao: caminho(a), px: Math.round(fora), texto: txt(el) });
  }

  // 3. campos estreitos
  for (const el of vis) {
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) continue;
    if (/^(checkbox|radio|hidden|range|submit|button|image|color|file)$/.test(el.type)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 110) out.push({ tipo: 'campo-estreito', el: caminho(el), largura: Math.round(r.width), id: el.id || el.name });
  }

  // 4. texto cortado sem querer (sem reticências e sem rolamento)
  for (const el of vis) {
    const s = cs(el);
    if (!/(hidden|clip)/.test(s.overflowX) || el.scrollWidth <= el.clientWidth + 1) continue;
    if (!el.innerText || !el.innerText.trim()) continue;
    if (/(auto|scroll)/.test(s.overflowX)) continue;
    { const r = el.getBoundingClientRect(); if (r.width <= 2 || r.height <= 2 || /visualmente-escondido|lr-sr|sr-only/.test(el.className)) continue; }
    out.push({ tipo: 'texto-cortado', el: caminho(el), texto: txt(el), reticencias: s.textOverflow === 'ellipsis', mais: el.scrollWidth - el.clientWidth });
  }

  // 5. coisas em que se carrega por cima umas das outras
  const clic = vis.filter((el) => el.matches('a[href], button, input:not([type=hidden]), select, textarea, summary, label, [role=button]'))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight * 6; });
  const rects = clic.map((el) => [el, el.getBoundingClientRect()]);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, ra] = rects[i], [b, rb] = rects[j];
    if (a.contains(b) || b.contains(a)) continue;
    if (a.tagName === 'LABEL' && (a.control === b || a.htmlFor === b.id)) continue;
    if (b.tagName === 'LABEL' && (b.control === a || b.htmlFor === a.id)) continue;
    const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ix > 3 && iy > 3) out.push({ tipo: 'por-cima', a: caminho(a), b: caminho(b), ta: txt(a), tb: txt(b), area: Math.round(ix * iy) });
  }

  // 6. imagens partidas
  for (const el of vis) if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0) out.push({ tipo: 'imagem-partida', el: caminho(el), src: el.currentSrc || el.src });

  // 7. alvos pequenos (fora do meio do texto)
  for (const el of clic) {
    if (el.matches('label, textarea') || (el.matches('input') && el.closest('label'))) continue;
    const s = cs(el);
    if (s.display === 'inline') { const pai = el.parentElement; if (pai && (pai.innerText || '').trim().length > (el.innerText || '').trim().length + 3) continue; }
    const r = el.getBoundingClientRect();
    if ((r.width < 24 && r.height < 24) || r.width < 14 || r.height < 14) out.push({ tipo: 'alvo-pequeno', el: caminho(el), w: Math.round(r.width), h: Math.round(r.height), texto: txt(el) });
  }

  // 8. fora do ecrã pela esquerda
  for (const el of vis) { const r = el.getBoundingClientRect(); if (r.left < -1 && r.right > 0 && !recortado(el) && cs(el).position !== 'fixed') out.push({ tipo: 'fora-pela-esquerda', el: caminho(el), left: Math.round(r.left) }); }

  return out;
}

/* ------------------------------------------------------------- correr */
const relatorio = [];
for (const motor of MOTORES) {
  const browser = await pw[motor].launch();
  for (const w of LARGURAS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 900 ? 844 : 900 }, reducedMotion: 'reduce', ignoreHTTPSErrors: true, locale: 'pt-PT', timezoneId: 'Europe/Lisbon' });
    await ctx.addInitScript((c) => { try { if (!sessionStorage.getItem('varrer')) { localStorage.setItem('lfmobile:carrinho', JSON.stringify(c)); sessionStorage.setItem('varrer', '1'); } } catch (_) {} }, CARRINHO);
    const page = await ctx.newPage();
    let erros = [];
    page.on('console', (m) => { if (m.type() === 'error') erros.push(`consola: ${m.text().slice(0, 200)}`); });
    page.on('pageerror', (e) => erros.push(`excepção: ${String(e.message).slice(0, 200)}`));
    page.on('response', (r) => { if (r.status() >= 400 && !/nao-existe-esta-pagina/.test(r.url())) erros.push(`HTTP ${r.status()} ${r.url().replace(BASE, '').slice(0, 120)}`); });
    page.on('requestfailed', (r) => { const f = r.failure()?.errorText || ''; if (!/ERR_ABORTED|cancelled|NS_BINDING_ABORTED|Load request cancelled/i.test(f)) erros.push(`falhou ${r.url().replace(BASE, '').slice(0, 120)} ${f}`); });
    for (const [nomeP, url, accao] of PAGINAS) {
      if (FILTRO && !FILTRO.test(nomeP)) continue;
      erros = [];
      try {
        await page.goto(BASE + url, { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(700);
        // descer até ao fim (as imagens «lazy») e voltar
        await page.evaluate(async () => { const h = () => document.documentElement.scrollHeight; for (let y = 0; y < h(); y += innerHeight * 0.8) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); });
        await page.waitForTimeout(300);
        if (accao) { const r = await accao(page, w); if (r === 'saltar') continue; await page.waitForTimeout(700); }
        const probs = await page.evaluate(verificar);
        const ficheiro = `${motor}-${String(w).padStart(4, '0')}-${nomeP}.png`;
        if (CAPTURAS.has(w)) await page.screenshot({ path: path.join(SAIDA, ficheiro), fullPage: !accao, timeout: 60000 }).catch((e) => erros.push(`captura: ${e.message.slice(0, 80)}`));
        relatorio.push({ motor, w, pagina: nomeP, url, probs, erros: [...new Set(erros)] });
        process.stdout.write(`${probs.length || erros.length ? '!' : '.'}`);
      } catch (e) {
        relatorio.push({ motor, w, pagina: nomeP, url, probs: [], erros: [`falhou a página: ${e.message.slice(0, 160)}`] });
        process.stdout.write('x');
      }
    }
    await ctx.close();
    process.stdout.write(` ${motor} ${w}\n`);
  }
  await browser.close();
}
fs.writeFileSync(path.join(SAIDA, 'relatorio.json'), JSON.stringify(relatorio, null, 1));
console.log(`\n${relatorio.length} páginas vistas; relatório em ${path.join(SAIDA, 'relatorio.json')}`);
