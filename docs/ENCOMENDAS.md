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
- `GET /painel/saude` → `{ ok, modo, stripe, webhook, email, dono, catalogo }` (booleanos; `email` diz se
  há por onde mandar, o binding `EMAIL` ou o `RESEND_API_KEY`; `catalogo` é `"ok"` ou o erro de ler o
  catálogo publicado).

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
| reembolsada / falhou / expirou | «Reembolso feito» / «O pagamento não se concluiu» | — (não lhe pedem nada: a encomenda não se fez e o painel mostra-a; até 11 nov 2026 ia «LF-… falhou/expirou») |
| pagamento numa encomenda anulada ou já paga à mão (Stripe) | — | «Pagamento recebido numa encomenda …» (conferir na Stripe e, se não segue, reembolsar) |

Ao dono só vai o que lhe pede alguma coisa: a encomenda nova, a paga e um pagamento numa anulada (o
Renato, 11 nov 2026, como na Franja Kids).

## 7. Vars do Worker (wrangler)

O Worker está publicado desde 8 nov 2026 em `https://lfmobile-encomendas.renato-lima-valente-dcb.workers.dev`
(KV `lfmobile-encomendas-ORDERS`; só o `PAINEL_SEGREDO` instalado; o README em `worker/encomendas/` diz
o que falta ligar). Os testes: `cd worker/encomendas && npm test`.

