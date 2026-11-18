// A IFTHENPAY DE FAZ-DE-CONTA, num servidor (18 nov 2026), para o ensaio dos pagamentos no browser
// (scripts/pente-fino-pagamentos.mjs). É a mesma dos testes do Worker (worker/encomendas/test/ajuda.mjs,
// ifthenpayFalsa), servida por HTTP: o Worker local fala com ela pela var IFTHENPAY_API (que só aceita o
// localhost: ifthenpay.js, baseDe). Não corre na CI e nunca vai para a Cloudflare.
//
//   node scripts/ifthenpay-de-ensaio.mjs [porta=8795]
//
// O que serve:
//   as APIs que o Worker usa (MB WAY, Multibanco, cartão, leitura, reembolso), com as chaves de ensaio (CHAVES);
//   GET  /catalogo.json          o _site/assets/catalogo.json desta pasta (o Worker lê-o: CATALOGO_URL);
//   GET  /cartao/<id>            a «página segura» do cartão: «Pagar» paga e volta ao successUrl, «Cancelar» ao cancelUrl;
//   POST /_pagar                 { orderId, metodo, cents, requestId? } — o cliente paga (o MB WAY aceite na app,
//                                a referência paga no multibanco);
//   POST /_mbway                 { requestId, estado } — o MB WAY recusado ('020') ou expirado ('101');
//   GET  /_estado                o que a ifthenpay de faz-de-conta sabe (pedidos MB WAY, referências, pagamentos).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ifthenpayFalsa } from '../worker/encomendas/test/ajuda.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.argv[2] || 8795);
const f = ifthenpayFalsa();
const cartoes = new Map();   // requestId → { orderId, cents, successUrl, errorUrl, cancelUrl }

const ler = (req) => new Promise((ok, mal) => { let s = ''; req.on('data', (d) => { s += d; }); req.on('end', () => ok(s)); req.on('error', mal); });
const json = (res, estado, dados) => { res.writeHead(estado, { 'content-type': 'application/json' }); res.end(JSON.stringify(dados)); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const centimos = (v) => Math.round(Number(v) * 100);

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORTA}`);
    const corpo = req.method === 'POST' ? await ler(req) : '';
    if (u.pathname === '/catalogo.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(fs.readFileSync(path.join(RAIZ, '_site', 'assets', 'catalogo.json')));
    }
    if (u.pathname === '/_pagar' && req.method === 'POST') {
      const { orderId, metodo, cents, requestId } = JSON.parse(corpo || '{}');
      return json(res, 200, { requestId: f.pagar(orderId, { metodo, cents, requestId }) });
    }
    if (u.pathname === '/_mbway' && req.method === 'POST') {
      const { requestId, estado } = JSON.parse(corpo || '{}');
      f.mbway.set(requestId, estado);
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/_estado') {
      return json(res, 200, { mbway: [...f.mbway], referencias: [...f.referencias], pagos: [...f.pagos], reembolsos: f.reembolsos, cartoes: [...cartoes] });
    }
    const pagina = /^\/cartao\/([A-Za-z0-9]+)(\/(pagar|cancelar))?$/.exec(u.pathname);
    if (pagina) {
      const c = cartoes.get(pagina[1]);
      if (!c) { res.writeHead(404); return res.end('não existe'); }
      if (pagina[3] === 'pagar') {
        f.pagar(c.orderId, { metodo: 'CCARD', cents: c.cents, requestId: pagina[1] });
        res.writeHead(303, { location: c.successUrl }); return res.end();
      }
      if (pagina[3] === 'cancelar') { res.writeHead(303, { location: c.cancelUrl }); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html lang="pt-PT"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cartão (ensaio)</title>
<body style="font-family:system-ui;padding:2rem"><h1>Cartão de ensaio</h1><p>Encomenda ${esc(c.orderId)} · ${(c.cents / 100).toFixed(2)} €</p>
<form method="post" action="/cartao/${esc(pagina[1])}/pagar"><button data-cartao-pagar>Pagar</button></form>
<form method="post" action="/cartao/${esc(pagina[1])}/cancelar"><button data-cartao-cancelar>Cancelar</button></form></body></html>`);
    }
    // As APIs da ifthenpay: a de faz-de-conta responde; o cartão volta com a página daqui.
    const r = await f.responder(`https://api.ifthenpay.com${u.pathname}${u.search}`, { method: req.method, body: corpo || undefined });
    let texto = await r.text();
    if (/^\/creditcard\/init\//.test(u.pathname) && r.ok) {
      const d = JSON.parse(texto);
      const pedido = JSON.parse(corpo);
      if (d.Status === '0') {
        cartoes.set(d.RequestId, { orderId: pedido.orderId, cents: centimos(pedido.amount), successUrl: pedido.successUrl, errorUrl: pedido.errorUrl, cancelUrl: pedido.cancelUrl });
        d.PaymentUrl = `http://localhost:${PORTA}/cartao/${d.RequestId}`;
        texto = JSON.stringify(d);
      }
    }
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
    res.end(texto);
  } catch (e) {
    json(res, 500, { erro: String(e?.message || e) });
  }
}).listen(PORTA, () => console.log(`ifthenpay de faz-de-conta em http://localhost:${PORTA}`));
