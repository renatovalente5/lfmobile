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
| `/` | Capa (a escolha do modelo para reparar, com a retoma ao lado), as categorias, a campanha a correr, os destaques, as películas e a loja. Em todas as páginas, por cima do rodapé: 5,0 no Google (com a ligação para as opiniões) · orçamento grátis · envios 24/48 h · levantamento grátis |
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

## 12. Os contactos e o mapa (9 nov 2026)

O Renato: «Melhora a página de contactos. E o mapa demora a carregar quando abro a página, meio que já
devia estar carregado.» O mapa do Google põe cookies e só podia carregar depois de a pessoa o pedir (o
site não tem aviso de cookies). Passou a ser um mapa desenhado pelo próprio site: `scripts/mapa.mjs`
faz uma consulta ao Overpass (as ruas, o rio e as zonas à volta da loja, do OpenStreetMap), desenha um
SVG e guarda-o em `media/mapa/loja.svg`; o gerador escreve-o dentro da página. Aparece logo, não manda
nada a ninguém e leva o crédito «© OpenStreetMap» (ODbL). Tocar no mapa abre o Google Maps («Como
chegar»). Só se volta a correr o script se a loja mudar de sítio (`local.coordenadas`, que o painel
não edita). A página ficou com três cartões (WhatsApp, telefone, email), a loja (o mapa, a morada e o
horário) e as redes numa linha. As políticas de cookies e de privacidade deixaram de falar do mapa do
Google; as frases da Stripe só aparecem com o pagamento no site ligado.

## 13. O site novo: loja de electrónica, reparações por modelo e retoma com simulação (9 nov 2026)

O Renato esteve com o dono a 9 nov e deixou as notas no WhatsApp. O pedido: «Para a página das
retomas ele quer um sistema como o da Fnac […] igual e melhor», «Para a página das reparações ele
gosta de um sistema como a iServices tem», «ele apenas quer trabalhar com a Apple e Samsung. Mas
[…] as películas de vidro já mete em qualquer telemóvel», «tens de deixar o utilizador escolher que
modelo do telemóvel tem», «Ele quer um site mais de eletrónica e não apenas um site simples de AI
generated, vais ter de caprichar», «campanhas, cupões para os clientes usarem na compra […] integrar
com o Stripe». E das notas: Samsung também nas categorias; tirar a impressão 3D; vender películas
(quem compra diz o modelo); tirar «Vendedor Oficial DIGI»; envios pela **Nacex**, duas tarifas:
**pacote até 5 kg 5,90 €, até 30 kg 14,90 €**.

### 13.1 O que se estudou

- **Fnac, retoma Apple** (fnac.pt/retomas-apple): três passos (simular, entregar ou enviar,
  receber por transferência, dinheiro ou cartão Fnac). A simulação: categoria → modelo →
  capacidade → cor; o «valor estimado» aparece logo como «até X €» e desce a cada resposta
  (funciona? estado geral A/B/C/D, ecrã, laterais, traseira, câmaras, bateria ≥ 85 %, dobrado ou
  líquidos, etiqueta CE), com «este valor depende da avaliação presencial»; no fim, o «Find my
  iPhone» desligado e os dados apagados numa caixa a marcar, e «Vender já». Num iPhone 13 128 GB:
  até 190 €; «Bom (Valor B)» em vez de «Como novo» deu 170 €.
- **iServices, reparações** (iservices.pt/problema): grelha de problemas (ecrã, bateria, botões,
  câmaras, líquidos, antenas, Face ID, porta de ligação, sensores, traseira, som), cada um com a
  explicação e os sintomas; escolha marca → categoria → modelo; a página do modelo com cada
  reparação e o preço («Ecrã desde 138 €», «Bateria 69,95 €»); a página da reparação com dois
  níveis (peça iServices 138 € «Best Seller» / original 203 €), os pontos de cada um e
  «Selecionar loja»; por baixo, películas e capas para aquele modelo. Não há marcação com dia e
  hora: acaba na loja ou em «Pedir orçamento».
- **Stripe, descontos**: uma Checkout Session aceita UM desconto (`discounts: [{ coupon }]` ou
  `[{ promotion_code }]`, ou a caixa `allow_promotion_codes`, nunca os dois). Os cupões da Stripe
  só limitam artigos por id de produto, e os nossos artigos vão como `price_data` (sem produto
  fixo): por isso as regras do cupão (mínimo, categorias, prazo, limite de usos) são nossas, e a
  Stripe recebe o desconto já calculado.

