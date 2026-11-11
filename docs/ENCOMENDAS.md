# As encomendas da LF Mobile: o contrato entre o site, o Worker e o painel

Escrito a 8 nov 2026. Três peças falam entre si; este ficheiro diz como, para cada uma se
construir sem ver as outras.

- **O site** (este repositório): `src/scripts/carrinho.js` guarda o carrinho no browser, lê os
  preços do catálogo publicado (`assets/catalogo.json`, a forma está em `scripts/build.mjs`,
  `const catalogo`) e fala com o Worker em `document.body.dataset.api` (o `--api=` do build;
  por omissão `https://lfmobile-encomendas.renato-lima-valente-dcb.workers.dev`).
- **O Worker das encomendas** (`worker/encomendas/`, nome `lfmobile-encomendas`): recebe a
  encomenda, volta a fazer as contas do seu lado com o catálogo publicado, guarda-a no KV,
  manda os emails e, em modo «online», abre a página segura da Stripe e ouve os webhooks.
- **O painel** (`renatovalente5/lfmobile-painel`): lista e marca as encomendas através do
  Worker (nunca lê o KV directamente), com um segredo partilhado.

## 1. Modos

O `content/site.json` do site diz `pagamentos.modo`: `"encomenda"` (o de agora: sem chaves da
Stripe; a encomenda regista-se e o dono confirma o pagamento e a entrega) ou `"online"` (a
Stripe: cartão, MB WAY, Multibanco; quando o Renato ligar a conta do cliente, no fim). O
catálogo publicado leva o `modo`; o Worker lê-o de lá (`MODO` nas vars só o pode forçar para
`encomenda`, como travão). Em modo «online» sem `STRIPE_SECRET_KEY` o Worker responde 503 com
`{ erro: 'O pagamento no site não está ligado. Encomende pelo WhatsApp.' }`.

## 2. O que o site envia: `POST /checkout`

```json
{
  "linhas": [{ "produto": "fones-p9", "opcoes": [1], "qtd": 2 }],
  "entrega": "levantamento",
  "cliente": { "nome": "…", "email": "…", "telefone": "…", "nif": "123456789",
               "morada": "…", "codigoPostal": "0000-000", "localidade": "…", "notas": "…" },
  "termos": true,
  "total_cents": 11980,
  "pedido": "9f2c7a1b3d4e5f6a7b-1c2d3e4f"
}
```

- `opcoes`: o índice escolhido em cada grupo de `produto.opcoes` do catálogo (o mesmo índice do
  site); `[]` quando o artigo não tem escolhas. O Worker ignora índices a mais e trata um índice
  em falta como o primeiro valor sem acréscimo (a mesma regra de `carrinho.js`, `escolhasDe`).
- `entrega`: `levantamento` ou `continente` (os ids de `site.entrega.zonas`). Com `continente`
  a morada, o código postal (`0000-000`) e a localidade são obrigatórios.
- `nif`, `morada`, `codigoPostal`, `localidade`, `notas`: opcionais (ausentes, não vazios). O código
  postal, além da forma `0000-000`, tem de ser do continente (começa por 1 a 8): o site só envia
  para lá, e o Worker responde 400 com `campo: "codigoPostal"` e a frase a dizer isso.
- `total_cents`: o que o site mostrou. É só para comparar: se o Worker chegar a outro total
  (um preço mudou entretanto) responde 409 `{ erro: 'Os preços mudaram entretanto. Actualizámos o
  carrinho: veja o total e envie outra vez.', campo: 'precos' }`; o carrinho vai buscar o catálogo
  sem a cache do browser (o GitHub Pages guarda-o 10 minutos), confere o cupão outra vez e
  redesenha o resumo com o total de agora.
- `pedido` (opcional): a tentativa de encomenda — uma semente por separador e o resumo (FNV-1a) do
  pedido, `[A-Za-z0-9_-]{16,80}`. A mesma tentativa duas vezes (a resposta perdeu-se e a pessoa
  carregou outra vez) devolve a MESMA encomenda (`idem:<pedido>` no KV, 1 dia); outro carrinho ou
  outros dados dão outro identificador, e outra encomenda.

