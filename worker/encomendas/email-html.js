/* O HTML DOS EMAILS. O HTML de email não é o do site: tabelas com role="presentation", uma
 * coluna de 600 px, tudo inline (o Gmail limita o <style> e ignora-o em parte), cores por
 * extenso (não há var() em email), sem flex nem grid. As regras vêm do email-html.js do
 * Armazém dos Pneus, que já foi visto no Outlook, no Gmail e no Apple Mail.
 *
 * As cores são as do site (src/styles: --tinta, --linha, --ouro-texto). O logótipo é o PNG do
 * site (a mesma imagem do topo da página, que também existe em .webp — o PNG é o que todos os
 * clientes de email mostram). É preto sobre transparente: fica numa célula branca que o modo
 * escuro não inverte (o Gmail do Android pode invertê-la na mesma — é o único caso em que o
 * logótipo se perde; um PNG opaco resolvia-o e fica para quando houver domínio).
 */

const TINTA = '#121212';
const TEXTO = '#222222';
const TEXTO2 = '#555555';
const LINHA = '#E6E3DD';
const FUNDO = '#F5F4F1';
const LIGACAO = '#7A5E14';   // o --ouro-texto do site: 6,2:1 sobre branco
const RODAPE = '#6f6f6f';
const FONTE = "'Manrope',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const eurHtml = (c) => `${(c / 100).toFixed(2).replace('.', ',')}&nbsp;€`;

export const p = (html, ultimo) => `<p style="margin:0 0 ${ultimo ? '0' : '14px'} 0;">${html}</p>`;
export const pequeno = (html, ultimo) => `<p style="margin:0 0 ${ultimo ? '0' : '10px'} 0;font-size:13px;line-height:19px;color:${TEXTO2};">${html}</p>`;
export const ligacao = (url, txt) => `<a href="${esc(url)}" style="color:${LIGACAO};text-decoration:underline;">${esc(txt || url)}</a>`;
export const h2 = (txt) => `<h2 style="margin:0 0 6px 0;font-family:${FONTE};font-size:13px;line-height:18px;font-weight:700;color:${TINTA};text-transform:uppercase;letter-spacing:.6px;">${esc(txt)}</h2>`;

/* Um bloco de texto, numa célula própria (o Outlook aplica a toda a linha o maior padding). */
export const bloco = (html, padding = '20px 40px 6px 40px') =>
  `<tr><td class="p t2" style="padding:${padding};font-family:${FONTE};font-size:15px;line-height:23px;color:${TEXTO};">${html}</td></tr>`;

export const separador = () => `<tr><td class="p" style="padding:14px 40px 0 40px;"><div class="hr" style="border-top:1px solid ${LINHA};font-size:0;line-height:0;">&nbsp;</div></td></tr>`;

/* A tabela dos artigos e dos totais: uma linha por artigo. */
export function tabelaArtigos(enc, { portes, total, desconto = null }) {
  const linhas = (enc.linhas || []).map((l) => `
        <tr>
          <td class="t" style="padding:9px 0;border-bottom:1px solid ${LINHA};font-family:${FONTE};font-size:15px;line-height:22px;color:${TEXTO};">${esc(l.qtd)} × ${esc(l.nome)}${l.escolhas && l.escolhas.length ? `<br><span style="font-size:13px;color:${TEXTO2};">${esc(l.escolhas.join(' · '))}</span>` : ''}</td>
          <td align="right" valign="top" class="t" style="padding:9px 0;border-bottom:1px solid ${LINHA};font-family:${FONTE};font-size:15px;line-height:22px;color:${TEXTO};white-space:nowrap;">${eurHtml(l.total_cents)}</td>
        </tr>`).join('');
  const menor = (rotulo, valor) => `
        <tr>
          <td class="t2" style="padding:7px 0 0 0;font-family:${FONTE};font-size:14px;line-height:20px;color:${TEXTO2};">${esc(rotulo)}</td>
          <td align="right" class="t2" style="padding:7px 0 0 0;font-family:${FONTE};font-size:14px;line-height:20px;color:${TEXTO2};white-space:nowrap;">${valor}</td>
        </tr>`;
  return `<tr><td class="p" style="padding:6px 40px 0 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${linhas}
        ${desconto ? menor(desconto.rotulo, esc(desconto.valor)) : ''}
        ${menor(portes.rotulo, esc(portes.valor))}
        <tr>
          <td class="t" style="padding:12px 0 0 0;font-family:${FONTE};font-size:17px;line-height:24px;font-weight:700;color:${TINTA};">Total</td>
          <td align="right" class="t" style="padding:12px 0 0 0;font-family:${FONTE};font-size:17px;line-height:24px;font-weight:700;color:${TINTA};white-space:nowrap;">${esc(total)}</td>
        </tr>
        <tr><td colspan="2" class="t2" style="padding:2px 0 0 0;font-family:${FONTE};font-size:12px;line-height:18px;color:${TEXTO2};">IVA incluído à taxa legal em vigor.</td></tr>
      </table>
    </td></tr>`;
}