`SITE_URL` (`https://lfmobile.pt`),
`ALLOWED_ORIGINS`, `MAIL_FROM`, `STORE_EMAIL`, `STORE_NAME = "LF Mobile"`, `STORE_PHONE`,
`STRIPE_API_VERSION = "2026-07-29.dahlia"`, `CATALOGO_URL` (por omissão `${SITE_URL}/assets/catalogo.json`),
`LOGO_URL` (o PNG do logótipo para os emails: o Outlook não mostra WebP), `PAINEL_URL` (o código QR do cartão
leva o endereço do cartão lá, §10), `GOOGLE_CLIENTE` (o id público do cliente OAuth do Google; vazio, não há «Entrar
com o Google», §10) e, opcional, `MODO = "encomenda"` como travão. Segredos: `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `PAINEL_SEGREDO`. Bindings: KV `ORDERS`, rate limit
`TRAVAO_CHECKOUT`, `send_email` `EMAIL` (só de `encomendas@lfmobile.pt`), objectos duráveis `CUPOES`
(classe `Cupoes`, migração `v1`), `ENCOMENDA` (classe `Encomenda`, migração `v2`) e `CONTADOR` (classe
`Contador`, migração `v3`: o travão dos emails) e `CONTA` (classe `Conta`, migração `v4`: a conta do cliente, §10),
SQLite, na jurisdição da UE (
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

## 10. A conta do cliente (13 nov 2026)

O Leandro pediu «a conta cliente para o cliente ver as encomendas». Entra-se com o email e um código, sem
palavra-passe; lá dentro, as encomendas feitas com esse email, em que ponto está cada uma e o caminho que fez.

**Onde vive.** As rotas são `/conta/api/…` deste Worker (`conta.js`), e chegam pelo Worker do site
(`worker/www.js`) através da service binding `ENCOMENDAS` do `wrangler.jsonc`: no domínio, a sessão é um cookie do
próprio `lfmobile.pt` e não há CORS (um cookie do `workers.dev` seria de terceiros, e o Safari recusa-o; um `fetch`
a outro Worker da mesma zona falha — memória worker-na-mesma-zona). Pelo `workers.dev` as rotas respondem igual,
mas sem o cookie não há conta. A página é `/conta/` (`src/scripts/conta.js`): noindex e fora do sitemap.

| rota | corpo | resposta |
|---|---|---|
| `POST /conta/api/codigo` | `{ email }` | `{ pedido }` (22 caracteres); o código vai por email |
| `POST /conta/api/entrar` | `{ email, pedido, codigo }` | `{ ok: true }` e o cookie; ou 400 `{ erro, campo?, novo? }` |
| `GET /conta/api/eu` | — | `{ email, encomendas: [{ encomenda, estado, entrega, total_cents, criada_em, linhas: [{ nome, qtd }], linhas_a_mais? }] }` |
| `GET /conta/api/encomenda?e=<id>` | — | a vista pública (§3) + `criada_em`, `morada` (no envio) e `historico: [{ em, estado, nota? }]`; 404 se não for desta conta |
| `POST /conta/api/sair` | — | `{ ok: true }` e o cookie apagado |

Sem sessão, `eu` e `encomenda` respondem 401 e apagam o cookie. Os `POST` só se aceitam com o `Origin` do site
(`SITE_URL` ou `ALLOWED_ORIGINS`); outro, 403.

**O cookie:** `__Host-lf-sessao=<id da conta>.<segredo>; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`.
Nenhum script o lê. Dura 30 dias e renova-se com o uso (uma vez por dia).

**O código:** 6 algarismos (sem enviesar), vale 10 minutos, 5 tentativas (à 5.ª errada pede-se outro). Dois toques no
botão em 20 s dão o mesmo pedido e um só email. Travões: por IP (o binding `TRAVAO_CHECKOUT`, chaves
`conta-codigo:<ip>` e `conta-entrar:<ip>`, 5 por minuto) e por email (4 códigos por hora, 10 por dia). O código vai a
qualquer email (a resposta é a mesma, haja ou não encomendas); o email não leva texto de quem pede. Assunto:
«123456 é o seu código da LF Mobile» (o código à frente: o telemóvel propõe-no sozinho).

**O objecto `Conta`** (`CONTA`, migração `v4`, SQLite, na UE; o nome é o resumo SHA-256 de
`lfmobile-conta:<email da conta>`): `email` (o da conta), `codigo` (`{ pedido, resumo, expira, tentativas, criado }`),
`pedidos` (quando se pediram códigos, 24 h) e `sessao:<resumo do segredo>` (`{ criada, expira, renovada, mostrar }`,
no máximo 10). Do código e da sessão só se guarda o resumo. Apaga-se sozinho quando já não tem sessões vivas.

**O email da conta:** minúsculas, sem invisíveis; no Gmail sem os pontos nem o `+etiqueta` (vão dar à mesma caixa).
Noutros domínios o `+etiqueta` fica.

**As encomendas da conta** fazem-se dos metadados do KV (`order:` com `email`, §4), sem ler cada encomenda; um email
que pode estar cortado nos metadados (80 caracteres, ou 40) confere-se na encomenda. A ficha lê o objecto da encomenda
e confere o email outra vez.

**O caminho** (`historico`): cada mudança de estado com a data; as linhas que não mudam o estado (as da Stripe que só
ficaram no histórico) saem. A `nota` só vai na `enviada` (o rastreio) e na `anulada` (a razão): são as que o cliente
já recebe por email (§6). As outras notas do painel e as `notas_painel` nunca saem.

**O cartão das películas (13 nov 2026; o Leandro: «Sim» à proposta).** O cartão de papel da loja, «Películas
Hidrogel»: 5 casas e, na 6.ª, uma película de oferta, a contar na loja E no site. Vive no objecto da conta (o email):

- **As do site contam sozinhas:** cada película de hidrogel (o nome do artigo tem «hidrogel», `ehHidrogel`) numa
  encomenda `paga`, `pronta`, `enviada` ou `levantada` (`CONTAM`), lidas dos metadados do KV como a lista da conta.
- **As da loja e as ofertas** marca-as o dono no painel (ecrã «Cartões»), pelo email do cliente:
  `carimbos: [{ em, n, por, nota? }]` (n de −10 a 10; o negativo corrige, nunca abaixo de zero) e
  `ofertas: [{ em, por, nota? }]` no objecto `Conta`. A oferta só se entrega se o cartão a tiver (conferido no objecto,
  num passo só). Um cartão pode nascer no painel antes de o cliente entrar no site.
- **As contas** (`cartaoDe`): `total = site + loja`; cada 5 dão uma oferta; `disponiveis = floor(total / 5) − entregues`;
  `atuais = total mod 5` (as casas do cartão de agora). Com uma oferta por entregar e 0 casas, o cartão mostra as 5
  cheias e a 6.ª acesa.
- **Rotas do painel** (com o `PAINEL_SEGREDO`): `GET /painel/cartoes?email=` → `{ email, cartao, movimentos }`,
  `POST /painel/cartoes/carimbo { email, n, por, nota? }`, `POST /painel/cartoes/oferta { email, por, nota? }` (409 sem
  oferta). Na conta, `GET /conta/api/eu` leva `cartao: { por_cartao, total, atuais, disponiveis }` (sem quem marcou).
- **Prazo:** o objecto guarda o cartão 3 anos depois do último movimento (`mexido`), mesmo sem sessões; depois apaga-o.

### O resto da conta (14 nov 2026)

O Renato, a 13 nov, depois de a ver no iPhone: um perfil mais completo, entrar com o Google, e o cartão das películas
marcado na loja por um código QR. As rotas novas (as de cima continuam iguais):

| rota | corpo | resposta |
|---|---|---|
| `GET /conta/api/eu` | — | também `nome`, `cartao`, `dados`, `sugestao` (os dados da última encomenda, enquanto a conta não tem os seus) e `garantias: [{ encomenda, nome, ate }]` (as que ainda correm; a que acaba primeiro, primeiro) |
| `GET /conta/api/encomenda?e=<id>` | — | também `garantias` (por linha: `{ meses, ate }`, ou `null`) e `desistir: { pode, ate, pedidos }` |
| `GET /conta/api/dados` | — | `{ email, dados, sugestao }` (o checkout lê-o) |
| `POST /conta/api/dados` | `{ nome?, telefone?, nif?, morada?, codigoPostal?, localidade? }` | `{ dados }`; 400 `{ erro, campo }` (as regras do checkout) |
| `POST /conta/api/desistir` | `{ e, nota? }` | `{ ok, desistir }`; 409 fora do prazo; 404 se não for desta conta |
| `POST /conta/api/sair-todos` | — | `{ ok }`: saem todas as sessões (os dados e o cartão ficam) |
| `POST /conta/api/apagar` | — | `{ ok }`: o objecto da conta apaga-se todo (dados, sessões, cartão); as encomendas ficam |
| `GET /conta/api/cartao.svg` | — | o código QR do cartão (SVG, `no-store`); 401 sem sessão |
| `POST /conta/api/google` | `{ id_token, nonce }` | `{ ok }` e o cookie; 400 se o token não passar; 503 sem `GOOGLE_CLIENTE` |

Sem sessão, as rotas da conta respondem 401 `{ erro, sessao: false, google }` (`google`: o id público, ou `null`).

- **Os dados** (`dados` no objecto `Conta`, com `actualizado_em`): só os que o cliente escreve na conta, todos
  opcionais. Preenchem os campos VAZIOS do checkout (`src/scripts/carrinho.js`, quando o browser sabe que há sessão:
  `localStorage lfmobile:conta`). Guardam-se 2 anos depois da última entrada (`visto`); depois o objecto apaga-os.
- **As garantias:** 3 anos nos artigos novos; nos recondicionados, a do catálogo (`garantias.recondicionados`, 18
  meses). Contam do levantamento ou do envio. Um artigo que já saiu do catálogo fica sem data (não se sabe se era
  recondicionado): a conta não a inventa.
- **Desistir da compra** (a «função de retratação» da Directiva (UE) 2023/2673, desde 19 jun 2026; o prazo do DL
  24/2014, art. 10.º): antes de receber, sempre; depois, 14 dias do levantamento, ou 21 do envio (não se sabe o dia da
  entrega; um pedido tardio decide-o a loja). Fica em `desistencias: [{ em, por, nota? }]` e numa linha do histórico; o
  estado NÃO muda (a devolução e o reembolso tratam-se no painel, como até aqui). Vai um email ao cliente (a
  confirmação, em suporte duradouro) e outro à loja (`AVISOS.desistencia`). Dois toques em 10 minutos são um pedido só.
- **O código QR** leva o endereço do cartão no painel: `PAINEL_URL/#/cartoes?conta=<id da conta>`
  (`enderecoDoCartao`; o id é o resumo do email, não o diz). O Leandro lê-o com a câmara do telemóvel (abre o painel) ou
  no próprio painel («Ler o código do cliente», ecrã Cartões). `GET /painel/cartoes?conta=<id>` → o cartão, com o email
  que o cliente escreveu; 404 «Este cartão já não existe.» se a conta não existir.
- **Entrar com o Google:** sem o script do Google na página — só um redireccionamento OpenID (`response_type=id_token`,
  `scope=openid email`, `prompt=select_account`). A página guarda o `state` e o `nonce` no sessionStorage
  (`lfmobile:conta-google`), confere o `state` à volta e manda o `id_token` e o `nonce`; o Worker confere a assinatura
  (RS256, as chaves públicas do Google, guardadas 1 h), o `iss`, o `aud` (`GOOGLE_CLIENTE`), o `exp`, o `iat`, o `nonce`
  e o `email_verified`. Não há segredo do cliente. O email do Google entra na mesma conta que o do código.
- **A política de privacidade** («A sua conta») e a **de cookies** (o `__Host-lf-sessao` e as três chaves do browser)
  dizem tudo isto ao cliente.
