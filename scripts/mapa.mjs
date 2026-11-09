#!/usr/bin/env node
// O MAPA DA LOJA, desenhado pelo próprio site (8 nov 2026).
//
//   node scripts/mapa.mjs                  vai buscar as ruas ao OpenStreetMap e escreve media/mapa/loja.svg
//   node scripts/mapa.mjs --dados=osm.json usa uma resposta do Overpass já guardada (sem rede)
//
// PORQUÊ: o mapa do Google põe cookies, por isso só pode carregar depois de a pessoa o pedir (o site não
// tem aviso de cookies) — e o Renato achou que «demora a carregar… já devia estar carregado». Este mapa é
// um SVG feito aqui, a partir dos dados abertos do OpenStreetMap (ODbL: o crédito «© OpenStreetMap»
// aparece junto do mapa), guardado no repositório e escrito dentro da página: aparece no instante em que
// a página abre, não contacta ninguém e não pede consentimento. Tocar nele abre o Google Maps.
//
// Corre-se à mão e só quando a loja muda de sítio (site.json › local.coordenadas, que o painel não
// edita). Uma consulta ao Overpass, pequena (as ruas à volta da loja), não um descarregar de mosaicos.
//
// O desenho: o fundo de papel, as zonas (mato, campos, o cemitério) em tons muito leves, o rio, as ruas
// com o contorno, os nomes de algumas ruas ao longo delas (a da loja sempre), e o pino com «LF Mobile».
// O viewBox é 800 × 500 (16:10) e a página recorta-o ao centro no telemóvel (preserveAspectRatio slice),
// por isso as letras são grandes no viewBox (18) para se lerem também lá.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const site = JSON.parse(fs.readFileSync(path.join(RAIZ, 'content/site.json'), 'utf8'));
const [LAT, LON] = String(site.local?.coordenadas || '').split(',').map(Number);
if (!Number.isFinite(LAT) || !Number.isFinite(LON)) { console.error('site.json › local.coordenadas não tem «latitude,longitude»'); process.exit(1); }
const RUA_DA_LOJA = String(site.empresa?.morada || '').split(',')[0].trim(); // «Rua das Marcadas»

// ---------------------------------------------------------------- os dados
const L = 800, A = 500;            // o viewBox
const METROS_POR_UNIDADE = 0.8;    // 640 m × 400 m à volta da loja
const MLAT = 110574, MLON = 111320 * Math.cos((LAT * Math.PI) / 180);
const MARGEM = 0.0012;             // pedir um pouco mais do que se vê, para as ruas cruzarem a borda
const dLat = (A / 2) * METROS_POR_UNIDADE / MLAT + MARGEM;
const dLon = (L / 2) * METROS_POR_UNIDADE / MLON + MARGEM;
const caixa = [LAT - dLat, LON - dLon, LAT + dLat, LON + dLon].map((v) => v.toFixed(6)).join(',');

async function dados() {
  const ficheiro = args.find((a) => a.startsWith('--dados='))?.slice(8);
  if (ficheiro) return JSON.parse(fs.readFileSync(ficheiro, 'utf8'));
  const q = `[out:json][timeout:60];(way["highway"](${caixa});way["landuse"](${caixa});way["leisure"](${caixa});way["natural"~"^(water|wood)$"](${caixa});way["waterway"](${caixa}););out geom;`;
  for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'user-agent': 'lfmobile-site-mapa/1.0' } });
      if (r.ok) return await r.json();
      console.error(`${url}: ${r.status}`);
    } catch (e) { console.error(`${url}: ${e.message}`); }
  }
  throw new Error('o Overpass não respondeu');
}

// ---------------------------------------------------------------- a projecção e a geometria
const xy = (p) => [L / 2 + ((p.lon - LON) * MLON) / METROS_POR_UNIDADE, A / 2 - ((p.lat - LAT) * MLAT) / METROS_POR_UNIDADE];
const r1 = (v) => Math.round(v * 10) / 10;
/* Tira os pontos a menos de 1 unidade do anterior (a 0,8 m não se vê a diferença). */
function simplificar(pts) {
  const out = [];
  for (const p of pts) { const u = out[out.length - 1]; if (!u || Math.hypot(p[0] - u[0], p[1] - u[1]) >= 1) out.push(p); }
  return out;
}
const d = (pts, fechar = false) => `M${pts.map((p) => `${r1(p[0])} ${r1(p[1])}`).join('L')}${fechar ? 'Z' : ''}`;
const dentro = (p, m = 0) => p[0] >= -m && p[0] <= L + m && p[1] >= -m && p[1] <= A + m;
const comprimentoVisivel = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) if (dentro(pts[i], -20) && dentro(pts[i - 1], -20)) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- o desenho
const ESTILO_RUA = {
  // largura do contorno e do miolo, em unidades (0,8 m)
  primary: [19, 15], secondary: [19, 15], tertiary: [17, 13],
  unclassified: [13, 10], residential: [13, 10], living_street: [12, 9], pedestrian: [10, 7],
  service: [8, 5.5],
};
const ZONAS = { forest: 'mato', wood: 'mato', farmland: 'campo', meadow: 'campo', grass: 'campo', cemetery: 'cemiterio', religious: 'cemiterio', park: 'parque', water: 'agua' };

