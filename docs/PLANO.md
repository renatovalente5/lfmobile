# LF Mobile — plano do site

Pedido do Renato a 8 nov 2026, depois da conversa com o dono no Instagram. Decisões dele: pagamentos **Stripe**
(a ligação final à conta Stripe do dono fica para quando o site estiver pronto); formulário de **retoma**
(«vende-nos o teu telemóvel»); **domínio só no fim**; dados legais com **marcadores** até ao fim.

O material recolhido (87 publicações, fotografias, logótipo, notas) está em `_cliente/` (fora do git).
O resumo da marca: `_cliente/notas/resumo-instagram-2026-11-08.md`.

## 1. A marca em três linhas

LF Mobile repara smartphones, tablets, computadores e consolas, vende equipamentos novos e recondicionados
e acessórios, em São Roque (Oliveira de Azeméis), desde 2020 (antes «Smartphone Repair»; loja física desde
5 set 2026). Preto e branco, dourado nos pormenores, madeira clara na loja. Tom: próximo, directo, honesto
(«orçamento gratuito», «preços justos», «reparar é cuidar»).

## 2. Registo e língua

Português de Portugal, só. Tratamento **formal-neutro** («o seu telemóvel», «peça orçamento»): a clientela
inclui pessoas mais velhas (o próprio dono o disse) e o cartão impresso da loja já diz «Obrigado pela sua
confiança». Pouco texto; o óbvio não se explica.

## 3. Páginas

| Página | Conteúdo |
|---|---|
| `/` | Capa, barra de confiança (5,0 no Google · desde 2020 · envios 24/48 h · Vendedor Oficial DIGI), destaques da loja, reparações, retoma, cartão das películas, a loja, contactos |
| `/loja/` | Catálogo com filtros por categoria e procura; cartões com preço c/ IVA, «Adicionar» |
| `/loja/<artigo>/` | Ficha: fotografias, preço, descrição, características, disponibilidade, «Adicionar ao carrinho», «Perguntar no WhatsApp» |
| `/reparacoes/` | Serviços por tipo de equipamento; «Pedir orçamento gratuito» → WhatsApp com a mensagem composta |
| `/retoma/` | Formulário (marca/modelo, capacidade, estado, acessórios) → WhatsApp com a proposta de retoma |
| `/carrinho/`, `/checkout/`, `/obrigado/` | Carrinho, dados + entrega (levantar na loja grátis ou envio para Portugal Continental), Stripe ou modo encomenda |
| `/sobre/` | História (2020 → 2026), a loja, o que prometem |
| `/contactos/` | Morada, horário, telefone com a nota da chamada, WhatsApp, mapa com consentimento, redes |
| `/legal/*` | Termos (com livre resolução), privacidade, cookies, envios e devoluções, RAL; Livro de Reclamações só no rodapé |

## 4. Catálogo inicial (do Instagram, set–nov 2026)

Categorias: Telemóveis · Recondicionados · Tablets · Smartwatches · Áudio · Acessórios · Outros.
Preços publicados pelo dono (c/ IVA). Os recondicionados ficam «disponibilidade a confirmar» até o dono
confirmar o stock. Sem preço (A17, ZTE, capas): «sob consulta», com botão de WhatsApp.

## 5. Pagamentos e encomendas

- Stripe Checkout alojado (cartão, MB WAY, Multibanco) criado por um Worker na Cloudflare, como no Armazém
  dos Pneus; o Worker revalida os preços a partir do catálogo publicado.
- **Modo encomenda** enquanto não há conta Stripe: o checkout regista a encomenda no Worker, envia os emails
  (dono + cliente) e mostra o resumo com os dados para pagar na loja ou por MB WAY ao número da loja; o
  interruptor fica no backoffice.
- Botão: «Encomendar e pagar» / «Pagar agora» — nunca «com obrigação de pagar».
- Facturação: manual, pelo dono, no programa dele, quando a Stripe confirma o pagamento.

## 6. Backoffice (dono autónomo)

Produtos (criar, editar, fotografias, ordem, disponibilidade), textos da capa e do «Sobre», definições
(horário, contactos, portes, dados legais, interruptor dos pagamentos), encomendas (ver, marcar levantada /
enviada, abrir na Stripe). Entrada por código de 8 algarismos por email. Secções em gavetas, listas a
arrastar, «Editar», «Histórico».

