/* OS OBJECTOS DURÁVEIS (11 nov 2026): o que tem de mudar num passo só, sem outro pedido a meio. O KV
 * é eventualmente consistente e não tem escrita condicional — lido noutro sítio, vem até 60 s atrasado,
 * e dois pedidos ao mesmo tempo lêem o mesmo e gravam um por cima do outro (memória
 * kv-ler-mudar-gravar-perde-escritas; o mesmo desenho da Franja Kids, franjakids/worker/encomendas).
 * Hoje só os CUPÕES (cupoes.js, a classe Cupoes): um cupão de um uso nunca passa o limite, nem com
 * dois clientes no mesmo instante.
 *
 * Na jurisdição da UE (os dados pessoais ficam na UE). O workerd local (o wrangler dev) não tem
 * jurisdições: só aí (ENCOMENDAS_LOCAL=1, nunca no wrangler.toml) vai sem ela — memória
 * do-jurisdicao-no-workerd. Na Cloudflare, uma recusa rebenta: nunca cai para fora da UE. */

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