### 13.2 Decisões

1. **Só Apple e Samsung** nos equipamentos: telemóveis, tablets e relógios à venda, reparações e
   retoma. Os acessórios (áudio, capas, carregadores, localizadores) podem ser de outras marcas, e
   as **películas servem qualquer telemóvel**. Saem do site: Huawei (Band 11, Band 11 Pro, Watch
   D2), OPPO A5x, ZTE Blade V70 Max, Redmi Pad Pro, Blackview Tab 10 Pro e a Dolce Gusto; a
   impressão 3D; os computadores e as consolas (não são Apple nem Samsung: voltam se o dono os
   quiser); o «Vendedor Oficial DIGI».
2. **Categorias da loja:** iPhone · Samsung · Recondicionados · Tablets · Smartwatches · Áudio ·
   Películas · Acessórios.
3. **Um ficheiro de modelos** (`content/aparelhos.json`): marcas, famílias (iPhone, iPad, Apple
   Watch, Galaxy S, Z, A, Note, Tab, Watch) e cada modelo com as capacidades. Serve as reparações,
   a retoma e a escolha do modelo nas películas. O dono acrescenta os modelos novos no painel.
4. **Reparações como a iServices, e melhor** (`content/reparacoes.json`): os tipos de reparação
   (com o desenho, a explicação, os sintomas e, no ecrã, dois níveis: compatível e original) e os
   preços por modelo. `/reparacoes/`: escolher o equipamento (marca → família → modelo, com
   procura) e a grelha dos problemas. `/reparacoes/<modelo>/`: as reparações daquele modelo com o
   preço (ou «Orçamento grátis» quando não há preço), o nível a escolher, e «Marcar reparação»
   com o resumo → WhatsApp com a mensagem pronta; por baixo, as películas e capas para aquele
   modelo. Melhor do que a iServices: tudo numa página (sem ir a outra para escolher o nível), a
   escolha fica por baixo do polegar no telemóvel, e a película escolhe já o modelo.
5. **Retoma como a Fnac, e melhor** (`content/retoma.json`): o valor máximo de cada modelo e
   capacidade, e as perguntas com o desconto de cada resposta (o dono muda os dois). `/retoma/`:
   simulador por passos (marca → modelo → capacidade → estado, uma pergunta de cada vez, com o
   valor a mexer ao lado ou na barra de baixo), o «Encontrar» desligado e os dados apagados, e o
   resultado: valor estimado, como entregar (na loja, ou por envio combinado) e como receber →
   WhatsApp com tudo escrito. Melhor do que a Fnac: Apple E Samsung, uma pergunta por ecrã no
   telemóvel, sem «cor» (não muda o valor), o porquê de cada desconto à vista, e o valor a
   aparecer desde a primeira escolha. Sem valor para um modelo: «avaliamos na loja».
6. **Películas** (categoria própria): vidro temperado, privacidade, mate, câmara e hidrogel. Um
   artigo com «pede o modelo» abre a escolha da marca (Apple, Samsung, Xiaomi, OPPO… ou outra) e
   do modelo (sugestões, ou escrito à mão); sem modelo não se junta ao carrinho, e o modelo segue
   na linha da encomenda até ao dono.
7. **Envios Nacex por peso**: cada artigo tem o peso (ou o da categoria), e a encomenda paga
   5,90 € até 5 kg e 14,90 € até 30 kg (acima, combina-se pelo WhatsApp). O levantamento na loja
   continua grátis.
8. **Campanhas** (`content/campanhas.json`, públicas): nome, datas, a frase da faixa do topo, e
   um desconto em percentagem nas categorias, marcas ou artigos escolhidos. Uma campanha activa
   põe a faixa, o cartão na página inicial, a etiqueta e o preço riscado nos artigos, e tem página
   própria (`/campanhas/<nome>/`). A publicação de todas as noites liga-a e desliga-a nas datas.
   O preço riscado é o preço normal do artigo; o painel lembra que tem de ser o mais baixo dos 30
   dias anteriores (DL 70/2007, art. 5.º). Fica preparada a «Black Friday» (por publicar).
