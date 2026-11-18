// LIGAR A CONTA DA IFTHENPAY AO WORKER DAS ENCOMENDAS (18 nov 2026). Corre-se UMA vez, quando chegam as chaves
// (o email da ifthenpay ao Leandro), e outra vez só se uma chave mudar. Nunca escreve uma chave no ecrã.
//
// As chaves ficam em ficheiros, fora do repositório (o _cliente/ está no .gitignore), um valor por ficheiro:
//   _cliente/segredos/ifthenpay/backoffice     a chave de backoffice (0000-0000-0000-0000)
//   _cliente/segredos/ifthenpay/mbway          a chave MB WAY (AAA-000000)          } só as que a conta tiver:
//   _cliente/segredos/ifthenpay/multibanco     a chave Multibanco (AAA-000000)      } o site mostra só esses
//   _cliente/segredos/ifthenpay/cartao         a chave do cartão (CCARD, AAA-000000) } métodos
//   _cliente/segredos/ifthenpay/antiphishing   escolhida por nós: se não existir, faz-se aqui (48 caracteres)
//
//   node scripts/ligar-ifthenpay.mjs --conferir   só confere os ficheiros (as formas, nunca os valores)
//   node scripts/ligar-ifthenpay.mjs              põe os 3 segredos no Worker (wrangler secret put, pelo stdin),
//                                                 activa o callback de cada método na ifthenpay
//                                                 (POST /v2/callback/activation) e pergunta a saúde ao Worker
//                                                 (GET /painel/saude?sondar=1, que prova a chave de backoffice)
//
// Depois: um pagamento real pequeno por método, e só então o botão «Pagamentos online» do painel.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = path.join(RAIZ, '_cliente', 'segredos', 'ifthenpay');
const WORKER = path.join(RAIZ, 'worker', 'encomendas');
const API = 'https://lfmobile-encomendas.renato-lima-valente-dcb.workers.dev';
const IFTHENPAY = 'https://api.ifthenpay.com';
// O callback: a mesma morada para os três métodos (o Worker ignora um marcador que a conta não substitua).
const URL_CB = `${API}/ifthenpay/callback?key=[ANTI_PHISHING_KEY]&orderId=[ORDER_ID]&amount=[AMOUNT]&requestId=[REQUEST_ID]`;
const METODOS = [['MBWAY', 'mbway'], ['MB', 'multibanco'], ['CCARD', 'cartao']];
const RE_CHAVE = /^[A-Za-z0-9]{2,6}-[A-Za-z0-9]{4,10}$/;
const RE_BO = /^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/;
const conferir = process.argv.includes('--conferir');

const ler = (nome) => { const f = path.join(PASTA, nome); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null; };
const falha = (m) => { console.error(`✗ ${m}`); process.exit(1); };

/* ---------------------------------------------------------------- 1. os ficheiros (as formas, nunca os valores) */
const bo = ler('backoffice');
if (!bo) falha(`falta ${path.relative(RAIZ, path.join(PASTA, 'backoffice'))}`);
if (!RE_BO.test(bo)) falha('a chave de backoffice não tem a forma 0000-0000-0000-0000 (quatro grupos de quatro)');
const contas = METODOS.map(([m, f]) => [m, ler(f)]).filter(([, v]) => v);
if (!contas.length) falha('não há nenhuma chave de método (mbway, multibanco, cartao)');
for (const [m, v] of contas) if (!RE_CHAVE.test(v)) falha(`a chave ${m} não tem a forma AAA-000000 (letras, um traço, algarismos)`);
let ap = ler('antiphishing');
if (!ap && !conferir) {
  ap = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(PASTA, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(PASTA, 'antiphishing'), `${ap}\n`, { mode: 0o600 });
  console.log('· a chave anti-phishing foi feita agora (48 caracteres), no ficheiro antiphishing');
}
if (ap && !/^[A-Za-z0-9]{16,50}$/.test(ap)) falha('a chave anti-phishing tem de ter 16 a 50 letras ou algarismos');
console.log(`✓ backoffice; métodos: ${contas.map(([m]) => m).join(', ')}${ap ? '; anti-phishing' : ''}`);
if (conferir) process.exit(0);

/* ---------------------------------------------------------------- 2. os segredos no Worker (pelo stdin) */
const wrangler = path.join(RAIZ, '..', 'lfmobile-painel', 'node_modules', '.bin', 'wrangler');
const por = (nome, valor) => {
  const r = spawnSync(fs.existsSync(wrangler) ? wrangler : 'npx', [...(fs.existsSync(wrangler) ? [] : ['--yes', 'wrangler']), 'secret', 'put', nome, '--config', 'wrangler.toml'],
    { cwd: WORKER, input: valor, encoding: 'utf8' });
  const ok = r.status === 0 && /Success/i.test(`${r.stdout}${r.stderr}`);
  console.log(`${ok ? '✓' : '✗'} segredo ${nome}${ok ? '' : ` (wrangler saiu com ${r.status})`}`);
  if (!ok) process.exit(1);
};
por('IFTHENPAY_ACCOUNTS', contas.map(([m, v]) => `${m}|${v}`).join(';'));
por('IFTHENPAY_BACKOFFICE_KEY', bo);
por('IFTHENPAY_ANTIPHISHING_KEY', ap);

/* ---------------------------------------------------------------- 3. o callback de cada método */
for (const [m, v] of contas) {
  const r = await fetch(`${IFTHENPAY}/v2/callback/activation`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ boKey: bo, paymentMethod: m, paymentKey: v, apKey: ap, urlCb: URL_CB }),
  }).catch((e) => ({ ok: false, status: 0, text: async () => String(e?.message ?? e) }));
  const texto = (await r.text()).replace(/\s+/g, ' ').slice(0, 160);
  console.log(`${r.ok && /^OK/i.test(texto) ? '✓' : '✗'} callback ${m}: HTTP ${r.status} — ${texto}`);
}

/* ---------------------------------------------------------------- 4. a saúde (prova a chave de backoffice) */
const segredo = fs.readFileSync(path.join(RAIZ, '_cliente', 'segredos', 'PAINEL_SEGREDO'), 'utf8').trim();
await new Promise((r) => setTimeout(r, 5000));   // o segredo novo chega ao Worker em segundos
const s = await fetch(`${API}/painel/saude?sondar=1`, { headers: { authorization: `Bearer ${segredo}` } }).then((r) => r.json()).catch(() => null);
const p = s?.pagamentos ?? {};
console.log(`${p.sonda === 'ok' && p.backoffice ? '✓' : '✗'} saúde: modo ${s?.modo ?? '?'}; métodos ${JSON.stringify(p.metodos ?? [])}; backoffice ${p.backoffice}; callback ${p.callback}; sonda ${p.sonda ?? '—'}${p.erro ? `; erro ${p.erro}` : ''}`);
console.log('\nFalta: um pagamento real pequeno por método e, só depois, o botão «Pagamentos online» do painel.');
