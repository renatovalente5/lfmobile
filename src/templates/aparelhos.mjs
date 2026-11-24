// OS DESENHOS DOS APARELHOS (feitos aqui, sem fotografias de marca): cada modelo tem um «desenho»
// (content/aparelhos.json; DESENHOS em src/lib/regras.mjs) — o iPhone com botão (8, SE), com
// entalhe (X a 14), com ilha (14 Pro em diante), o dobrável, o Galaxy, o Flip e o Fold, o tablet, o
// relógio, a consola (uma torre qualquer com um comando à frente: nenhuma consola verdadeira), o portátil
// e o computador fixo (um monitor e uma torre; 11 nov 2026). De frente, com o ecrã aceso num brilho dourado (a cor da marca). Decorativos (aria-hidden):
// o nome do modelo está sempre ao lado.

const CORPO = '#1c1c1e';
const ARO = '#a1a1a8';
const ECRA = '#2b2b30';

const svg = (vb, corpo, classe) => `<svg class="aparelho${classe ? ` ${classe}` : ''}" viewBox="${vb}" aria-hidden="true" focusable="false">${corpo}</svg>`;

// um ecrã aceso: um fundo escuro e quente (o gradiente #ap-ecra, definido uma vez na página) com um
// reflexo na diagonal
const ecra = (x, y, w, h, r) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#ap-ecra)"/>
  <path d="M${x + w * 0.58} ${y} L${x + w} ${y + h * 0.22} L${x + w} ${y + h * 0.3} L${x + w * 0.46} ${y}Z" fill="#fff" opacity=".07"/>`;
// (o dourado, #ap-ouro, é o das costas de um telemóvel nos desenhos das categorias, lá em baixo)
const DEFS = `<defs><linearGradient id="ap-ecra" x1="0" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="#6b5a35"/><stop offset=".38" stop-color="${ECRA}"/><stop offset="1" stop-color="#141416"/></linearGradient><linearGradient id="ap-ouro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E3C681"/><stop offset=".55" stop-color="#C9A24C"/><stop offset="1" stop-color="#9C7A30"/></linearGradient></defs>`;

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
  portatil: () => svg('0 0 200 140', `
    <rect x="26" y="4" width="148" height="106" rx="8" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(33, 11, 134, 92, 3)}
    <circle cx="100" cy="7.6" r="1.5" fill="#3a3a3e"/>
    <path d="M6 112h188l-5.5 15.5a9 9 0 0 1-8.5 6H20a9 9 0 0 1-8.5-6Z" fill="#26262a" stroke="${ARO}" stroke-width="2" stroke-linejoin="round"/>
    <rect x="82" y="112" width="36" height="5" rx="2.5" fill="#0e0e10"/>`),
  torre: () => svg('0 0 200 140', `
    <rect x="4" y="6" width="130" height="90" rx="6" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(10, 12, 118, 78, 3)}
    <path d="M60 96h18l3 26H57Z" fill="#26262a" stroke="${ARO}" stroke-width="2" stroke-linejoin="round"/>
    <rect x="38" y="122" width="62" height="7" rx="3.5" fill="#26262a" stroke="${ARO}" stroke-width="2"/>
    <rect x="144" y="30" width="52" height="99" rx="6" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    <rect x="152" y="40" width="3.5" height="64" rx="1.75" fill="#C9A24C" opacity=".9"/>
    <circle cx="184" cy="42" r="3.2" fill="none" stroke="#4a4a50" stroke-width="2"/>
    <path d="M164 112h24M164 117h24M164 122h24" stroke="#4a4a50" stroke-width="2" stroke-linecap="round"/>`),
};

/* O desenho de um modelo (ou de um tipo: 'iphone-ilha', 'galaxy'…). */
export function desenhoAparelho(desenho, classe = '') {
  return (DESENHOS[desenho] || DESENHOS.galaxy)().replace('class="aparelho"', `class="aparelho${classe ? ` ${classe}` : ''}"`).replace(/(<svg[^>]*>)/, `$1${DEFS}`);
}

/* As páginas com muitos modelos (as reparações, a retoma) escrevem os desenhos UMA vez, como
   <symbol>, e cada modelo usa-os com <use>: 187 desenhos inteiros pesavam mais de 100 KB. */
const VB = { 'iphone-duo': '0 0 200 180', 'galaxy-fold': '0 0 200 180', tablet: '0 0 160 210', relogio: '0 0 120 180', consola: '0 0 140 200', portatil: '0 0 200 140', torre: '0 0 200 140' };
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

// ---------------------------------------------------------------- os desenhos das categorias
/* OS DESENHOS DAS CATEGORIAS, na fila da página inicial (o Renato, 24 nov 2026, com a fila em que seis categorias
   tinham a mesma caixa, pediu ícones mais adequados ao que ele vende): o artigo de cada uma, desenhado
   como os aparelhos (o corpo escuro, o aro prateado, o brilho dourado) a partir das fotografias da loja. Num quadrado
   de 200, que no ecrã tem 50 px: a escala dos telemóveis (120 de largo em 30 px). A página inicial usa cada um uma
   vez, por isso vão inteiros, sem <symbol>; os gradientes são os do sprite dessa página. */
const OURO = '#C9A24C';
const OURO_CLARO = '#E3C681';
const CINZA = '#2c2c2e';
const DETALHE = '#4a4a50';
const FUNDO = '#0e0e10';
const n = (v) => +v.toFixed(1);
// uma lente de câmara: o anel, o vidro aceso e um reflexo
const lente = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${FUNDO}" stroke="${DETALHE}" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="${n(r * 0.5)}" fill="url(#ap-ecra)"/><circle cx="${n(cx - r * 0.3)}" cy="${n(cy - r * 0.3)}" r="${n(r * 0.17)}" fill="#fff" opacity=".55"/>`;
// um fio (um cabo, uma alça, uma bandolete) com o aro por baixo
const fio = (d, largura, cor = CINZA) => `<path d="${d}" fill="none" stroke="${ARO}" stroke-width="${largura + 4}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${cor}" stroke-width="${largura}" stroke-linecap="round" stroke-linejoin="round"/>`;
// o raio dourado (a carregar), centrado em (cx, cy), com a altura h
const raio = (cx, cy, h) => `<path d="M${[[1, -10], [-9, 2], [0, 2], [-1, 10], [9, -2], [0, -2]].map(([x, y]) => `${n(cx + (x * h) / 20)} ${n(cy + (y * h) / 20)}`).join('L')}Z" fill="${OURO}" stroke="${OURO}" stroke-width="2" stroke-linejoin="round"/>`;

