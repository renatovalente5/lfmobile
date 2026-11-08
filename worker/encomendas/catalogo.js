/* O CATÁLOGO PUBLICADO (assets/catalogo.json, a forma de `const catalogo` em scripts/build.mjs):
 * os preços, as escolhas, os portes, as zonas e o modo. Lê-se de CATALOGO_URL (por omissão
 * SITE_URL/assets/catalogo.json) com a cache da Cloudflare a 60 s no máximo: um preço mudado no
 * painel vale no Worker daí a um minuto, e um pico de pedidos não martela o site. Um .json não
 * entra na cache por omissão, daí o cacheEverything. */

export const CACHE = Object.freeze({ cf: Object.freeze({ cacheTtl: 60, cacheEverything: true }) });

export const siteUrl = (env) => String(env.SITE_URL || '').replace(/\/+$/, '');
export const urlDoCatalogo = (env) => String(env.CATALOGO_URL || `${siteUrl(env)}/assets/catalogo.json`);

export async function lerCatalogo(env) {
  const url = urlDoCatalogo(env);
  const r = await fetch(url, CACHE);
  if (!r.ok) throw new Error(`catálogo ${url}: HTTP ${r.status}`);
  const cat = await r.json();
  if (!cat || typeof cat !== 'object' || !cat.produtos || typeof cat.produtos !== 'object' || !Array.isArray(cat.zonas) || !cat.zonas.length) {
    throw new Error(`catálogo ${url}: sem a forma esperada`);
  }
  return cat;
}

/* O modo vem do catálogo (site.json → pagamentos.modo); a var MODO só o pode forçar para
   «encomenda», como travão de emergência — nunca o contrário. */
export const modoDe = (cat, env) => (env.MODO === 'encomenda' ? 'encomenda' : (cat && cat.modo === 'online' ? 'online' : 'encomenda'));
