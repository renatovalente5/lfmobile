// Ícones em SVG, desenhados aqui (traço de 1,8 em 24×24, pontas redondas). Os de marcas
// (WhatsApp, Facebook) vêm do Simple Icons (CC0). Todos levam aria-hidden: o texto do botão ou da
// ligação é que diz o que fazem. Os das reparações (ecrã, bateria, câmara…) são os que o painel
// deixa escolher para cada tipo de reparação (ICONES_REPARACAO em src/lib/regras.mjs).

const T = (corpo, extra = '') =>
  `<svg class="icone${extra}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${corpo}</svg>`;
const C = (corpo, extra = '') =>
  `<svg class="icone${extra}" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false">${corpo}</svg>`;

export const icones = {
  // a interface
  carrinho: T('<path d="M5.5 8h13l-1.1 11.2a1 1 0 0 1-1 .8H7.6a1 1 0 0 1-1-.8L5.5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
  menu: T('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  fechar: T('<path d="M6 6l12 12M18 6 6 18"/>'),
  seta: T('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  setaEsq: T('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  baixo: T('<path d="m6 9 6 6 6-6"/>'),
  externo: T('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  mais: T('<path d="M12 5v14M5 12h14"/>'),
  menos: T('<path d="M5 12h14"/>'),
  lixo: T('<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12.2a1 1 0 0 0 1 .8h9a1 1 0 0 0 1-.8l1-12.2M9 7V4.5h6V7"/>'),
  copiar: T('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>'),
  certo: T('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  info: T('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>'),
  aviso: T('<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.5M12 17.2v.2"/>'),
  pesquisa: T('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>'),
  pausa: T('<path d="M9 6.5v11M15 6.5v11"/>'),
  tocar: T('<path d="M8 5.5v13l10.5-6.5L8 5.5Z"/>'),
  estrela: C('<path d="m12 3.6 2.5 5.3 5.8.7-4.3 4 1.2 5.8L12 16.5l-5.2 2.9 1.2-5.8-4.3-4 5.8-.7L12 3.6Z"/>'),
  // contactos e loja
  email: T('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>'),
  telefone: T('<path d="M6.5 3.5h3l1.5 4.5-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4.5 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z"/>'),
  local: T('<path d="M12 21s-7-6.1-7-11.4A7 7 0 0 1 19 9.6C19 14.9 12 21 12 21Z"/><circle cx="12" cy="9.6" r="2.6"/>'),
  relogio: T('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  camiao: T('<path d="M3 6.5h10.5v9.5H3zM13.5 10h4l3.5 3.5V16h-7.5"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/>'),
  cartao: T('<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M3.5 10h17M7 14.5h4"/>'),
  escudo: T('<path d="M12 3.2 19 6v5.2c0 4.6-3 8.1-7 9.6-4-1.5-7-5-7-9.6V6l7-2.8Z"/><path d="m9 12 2.2 2.2L15.5 10"/>'),
  caixa: T('<path d="M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2V8.2Z"/><path d="m4 8.2 8 4.2 8-4.2M12 12.4V20"/>'),
  loja: T('<path d="M4 10.5V20h16v-9.5M3 7.5 5 4h14l2 3.5c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3Z"/><path d="M9.5 20v-5.5h5V20"/>'),
  cadeado: T('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3M12 14.5v2.5"/>'),
  retoma: T('<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.5 3.5v4h-4M5.5 20.5v-4h4"/>'),
  documento: T('<path d="M8 4h6.5L19 8.5V19a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M14.5 4v4.5H19M10 12.5h6M10 16h6"/>'),
  presente: T('<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v7.5h14V12M12 8v11.5M12 8C10 5 7.5 4.6 7 6.3S9 8 12 8Zm0 0c2-3 4.5-3.4 5-1.7S15 8 12 8Z"/>'),
  filtro: T('<path d="M4 6h16M7 12h10M10 18h4"/>'),
  ordenar: T('<path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/>'),
  raio: T('<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z"/>'),
  verificado: T('<path d="M12 3.2l2.2 1.6 2.7-.1.9 2.6 2.2 1.6-.8 2.6.8 2.6-2.2 1.6-.9 2.6-2.7-.1L12 20.8l-2.2-1.6-2.7.1-.9-2.6-2.2-1.6.8-2.6-.8-2.6 2.2-1.6.9-2.6 2.7.1L12 3.2Z"/><path d="m9 12 2.1 2.1L15.2 10"/>'),
  euro: T('<path d="M17.5 6.6A7 7 0 1 0 17.5 17.4M4.5 10.5h9M4.5 13.5h8"/>'),
  maos: T('<path d="M4 13.5 8.5 9a2 2 0 0 1 2.8 0l.7.7M20 13.5 15.5 9a2 2 0 0 0-2.8 0L9 12.7a1.4 1.4 0 0 0 2 2l1.5-1.5"/><path d="M4 13.5l4.2 4.2a2 2 0 0 0 2.8 0l.5-.5M20 13.5l-4.6 4.6a2 2 0 0 1-2.8 0"/>'),
  // os aparelhos
  telemovel: T('<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 17.8h2"/>'),
  tablet: T('<rect x="4.5" y="3" width="15" height="18" rx="2.2"/><path d="M11 17.8h2"/>'),
  relogioPulso: T('<rect x="6.5" y="6.5" width="11" height="11" rx="3"/><path d="M9 6.5 9.6 3h4.8l.6 3.5M9 17.5l.6 3.5h4.8l.6-3.5"/>'),
  auriculares: T('<path d="M8 4.5a3 3 0 0 0-3 3v2.5a3 3 0 0 0 3 3h.5V4.5H8ZM16 4.5a3 3 0 0 1 3 3v2.5a3 3 0 0 1-3 3h-.5V4.5H16Z"/><path d="M8.5 13v6.5M15.5 13v6.5"/>'),
  ferramentas: T('<path d="M14.5 6.5a3.5 3.5 0 0 0 4.4 4.4L9 20.8a1.8 1.8 0 0 1-2.6-2.6l9.9-9.9a3.5 3.5 0 0 0-1.8-1.8Z"/><path d="m4 5 2.5 2.5M4 5l1.5-1.5L8 6"/>'),
  // as reparações (ICONES_REPARACAO)
  ecra: T('<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="m9.5 6 2 3-1.5 2.5 2.5 3-1 3.5"/>'),
  bateria: T('<rect x="3" y="8" width="16" height="8" rx="2"/><path d="M19 10.5h1.5v3H19M6 11v2M9 11v2M12 11v2"/>'),
  traseira: T('<rect x="7" y="3" width="10" height="18" rx="2.2"/><rect x="8.8" y="4.8" width="4.4" height="4.4" rx="1.3"/><path d="m14.5 12-1.6 2.4 1.6 1.6-1.2 2.5"/>'),
  camara: T('<path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z"/><circle cx="12" cy="13" r="3.5"/>'),
  'camara-frontal': T('<rect x="7" y="3" width="10" height="18" rx="2.2"/><circle cx="12" cy="6.3" r="1.1"/><path d="M9.5 14.5a2.5 2.5 0 0 1 5 0M12 12.3v.01"/>'),
  lente: T('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.2"/><path d="M9.6 9.8a3 3 0 0 1 2-1"/>'),
  conector: T('<path d="M8.5 3h7v6.5a3.5 3.5 0 0 1-7 0V3Z"/><path d="M10.5 3v3M13.5 3v3M12 13v8"/>'),
  botoes: T('<rect x="8" y="3" width="10" height="18" rx="2.2"/><path d="M5 7.5v3M5 13v3"/>'),
  som: T('<path d="M5 9.5h3.2L12 6v12l-3.8-3.5H5V9.5Z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 7a7 7 0 0 1 0 10"/>'),
  rosto: T('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 15.5a3.5 3.5 0 0 0 5 0"/>'),
  agua: T('<path d="M12 3.5c3.5 4.2 6 7.4 6 10.5a6 6 0 0 1-12 0c0-3.1 2.5-6.3 6-10.5Z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2 2.4"/>'),
  software: T('<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M14.5 12a2.5 2.5 0 1 1-1-2M14.6 8.6v1.6H13"/>'),
  diagnostico: T('<circle cx="10.5" cy="10.5" r="6"/><path d="m20 20-5.2-5.2M8 10.5h1.2l.8-1.8 1.2 3.6.8-1.8H13"/>'),
  pelicula: T('<rect x="6" y="3" width="10" height="18" rx="2.2"/><path d="M9 3.6h8.6a1.8 1.8 0 0 1 1.8 1.8v13.2a1.8 1.8 0 0 1-1.8 1.8H9"/><path d="M12 6.5l3 3"/>'),
  // as consolas (10 nov 2026) e a placa
  temperatura: T('<path d="M10 14.6V5.5a2 2 0 0 1 4 0v9.1a4 4 0 1 1-4 0Z"/><path d="M12 10v6.5M16.5 6h2M16.5 9.5h2"/>'),
  ventoinha: T('<circle cx="12" cy="12" r="1.7"/><path d="M12 10.3c-.9-3.5.4-6.3 3.1-6.3 2.3 0 2.8 2.8.3 4.3M13.7 12c3.5-.9 6.3.4 6.3 3.1 0 2.3-2.8 2.8-4.3.3M12 13.7c.9 3.5-.4 6.3-3.1 6.3-2.3 0-2.8-2.8-.3-4.3M10.3 12c-3.5.9-6.3-.4-6.3-3.1 0-2.3 2.8-2.8 4.3-.3"/>'),
  hdmi: T('<path d="M3.5 8.5h17v4.3l-2.6 2.7H6.1l-2.6-2.7V8.5Z"/><path d="M7.5 11.5h9"/>'),
  disco: T('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 6.3a5.7 5.7 0 0 1 5.7 5.7"/>'),
  fonte: T('<rect x="4" y="5.5" width="16" height="13" rx="2.5"/><path d="m12.9 8-3.2 4.5h3.6l-1.2 3.6 3.2-4.6h-3.6L12.9 8Z"/>'),
  comando: T('<path d="M7.7 7.5h8.6a4.5 4.5 0 0 1 4.4 3.6l1 5.1a2.6 2.6 0 0 1-4.5 2.2L15.5 16h-7l-1.7 2.4a2.6 2.6 0 0 1-4.5-2.2l1-5.1a4.5 4.5 0 0 1 4.4-3.6Z"/><path d="M7.5 10.6v3M6 12.1h3M15.6 11.3v.01M17.6 13v.01"/>'),
  placa: T('<rect x="7" y="7" width="10" height="10" rx="1.6"/><rect x="10" y="10" width="4" height="4" rx=".6"/><path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3"/>'),
  // marcas
  whatsapp: C('<path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.4-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.91-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.42.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89a11.82 11.82 0 0 0-3.48-8.41Z"/>'),
  instagram: T('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.2 6.8v.01"/>'),
  facebook: C('<path d="M13.5 21v-7.6h2.6l.4-3h-3V8.5c0-.9.3-1.5 1.6-1.5h1.6V4.3c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H8v3h2.5V21h3Z"/>'),
};

/* O desenho de um tipo de reparação, pelo nome que o painel grava (ICONES_REPARACAO); sem nome, ou
   com um que não existe, a lupa do diagnóstico. */
export const iconeReparacao = (nome) => icones[nome] || icones.diagnostico;