9. **Cupões** (privados: no KV do Worker, nunca no repositório, que é público): código,
   percentagem, valor fixo ou portes grátis, compra mínima, datas, limite de usos, uma vez por
   cliente, e (opcional) só em certas categorias. No carrinho, «Tem um cupão?» pergunta ao Worker
   e mostra o desconto; no `/checkout` o Worker confere tudo outra vez. Em modo «online» a Stripe
   recebe um cupão de uso único com o valor calculado (aparece «Cupão X −5,00 €» na página dela);
   em modo «encomenda» o desconto vai na encomenda e nos emails. Os usos contam-se quando a
   encomenda fica registada (encomenda) ou paga (online).
10. **Desenho de loja de electrónica**, à volta do logótipo que existe: barra de campanha, cabeçalho
    com procura e menu de categorias, página inicial em mosaico (campanha, reparar, vender), filas
    de artigos, os artigos sem o fundo da fotografia em cartões claros iguais, filtros e ordenação
    na loja, desenhos próprios de cada tipo de aparelho nas reparações e na retoma. Preto, branco e
    o dourado da marca; cantos redondos; Manrope.
11. **Preços e valores**: o dono ainda não deu os preços das reparações nem os valores da retoma.
    Ficam como referência do mercado (iServices e Fnac, 9 nov 2026) marcados «por confirmar» na
    pré-visualização, como os dados legais. A produção não mostra nenhum por confirmar: sem a
    confirmação do dono, a página diz «Orçamento grátis» / «avaliamos na loja».

### 13.3 O que muda no Worker das encomendas

Catálogo v3 (o peso, «pede o modelo», as campanhas já aplicadas ao preço com início e fim, as
tarifas da Nacex); a linha da encomenda leva o modelo escrito pelo cliente; os portes pelo peso;
`POST /cupao` (conferir um código para o carrinho) e o cupão no `/checkout`; `GET/PUT/DELETE
/painel/cupoes` para o painel; os emails e o resumo com o desconto. O contrato está no
`docs/ENCOMENDAS.md`.

### 13.4 O que muda no painel (feito a 10 nov 2026)

Ecrãs novos: **Reparações** (a marca e a família, a procura, os preços de cada modelo numa grelha
— o ecrã por nível —, um modelo novo no princípio da família, «Ajustar os preços desta família» por
uma percentagem), **Retoma** (os valores por modelo e capacidade, o que fica com cada resposta ou
«Avaliamos na loja», as formas de receber e de entregar, o mínimo), **Campanhas** e **Cupões** (no
Worker das encomendas, sem passar pelo repositório). As capacidades de um modelo escolhem-se na ficha
dele. Na ficha do artigo: o peso e «pede o modelo»; nas Categorias, o peso. Em Dados da loja: a
transportadora e os escalões dos portes; saiu a DIGI. Saiu o ecrã Serviços. Os preços e os valores
já estão confirmados (§13.6): o painel não mostra o «Confirmo». As regras entram no `regras.mjs`
(copiado byte a byte); todos os artigos têm o `pedeModelo` escrito (o painel escreve sempre os
interruptores).

### 13.5 O que falta do dono

- Se ainda repara computadores e consolas (saíram do site com o «só Apple e Samsung»).
- A conta da Stripe (ficou de a criar a 9 nov) e o resto da §9.

### 13.6 O Renato, 9 nov à noite: «repara qualquer marca», e os preços ficam os do mercado

«Usar os preços das reparações e das retomas os mesmo que encontras na net ou os que achas que
valem. Repara qualquer marca ele. Os preços podes meter os que quiseres e ele depois ajusta no
Backoffice.» O que mudou (substitui a decisão 1 nas reparações e a 11):

1. **As reparações são de todas as marcas.** A lista dos modelos ganhou Xiaomi (Redmi, POCO, Pad,
   Watch), Huawei, OPPO, Google, Motorola, Honor, OnePlus, realme, vivo, Nothing, Sony, TCL, Nokia,
   ZTE e Alcatel, e as séries Galaxy M, J e XCover, os iPad desde 2014, o Apple Watch Series 3, mais
   Galaxy Tab e Galaxy Watch. A escolha do aparelho mostra Apple e Samsung, e «Outras» abre as
   outras marcas; por baixo, «Outra marca ou modelo? Pergunte-nos pelo WhatsApp». A venda continua
   só Apple e Samsung nos telemóveis, e a **retoma também** (o simulador só tem essas famílias).