/* A referência Multibanco: texto vivo e monoespaçado, nunca imagem (o Outlook bloqueia imagens
   e a pessoa tem de a poder copiar). */
export function caixaMultibanco(mb, totalCents) {
  const campo = (rotulo, valor, grande) => `
          <p style="margin:0 0 4px 0;font-family:${FONTE};font-size:12px;line-height:16px;color:#cfcfcf;text-transform:uppercase;letter-spacing:1px;">${esc(rotulo)}</p>
          <p style="margin:0 0 ${grande ? '16' : '12'}px 0;font-family:'Courier New',Courier,monospace;font-size:${grande ? '28' : '20'}px;line-height:${grande ? '34' : '26'}px;font-weight:bold;color:#ffffff;letter-spacing:${grande ? '3' : '1'}px;white-space:nowrap;">${esc(valor)}</p>`;
  const validade = mb.validade ? new Date(mb.validade * 1000).toLocaleDateString('pt-PT', { timeZone: 'Europe/Lisbon' }) : null;
  return `<tr><td class="p" style="padding:14px 40px 6px 40px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${TINTA}" style="background-color:${TINTA};border-radius:8px;">
        <tr><td align="center" style="padding:22px 24px 10px 24px;">
          ${campo('Entidade', mb.entidade, true)}
          ${campo('Referência', mb.referencia, true)}
          ${campo('Valor', `${(totalCents / 100).toFixed(2).replace('.', ',')} EUR`)}
          ${validade ? campo('Válida até', validade) : ''}
        </td></tr>
      </table>
    </td></tr>`;
}

/* O botão: VML para o Outlook clássico, tabela para os outros. 48 px de altura. */
export function botao(url, txt) {
  return `<tr><td align="center" class="p" style="padding:18px 40px 8px 40px;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(url)}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="18%" strokecolor="${TINTA}" fillcolor="${TINTA}">
        <w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${esc(txt)}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr><td align="center" bgcolor="${TINTA}" style="background-color:${TINTA};border-radius:8px;">
          <a href="${esc(url)}" style="display:block;min-width:180px;padding:14px 28px;font-family:${FONTE};font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(txt)}</a>
        </td></tr>
      </table>
      <!--<![endif]-->
    </td></tr>`;
}

/* O documento inteiro: o logótipo, o título, o subtítulo (o número e a data), o corpo e o
   rodapé. `preheader` é a linha que a lista de mensagens mostra. */
export function documento({ assunto, preheader, titulo, subtitulo, corpo, logo, marca, site }) {
  const dominio = String(site || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="pt-PT" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">
<title>${esc(assunto)}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<style>table,td,div,p,a,h1,h2{font-family:Arial,sans-serif !important;}</style>
<![endif]-->
<style>
  html,body{margin:0 !important;padding:0 !important;width:100% !important;}
  body{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;display:block;}
  a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;}
  @media only screen and (max-width:620px){
    .w{width:100% !important;}
    .p{padding-left:20px !important;padding-right:20px !important;}
    .h1{font-size:24px !important;line-height:30px !important;}
  }
  @media (prefers-color-scheme:dark){
    .bg:not([class^="x_"]){background-color:#0d0d0d !important;}
    .card:not([class^="x_"]){background-color:#161616 !important;}
    .t:not([class^="x_"]),.t:not([class^="x_"]) *{color:#f4f4f4 !important;}
    .t2:not([class^="x_"]),.t2:not([class^="x_"]) *{color:#b8b8b8 !important;}
    .hr:not([class^="x_"]){border-color:#2e2e2e !important;}
  }
  [data-ogsb] .bg{background-color:#0d0d0d !important;}
  [data-ogsb] .card{background-color:#161616 !important;}
  [data-ogsc] .t,[data-ogsc] .t *{color:#f4f4f4 !important;}
  [data-ogsc] .t2,[data-ogsc] .t2 *{color:#b8b8b8 !important;}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background-color:${FUNDO};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="bg" style="background-color:${FUNDO};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="w card" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:12px;">
    <tr><td align="center" bgcolor="#ffffff" style="background-color:#ffffff;padding:28px 40px 8px 40px;border-radius:12px 12px 0 0;">
      <img src="${esc(logo)}" width="72" height="64" alt="${esc(marca)}" style="display:block;width:72px;height:64px;border:0;">
    </td></tr>
    <tr><td class="p" style="padding:16px 40px 2px 40px;">
      <h1 class="h1 t" style="margin:0 0 6px 0;font-family:${FONTE};font-size:26px;line-height:32px;font-weight:700;color:${TINTA};">${esc(titulo)}</h1>
      <p class="t2" style="margin:0;font-family:${FONTE};font-size:14px;line-height:20px;color:${TEXTO2};">${esc(subtitulo)}</p>
    </td></tr>
${corpo}
    <tr><td style="padding:0 0 22px 0;font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="w" style="width:600px;max-width:600px;">
    <tr><td align="center" class="t2" style="padding:18px 24px;font-family:${FONTE};font-size:12px;line-height:18px;color:${RODAPE};">
      Recebeu este email porque fez uma encomenda em ${esc(dominio)}. É um email transaccional, não é publicidade.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
