// A RETOMA, como a da Fnac e melhor (o Renato, 9 nov 2026: «Para a página das retomas ele quer um
// sistema como o da Fnac, analisa para fazeres igual e melhor»). Um simulador por passos: a marca
// (Apple ou Samsung), o modelo (com procura), a capacidade e o estado, uma pergunta de cada vez,
// com o valor a mexer ao lado (computador) ou na barra de baixo (telemóvel). No fim, o valor
// estimado com o porquê de cada desconto, como entregar e como receber, e o pedido pelo WhatsApp
// com tudo escrito. O simulador é do browser (src/scripts/retoma.js), com os dados desta página; a
// conta é a de src/lib/regras.mjs (valorDaRetoma), repetida lá.
// Melhor do que a Fnac: Apple E Samsung; uma pergunta por ecrã no telemóvel; sem a cor (não muda
// nada); o valor desde a primeira escolha; o porquê de cada desconto à vista; sem conta nem envio
// de dados para o site (só o WhatsApp, que a pessoa envia se quiser).
import { esc } from './util.mjs';
import { icones } from './icones.mjs';
import { spriteAparelhos } from './aparelhos.mjs';
import { migalhas, notaPorConfirmar } from './componentes.mjs';
import { capacidadeTexto } from '../lib/regras.mjs';

export function retoma(ctx) {
  const m = migalhas(ctx, [{ nome: 'Início', caminho: '/' }, { nome: 'Retoma', caminho: '/retoma/' }]);
  const r = ctx.retoma;
  const familias = ctx.aparelhos.familias.filter((f) => r.familias.includes(f.id));
  const modelos = ctx.aparelhos.modelos.filter((x) => r.familias.includes(x.familia));
  const marcas = ctx.aparelhos.marcas.filter((mm) => familias.some((f) => f.marca === mm.id));
  const dados = {
    marcas: marcas.map((x) => ({ id: x.id, nome: x.nome })),
    familias: familias.map((f) => ({ id: f.id, nome: f.nome, marca: f.marca })),
    modelos: modelos.map((x) => ({ id: x.id, nome: x.nome, familia: x.familia, marca: x.marca, desenho: x.desenho, capacidades: x.capacidades.map((c) => ({ gb: c, texto: capacidadeTexto(c) })) })),
    valores: r.valores,
    perguntas: r.perguntas,
    minimo: r.minimo,
    receber: r.receber,
    entregar: r.entregar,
    porConfirmar: r.porConfirmar,
  };
  const c = ctx.site.contactos;
  const conteudo = `${spriteAparelhos()}
<section class="ret-capa">
  <div class="contentor ret-capa__dentro">
    <p class="rotulo rotulo--claro">Retoma</p>
    <h1 class="ret-capa__titulo">Quanto vale o seu telemóvel?</h1>
    <p class="ret-capa__sub">Responda a umas perguntas e veja o valor na hora. Sem compromisso.</p>
    <ol class="ret-capa__passos">
      <li><span>1</span>Simule aqui</li>
      <li><span>2</span>Entregue na loja</li>
      <li><span>3</span>Receba o valor</li>
    </ol>
  </div>
</section>
<div class="contentor retoma-pagina">
  ${r.porConfirmar ? notaPorConfirmar(ctx, 'valores de referência do mercado, a confirmar pela loja') : ''}
  <div class="simulador" data-simulador>
    <div class="simulador__palco" data-palco aria-live="polite">
      <noscript><p>O simulador precisa de JavaScript. Pode sempre pedir uma proposta pelo <a href="${ctx.whatsapp('Olá! Quero vender o meu telemóvel (retoma).')}">WhatsApp</a>.</p></noscript>
    </div>
    <aside class="simulador__lado" data-lado aria-label="A sua simulação">
      <div class="simulador__aparelho" data-lado-aparelho>
        <span class="simulador__aparelho-vazio">${icones.telemovel}</span>
        <p><strong data-lado-nome>O seu telemóvel</strong><span data-lado-detalhe>Escolha a marca e o modelo.</span></p>
      </div>
      <div class="simulador__valor" data-lado-valor hidden>
        <p class="simulador__valor-rotulo" data-lado-rotulo>Valor estimado</p>
        <p class="simulador__valor-numero" data-lado-numero></p>
        <p class="simulador__valor-nota">O valor confirma-se na loja, com o telemóvel à frente.</p>
      </div>
      <ol class="simulador__etapas" data-etapas>
        <li data-etapa="aparelho">O aparelho</li>
        <li data-etapa="estado">O estado</li>
        <li data-etapa="valor">O valor</li>
      </ol>
    </aside>
  </div>
  <section class="ret-antes" aria-labelledby="antes-titulo">
    <h2 class="titulo-seccao" id="antes-titulo">Antes de entregar</h2>
    <ul class="ret-antes__lista">
      <li>${icones.cadeado}<h3>Desligue o «Encontrar»</h3><p>No iPhone, o «Encontrar o iPhone»; no Samsung, a conta Samsung e a conta Google. Sem isto não o podemos aceitar.</p></li>
      <li>${icones.software}<h3>Faça uma cópia e apague tudo</h3><p>Guarde as fotografias e os contactos e reponha as definições de fábrica. Se precisar, ajudamos na loja.</p></li>
      <li>${icones.documento}<h3>Traga um documento</h3><p>Pedimos o documento de identificação de quem vende e, se a tiver, a fatura da compra.</p></li>
    </ul>
  </section>
  ${c.whatsapp ? `<aside class="convite" aria-label="Fale connosco"><p class="convite__titulo">Tem outro aparelho para vender? Pergunte-nos.</p><div class="convite__botoes"><a class="botao botao--whatsapp" href="${ctx.whatsapp('Olá! Quero vender um aparelho (retoma): ')}" target="_blank" rel="noopener">${icones.whatsapp}<span>Falar no WhatsApp</span></a></div></aside>` : ''}
</div>
<script type="application/json" id="dados-retoma">${JSON.stringify(dados).replace(/</g, '\\u003c')}</script>`;
  return {
    caminho: '/retoma/',
    titulo: 'Retoma: quanto vale o seu iPhone ou Samsung?',
    descricao: `Simule a retoma do seu iPhone ou Samsung Galaxy e veja o valor na hora. Entregue na loja da ${ctx.site.marca}, em ${ctx.site.local.localidade}, e receba o valor.`,
    classe: 'pagina-retoma',
    jsonld: [m.ld],
    conteudo,
  };
}
