# lfmobile-encomendas — o Worker das encomendas da LF Mobile

O contrato (as rotas, a forma da encomenda, os estados, os emails, as vars) está em
[`docs/ENCOMENDAS.md`](../../docs/ENCOMENDAS.md); este Worker segue-o à letra. O site
(`src/scripts/carrinho.js`) e o painel (`renatovalente5/lfmobile-painel`) falam com ele.

Publicado em `https://lfmobile-encomendas.renato-lima-valente-dcb.workers.dev` (a conta do Renato).

## O que faz

- `POST /checkout` — recebe a encomenda do site, **refaz as contas** com o catálogo publicado
  (`CATALOGO_URL`, cache de 60 s; as regras de `src/lib/regras.mjs`: `precoDe`, as escolhas,
  `compravel`, `enviavel`, os portes), valida (email, telefone, NIF, código postal do continente,
  termos) e grava-a (no objecto dela, com a cópia no KV `ORDERS`). Em modo **encomenda** (o de agora)
  manda os emails e devolve o número e a chave; em modo **online** pede o pagamento à **ifthenpay** pelo
  método escolhido (MB WAY, Multibanco ou cartão) e devolve `proxima`: a página `/pagar/` do site, ou o
  formulário do cartão da ifthenpay.
- `GET /encomenda?e=<id>&c=<chave>` — o que as páginas «pagar» e «obrigado» mostram, sem dados
  pessoais; com o pagamento por confirmar, pergunta à ifthenpay (com travão por encomenda).
- `POST /pagar` — a página de pagamento pede outra vez, ou por outro método, na mesma encomenda.
- `GET /metodos` — os métodos ligados (o finalizar só mostra esses).
- `POST /cupao` — o carrinho confere um código de cupão (os cupões vivem num objecto durável, `Cupoes`, na UE: `cupoes.js` e `objecto.js`; o
  contrato no §8 do `docs/ENCOMENDAS.md`).
- `GET /ifthenpay/callback` — a campainha da ifthenpay: um GET **sem assinatura** (só a chave
  anti-phishing), que nunca marca nada por si — confirma sempre com `/v2/payments/read` (o valor
  conferido); 200 ao que está tratado, 409 quando a ifthenpay ainda não confirma (que repitam), 500
  com um email por mandar.
- A **varredura** (cron de 10 em 10 minutos): pergunta à ifthenpay pelas encomendas por pagar que
  ninguém está a ver, e dá por expiradas as que passaram do prazo (o uso do cupão volta). A loja não
  depende dos callbacks estarem activos.
- `/painel/…` com `Authorization: Bearer <PAINEL_SEGREDO>` — a lista (feita dos metadados das
  chaves do KV, sem ler cada encomenda), a ficha, mudar o estado (só as transições do painel;
  as outras dão 409), as notas, os reembolsos (`/reembolso`: MB WAY e cartão pela ifthenpay; o
  Multibanco à mão, por transferência), a saúde (`?sondar=1` prova a chave de backoffice).

Ficheiros: `index.js` (rotas, CORS, travão, checkout, cupão, `/pagar`, cron), `ifthenpay.js` (a API da
ifthenpay, sem SDK: valores, métodos, confirmação, reembolsos, callback), `pagamento.js` (o pagamento
na encomenda: pedir, confirmar, expirar, varredura, callback, a página), `prazos.js` (os prazos, que o
site também diz), `contas.js` (preços, portes pelo peso, modelo do telemóvel, desconto e validações),
`cupoes.js` (as regras, os usos, o painel), `encomenda.js` (ids, estados, vistas, as escritas com
versão), `objecto.js`, `catalogo.js`, `email.js` + `email-html.js`, `painel.js`, `http.js`. Sem
dependências npm.

O modo vem do catálogo (`site.json` → `pagamentos.modo`); a var `MODO = "encomenda"` força o
modo «encomenda» como travão de emergência.

## Testar

```sh
cd worker/encomendas && npm test        # node --test, sem rede: catálogo, ifthenpay e Resend de faz-de-conta
```

