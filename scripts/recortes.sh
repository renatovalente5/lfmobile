#!/bin/bash
# Os RECORTES das fotografias dos artigos (o artigo sem o fundo, para os cartões da loja e o cartão de
# partilha): faz os que faltam, com o «isolar objecto» do macOS (Vision), e apara-os com uma margem.
# Corre-se num Mac, depois de o dono juntar fotografias novas no painel (o CI corre em Linux, sem o
# Vision): só a PRIMEIRA fotografia de cada artigo precisa de recorte. Sem recorte, o cartão mostra a
# fotografia inteira. Um recorte mal feito (uma película, um objecto transparente) apaga-se e fica a
# fotografia; ou desenha-se à mão, como as películas (o PNG em media/recortes/ com o mesmo nome).
#
#   scripts/recortes.sh            os que faltam
#   scripts/recortes.sh nome-foto  só esse (refaz)
set -euo pipefail
cd "$(dirname "$0")/.."
BIN="${TMPDIR:-/tmp}/lfmobile-recortar"
[ -x "$BIN" ] || swiftc -O scripts/recortar.swift -o "$BIN"
mkdir -p media/recortes
nomes=()
if [ $# -gt 0 ]; then nomes=("$@"); else
  while IFS= read -r n; do nomes+=("$n"); done < <(python3 -c "
import json,glob,os
for f in sorted(glob.glob('content/produtos/*.json')):
    p=json.load(open(f)); fs=p.get('fotos') or []
    if fs and not os.path.exists(f'media/recortes/{fs[0]}.png') and os.path.exists(f'media/fotos/{fs[0]}.jpg'): print(fs[0])")
fi
for n in "${nomes[@]}"; do
  "$BIN" "media/fotos/$n.jpg" "media/recortes/$n.png" && python3 - "$n" <<'PY'
import sys
from PIL import Image
n = sys.argv[1]
p = f'media/recortes/{n}.png'
im = Image.open(p).convert('RGBA')
bb = im.split()[3].point(lambda v: 255 if v > 24 else 0).getbbox()
if not bb: raise SystemExit(f'{n}: o recorte saiu vazio')
im = im.crop(bb)
m = round(max(im.size) * 0.04)
tela = Image.new('RGBA', (im.width + 2 * m, im.height + 2 * m), (0, 0, 0, 0))
tela.alpha_composite(im, (m, m))
tela.thumbnail((1600, 1600), Image.LANCZOS)
tela.save(p, optimize=True)
print(f'recorte: {n} {tela.size}')
PY
done
