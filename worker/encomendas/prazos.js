/* OS PRAZOS DO PAGAMENTO NO SITE, num sítio só: o Worker usa-os (pagamento.js) e o site di-los nos termos
   (scripts/build.mjs importa este ficheiro). Mudar um número aqui muda os dois. */

/* Quanto tempo uma encomenda fica à espera do pagamento quando ninguém pediu uma referência Multibanco: o
   MB WAY dá 4 minutos por pedido e o formulário do cartão uns minutos; uma hora chega para tentar outra
   vez ou escolher outra forma (como a página da Stripe dava). Depois a varredura dá-a por expirada. */
export const PRAZO_MINUTOS = 60;

/* Os dias de uma referência Multibanco (o expiryDays da ifthenpay): conta-se a partir de hoje, e a
   referência vale até ao fim do último dia. */
export const DIAS_MULTIBANCO = 3;

/* Quantas vezes se pode pedir o pagamento de uma encomenda (o primeiro e as tentativas na página de
   pagamento): cada MB WAY chega ao telemóvel de alguém, e quem encomenda pode escrever o de outra pessoa. */
export const MAX_PEDIDOS = 6;
