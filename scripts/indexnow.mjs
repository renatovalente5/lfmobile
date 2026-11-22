// O INDEXNOW (22 nov 2026, a revisão do SEO; memória sitemap-lastmod-e-indexnow): avisa o Bing, e a rede que
// partilha os avisos (Yandex, Seznam, Naver…), das páginas que mudaram, logo depois de cada publicação. O Google não
// participa: para ele valem o sitemap e o Search Console.
//   - A CHAVE é pública por desenho: o build de produção põe-na em /<chave>.txt, e é assim que se prova o domínio.
//   - Corre no workflow indexnow.yml, DEPOIS de o publicar.yml acabar bem (avisar antes fazia o Bing vir buscar a
//     versão antiga). O publicar.yml não muda: o painel ensaia-o passo a passo, e um aviso a partir do ensaio falaria
//     de páginas de faz-de-conta.
//   - Só as páginas cujo lastmod do mapa (a data do git) é posterior ao commit da publicação anterior; sem publicação
//     anterior, o mapa todo. Os crons da noite (as campanhas) não mudam commits: não avisam nada.
//   - Nunca falha: um aviso que não passa é um ::warning:: (o site já está no ar).
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const CHAVE_INDEXNOW = '560f43bad5bae98e6be63286d0afa61b';
const DOMINIO = 'lfmobile.pt';
const aviso = (t) => console.log(`::warning::IndexNow: ${t}`);

/* O commit da publicação bem-sucedida anterior a esta (a API do GitHub), e a data dele (o git, com o histórico todo).
   → Date, 'tudo' (nunca houve outra), ou null (não se soube: não se avisa nada). */
async function desdeQuando() {
  const repo = process.env.GITHUB_REPOSITORY; const token = process.env.GH_TOKEN;
  const este = Number(process.env.RUN_ID); const criado = process.env.RUN_CRIADO || '';
  if (!repo || !token || !este) return null;
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/publicar.yml/runs?status=success&per_page=30`,
    { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } });
  if (!r.ok) { aviso(`a lista das publicações respondeu ${r.status}.`); return null; }
  const corridas = (await r.json()).workflow_runs || [];
  const antes = corridas.find((x) => x.id !== este && (!criado || x.created_at < criado));
  if (!antes) return corridas.some((x) => x.id === este) ? 'tudo' : null;
  const data = execFileSync('git', ['log', '-1', '--format=%cI', antes.head_sha], { encoding: 'utf8' }).trim();
  return data ? new Date(data) : null;
}

async function principal() {
  // DESDE=<data ISO>: à mão, para avisar as páginas que mudaram desde uma data (ex.: depois de mudar o próprio mapa)
  const desde = process.env.DESDE ? new Date(process.env.DESDE) : await desdeQuando();
  if (desde === null || (desde instanceof Date && Number.isNaN(+desde))) { aviso('não se soube a publicação anterior; não se avisou nada.'); return; }
  const r = await fetch(`https://${DOMINIO}/sitemap.xml?_=${Date.now()}`);
  if (!r.ok) { aviso(`o mapa do site respondeu ${r.status}; não se avisou nada.`); return; }
  const urls = [...(await r.text()).matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)]
    .map((m) => ({ loc: m[1], lastmod: m[2] ? new Date(m[2]) : null }));
  const mudaram = desde === 'tudo' ? urls : urls.filter((u) => u.lastmod && u.lastmod > desde);
  if (!mudaram.length) { console.log(`IndexNow: nenhuma página mudou desde ${desde.toISOString()}.`); return; }
  const ficheiro = await fetch(`https://${DOMINIO}/${CHAVE_INDEXNOW}.txt?_=${Date.now()}`);
  if (!ficheiro.ok || (await ficheiro.text()).trim() !== CHAVE_INDEXNOW) { aviso('o ficheiro da chave não está no ar; não se avisou nada.'); return; }
  const corpo = { host: DOMINIO, key: CHAVE_INDEXNOW, keyLocation: `https://${DOMINIO}/${CHAVE_INDEXNOW}.txt`, urlList: mudaram.slice(0, 10000).map((u) => u.loc) };
  const res = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(corpo) });
  // 200: aceite; 202: aceite, com a chave ainda por validar (não é erro)
  if (res.status === 200 || res.status === 202) console.log(`IndexNow: ${corpo.urlList.length} páginas avisadas (${res.status}).`);
  else aviso(`respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) principal().catch((e) => aviso(e.message));
