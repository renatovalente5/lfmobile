// OS DESENHOS DOS APARELHOS (feitos aqui, sem fotografias de marca): cada modelo tem um «desenho»
// (content/aparelhos.json; DESENHOS em src/lib/regras.mjs) — o iPhone com botão (8, SE), com
// entalhe (X a 14), com ilha (14 Pro em diante), o dobrável, o Galaxy, o Flip e o Fold, o tablet, o
// relógio e a consola (uma torre qualquer com um comando à frente: nenhuma consola verdadeira). De frente, com o ecrã aceso num brilho dourado (a cor da marca). Decorativos (aria-hidden):
// o nome do modelo está sempre ao lado.

const CORPO = '#1c1c1e';
const ARO = '#a1a1a8';
const ECRA = '#2b2b30';

const svg = (vb, corpo, classe) => `<svg class="aparelho${classe ? ` ${classe}` : ''}" viewBox="${vb}" aria-hidden="true" focusable="false">${corpo}</svg>`;

// um ecrã aceso: um fundo escuro e quente (o gradiente #ap-ecra, definido uma vez na página) com um
// reflexo na diagonal
const ecra = (x, y, w, h, r) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#ap-ecra)"/>
  <path d="M${x + w * 0.58} ${y} L${x + w} ${y + h * 0.22} L${x + w} ${y + h * 0.3} L${x + w * 0.46} ${y}Z" fill="#fff" opacity=".07"/>`;
const DEFS = `<defs><linearGradient id="ap-ecra" x1="0" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="#6b5a35"/><stop offset=".38" stop-color="${ECRA}"/><stop offset="1" stop-color="#141416"/></linearGradient></defs>`;

const DESENHOS = {
  'iphone-ilha': () => svg('0 0 120 200', `
    <rect x="3" y="3" width="114" height="194" rx="24" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(9, 9, 102, 182, 18)}
    <rect x="46" y="15" width="28" height="9" rx="4.5" fill="#000"/>`),
  'iphone-entalhe': () => svg('0 0 120 200', `
    <rect x="3" y="3" width="114" height="194" rx="22" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(9, 9, 102, 182, 16)}
    <path d="M38 9h44v4a7 7 0 0 1-7 7H45a7 7 0 0 1-7-7V9Z" fill="#000"/>`),
  'iphone-botao': () => svg('0 0 120 200', `
    <rect x="3" y="3" width="114" height="194" rx="18" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(9, 30, 102, 140, 3)}
    <rect x="48" y="15" width="24" height="4" rx="2" fill="#3a3a3e"/>
    <circle cx="60" cy="184" r="8" fill="none" stroke="#4a4a50" stroke-width="2"/>`),
  'iphone-duo': () => svg('0 0 200 180', `
    <rect x="3" y="3" width="194" height="174" rx="20" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(9, 9, 182, 162, 14)}
    <path d="M100 9v162" stroke="#000" stroke-opacity=".35" stroke-width="2"/>
    <rect x="132" y="15" width="22" height="8" rx="4" fill="#000"/>`),
  galaxy: () => svg('0 0 120 200', `
    <rect x="3" y="3" width="114" height="194" rx="16" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(8, 8, 104, 184, 11)}
    <circle cx="60" cy="16" r="3.6" fill="#000"/>`),
  'galaxy-flip': () => svg('0 0 120 200', `
    <rect x="3" y="3" width="114" height="194" rx="18" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(8, 8, 104, 184, 13)}
    <path d="M8 100h104" stroke="#000" stroke-opacity=".35" stroke-width="2"/>
    <circle cx="60" cy="16" r="3.6" fill="#000"/>`),
  'galaxy-fold': () => svg('0 0 200 180', `
    <rect x="3" y="3" width="194" height="174" rx="14" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(8, 8, 184, 164, 9)}
    <path d="M100 8v164" stroke="#000" stroke-opacity=".35" stroke-width="2"/>
    <circle cx="160" cy="18" r="3.4" fill="#000"/>`),
  tablet: () => svg('0 0 160 210', `
    <rect x="3" y="3" width="154" height="204" rx="16" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(11, 11, 138, 188, 9)}
    <circle cx="80" cy="7" r="2" fill="#000"/>`),
  relogio: () => svg('0 0 120 180', `
    <path d="M30 34 36 4h48l6 30M30 146l6 30h48l6-30" fill="#2c2c2e" stroke="${ARO}" stroke-width="2" stroke-linejoin="round"/>
    <rect x="16" y="30" width="88" height="120" rx="26" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(23, 37, 74, 106, 20)}
    <rect x="104" y="62" width="7" height="22" rx="3" fill="${ARO}"/>`),
  consola: () => svg('0 0 140 200', `
    <rect x="38" y="4" width="70" height="152" rx="14" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(45, 11, 56, 138, 9)}
    <rect x="71" y="22" width="4" height="70" rx="2" fill="#C9A24C" opacity=".9"/>
    <rect x="50" y="128" width="46" height="3.5" rx="1.75" fill="#000" opacity=".7"/>
    <path d="M37 142h66c11 0 19 7 22 18l6 21c2.5 9-7 15-14.5 9.5L103 180H37l-13.5 10.5C16 196 6.5 190 9 181l6-21c3-11 11-18 22-18Z" fill="#26262a" stroke="${ARO}" stroke-width="2" stroke-linejoin="round"/>
    <rect x="56" y="148" width="28" height="13" rx="4" fill="url(#ap-ecra)" stroke="#4a4a50" stroke-width="1"/>
    <circle cx="51" cy="170" r="7.5" fill="#0e0e10" stroke="#4a4a50" stroke-width="2"/>
    <circle cx="89" cy="170" r="7.5" fill="#0e0e10" stroke="#4a4a50" stroke-width="2"/>
    <path d="M27.5 152.5h5v-5h4v5h5v4h-5v5h-4v-5h-5z" fill="#4a4a50"/>
    <circle cx="109" cy="149.5" r="2.8" fill="#4a4a50"/><circle cx="115" cy="155.5" r="2.8" fill="#4a4a50"/><circle cx="103" cy="155.5" r="2.8" fill="#4a4a50"/><circle cx="109" cy="161.5" r="2.8" fill="#C9A24C"/>`),
};

/* O desenho de um modelo (ou de um tipo: 'iphone-ilha', 'galaxy'…). */
export function desenhoAparelho(desenho, classe = '') {
  return (DESENHOS[desenho] || DESENHOS.galaxy)().replace('class="aparelho"', `class="aparelho${classe ? ` ${classe}` : ''}"`).replace(/(<svg[^>]*>)/, `$1${DEFS}`);
}

/* As páginas com muitos modelos (as reparações, a retoma) escrevem os desenhos UMA vez, como
   <symbol>, e cada modelo usa-os com <use>: 187 desenhos inteiros pesavam mais de 100 KB. */
const VB = { 'iphone-duo': '0 0 200 180', 'galaxy-fold': '0 0 200 180', tablet: '0 0 160 210', relogio: '0 0 120 180', consola: '0 0 140 200' };
export function spriteAparelhos() {
  const simbolos = Object.keys(DESENHOS).map((d) => {
    const s = DESENHOS[d]();
    const corpo = s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    return `<symbol id="ap-${d}" viewBox="${VB[d] || '0 0 120 200'}">${corpo}</symbol>`;
  }).join('');
  return `<svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">${DEFS}${simbolos}</svg>`;
}
export const usarAparelho = (desenho, classe = '') => {
  const d = DESENHOS[desenho] ? desenho : 'galaxy';
  return `<svg class="aparelho${classe ? ` ${classe}` : ''}" viewBox="${VB[d] || '0 0 120 200'}" aria-hidden="true" focusable="false"><use href="#ap-${d}"/></svg>`;
};
