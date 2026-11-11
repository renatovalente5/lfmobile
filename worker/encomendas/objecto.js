/* OS OBJECTOS DURÁVEIS (11 nov 2026): o que tem de mudar num passo só, sem outro pedido a meio. O KV
 * é eventualmente consistente e não tem escrita condicional — lido noutro sítio, vem até 60 s atrasado,
 * e dois pedidos ao mesmo tempo lêem o mesmo e gravam um por cima do outro (memória
 * kv-ler-mudar-gravar-perde-escritas; o mesmo desenho da Franja Kids, franjakids/worker/encomendas).
 * Duas classes:
 *   · Encomenda (aqui): cada encomenda tem um objecto (o nome é o id): a verdade dela, lida sempre a de
 *     agora. Cada escrita leva a versão que leu; se outra passou entretanto, o objecto recusa (conflito)
 *     e quem escreve volta a ler e a fazer (encomenda.js, alterarEncomenda). Com o KV, uma nota do painel
 *     logo a seguir a um pagamento voltava a pôr «pendente» por cima do «paga», o «expirou» da Stripe
 *     gravava por cima de uma anulação, e duas mudanças ao mesmo tempo davam 200 as duas (uma perdia-se).
 *     O KV fica com uma CÓPIA de cada versão, escrita aqui dentro e pela ordem das versões: é dela que se
 *     faz a lista do painel (os metadados). As encomendas de antes do objecto lêem-se do KV até à
 *     primeira escrita, que as passa para cá. O objecto apaga-se TTL_ENCOMENDA depois da última escrita.
 *   · Cupoes (cupoes.js): um cupão de um uso nunca passa o limite, nem com dois clientes no mesmo
 *     instante.
 *   · Contador (aqui): quantos emails de encomendas por pagar recebeu hoje um endereço (o nome é o
 *     resumo do email, nunca o email): o travão de email.js, podeAvisarCliente.
 *
 * Na jurisdição da UE (os dados pessoais ficam na UE). O workerd local (o wrangler dev) não tem
 * jurisdições: só aí (ENCOMENDAS_LOCAL=1, nunca no wrangler.toml) vai sem ela — memória
 * do-jurisdicao-no-workerd. Na Cloudflare, uma recusa rebenta: nunca cai para fora da UE. */

import { chaveKV, metadadosDe, TTL_ENCOMENDA } from './encomenda.js';

/* O objecto de um nome, numa ligação (`binding`) do wrangler.toml. */
export function objecto(env, binding, nome) {
  const ns = env[binding];
  if (!ns) throw new Error(`sem a ligação ${binding}`);
  let eu;
  try {
    eu = ns.jurisdiction('eu');
  } catch (e) {
    if (env.ENCOMENDAS_LOCAL !== '1') throw e;
    return ns.get(ns.idFromName(nome));
  }
  return eu.get(eu.idFromName(nome));
}

/* Um pedido ao objecto: o corpo em JSON, a resposta em JSON. Uma resposta que não é 2xx lança. */
export async function pedirAoObjecto(env, binding, nome, corpo) {
  const r = await objecto(env, binding, nome).fetch('https://objecto.interno/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error(`o objecto ${binding} respondeu ${r.status}`);
  return r.json();
}

export const respostaJson = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

/* A cópia no KV de uma versão da encomenda (com os metadados da lista do painel). */
export async function espelhar(env, enc) {
  await env.ORDERS.put(chaveKV(enc.encomenda), JSON.stringify(enc), { expirationTtl: TTL_ENCOMENDA, metadata: metadadosDe(enc) });
}

export class Encomenda {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    let corpo;
    try { corpo = await request.json(); } catch { return respostaJson({ erro: 'pedido' }, 400); }
    const s = this.ctx.storage;
    if (corpo.op === 'ler') return respostaJson({ enc: (await s.get('enc')) ?? null });
    if (corpo.op !== 'gravar' || !corpo.enc || typeof corpo.enc !== 'object') return respostaJson({ erro: 'operação' }, 400);
    /* Conferir a versão, gravar e copiar para o KV são um passo só: nenhum outro pedido entra a meio
       (sem isto, a cópia de uma versão antiga podia chegar ao KV depois da nova). */
    let resposta;
    await this.ctx.blockConcurrencyWhile(async () => {
      const actual = (await s.get('enc')) ?? null;
      const agora = actual ? Number(actual.versao) || 0 : 0;
      if ((Number(corpo.versao) || 0) !== agora) { resposta = { conflito: true, enc: actual }; return; }
      const novo = { ...corpo.enc, versao: agora + 1 };
      await s.put('enc', novo);
      await s.setAlarm(Date.now() + TTL_ENCOMENDA * 1000);
      let kv = true;
      try { await espelhar(this.env, novo); } catch (e) { kv = false; console.error('CÓPIA NO KV POR GRAVAR', novo.encomenda, e.message); }
      resposta = { enc: novo, kv };
    });
    return respostaJson(resposta);
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

/* O contador de um endereço: { max } → { ok, n }. Conta o dia (UTC); passado o máximo, recusa sem
   contar. Apaga-se dois dias depois da última conta. */
export class Contador {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    let corpo;
    try { corpo = await request.json(); } catch { return respostaJson({ erro: 'pedido' }, 400); }
    const max = Number(corpo.max) || 0;
    const dia = new Date().toISOString().slice(0, 10);
    let resposta;
    await this.ctx.blockConcurrencyWhile(async () => {
      const c = (await this.ctx.storage.get('c')) ?? { dia, n: 0 };
      const n = c.dia === dia ? c.n : 0;
      if (n >= max) { resposta = { ok: false, n }; return; }
      await this.ctx.storage.put('c', { dia, n: n + 1 });
      await this.ctx.storage.setAlarm(Date.now() + 2 * 86400 * 1000);
      resposta = { ok: true, n: n + 1 };
    });
    return respostaJson(resposta);
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