const CATEGORIAS = {
  // outras marcas: dois telemóveis, um de costas (as câmaras ao alto, como o Oppo da loja) e um de frente
  marcas: () => `
    <g transform="rotate(-10 68 98)">
      <rect x="18" y="14" width="100" height="168" rx="18" fill="url(#ap-ouro)" stroke="${ARO}" stroke-width="2"/>
      <rect x="27" y="23" width="28" height="52" rx="14" fill="${CORPO}"/>
      ${lente(41, 37, 9)}${lente(41, 61, 9)}
    </g>
    <rect x="82" y="26" width="100" height="168" rx="18" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    ${ecra(88, 32, 88, 156, 13)}
    <circle cx="132" cy="41" r="3.4" fill="#000"/>`,
  // os gadgets: a coluna com a alça (as KMS da loja), deitada, com o anel de luz na ponta
  coluna: () => `
    ${fio('M88 78C88 30 148 30 148 78', 10, OURO)}
    <path d="M42 68H152A38 38 0 0 1 190 106V146A38 38 0 0 1 152 184H42Z" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    <path d="M82 84H156" stroke="#fff" stroke-opacity=".08" stroke-width="8" stroke-linecap="round"/>
    <ellipse cx="42" cy="126" rx="32" ry="58" fill="${CINZA}" stroke="${ARO}" stroke-width="2"/>
    <ellipse cx="42" cy="126" rx="25" ry="47" fill="none" stroke="${OURO}" stroke-width="3"/>
    <ellipse cx="42" cy="126" rx="18" ry="35" fill="url(#ap-ecra)"/>
    <ellipse cx="42" cy="126" rx="6" ry="12" fill="${OURO}" opacity=".55"/>`,
  // a casa: a máquina de café (a Dolce Gusto da loja), com o copo
  cafe: () => `
    <rect x="26" y="168" width="80" height="14" rx="5" fill="${CINZA}" stroke="${ARO}" stroke-width="2"/>
    <path d="M66 22H142A28 28 0 0 1 170 50V166A14 14 0 0 1 156 180H110A14 14 0 0 1 96 166V104A12 12 0 0 0 84 92H66A34 34 0 0 1 32 58V56A34 34 0 0 1 66 22Z" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    <path d="M154 42V154" stroke="#fff" stroke-opacity=".07" stroke-width="8" stroke-linecap="round"/>
    <circle cx="66" cy="52" r="11" fill="none" stroke="${OURO}" stroke-width="3"/>
    <circle cx="66" cy="52" r="3.5" fill="${OURO}"/>
    <rect x="58" y="91" width="16" height="9" rx="3" fill="${FUNDO}"/>
    <path d="M66 100V114" stroke="#6b5a35" stroke-width="3" stroke-linecap="round"/>
    <path d="M44 116H88L84.5 162A4 4 0 0 1 80.5 166H51.5A4 4 0 0 1 47.5 162Z" fill="url(#ap-ecra)" stroke="${ARO}" stroke-width="2"/>
    <path d="M45 117H87L86.2 128H45.8Z" fill="${OURO_CLARO}"/>`,
  // as capas: a capa transparente com o telemóvel dentro (o rebordo claro, o recorte da câmara, os botões)
  capa: () => `
    <rect x="34" y="54" width="6" height="26" rx="3" fill="${ARO}"/>
    <rect x="160" y="46" width="6" height="18" rx="3" fill="${ARO}"/>
    <rect x="160" y="70" width="6" height="18" rx="3" fill="${ARO}"/>
    <rect x="38" y="4" width="124" height="192" rx="27" fill="#fff" fill-opacity=".7" stroke="${ARO}" stroke-width="3"/>
    <rect x="47" y="13" width="106" height="174" rx="19" fill="${CORPO}"/>
    <rect x="50" y="16" width="54" height="76" rx="17" fill="#fff" fill-opacity=".7" stroke="${ARO}" stroke-width="3"/>
    <rect x="56" y="22" width="42" height="64" rx="13" fill="${CINZA}"/>
    ${lente(70, 38, 9)}${lente(70, 68, 9)}
    <circle cx="88" cy="38" r="3.5" fill="${OURO_CLARO}"/>
    <path d="M122 13L153 42V66L98 13Z" fill="#fff" opacity=".07"/>`,
  // os localizadores: o cartão (o P10 da loja), com o furo da fita e o alfinete dourado
  localizador: () => `
    <g transform="rotate(-12 100 104)">
      <path fill-rule="evenodd" d="M58 12H142A8 8 0 0 1 150 20V184A8 8 0 0 1 142 192H58A8 8 0 0 1 50 184V20A8 8 0 0 1 58 12ZM84 26H116A5 5 0 0 1 116 36H84A5 5 0 0 1 84 26Z" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
      <path d="M100 150C94 142 78 126 78 110A22 22 0 0 1 122 110C122 126 106 142 100 150Z" fill="${OURO}"/>
      <circle cx="100" cy="110" r="8" fill="${CORPO}"/>
      <ellipse cx="100" cy="160" rx="16" ry="4.5" fill="${OURO}" opacity=".35"/>
    </g>`,
  // os acessórios: a base de carregamento sem fios (a da loja tem o raio aceso), com o cabo
  carregador: () => `
    ${fio('M100 160C100 184 136 178 150 194', 9)}
    <circle cx="100" cy="88" r="76" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    <circle cx="100" cy="88" r="63" fill="url(#ap-ecra)"/>
    <circle cx="100" cy="88" r="46" fill="none" stroke="${OURO}" stroke-width="3" opacity=".85"/>
    ${raio(100, 88, 56)}`,
  // o áudio: os auscultadores (os P9 da loja)
  auscultadores: () => `
    ${fio('M38 120V100A62 62 0 0 1 162 100V120', 12, CORPO)}
    <rect x="18" y="96" width="42" height="80" rx="20" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    <rect x="140" y="96" width="42" height="80" rx="20" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    <rect x="24" y="106" width="24" height="60" rx="12" fill="url(#ap-ecra)"/>
    <rect x="152" y="106" width="24" height="60" rx="12" fill="url(#ap-ecra)"/>
    <rect x="54" y="104" width="14" height="64" rx="7" fill="${CINZA}" stroke="${ARO}" stroke-width="2"/>
    <rect x="132" y="104" width="14" height="64" rx="7" fill="${CINZA}" stroke="${ARO}" stroke-width="2"/>`,
  // os cabos: a ficha USB-C com o cabo
  cabo: () => `
    ${fio('M100 106C100 142 54 138 58 166C61 188 104 192 130 176', 10)}
    <path d="M89 96H111L106 112H94Z" fill="${CORPO}" stroke="${ARO}" stroke-width="2" stroke-linejoin="round"/>
    <rect x="80" y="46" width="40" height="54" rx="10" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    <rect x="81" y="82" width="38" height="5" fill="${OURO}"/>
    <path d="M87 48V22A6 6 0 0 1 93 16H107A6 6 0 0 1 113 22V48Z" fill="${ARO}"/>
    <rect x="94" y="22" width="12" height="18" rx="3" fill="${DETALHE}"/>`,
  // os powerbanks: a bateria, mais larga do que um telemóvel, com o raio e as luzes da carga
  powerbank: () => `
    <rect x="44" y="26" width="112" height="152" rx="26" fill="${CORPO}" stroke="${ARO}" stroke-width="2"/>
    <rect x="60" y="42" width="80" height="86" rx="15" fill="url(#ap-ecra)"/>
    ${raio(100, 85, 50)}
    ${[79, 93, 107, 121].map((x, i) => `<circle cx="${x}" cy="153" r="4.5" fill="${i < 3 ? OURO : DETALHE}"/>`).join('')}`,
  // as braceletes: a bracelete de relógio, com a fivela dourada
  bracelete: () => `
    <rect x="76" y="6" width="48" height="190" rx="20" fill="${CINZA}" stroke="${ARO}" stroke-width="2"/>
    <rect x="70" y="4" width="60" height="7" rx="3.5" fill="${ARO}"/>
    <rect x="64" y="34" width="72" height="30" rx="10" fill="none" stroke="${OURO}" stroke-width="6"/>
    <path d="M100 37V61" stroke="${OURO}" stroke-width="5" stroke-linecap="round"/>
    ${[100, 122, 144, 166].map((y) => `<circle cx="100" cy="${y}" r="4.5" fill="${FUNDO}"/>`).join('')}`,
  // os kids: o comando (o da consola, sozinho)
  comando: () => `
    <g transform="translate(5.5 -124.2) scale(1.35)">
      <path d="M37 142h66c11 0 19 7 22 18l6 21c2.5 9-7 15-14.5 9.5L103 180H37l-13.5 10.5C16 196 6.5 190 9 181l6-21c3-11 11-18 22-18Z" fill="#26262a" stroke="${ARO}" stroke-width="1.5" stroke-linejoin="round"/>
      <rect x="56" y="148" width="28" height="13" rx="4" fill="url(#ap-ecra)" stroke="${DETALHE}" stroke-width=".8"/>
      <circle cx="51" cy="170" r="7.5" fill="${FUNDO}" stroke="${DETALHE}" stroke-width="1.5"/>
      <circle cx="89" cy="170" r="7.5" fill="${FUNDO}" stroke="${DETALHE}" stroke-width="1.5"/>
      <path d="M27.5 152.5h5v-5h4v5h5v4h-5v5h-4v-5h-5z" fill="${DETALHE}"/>
      <circle cx="109" cy="149.5" r="2.8" fill="${DETALHE}"/><circle cx="115" cy="155.5" r="2.8" fill="${DETALHE}"/><circle cx="103" cy="155.5" r="2.8" fill="${DETALHE}"/><circle cx="109" cy="161.5" r="2.8" fill="${OURO}"/>
    </g>`,
  // uma categoria nova, que ainda não tem desenho: o saco da loja
  saco: () => `
    <path d="M52 66H148L158 176A12 12 0 0 1 146 190H54A12 12 0 0 1 42 176Z" fill="${CORPO}" stroke="${ARO}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M60 74H140" stroke="#fff" stroke-opacity=".08" stroke-width="6" stroke-linecap="round"/>
    ${fio('M76 86V58A24 24 0 0 1 124 58V86', 6, OURO)}
    <circle cx="76" cy="88" r="5" fill="${OURO}"/><circle cx="124" cy="88" r="5" fill="${OURO}"/>`,
};

/* O desenho de uma categoria (CATEGORIAS); o saco, se não tiver. */
export const desenhoCategoria = (desenho, classe = '') =>
  `<svg class="aparelho${classe ? ` ${classe}` : ''}" viewBox="0 0 200 200" aria-hidden="true" focusable="false">${(CATEGORIAS[desenho] || CATEGORIAS.saco)()}</svg>`;
export const DESENHOS_DE_CATEGORIA = Object.keys(CATEGORIAS);
