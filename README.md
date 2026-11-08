# LF Mobile — o site

Site da LF Mobile (reparações, loja online e retoma de telemóveis), em São Roque, Oliveira de
Azeméis. Gerador estático em Node (sem dependências), à imagem dos outros sites do Renato (a base
é a Mimices). O plano e as decisões estão em [docs/PLANO.md](docs/PLANO.md); o contrato das
encomendas (site ↔ Worker ↔ painel) em [docs/ENCOMENDAS.md](docs/ENCOMENDAS.md).

- **Pré-visualização**: https://renatovalente5.github.io/lfmobile/ (noindex; `pre-visualizacao.yml`,
  a cada envio para a `main`). Os dados legais por escrever aparecem como «[por confirmar: …]».
- **Produção**: um Worker da Cloudflare com os ficheiros do site (`wrangler.jsonc`, `worker/www.js`,
  `publicar.yml`), no domínio — quando o houver. Até lá o `publicar.yml` só corre à mão.
- **Encomendas**: `worker/encomendas/` (o Worker `lfmobile-encomendas`): regista as encomendas, manda
  os emails e, quando a Stripe estiver ligada, abre a página segura de pagamento.
- **Painel**: `renatovalente5/lfmobile-painel`, onde o dono edita a loja sozinho.

## Correr

```bash
python3 scripts/imagens.py        # as versões web das fotografias (Pillow), para .cache/imagens
node scripts/build.mjs            # o site em _site/, para http://localhost:4870 (python3 -m http.server 4870 --directory _site)
node scripts/build.mjs --base=/lfmobile   # como no GitHub Pages
node scripts/build.mjs --producao         # como no domínio: pára se faltar um dado que a lei pede
node scripts/testar.mjs           # os testes (regras, scripts, construções de ensaio)
```

## Onde está cada coisa

- `content/` — o que o painel edita: `site.json` (contactos, horário, local, empresa, entrega,
  pagamentos, garantias, Google, parcerias), `inicio.json`, `categorias.json`, `servicos.json`,
  `fotos.json`, `produtos/<slug>.json`; e `paginas/*.md` (as páginas de texto e legais, só do Renato).
- `src/lib/regras.mjs` — as regras do conteúdo, partilhadas byte a byte com o painel.
- `src/templates/` — a moldura (`layout.mjs`), as páginas (`paginas.mjs`), os componentes, os ícones.
- `src/estilos/site.css`, `src/scripts/site.js` e `carrinho.js` — o estilo e o comportamento.
- `scripts/build.mjs` — o gerador; `scripts/imagens.py` — as imagens; `scripts/testar.mjs` — os testes.
- `legal-comum/` — os textos e verificações legais comuns aos sites do Renato (cópia instalada).
- `media/fotos/` — a biblioteca de fotografias (plana); `media/logo/`… ver `scripts/imagens.py`.
- `_cliente/` (fora do git) — o material do cliente: a recolha do Instagram, o logótipo original, as notas.