**O Worker refaz as contas** com o catálogo publicado (`SITE_URL/assets/catalogo.json`, sem
cache mais de 60 s): o preço de cada artigo pela regra `precoDe` (a promoção só entre
`promocaoDesde` e `promocaoAte` — antes de começar e depois de acabar, o preço normal; um preço
anterior que não é maior do que o de venda não conta), os acréscimos das escolhas, os portes
(`portes.continente`, grátis a partir de `portes.gratisAPartirDe`, zero no levantamento; acima do
último escalão de peso ficam por confirmar, mesmo com os portes grátis ou um cupão de portes).
Recusa (400, `{ erro, campo? }`, frases em português para o site mostrar tal e qual): artigo que
não existe ou não é `compravel`; artigo `enviavel: false` com entrega `continente` («só se levanta
na loja»); quantidade fora de 1–20 (por linha, e somada por artigo: três linhas iguais de 7 não
passam);
email inválido; telefone sem 9 a 15 algarismos; NIF com dígito de controlo errado; `termos`
que não seja `true`; portes por definir (`null`) com entrega `continente` em modo «online» (em
modo «encomenda» a encomenda segue com `portes_por_confirmar: true` e o email diz-o).

Respostas boas (200):

- modo «encomenda»: `{ "encomenda": "LF-20261108-7K2Q9M", "chave": "…", "estado": "registada", "total_cents": 11980 }`
- modo «online»: `{ "encomenda": "…", "chave": "…", "url": "https://checkout.stripe.com/…", "total_cents": 11980 }`

O site: com `url` segue para lá; com `encomenda` esvazia o carrinho e segue para
`/obrigado/?e=<encomenda>&c=<chave>`. A Stripe volta para `SITE_URL/obrigado/?s={CHECKOUT_SESSION_ID}`
(sucesso) e para `SITE_URL/checkout/?cancelado=1` (cancelar).

CORS: só as origens de `ALLOWED_ORIGINS` (o domínio `https://lfmobile.pt`, desde 11 nov 2026); `OPTIONS` responde às duas rotas públicas. Um travão de 5 pedidos por
minuto por IP no `/checkout` (rate limit binding, como no Armazém dos Pneus).

## 3. O que o site lê: `GET /encomenda?e=<id>&c=<chave>` ou `GET /encomenda?s=<sessão Stripe>`

Só o que a pessoa já sabe, sem email, telefone nem morada (a chave é o segredo da encomenda;
sem ela, ou errada, 404):

```json
{ "encomenda": "LF-20261108-7K2Q9M", "estado": "registada", "modo": "encomenda",
  "entrega": "levantamento", "portes_por_confirmar": false,
  "linhas": [{ "nome": "Auscultadores P9", "qtd": 2, "total_cents": 11980, "escolhas": ["Cor: Prateado"] }],
  "artigos_cents": 11980, "portes_cents": 0, "total_cents": 11980,
  "cliente": { "nome": "Maria" } }
```

`cliente.nome` é só o primeiro nome. Pela sessão da Stripe (`s`) responde o mesmo, se a sessão
for de uma encomenda conhecida (índice `session:`).

## 4. Onde ficam as encomendas: o objecto de cada uma, e a cópia no KV (`ORDERS`, só o Worker escreve)

**A verdade de cada encomenda é o objecto durável dela** (`ENCOMENDA`, classe `Encomenda` em
`objecto.js`; o nome é o id, na jurisdição da UE — desde 11 nov 2026). Lê-se sempre a de agora, e cada
escrita leva a `versao` que leu: se outra passou entretanto, o objecto recusa e quem escreve relê e
repete (`alterarEncomenda` em `encomenda.js`). Com o KV (eventualmente consistente, até 60 s noutro
sítio, e sem escrita condicional), uma nota do painel escrita sobre uma leitura atrasada voltava a pôr
«pendente» por cima do «paga», o `checkout.session.expired` gravava «expirou» por cima de uma anulação
(com os emails), e duas mudanças ao mesmo tempo davam 200 as duas. O objecto apaga-se 400 dias depois
da última escrita. As encomendas de antes do objecto lêem-se do KV até à primeira escrita, que as passa
para lá.

- `order:<id>` → a CÓPIA da última versão (JSON abaixo, com `versao`), 400 dias, escrita pelo objecto
  na mesma passagem e pela ordem das versões, com os metadados da lista do painel.
- `session:<id da Checkout Session>` → `<id>`, `pi:<PaymentIntent>` → `<id>` (modo «online»).
- `evt:<id do evento Stripe>` → `1`, 30 dias (um webhook repetido não repete emails).
- `idem:<pedido>` → a resposta do `/checkout` dessa tentativa, 1 dia (a tentativa repetida).

