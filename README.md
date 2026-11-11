# LF Mobile — o site

Site da LF Mobile (reparações, loja online e retoma de telemóveis), em São Roque, Oliveira de
Azeméis. Gerador estático em Node (sem dependências), à imagem dos outros sites do Renato (a base
é a Mimices). O plano e as decisões estão em [docs/PLANO.md](docs/PLANO.md); o contrato das
encomendas (site ↔ Worker ↔ painel) em [docs/ENCOMENDAS.md](docs/ENCOMENDAS.md).

- **No ar**: https://lfmobile.pt (desde 11 nov 2026), um Worker da Cloudflare com os ficheiros do site
  (`wrangler.jsonc`, `worker/www.js`, `publicar.yml`, a cada envio para a `main` e todos os dias às
  00:15), aberto ao Google desde 11 nov 2026 (`--producao`: pára se faltar um dado que a lei pede). A pré-visualização antiga
  (https://renatovalente5.github.io/lfmobile/) reencaminha para o domínio
  (`reencaminhar-pre-visualizacao.yml`, corrido uma vez).
- **Encomendas**: `worker/encomendas/` (o Worker `lfmobile-encomendas`): regista as encomendas, manda
  os emails e, quando a Stripe estiver ligada, abre a página segura de pagamento.
- **Painel**: `renatovalente5/lfmobile-painel`, onde o dono edita a loja sozinho.

## Correr

```bash
python3 scripts/imagens.py        # as versões web das fotografias (Pillow), para .cache/imagens
node scripts/build.mjs            # o site em _site/, para http://localhost:4870 (python3 -m http.server 4870 --directory _site)
node scripts/build.mjs --dominio          # como no domínio hoje (noindex)
node scripts/build.mjs --producao         # o domínio aberto ao Google: pára se faltar um dado que a lei pede
node scripts/testar.mjs           # os testes (regras, scripts, construções de ensaio)
scripts/recortes.sh               # (num Mac) os recortes que faltam das fotografias novas dos artigos
```

## Onde está cada coisa

- `content/` — o que o painel edita: `site.json` (contactos, horário, local, empresa, entrega com os
  escalões da Nacex, pagamentos, garantias, Google), `inicio.json`, `categorias.json` (com o peso de
  cada uma), `fotos.json`, `produtos/<slug>.json`, `aparelhos.json` (as marcas, as famílias e os
  modelos: todas as marcas nas reparações, Apple e Samsung na retoma), `reparacoes.json` (os tipos de
  reparação e os preços por modelo),
  `retoma.json` (os valores e as perguntas do simulador) e `campanhas.json`; e `paginas/*.md` (as
  páginas de texto e legais, só do Renato). Os cupões não estão aqui: vivem no KV do Worker das
  encomendas (`docs/ENCOMENDAS.md`, §8).
- `src/lib/regras.mjs` — as regras do conteúdo, partilhadas byte a byte com o painel.
- `src/templates/` — a moldura (`layout.mjs`), as páginas (`paginas.mjs`, `reparacoes.mjs`,
  `retoma.mjs`), os componentes, os ícones e os desenhos dos aparelhos (`aparelhos.mjs`).
- `src/estilos/site.css` e `src/scripts/` (`site.js`, `carrinho.js`, `loja.js`, `reparacoes.js`,
  `retoma.js`) — o estilo e o comportamento.
- `scripts/build.mjs` — o gerador; `scripts/imagens.py` — as imagens; `scripts/testar.mjs` — os testes.
- `legal-comum/` — os textos e verificações legais comuns aos sites do Renato (cópia instalada).
- `media/fotos/` — a biblioteca de fotografias (plana); `media/recortes/` — o recorte (sem o fundo) da
  primeira fotografia de cada artigo, feito no Mac (`scripts/recortes.sh`) ou desenhado (as películas);
  `media/logo/`… ver `scripts/imagens.py`.
- `_cliente/` (fora do git) — o material do cliente: a recolha do Instagram, o logótipo original, as notas.