const osm = await dados();
const ruas = [], caminhos = [], zonas = [], rios = [];
for (const e of osm.elements || []) {
  if (e.type !== 'way' || !Array.isArray(e.geometry)) continue;
  const t = e.tags || {};
  const pts = simplificar(e.geometry.map(xy));
  if (pts.length < 2) continue;
  if (t.highway && ESTILO_RUA[t.highway]) ruas.push({ pts, tipo: t.highway, nome: t.name || '' });
  else if (t.highway && /^(track|footway|path|steps|cycleway)$/.test(t.highway)) caminhos.push({ pts });
  else if (t.waterway) rios.push({ pts });
  else {
    const z = ZONAS[t.landuse] || ZONAS[t.leisure] || ZONAS[t.natural];
    if (z && pts.length > 3) zonas.push({ pts, classe: z });
  }
}
// as ruas mais importantes por cima das outras
const ORDEM = ['service', 'pedestrian', 'living_street', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary'];
ruas.sort((a, b) => ORDEM.indexOf(a.tipo) - ORDEM.indexOf(b.tipo));

/* Os nomes: a rua da loja sempre, e mais três das ruas com nome mais compridas à vista, cada nome uma
   vez, no troço mais comprido. O texto vai da esquerda para a direita (o caminho vira-se se for preciso)
   e não nasce em cima do pino. */
const TAM_LETRA = 18, LARG_LETRA = 9.6; // largura média de um carácter, em unidades
const porNome = new Map();
for (const r of ruas) if (r.nome) { const c = comprimentoVisivel(r.pts); if (!porNome.has(r.nome) || porNome.get(r.nome).c < c) porNome.set(r.nome, { r, c }); }
const curto = (n) => n.replace(/^Rua /, 'R. ').replace(/^Avenida /, 'Av. ').replace(/^Travessa /, 'Tv. ');
const candidatos = [...porNome.entries()].map(([nome, v]) => ({ nome, ...v })).sort((a, b) => (b.nome === RUA_DA_LOJA) - (a.nome === RUA_DA_LOJA) || b.c - a.c);
const nomes = [];
for (const k of candidatos) {
  if (nomes.length >= 4) break;
  const texto = k.nome === RUA_DA_LOJA ? k.nome : curto(k.nome);
  if (k.c < texto.length * LARG_LETRA + 40) continue;
  let pts = k.r.pts.filter((p) => dentro(p, -10));
  if (pts.length < 2) continue;
  if (pts[pts.length - 1][0] < pts[0][0]) pts = pts.slice().reverse();
  // o texto fica longe do pino: começa no quarto do caminho mais afastado do centro
  const meio = pts[Math.floor(pts.length / 2)];
  const pertoDoPino = Math.hypot(meio[0] - L / 2, meio[1] - A / 2) < 90;
  nomes.push({ id: `rua-${nomes.length}`, pts, texto, offset: pertoDoPino ? (pts[0][1] < A / 2 ? '22%' : '78%') : '50%', daLoja: k.nome === RUA_DA_LOJA });
}

// ---------------------------------------------------------------- o SVG
const P = [L / 2, A / 2]; // o pino
const svg = `<svg class="mapa-loja__desenho" viewBox="0 0 ${L} ${A}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Mapa: a ${esc(site.marca)} na ${esc(RUA_DA_LOJA)}, em ${esc(site.local.localidade)}" xmlns="http://www.w3.org/2000/svg">
<!-- Desenhado por scripts/mapa.mjs com dados do OpenStreetMap (© OpenStreetMap contributors, ODbL). -->
<defs><clipPath id="mapa-recorte"><rect width="${L}" height="${A}"/></clipPath>${nomes.map((n) => `<path id="${n.id}" d="${d(n.pts)}"/>`).join('')}</defs>
<rect class="mapa-loja__fundo" width="${L}" height="${A}"/>
<g clip-path="url(#mapa-recorte)">
<g class="mapa-loja__zonas">${zonas.map((z) => `<path class="mapa-zona mapa-zona--${z.classe}" d="${d(z.pts, true)}"/>`).join('')}</g>
<g class="mapa-loja__rios">${rios.map((r) => `<path d="${d(r.pts)}"/>`).join('')}</g>
<g class="mapa-loja__caminhos">${caminhos.map((c) => `<path d="${d(c.pts)}"/>`).join('')}</g>
<g class="mapa-loja__contornos">${ruas.map((r) => `<path stroke-width="${ESTILO_RUA[r.tipo][0]}" d="${d(r.pts)}"/>`).join('')}</g>
<g class="mapa-loja__ruas">${ruas.map((r) => `<path stroke-width="${ESTILO_RUA[r.tipo][1]}" d="${d(r.pts)}"/>`).join('')}</g>
<g class="mapa-loja__nomes" font-size="${TAM_LETRA}">${nomes.map((n) => `<text${n.daLoja ? ' class="mapa-loja__nome--loja"' : ''}><textPath href="#${n.id}" startOffset="${n.offset}" text-anchor="middle" dominant-baseline="central">${esc(n.texto)}</textPath></text>`).join('')}</g>
</g>
<g class="mapa-loja__pino" transform="translate(${r1(P[0])} ${r1(P[1])})">
<ellipse class="mapa-loja__sombra" cx="0" cy="1" rx="9" ry="3.5"/>
<path class="mapa-loja__gota" d="M0 0C-6-9-17-19-17-31A17 17 0 1 1 17-31C17-19 6-9 0 0Z"/>
<circle class="mapa-loja__ponto" cx="0" cy="-31" r="6.5"/>
<g class="mapa-loja__etiqueta" transform="translate(24 -50)"><rect width="${Math.round(String(site.marca).length * 12.5 + 28)}" height="38" rx="19"/><text x="14" y="25">${esc(site.marca)}</text></g>
</g>
</svg>
`;
const destino = path.join(RAIZ, 'media/mapa/loja.svg');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, svg);
console.log(`mapa: ${ruas.length} ruas, ${caminhos.length} caminhos, ${zonas.length} zonas, ${rios.length} rios; nomes: ${nomes.map((n) => n.texto).join(', ')}; ${(svg.length / 1024).toFixed(1)} KB em ${path.relative(RAIZ, destino)}`);