**Os eventos da Stripe só mexem na encomenda se forem dela** (`eventoNaoBate`): a sessão é a que este
Worker abriu (`stripe.session_id`) e, nos de pagamento, `amount_total` e `currency` são os da
encomenda; o PaymentIntent leva `metadata.encomenda` dela (e é o guardado, quando o há); a cobrança
é desse PaymentIntent. Os outros (um Payment Link da loja com `client_reference_id=LF-…`, por
exemplo) ficam no histórico como «Evento da Stripe ignorado» e não mudam nada. Em modo «online»,
sem `STRIPE_WEBHOOK_SECRET`, o `/checkout` responde 503 (a Stripe cobrava e ninguém sabia). Um
pagamento que chega com a encomenda já anulada, ou marcada paga à mão, não a muda: fica no
histórico e o dono recebe «Pagamento recebido numa encomenda …» (aviso `paga-fora`), para conferir
e, se for o caso, reembolsar. Quando o dono tira uma encomenda de «pendente» no painel, a página de
pagamento fecha-se (`/checkout/sessions/<id>/expire`; se já tem referência Multibanco, cancela-se o
PaymentIntent), e fica dito no histórico.

Os ids: `LF-AAAAMMDD-XXXXXX` (6 caracteres de `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, sem 0/O/1/I):
ordenam por data no `list({ prefix: 'order:' })` e dizem-se ao telefone. A chave: 20 caracteres
do mesmo alfabeto, gerada com `crypto.getRandomValues`.

```json
{
  "v": 1,
  "encomenda": "LF-20261108-7K2Q9M",
  "chave": "…",
  "modo": "encomenda",
  "estado": "registada",
  "entrega": "levantamento",
  "linhas": [{ "produto": "fones-p9", "nome": "Auscultadores P9", "qtd": 2, "opcoes": [1],
               "escolhas": ["Cor: Prateado"], "unidade_cents": 5990, "total_cents": 11980 }],
  "artigos_cents": 11980, "portes_cents": 0, "portes_por_confirmar": false, "total_cents": 11980,
  "cliente": { "nome": "…", "email": "…", "telefone": "…", "nif": "…",
               "morada": "…", "codigoPostal": "…", "localidade": "…", "notas": "…" },
  "termos": { "aceites_em": "2026-11-08T21:02:11.000Z", "pagina": "https://…/termos-e-condicoes/" },
  "stripe": { "session_id": "cs_…", "payment_intent": "pi_…", "metodo": "card", "pago_em": "…" },
  "historico": [{ "em": "2026-11-08T21:02:11.000Z", "estado": "registada", "por": "site" }],
  "notas_painel": [{ "em": "…", "por": "email do dono", "texto": "…" }],
  "criada_em": "2026-11-08T21:02:11.000Z",
  "actualizada_em": "2026-11-08T21:02:11.000Z"
}
```

Estados (`estado`), e quem os põe:

| estado | quem | quando |
|---|---|---|
| `registada` | Worker | modo «encomenda»: a encomenda ficou gravada; o dono confirma o pagamento |
| `pendente` | Worker | modo «online»: a sessão da Stripe foi aberta, ou o Multibanco espera pagamento |
| `paga` | Worker (webhook) ou painel | o pagamento entrou (Stripe), ou o dono recebeu-o (MB WAY, loja) |
| `pronta` | painel | está na loja para levantar (entrega `levantamento`) |
| `enviada` | painel | seguiu pelos correios (entrega `continente`); a nota pode levar o rastreio |
| `levantada` | painel | a pessoa levantou-a |
| `anulada` | painel | o dono anulou (sem pagamento, ou com reembolso feito à parte) |
| `reembolsada` | Worker (webhook) | a Stripe devolveu o dinheiro |
| `falhou` / `expirou` | Worker (webhook) | o pagamento falhou, ou a sessão expirou sem pagar |

Cada mudança acrescenta uma linha ao `historico` (`por`: `site`, `stripe` ou o email de quem
marcou no painel; `nota` opcional).

As transições que o painel pode pedir (o Worker recusa as outras com 409): `registada` →
`paga` | `pronta` | `anulada`; `pendente` → `paga` | `anulada`; `paga` → `pronta` | `enviada` |
`levantada` | `anulada`; `pronta` → `levantada` | `anulada`; `enviada` → `anulada`; `falhou` e
`expirou` → `paga` | `anulada`; `levantada`, `anulada` e `reembolsada` são finais. `pronta` e
`levantada` só com entrega `levantamento`; `enviada` só com `continente`. Marcar `paga` no
painel avisa só o cliente.

Campos que o Worker acrescenta à encomenda, além dos de cima: `avisos` (o resultado de cada email
enviado), `stripe.multibanco` (entidade, referência, validade) e `stripe.reembolsado_cents`.

## 5. O que o painel usa (`Authorization: Bearer <PAINEL_SEGREDO>`; sem ele, 401; sem CORS)

- `GET /painel/encomendas?estado=<…>&desde=<AAAA-MM-DD>&ate=<…>&q=<texto>` → `{ encomendas: [resumo…] }`,
  as mais recentes primeiro (resumo: `encomenda, estado, modo, entrega, total_cents, cliente.nome,
  cliente.telefone, criada_em, actualizada_em, linhas: [{ nome, qtd }]`). `q` procura no id, no
  nome, no email e no telefone (sem acentos nem maiúsculas). Até 200; o resto por `?pagina=`.
- `GET /painel/encomendas/<id>` → a encomenda inteira.
- `POST /painel/encomendas/<id>/estado` `{ "estado": "enviada", "nota": "CTT RR123…", "por": "email do dono" }`
  → a encomenda inteira depois de mudar. Só as transições do painel (tabela acima); outra, 409.
  Manda o email ao cliente que a transição pede (§6) — `"avisar": false` não manda.
- `POST /painel/encomendas/<id>/nota` `{ "texto": "…", "por": "…" }` → acrescenta a `notas_painel`.
- `GET /painel/saude` → `{ ok, modo, stripe, webhook, email, dono, catalogo }` (booleanos; `catalogo` é
  `"ok"` ou o erro de ler o catálogo publicado).

A lista faz-se dos metadados das chaves do KV (sem ler cada encomenda, por causa do limite de
subpedidos): uma mudança de estado pode levar até 60 s a aparecer na lista; a ficha lê o objecto, é
imediata. Mudar o estado grava PRIMEIRO o estado novo e só depois fecha a página da Stripe e manda o
email (o resultado junta-se com outra escrita condicional); se a encomenda mudou entre a leitura e a
escrita (outro aparelho, um pagamento que chegou), responde 409 com «A encomenda mudou entretanto: está
«…»» — quem pediu decidiu sobre outro estado.
A lista traz também `pagina`, `paginas`, `total` e, em cada resumo, `linhas_a_mais`.

O segredo `PAINEL_SEGREDO` é o mesmo nos dois Workers (um `wrangler secret put` em cada).

## 6. Emails (pela Cloudflare, o binding `EMAIL`; sem ele, o Resend, `RESEND_API_KEY`; sem nenhum não se manda nada e a encomenda fica na mesma)

Texto e HTML (memória email-transaccional-texto-e-html), em português, curtos, com o logótipo
no topo (`SITE_URL/assets/img/logo-…`, a mesma imagem do site), o número da encomenda, as
linhas, o total, a entrega e os contactos da loja; sem «obrigação de pagar»; e com o aviso dos
14 dias e a ligação a `/desistir/` (DL 24/2014, art. 4.º e 5.º: a confirmação em suporte
duradouro leva as condições). Remetente `MAIL_FROM` = `LF Mobile <encomendas@lfmobile.pt>` (o domínio
está no Email Sending da Cloudflare desde 11 nov 2026). Os emails ao cliente de uma encomenda por pagar
(registada, Multibanco pendente, falhou, expirou) têm um travão: no máximo 3 por dia para o mesmo
endereço (qualquer pessoa pode encomendar com o email de outra); o do dono sai sempre.

| momento | ao cliente | ao dono (`STORE_EMAIL`) |
|---|---|---|
| encomenda registada (modo «encomenda») | «Recebemos a sua encomenda» + o que falta (o dono confirma o pagamento e a entrega) | «Nova encomenda LF-…» com tudo, e o telefone do cliente |
| paga (Stripe) | «Pagamento recebido» | «Encomenda paga LF-…» |
| Multibanco pendente | «Falta pagar: referência …» (a Stripe mostra-a; o email repete-a) | — |
| pronta | «A sua encomenda está pronta para levantar» + morada e horário | — |
| enviada | «A sua encomenda seguiu» + nota (rastreio) | — |
| anulada | «A sua encomenda foi anulada» + nota | — |
| reembolsada / falhou / expirou | «Reembolso feito» / «O pagamento não se concluiu» | «LF-… falhou/expirou» |

## 7. Vars do Worker (wrangler)

O Worker está publicado desde 8 nov 2026 em `https://lfmobile-encomendas.renato-lima-valente-dcb.workers.dev`
(KV `lfmobile-encomendas-ORDERS`; só o `PAINEL_SEGREDO` instalado; o README em `worker/encomendas/` diz
o que falta ligar). Os testes: `cd worker/encomendas && npm test`.

`SITE_URL` (`https://lfmobile.pt`),
`ALLOWED_ORIGINS`, `MAIL_FROM`, `STORE_EMAIL`, `STORE_NAME = "LF Mobile"`, `STORE_PHONE`,
`STRIPE_API_VERSION = "2026-07-29.dahlia"`, `CATALOGO_URL` (por omissão `${SITE_URL}/assets/catalogo.json`),
`LOGO_URL` (o PNG do logótipo para os emails: o Outlook não mostra WebP) e, opcional, `MODO = "encomenda"`
como travão. Segredos: `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `PAINEL_SEGREDO`. Bindings: KV `ORDERS`, rate limit
`TRAVAO_CHECKOUT`, `send_email` `EMAIL` (só de `encomendas@lfmobile.pt`), objectos duráveis `CUPOES`
(classe `Cupoes`, migração `v1`), `ENCOMENDA` (classe `Encomenda`, migração `v2`) e `CONTADOR` (classe
`Contador`, migração `v3`: o travão dos emails), SQLite, na jurisdição da UE (
num `wrangler dev` local, sem jurisdições, `ENCOMENDAS_LOCAL=1` no `.dev.vars`). `wrangler deploy --config worker/encomendas/wrangler.toml` sempre com
`--config` (memória: wrangler-autoconfig-pasta-mae).

## 8. O site novo (9 nov 2026): o catálogo v3, o peso, o modelo e os cupões

**O catálogo** (`assets/catalogo.json`, `v: 3`) passa a levar `transportadora` («Nacex»), `categorias`
(`[{ slug, nome }]`) e os portes de cada zona como **escalões de peso**:
`portes: { continente: [{ "ate": 5, "preco": 5.9 }, { "ate": 30, "preco": 14.9 }], gratisAPartirDe: null }`.
Cada artigo leva `categoria`, `peso` (kg: o dele, o da categoria, ou 0,3), `pedeModelo` e `campanha`
(o slug da campanha que lhe deu o preço, ou `''`). Com uma campanha a correr, `preco` já é o preço com
o desconto e `precoAnterior`/`promocaoAte` são os da campanha: o Worker não precisa de saber de
campanhas. Um catálogo v2 (um número por zona) continua a valer, como um escalão só.

**As categorias de marca (10 nov 2026).** Uma categoria com `marca` (Apple, Samsung) junta os artigos
dessa marca de todas as categorias (`categoriasDoArtigo` em `src/lib/regras.mjs`). Cada artigo do
catálogo leva também `categorias` (a dele e as de marca: um iPhone recondicionado tem
`["recondicionados", "apple"]`). Um cupão «só em certas categorias» apanha a linha se alguma das
`categorias` dela estiver no cupão (o Worker, `contas.js`, e o carrinho, `carrinho.js`); sem
`categorias` (um catálogo antigo), vale a `categoria`. A linha gravada na encomenda não muda.

**Os portes** de uma encomenda com envio: o primeiro escalão cujo `ate` aguenta o peso total (a soma
`peso × qtd`); mais pesada do que o último, «por confirmar» (em modo «online» o `/checkout` recusa, com
a frase «A encomenda pesa mais de 30 kg…»). Grátis a partir de `gratisAPartirDe` em artigos, ou com um
cupão de portes grátis. A encomenda guarda `peso_kg`.

**O modelo do telemóvel** (as películas, `pedeModelo: true`): cada linha do `/checkout` pode levar
`"modelo": "Samsung Galaxy A55"` (até 80 caracteres, limpo). Num artigo que o pede, sem modelo: 400. Na
encomenda fica em `linhas[].modelo` e nas escolhas («Modelo: Samsung Galaxy A55»), por isso aparece nos
emails, no painel e na página da Stripe.

**Os cupões** (worker/encomendas/cupoes.js) vivem num **objecto durável** deste Worker (`Cupoes`, um só
para a loja, na UE — desde 11 nov 2026; até aí no KV), nunca no repositório. Ler, conferir e contar um
uso é um passo só (`blockConcurrencyWhile`): dois clientes no MESMO instante nunca passam o limite nem o
«um por cliente» (com o KV, três encomendas simultâneas com um cupão de um uso passavam as três). Na
primeira vez, o objecto traz do KV os cupões de antes (`cupao:`, `cupao-usos:`, `cupao-cliente:`).

- `regra:<CÓDIGO>` → a regra `{ codigo, tipo: "percentagem" | "valor" | "portes", valor, minimo?, desde?,
  ate?, limite?, porCliente?, categorias?, ativo, nota?, criado_em, actualizado_em }`;
  `usos:<CÓDIGO>` → o número de usos; `cliente:<CÓDIGO>:<resumo SHA-256 do email>` → o id da encomenda,
  quando é «um por cliente» (o email nunca se guarda).
- `POST /cupao` `{ codigo, entrega, linhas }` (público, CORS, o mesmo travão do `/checkout`) → 200
  `{ cupao: { codigo, tipo, valor, minimo, categorias, descricao }, desconto_cents }`, ou 400
  `{ erro, campo: "cupao" }` (não existe, inactivo, fora das datas, abaixo do mínimo, gasto). O carrinho
  guarda o código e a regra e faz a conta (a mesma de `descontoDoCupao`).
- `/checkout` com `"cupao": "BEMVINDO"`: o Worker lê a regra e os usos, confere outra vez, faz as contas
  com o desconto e, antes de gravar a encomenda, RESERVA o uso no objecto (`reservar`: as datas, o
  mínimo, o limite e o «um por cliente», pelo email, conferidos e contados num passo; se a Stripe não
  abrir a página ou a encomenda não se gravar, o uso volta). As contas: `desconto_cents` (a percentagem arredonda ao
  cêntimo; o valor fixo nunca passa dos artigos a que se aplica), e `total_cents = artigos − desconto +
  portes`. Um cupão que deixou de valer: 400 com `campo: "cupao"` (o carrinho tira-o e redesenha). A
  encomenda guarda `cupao`, `desconto_cents` e, nos de portes, `cupao_portes: true`; a vista pública
  (`GET /encomenda`) mostra `cupao` e `desconto_cents`.
- Em modo «online», a Stripe recebe um cupão de uso único com o valor calculado (`POST /coupons`
  `amount_off`, `max_redemptions: 1`, `name: "Cupão <CÓDIGO>"`) e a sessão leva `discounts: [{ coupon }]`.
- **Os descontos não se juntam** (como diz a página da campanha): o cupão desconta só os artigos que
  não estão em promoção nem numa campanha. O de portes grátis, com categorias, só vale quando a
  encomenda é toda delas. Um cupão que não dá nada nesta encomenda (só artigos em promoção; portes
  grátis num levantamento ou com os portes já grátis): o `/checkout` recusa-o com `campo: "cupao"`, e o
  carrinho, que faz a mesma conta, já não o manda (diz porquê ao lado do cupão) — o uso não se gasta.
- **Os usos reservam-se quando a encomenda fica registada, nos dois modos** (antes, em «online», só
  quando o pagamento entrava: um cupão de um uso servia a várias encomendas abertas). Voltam
  (`libertarUso`, `cupao_contado: false`) quando o pagamento expira ou falha (webhook) e quando o dono
  anula a encomenda no painel; uma encomenda paga depois disso conta outra vez. O «um por cliente»
  confere o email como pessoa (`emailCanonico`: sem invisíveis nem maiúsculas, sem o `+etiqueta`, no
  Gmail sem os pontos). Um pagamento que chega depois de o uso ter voltado conta outra vez, sem
  limite (`contar`: o dinheiro entrou).
- O painel: `GET /painel/cupoes` → `{ cupoes: [regra + usos + descricao] }`; `PUT /painel/cupoes/<CÓDIGO>`
  com a regra (400 `{ erro, campo }` quando não presta; as categorias conferem-se com o catálogo);
  `DELETE /painel/cupoes/<CÓDIGO>`.
