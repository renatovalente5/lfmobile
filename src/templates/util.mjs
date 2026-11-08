// Utilitários dos modelos: escapar HTML, Markdown mínimo, dinheiro, datas e moradas do site.
import { precoDe as precoDasRegras } from '../lib/regras.mjs';

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Euros à portuguesa: «45 €», «1 234,50 €». Sem casas decimais quando é um número redondo.
export function euros(v) {
  const n = Number(v);
  const redondo = Number.isInteger(n);
  const t = n.toLocaleString('pt-PT', { minimumFractionDigits: redondo ? 0 : 2, maximumFractionDigits: 2 });
  return `${t.replace(/\s/g, '\u00a0')}\u00a0€`;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// «2026-12-31» → «31 de dezembro»; com ano: «31 de dezembro de 2026»
export function dataPorExtenso(iso, comAno = false) {
  const [a, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}${comAno ? ` de ${a}` : ''}`;
}

// O dia de hoje em Portugal (a publicação corre em UTC no GitHub; à meia-noite de cá ainda é
// o dia anterior lá — a data de uma promoção conta em Lisboa).
export function hojeEmLisboa(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

// O preço que vale hoje: a regra está nas regras dos dados (src/lib/regras.mjs, precoDe), a mesma
// do carrinho e do painel. Sem preço (ainda por dizer), atual é null.
export const precoDe = precoDasRegras;

// Markdown mínimo para as páginas de texto: títulos ##/###, parágrafos, listas (- e 1.),
// **negrito**, *itálico*, [ligações](url) e quadros simples (| a | b |). Mais do que isto não
// é preciso e cada coisa a mais é uma coisa a mais para o backoffice explicar.
const idBase = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\*|_|\[|\]\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'seccao';
function idDoTitulo(t, ids) {
  const base = idBase(t);
  let id = base;
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
  ids.add(id);
  return id;
}
export function markdown(src, url = (u) => u) {
  const ids = new Set();
  const linhas = src.replace(/\r/g, '').split('\n');
  const out = [];
  let para = [];
  let lista = null;
  let quadro = null;
  const fecharPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '), url)}</p>`); para = []; } };
  const fecharLista = () => { if (lista) { out.push(`<${lista.tipo}>${lista.itens.map((i) => `<li>${inline(i, url)}</li>`).join('')}</${lista.tipo}>`); lista = null; } };
  const fecharQuadro = () => {
    if (!quadro) return;
    const [cab, ...corpo] = quadro.filter((l) => !/^\|\s*-/.test(l));
    const cel = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    out.push(`<div class="quadro"><table><thead><tr>${cel(cab).map((c) => `<th scope="col">${inline(c, url)}</th>`).join('')}</tr></thead><tbody>${corpo.map((l) => `<tr>${cel(l).map((c) => `<td>${inline(c, url)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    quadro = null;
  };
  for (const linha of linhas) {
    const t = linha.trim();
    if (/^\|/.test(t)) { fecharPara(); fecharLista(); (quadro ||= []).push(t); continue; }
    fecharQuadro();
    if (!t) { fecharPara(); fecharLista(); continue; }
    const h = t.match(/^(#{2,4})\s+(.*)$/);
    // cada título leva um id (o texto sem acentos), para se poder ligar a ele: /politica-de-privacidade/#opinioes
    if (h) { fecharPara(); fecharLista(); out.push(`<h${h[1].length} id="${idDoTitulo(h[2], ids)}">${inline(h[2], url)}</h${h[1].length}>`); continue; }
    const li = t.match(/^(-|\d+\.)\s+(.*)$/);
    if (li) {
      fecharPara();
      const tipo = li[1] === '-' ? 'ul' : 'ol';
      if (lista && lista.tipo !== tipo) fecharLista();
      (lista ||= { tipo, itens: [] }).itens.push(li[2]);
      continue;
    }
    if (lista && /^\s{2,}/.test(linha)) { lista.itens[lista.itens.length - 1] += ' ' + t; continue; }
    fecharLista();
    para.push(t);
  }
  fecharPara(); fecharLista(); fecharQuadro();
  return out.join('\n');
}

/* O primeiro parágrafo de um markdown, em texto simples (para a descrição da página nos
   motores de busca): sem títulos, sem marcas de lista, sem negrito nem ligações. */
export function textoSimples(src) {
  const blocos = String(src || '').replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const b = blocos.find((x) => !/^#{1,4}\s/.test(x) && !/^(-|\d+\.)\s/.test(x)) || blocos[0] || '';
  return b.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/^#{1,4}\s+/gm, '').replace(/\s+/g, ' ').trim();
}

export function inline(s, url = (u) => u) {
  let r = esc(s);
  r = r.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, texto, destino) => {
    const d = destino.replace(/&amp;/g, '&');
    const externo = /^https?:\/\//.test(d);
    const href = externo || /^(mailto|tel):/.test(d) || d.startsWith('#') ? d : url(d);
    return `<a href="${esc(href)}"${externo ? ' target="_blank" rel="noopener"' : ''}>${texto}</a>`;
  });
  r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  r = r.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return r;
}

// Número português para o WhatsApp: «912 345 678» → «351912345678». Um número já com o
// indicativo (+351…, 00351…, ou de outro país) fica como está, só com os algarismos.
export function numeroWhatsApp(n) {
  let d = String(n || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^9\d{8}$/.test(d) || /^2\d{8}$/.test(d)) d = '351' + d;
  return d.replace(/\D/g, '');
}

// «351912345678» → «912 345 678» (para mostrar)
export function numeroLegivel(n) {
  const d = numeroWhatsApp(n);
  const local = d.startsWith('351') ? d.slice(3) : d;
  return local.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
}

// A nota que a lei pede junto de um número de telefone (DL 59/2021): depende da rede.
export function custoChamada(n) {
  const local = numeroWhatsApp(n).replace(/^351/, '');
  if (/^9/.test(local)) return 'Chamada para a rede móvel nacional';
  if (/^2/.test(local)) return 'Chamada para a rede fixa nacional';
  return 'Chamada para a rede nacional';
}

// A nota junto de um número, como o Renato a quer em todo o site (17 out 2026): entre parênteses e em
// letra mais pequena. O WhatsApp vai só como ligação, sem o número, e por isso sem nota.
export function notaChamada(n) {
  return `<span class="chamada">(${esc(custoChamada(n))})</span>`;
}

// A morada da sede por extenso: «Rua …, n.º …, 2925-000 Azeitão, Setúbal»
export function moradaCompleta(e) {
  return [e.morada, [e.codigoPostal, e.localidade].filter(Boolean).join(' '), e.concelho].filter(Boolean).join(', ');
}
