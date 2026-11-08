/* Os utilitários HTTP comuns às rotas: a resposta JSON (sempre sem cache) e a leitura de um
   corpo JSON com tecto de tamanho. */

export const MAX_CORPO_BYTES = 16 * 1024;

export function json(dados, status = 200, extra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

/* O corpo como JSON, ou um erro já em forma de resposta ({ erro, resposta }). */
export async function lerCorpoJson(request, cors = {}) {
  const tamanho = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (tamanho > MAX_CORPO_BYTES) return { resposta: json({ erro: 'Pedido demasiado grande.' }, 413, cors) };
  const bruto = await request.text();
  if (bruto.length > MAX_CORPO_BYTES) return { resposta: json({ erro: 'Pedido demasiado grande.' }, 413, cors) };
  try {
    const corpo = JSON.parse(bruto);
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { resposta: json({ erro: 'Pedido inválido.' }, 400, cors) };
    return { corpo };
  } catch {
    return { resposta: json({ erro: 'Pedido inválido.' }, 400, cors) };
  }
}