2. **Os preços das reparações** são os da iServices (recolhidos a 9-10 nov, um pedido por segundo,
   das páginas públicas de cada modelo). Um modelo com dois preços ou menos herda os que faltam do
   irmão mais próximo da mesma linha (o S26 do S25, o Galaxy A57 do A56), até 3 anos de diferença
   (ou 2 números no nome, nas marcas sem ano). Sem irmão, «Orçamento grátis» (o iPhone Duo e o
   Galaxy Z TriFold, sem base nenhuma). Dois tamanhos do mesmo relógio: fica o preço mais alto.
3. **Os valores da retoma**: os da Fnac e da iServices onde os há; nos outros modelos e
   capacidades, uma estimativa pela geração e pela capacidade (os mais antigos, aos 5 €). Dois
   valores do mercado estavam ao contrário e foram corrigidos (o Galaxy S22+ acima do S22 Ultra; o
   A34 acima do A54).
4. **`confirmado: true`** nas reparações e na retoma: os preços aparecem sem a marca «por
   confirmar», também em produção. O dono ajusta-os no painel (ecrãs Reparações e Retoma, §13.4).
5. **As películas de vidro** têm preço: temperado 9,90 €, privacidade 14,90 €, mate 12,90 €,
   câmara 7,90 € (a de hidrogel continua a 12,50 €).
6. **A folha de cálculo** de 9 nov já não é precisa (o dono ajusta no painel). A retoma fica com
   as formas de pagar e de entregar que já tinha (dinheiro, transferência ou desconto; na loja ou
   por envio combinado).

### 13.7 O Renato, 10 nov: arrumar o site, e o painel em sintonia

«Porque não criaste um separador para Apple e criaste um separador para Samsung?» — a categoria
iPhone não tinha artigos novos (os iPhone estão em Recondicionados) e escondia-se. Agora:

1. **Apple e Samsung são categorias de marca** (`marca` em `categorias.json`; a «iphone» passou a
   «apple»): juntam os artigos da marca de todas as categorias, e estão sempre na fila e no menu.
   As campanhas e os cupões de uma dessas categorias apanham os artigos da marca (`docs/ENCOMENDAS.md` §8).
2. **«Vender o meu» e «Retoma» eram a mesma coisa**: fica a **Retoma**, junto das **Reparações**, ao
   lado do carrinho; a fila de baixo é só a loja. A página da retoma diz as duas formas: **Vender**
   (compramos o seu, em dinheiro ou por transferência) e **Retoma** (desconto numa compra), tiradas
   das formas de receber.
3. **A página inicial ficou curta**: saiu a grelha dos problemas (está nas Reparações) e a faixa da
   retoma (repetia o cartão da capa). Saíram do `inicio.json` a secção das reparações e os campos que
   o gerador não lia (o segundo botão da capa e as ligações).
4. **O menu do telemóvel**: os dois serviços em cartões, a loja numa grelha de duas colunas, a ajuda
   em quatro linhas, e o WhatsApp — cabe quase num ecrã.
5. **O painel** acompanha tudo isto (§13.4 e o repositório do painel).
6. **As garantias numa faixa só** (o Renato, com uma captura: «estão um bocado repetidos»): saiu da
   página inicial a faixa por cima da loja (Google · desde 2020 · envios · loja em São Roque). Fica a
   do rodapé, em todas as páginas, que abre com a nota do Google e a ligação para as opiniões, no
   lugar da «Retoma do seu usado» (a Retoma já está no topo de todas as páginas).
7. **Os efeitos ao descer, como no site da Apple** (o dono pediu-os na loja a 9 nov; no WhatsApp a 10:
   «Se der para meter, dá um toque ao site!»). Vistos no apple.com/pt: os blocos entram quando chegam
   ao ecrã (sobem 30 px em 0,7 s, acendem em 0,9 s, uns atrás dos outros), e as fotografias acompanham
   o scroll. Aqui: `site.js` («o movimento ao descer») só esconde o que está abaixo do ecrã quando a
   página abre (nada pisca; sem JavaScript está tudo à vista), e numa fila que desliza de lado entra a
   fila inteira; o CSS anima com `translate`/`scale` (o `:hover` dos cartões fica intacto). Onde o
   browser anima com o scroll (`animation-timeline`): os cartões da capa recuam ao sair, a fotografia
   da capa sobe mais devagar, a da loja e a do «Sobre» aproximam-se e as películas flutuam. Com
   «reduzir movimento» no sistema, nada disto. O rodapé acaba na linha legal (o botão do WhatsApp sai
   quando ela aparece), e na capa a escolha do modelo passou para baixo do texto e da fotografia, a toda
   a largura do cartão (cortava «Escolha o modelo»).

