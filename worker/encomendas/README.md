# lfmobile-encomendas — o Worker das encomendas da LF Mobile

O contrato (as rotas, a forma da encomenda, os estados, os emails, as vars) está em
[`docs/ENCOMENDAS.md`](../../docs/ENCOMENDAS.md); este Worker segue-o à letra. O site
(`src/scripts/carrinho.js`) e o painel (`renatovalente5/lfmobile-painel`) falam com ele.

Publicado em `https://lfmobile-encomendas.renato-lima-valente-dcb.workers.dev` (a conta do Renato).

## O que faz

- `POST /checkout` — recebe a encomenda do site, **refaz as contas** com o catálogo publicado
  (`CATALOGO_URL`, cache de 60 s; as regras de `src/lib/regras.mjs`: `precoDe`, as escolhas,
  `compravel`, `enviavel`, os portes), valida (email, telefone, NIF, código postal do continente,
  termos) e grava no KV `ORDERS`. Em modo **encomenda** (o de agora) manda os emails e devolve o
  número e a chave; em modo **online** abre a página segura da Stripe (em português) e devolve o URL.
- `GET /encomenda?e=<id>&c=<chave>` (ou `?s=<sessão Stripe>`) — o que a página «obrigado» mostra,
  sem dados pessoais.
- `POST /stripe/webhook` — os eventos da Stripe, com assinatura verificada e idempotência por
  evento (`evt:`); um webhook que falhe a enviar emails responde 500 para a Stripe reentregar.
- `/painel/…` com `Authorization: Bearer <PAINEL_SEGREDO>` — a lista (feita dos metadados das
  chaves do KV, sem ler cada encomenda), a ficha, mudar o estado (só as transições do painel;
  as outras dão 409), as notas, a saúde.

Ficheiros: `index.js` (rotas, CORS, travão, checkout, webhook), `contas.js` (preços e
validações), `encomenda.js` (KV, ids, estados, vistas), `catalogo.js`, `stripe.js`, `email.js` +
`email-html.js`, `painel.js`, `http.js`. Sem dependências npm.

O modo vem do catálogo (`site.json` → `pagamentos.modo`); a var `MODO = "encomenda"` força o
modo «encomenda» como travão de emergência.

## Testar

```sh
cd worker/encomendas && npm test        # node --test, sem rede: catálogo, Stripe e Resend de faz-de-conta
```

Os testes cobrem as contas (promoções, acréscimos das escolhas, portes grátis a partir de X,
portes `null`), as validações, a forma da encomenda no KV, os dois modos, o CORS, o travão, o
`GET /encomenda`, as rotas do painel e as transições proibidas, o webhook (pago, Multibanco,
expirado, reembolsado, repetido, Resend em baixo) e os emails (texto e HTML, nunca «obrigação de
pagar»). Lêem o `_site/assets/catalogo.json` gerado, se existir; senão a cópia `test/catalogo.json`.

Para testar em local contra o Worker a correr: `wrangler dev --config worker/encomendas/wrangler.toml`
(arrancar, testar com `curl`, parar — um `wrangler dev` deixado a correr morre a meio de edições).

## Publicar

O wrangler corre-se **sempre com `--config`** apontado a este `wrangler.toml` (da pasta-mãe sem
config, a autoconfiguração inventa um Worker com o conteúdo de outro projecto). Não há wrangler
instalado neste repositório; usa-se o da `mimices-painel`:

```sh
WR=~/Websites/mimices-painel/node_modules/.bin/wrangler
CFG=~/Websites/lfmobile/worker/encomendas/wrangler.toml
$WR deploy --config $CFG
```

Segredos (nunca no repositório; o valor passa pelo stdin a partir de um ficheiro em
`_cliente/segredos/`, que está no `.gitignore`):

```sh
$WR secret put PAINEL_SEGREDO --config $CFG < ~/Websites/lfmobile/_cliente/segredos/PAINEL_SEGREDO
```

O KV: binding `ORDERS`, título «lfmobile-encomendas-ORDERS» (o título «ORDERS» sem prefixo é
do Armazém dos Pneus), id `b1609f701d5f43e7ad515c939b39ca6d`. Apagar uma encomenda de teste:
`$WR kv key delete "order:LF-…" --binding ORDERS --remote --config $CFG`.

Nota: a lista do painel (`list()` do KV) pode levar até um minuto a reflectir uma mudança de
estado; a ficha (`get`) é imediata.

## O que falta ligar

1. **Resend com o domínio** — criar a conta do Resend (idealmente no email da loja), verificar o
   domínio (DKIM, SPF, DMARC), e:
   `$WR secret put RESEND_API_KEY --config $CFG < …`; no toml, `MAIL_FROM = "LF Mobile <encomendas@<domínio>>"`.
   Até lá `onboarding@resend.dev` só entrega ao dono da conta, e sem a chave não se manda nada
   (a encomenda fica gravada na mesma).
2. **O email do dono** — `STORE_EMAIL` no toml (recebe «Nova encomenda», «Encomenda paga», os
   falhados; é o reply-to dos emails ao cliente). Vazio, o dono não recebe nada.
3. **A Stripe** (modo «online», quando o cliente a quiser) — na conta da loja, activar cartão,
   MB WAY e Multibanco; `$WR secret put STRIPE_SECRET_KEY --config $CFG < …` (uma chave
   restrita, `rk_live_…`, com Checkout Sessions e leitura); criar o endpoint
   `https://<worker>/stripe/webhook` com os eventos `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `checkout.session.expired`, `payment_intent.requires_action`, `charge.refunded`
   (a lista está em `stripe.js`, `EVENTOS`) e `$WR secret put STRIPE_WEBHOOK_SECRET --config $CFG < …`;
   por fim `pagamentos.modo = "online"` no `site.json` (pelo painel) — o catálogo leva o modo.
4. **O domínio** — no toml, `SITE_URL`, `CATALOGO_URL`, `LOGO_URL` e `ALLOWED_ORIGINS` passam do
   `renatovalente5.github.io/lfmobile` ao domínio (e o `localhost:4870` sai). Se o logótipo mudar,
   o nome do ficheiro muda (leva a assinatura): copiar o novo do `<img class="logo">` do
   `_site/index.html` gerado.
5. **O painel** — o mesmo `PAINEL_SEGREDO` no Worker do painel (`wrangler secret put` lá).