## 7. Marcadores a preencher no fim

`{{firma}}`, `{{nif}}`, `{{email}}`, portes, domínio, conta Stripe, email do dono para o painel. A construção
de produção falha enquanto faltarem (pré-visualização aceita marcadores).

## 8. Fora do site

Opiniões do Google e do Instagram **não se copiam** (DL 57/2008, art. 8.º, al. cc); fica a nota agregada com
ligação ao Google. Fotografias com pessoas: nenhuma (só mãos). A ficha do Google aponta para a Shopify
abandonada: trocar quando o site estiver no ar.

## 9. Estado a 8 nov 2026

Feito e publicado em pré-visualização (https://renatovalente5.github.io/lfmobile/, noindex):

- O site inteiro: início, loja com 7 categorias e 23 artigos do Instagram, fichas com carrinho,
  reparações (6 serviços + pedido de orçamento pelo WhatsApp), retoma (formulário → WhatsApp),
  contactos (mapa do Google só se o pedir), sobre, perguntas frequentes, envios e devoluções, e as
  páginas legais da legal-comum (termos, privacidade, cookies, garantia, RAL, desistir).
- O carrinho (`src/scripts/carrinho.js`) e o checkout em **modo «encomenda»** (sem Stripe): a
  encomenda vai para o Worker `lfmobile-encomendas` (docs/ENCOMENDAS.md), que a regista e manda os
  emails; a página «obrigado» mostra o resumo. Em modo «online» o mesmo checkout abre a Stripe.
- Testes (`scripts/testar.mjs`) no CI antes de cada publicação; entre eles, a prova de que a
  produção (`--producao`) constrói quando os dados legais estiverem preenchidos.
- O painel (`renatovalente5/lfmobile-painel`) e o Worker das encomendas: construídos em paralelo
  (ver os README de cada um).

Por fazer no fim, com o cliente (os marcadores da §7): o email da loja, o nome ou firma e o NIF,
os portes para o continente, a garantia dos recondicionados (18 meses por acordo, ou 3 anos), as
chaves da Stripe (modo «online»), o domínio (lfmobile.pt estava livre a 8 nov) e, com ele, o
Resend para os emails, o custom domain do painel e a abertura aos motores de busca.

O Resend tem de estar ligado ANTES de abrir: os termos (em modo «encomenda» e em «online») prometem o
email com o resumo da encomenda, e sem a chave o Worker não manda nenhum.

## 10. Pedidos do Renato a 8 nov 2026 (feitos)

Ficha só com o essencial (etiqueta marca · estado, uma ou duas frases, características sem repetir, o
botão, a entrega e a garantia numa linha cada); Sobre curto, com a fachada num tamanho contido; rodapé
sem a coluna dos contactos e do horário; sem o aviso da cópia de segurança na retoma; os cantos dos
botões (o mapa cortava o canto do botão que o retira). O pagamento nos termos e nas perguntas segue o
modo da loja.

## 11. As outras páginas, simples e diretas (8 nov 2026)

O Renato: «melhora também as outras páginas, faz algo simples, moderno e intuitivo». Cada página ficou
com um título, uma frase, o conteúdo e uma acção principal, sem repetir o que outra página diz:
- sem migalhas nas páginas de primeiro nível (ficam na ficha do artigo; o JSON-LD continua em todas);
- início: a faixa com quatro pontos, as reparações em azulejos com um botão, a retoma numa faixa só, a
  loja com a morada e o horário numa coluna;
- loja: sem o texto dos portes por cima e sem contagens nas categorias; nos recondicionados, o cartão
  mostra só a grade;
- reparações: o cartão inteiro leva ao pedido de orçamento com o equipamento escolhido; o pedido num
  bloco, sem passos nem notas;
- retoma: «Algum problema?» em vez de «Funciona tudo?»; envios: três cartões (envios, levantamento,
  devoluções); encomenda: os títulos dos blocos dentro dos cartões;
- os termos já não falam da Stripe nem do «enquanto o pagamento não estiver ligado» fora do modo certo.