Os testes cobrem as contas (promoções, acréscimos das escolhas, portes grátis a partir de X,
portes `null`), as validações, a forma da encomenda no KV, os dois modos, o CORS, o travão, o
`GET /encomenda`, as rotas do painel e as transições proibidas, o pagamento pela ifthenpay
(`test/ifthenpay.test.mjs`: cada método, o callback com chave errada, marcadores e valor no endereço,
a página, `/pagar`, a varredura, os pagamentos fora de tempo e a mais, os reembolsos, a saúde), as
corridas (o painel e a confirmação ao mesmo tempo) e os emails (texto e HTML, nunca «obrigação de
pagar»), e ainda os portes da Nacex pelo peso, o modelo das películas e os cupões. A ifthenpay de
faz-de-conta (`test/ajuda.mjs`, `ifthenpayFalsa`) responde com a forma das respostas de lá e recusa um
pedido mal feito. Lêem a cópia congelada `test/catalogo.json` (o catálogo v3), nunca o `_site/`.

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

As encomendas e os cupões em objectos duráveis (SQLite — o tipo do plano gratuito —, na jurisdição da
UE): `ENCOMENDA` (classe `Encomenda`, migração `v2`; a verdade de cada encomenda, com versões; o KV fica
com a cópia para a lista do painel) e `CUPOES` (classe `Cupoes`, migração `v1`). Num `wrangler dev` local não há jurisdições: põe-se
`ENCOMENDAS_LOCAL=1` no `.dev.vars` (nunca no `wrangler.toml`). No primeiro pedido, o objecto traz do KV
os cupões que lá estivessem.

O KV: binding `ORDERS`, título «lfmobile-encomendas-ORDERS» (o título «ORDERS» sem prefixo é
do Armazém dos Pneus), id `b1609f701d5f43e7ad515c939b39ca6d`. Apagar uma encomenda de teste:
`$WR kv key delete "order:LF-…" --binding ORDERS --remote --config $CFG`.

Nota: a lista do painel (`list()` do KV) pode levar até um minuto a reflectir uma mudança de
estado; a ficha (`get`) é imediata.

## O que falta ligar

1. ~~Os emails pelo domínio~~ — feito a 11 nov 2026: o lfmobile.pt está no Email Sending da
   Cloudflare, e o Worker manda pelo binding `EMAIL`, de `encomendas@lfmobile.pt` (o Resend fica só
   como plano B, sem chave).
2. **O email do dono** — `STORE_EMAIL` no toml (recebe só o que lhe pede alguma coisa: «Nova
   encomenda», «Encomenda paga» e um pagamento numa encomenda anulada; o «expirou» e o «falhou» vão só
   ao cliente; é o reply-to dos emails ao cliente). Vazio, o dono não recebe nada.
3. **A ifthenpay** (modo «online», desde 11 nov 2026 em vez da Stripe; quando a adesão do Leandro for
   aprovada) — três segredos, cada um pelo stdin a partir de um ficheiro em `_cliente/segredos/`:
   - `IFTHENPAY_ACCOUNTS`: `MBWAY|<chave MB WAY>;MB|<chave Multibanco>;CCARD|<chave CCARD>` (só os
     métodos que a conta tiver; o site mostra só esses);
   - `IFTHENPAY_BACKOFFICE_KEY`: a chave de backoffice (confirma os pagamentos e faz os reembolsos);
   - `IFTHENPAY_ANTIPHISHING_KEY`: escolhida por nós (`openssl rand -hex 24`).

   Depois, os **callbacks**, um por método (vêm desligados), no backoffice da ifthenpay ou por
   `POST https://api.ifthenpay.com/v2/callback/activation` com `{ boKey, paymentMethod, paymentKey,
   apKey, urlCb }`, com o endereço
   `https://<worker>/ifthenpay/callback?key=[ANTI_PHISHING_KEY]&orderId=[ORDER_ID]&amount=[AMOUNT]&requestId=[REQUEST_ID]`.
   Sem callbacks, a varredura confirma na mesma (até 10 minutos depois). Conferir com
   `GET /painel/saude?sondar=1` (`pagamentos.metodos`, `backoffice`, `callback`, `sonda: "ok"`), fazer um
   pagamento real pequeno por método, e só então `pagamentos.modo = "online"` no `site.json` (pelo
   painel) — o catálogo leva o modo. A var `MODO = "encomenda"` volta a fechar o pagamento no site num
   deploy, se for preciso.
4. ~~O domínio~~ — feito a 11 nov 2026: `SITE_URL`, `CATALOGO_URL`, `LOGO_URL` e `ALLOWED_ORIGINS`
   em `https://lfmobile.pt`. Se o logótipo mudar, o nome do ficheiro muda (leva a assinatura):
   copiar o novo do `<img class="logo">` do `_site/index.html` gerado.
5. **O painel** — o mesmo `PAINEL_SEGREDO` no Worker do painel (`wrangler secret put` lá).
