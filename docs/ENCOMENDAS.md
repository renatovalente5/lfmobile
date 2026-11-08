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
  "total_cents": 11980
}
```

- `opcoes`: o índice escolhido em cada grupo de `produto.opcoes` do catálogo (o mesmo índice do
  site); `[]` quando o artigo não tem escolhas. O Worker ignora índices a mais e trata um índice
  em falta como o primeiro valor sem acréscimo (a mesma regra de `carrinho.js`, `escolhasDe`).
- `entrega`: `levantamento` ou `continente` (os ids de `site.entrega.zonas`). Com `continente`
  a morada, o código postal (`0000-000`) e a localidade são obrigatórios.
- `nif`, `morada`, `codigoPostal`, `localidade`, `notas`: opcionais (ausentes, não vazios).
- `total_cents`: o que o site mostrou. É só para comparar: se o Worker chegar a outro total
  (um preço mudou entretanto) responde 409 `{ erro: 'Os preços mudaram. Veja o carrinho outra vez.' }`
  e o site redesenha.

**O Worker refaz as contas** com o catálogo publicado (`SITE_URL/assets/catalogo.json`, sem
cache mais de 60 s): o preço de cada artigo pela regra `precoDe` (acabada a promoção volta o
preço normal), os acréscimos das escolhas, os portes (`portes.continente`, grátis a partir de
`portes.gratisAPartirDe`, zero no levantamento). Recusa (400, `{ erro, campo? }`, frases em
português para o site mostrar tal e qual): artigo que não existe ou não é `compravel`; artigo
`enviavel: false` com entrega `continente` («só se levanta na loja»); quantidade fora de 1–20;
email inválido; telefone sem 9 a 15 algarismos; NIF com dígito de controlo errado; `termos`
que não seja `true`; portes por definir (`null`) com entrega `continente` em modo «online» (em
modo «encomenda» a encomenda segue com `portes_por_confirmar: true` e o email diz-o).

Respostas boas (200):

- modo «encomenda»: `{ "encomenda": "LF-20261108-7K2Q9M", "chave": "…", "estado": "registada", "total_cents": 11980 }`
- modo «online»: `{ "encomenda": "…", "chave": "…", "url": "https://checkout.stripe.com/…", "total_cents": 11980 }`

O site: com `url` segue para lá; com `encomenda` esvazia o carrinho e segue para
`/obrigado/?e=<encomenda>&c=<chave>`. A Stripe volta para `SITE_URL/obrigado/?s={CHECKOUT_SESSION_ID}`
(sucesso) e para `SITE_URL/checkout/?cancelado=1` (cancelar).

CORS: só as origens de `ALLOWED_ORIGINS` (a pré-visualização `https://renatovalente5.github.io`
e, depois, o domínio); `OPTIONS` responde às duas rotas públicas. Um travão de 5 pedidos por
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

## 4. O que fica no KV (namespace `ORDERS`, só o Worker escreve)

- `order:<id>` → a encomenda inteira (JSON abaixo), 400 dias.
- `session:<id da Checkout Session>` → `<id>`, `pi:<PaymentIntent>` → `<id>` (modo «online»).
- `evt:<id do evento Stripe>` → `1`, 30 dias (um webhook repetido não repete emails).

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
- `GET /painel/saude` → `{ ok: true, modo, stripe: true|false, email: true|false }`.

O segredo `PAINEL_SEGREDO` é o mesmo nos dois Workers (um `wrangler secret put` em cada).

## 6. Emails (Resend, `RESEND_API_KEY`; sem a chave não se manda nada e a encomenda fica na mesma)

Texto e HTML (memória email-transaccional-texto-e-html), em português, curtos, com o logótipo
no topo (`SITE_URL/assets/img/logo-…`, a mesma imagem do site), o número da encomenda, as
linhas, o total, a entrega e os contactos da loja; sem «obrigação de pagar»; e com o aviso dos
14 dias e a ligação a `/desistir/` (DL 24/2014, art. 4.º e 5.º: a confirmação em suporte
duradouro leva as condições). Remetente `MAIL_FROM` (um endereço do domínio, quando o houver;
até lá `onboarding@resend.dev` só chega ao Renato — por isso os emails são opcionais).

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

`SITE_URL` (a pré-visualização `https://renatovalente5.github.io/lfmobile`, depois o domínio),
`ALLOWED_ORIGINS`, `MAIL_FROM`, `STORE_EMAIL`, `STORE_NAME = "LF Mobile"`, `STORE_PHONE`,
`STRIPE_API_VERSION = "2026-07-29.dahlia"`. Segredos: `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `PAINEL_SEGREDO`. Bindings: KV `ORDERS`, rate limit
`TRAVAO_CHECKOUT`. `wrangler deploy --config worker/encomendas/wrangler.toml` sempre com
`--config` (memória: wrangler-autoconfig-pasta-mae).
