/* A conta do cliente (conta.js): pedir o código, entrar, a sessão no cookie, as encomendas de cada um
   (e só as dele), o caminho sem as notas internas, sair, e os travões. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { emailDaConta, codigoNovo, historicoDoCliente, CODIGOS_POR_HORA, TENTATIVAS, SESSAO_DIAS } from '../conta.js';
import { envFalso, redeFalsa, catalogoBase, pedir, registar, bearer, moradaValida } from './ajuda.mjs';

const ORIGEM = { Origin: 'https://renatovalente5.github.io' };

/* Um env com o binding EMAIL de faz-de-conta (guarda o que «manda») e a rede do catálogo. */
function ambiente(extra = {}) {
  const enviados = [];
  const env = envFalso({ EMAIL: { send: async (m) => { enviados.push(m); } }, ...extra });
  return { env, enviados };
}
const codigoDe = (m) => /^(\d{6}) é o seu código/.exec(m.subject)?.[1];
const ultimoCodigo = (enviados) => codigoDe([...enviados].reverse().find((m) => codigoDe(m)));
const cookieDe = (r) => (r.headers.get('set-cookie') || '').split(';')[0];

async function pedirCodigo(env, email, cab = ORIGEM) {
  return pedir(worker, env, 'POST', '/conta/api/codigo', { corpo: { email }, cabecalhos: cab });
}
async function entrar(env, enviados, email) {
  const r1 = await pedirCodigo(env, email);
  assert.equal(r1.status, 200, r1.texto);
  const r2 = await pedir(worker, env, 'POST', '/conta/api/entrar', { corpo: { email, pedido: r1.json.pedido, codigo: ultimoCodigo(enviados) }, cabecalhos: ORIGEM });
  assert.equal(r2.status, 200, r2.texto);
  return cookieDe(r2);
}
function comRelogio(mais) {
  const real = Date.now;
  Date.now = () => real() + mais;
  return () => { Date.now = real; };
}

test('o email da conta: minúsculas; no Gmail sem pontos nem +etiqueta; nos outros o +etiqueta fica', () => {
  assert.equal(emailDaConta(' Maria@Exemplo.PT '), 'maria@exemplo.pt');
  assert.equal(emailDaConta('Joao.Silva+loja@gmail.com'), 'joaosilva@gmail.com');
  assert.equal(emailDaConta('joao.silva@googlemail.com'), 'joaosilva@gmail.com');
  assert.equal(emailDaConta('ana+lf@exemplo.pt'), 'ana+lf@exemplo.pt');
  assert.equal(emailDaConta('ze​@exemplo.pt'), 'ze@exemplo.pt');
});

test('o código tem sempre 6 algarismos', () => {
  for (let i = 0; i < 200; i++) assert.match(codigoNovo(), /^\d{6}$/);
});

test('pedir o código: vai por email (texto e HTML, o código no assunto) e a resposta só diz o pedido', async () => {
  const rede = redeFalsa({ catalogo: catalogoBase() });
  try {
    const { env, enviados } = ambiente({ STORE_EMAIL: 'dono@exemplo.pt' });
    const r = await pedirCodigo(env, 'Maria@Exemplo.pt');
    assert.equal(r.status, 200, r.texto);
    assert.match(r.json.pedido, /^[A-Za-z0-9_-]{22}$/);
    assert.deepEqual(Object.keys(r.json), ['pedido'], 'o código nunca vem na resposta');
    assert.equal(enviados.length, 1);
    const m = enviados[0];
    assert.equal(m.to, 'maria@exemplo.pt');
    assert.equal(m.replyTo, 'dono@exemplo.pt');
    const codigo = codigoDe(m);
    assert.match(codigo, /^\d{6}$/);
    const espacado = `${codigo.slice(0, 3)} ${codigo.slice(3)}`;
    assert.ok(m.text.includes(espacado) && m.html.includes(espacado));
    assert.match(m.text, /Vale 10 minutos/);
    assert.doesNotMatch(m.html, /fez uma encomenda/, 'o rodapé do código não fala de encomendas');
    assert.match(m.html, /pediram um código para entrar/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  } finally { rede.repor(); }
});

test('pedir o código: só vindo do site (o Origin), com um email válido', async () => {
  const { env, enviados } = ambiente();
  assert.equal((await pedirCodigo(env, 'maria@exemplo.pt', {})).status, 403, 'sem Origin');
  assert.equal((await pedirCodigo(env, 'maria@exemplo.pt', { Origin: 'https://outro.exemplo' })).status, 403, 'origem alheia');
  const r = await pedirCodigo(env, 'maria@');
  assert.equal(r.status, 400);
  assert.equal(r.json.campo, 'email');
  assert.equal(enviados.length, 0);
});

test('dois toques seguidos dão o mesmo pedido e um só email; depois, o travão por email (4 por hora)', async () => {
  const { env, enviados } = ambiente();
  const a = await pedirCodigo(env, 'rui@exemplo.pt');
  const b = await pedirCodigo(env, 'rui@exemplo.pt');
  assert.equal(a.json.pedido, b.json.pedido);
  assert.equal(enviados.length, 1);
  let repor = () => {};
  try {
    for (let i = 1; i < CODIGOS_POR_HORA; i++) {
      repor(); repor = comRelogio(i * 30_000);
      assert.equal((await pedirCodigo(env, 'rui@exemplo.pt')).status, 200);
    }
    repor(); repor = comRelogio(CODIGOS_POR_HORA * 30_000);
    const travado = await pedirCodigo(env, 'rui@exemplo.pt');
    assert.equal(travado.status, 429);
    assert.equal(enviados.length, CODIGOS_POR_HORA);
    // passada a hora, volta a dar
    repor(); repor = comRelogio(3700_000);
    assert.equal((await pedirCodigo(env, 'rui@exemplo.pt')).status, 200);
  } finally { repor(); }
});

test('o travão por IP (o binding da Cloudflare) pára o pedido do código e a entrada', async () => {
  const { env } = ambiente({ TRAVAO_CHECKOUT: { limit: async () => ({ success: false }) } });
  assert.equal((await pedirCodigo(env, 'maria@exemplo.pt')).status, 429);
  const r = await pedir(worker, env, 'POST', '/conta/api/entrar', { corpo: { email: 'maria@exemplo.pt', pedido: 'a'.repeat(22), codigo: '123456' }, cabecalhos: ORIGEM });
  assert.equal(r.status, 429);
});

test('entrar: o código errado conta as tentativas; à 5.ª pede-se outro, e o certo já não vale', async () => {
  const { env, enviados } = ambiente();
  const r1 = await pedirCodigo(env, 'ana@exemplo.pt');
  const certo = ultimoCodigo(enviados);
  const errado = certo === '000000' ? '111111' : '000000';
  const tentar = (codigo) => pedir(worker, env, 'POST', '/conta/api/entrar', { corpo: { email: 'ana@exemplo.pt', pedido: r1.json.pedido, codigo }, cabecalhos: ORIGEM });
  const curto = await tentar('123');
  assert.equal(curto.status, 400);
  assert.match(curto.json.erro, /6 algarismos/);
  for (let i = 1; i < TENTATIVAS; i++) {
    const r = await tentar(errado);
    assert.equal(r.status, 400);
    assert.equal(r.json.campo, 'codigo');
    assert.match(r.json.erro, TENTATIVAS - i === 1 ? /mais uma tentativa/ : new RegExp(`mais ${TENTATIVAS - i} tentativas`));
  }
  const ultima = await tentar(errado);
  assert.equal(ultima.json.novo, true);
  assert.match(ultima.json.erro, /Peça um código novo/);
  const tarde = await tentar(certo);
  assert.equal(tarde.status, 400);
  assert.equal(tarde.json.novo, true);
  assert.equal(tarde.headers.get('set-cookie'), null);
});

test('entrar: o código certo dá o cookie da sessão (__Host-, HttpOnly, Secure, SameSite=Lax, 30 dias) e só vale uma vez', async () => {
  const { env, enviados } = ambiente();
  const r1 = await pedirCodigo(env, 'ana@exemplo.pt');
  const codigo = ultimoCodigo(enviados);
  const corpo = { email: 'ANA@exemplo.pt', pedido: r1.json.pedido, codigo: `${codigo.slice(0, 3)} ${codigo.slice(3)}` };
  const r2 = await pedir(worker, env, 'POST', '/conta/api/entrar', { corpo, cabecalhos: ORIGEM });
  assert.equal(r2.status, 200, r2.texto);
  const cab = r2.headers.get('set-cookie');
  assert.match(cab, /^__Host-lf-sessao=[0-9a-f]{64}\.[A-Za-z0-9_-]{43}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/);
  const outra = await pedir(worker, env, 'POST', '/conta/api/entrar', { corpo, cabecalhos: ORIGEM });
  assert.equal(outra.status, 400, 'o código gastou-se');
});

test('o código passa ao fim de 10 minutos', async () => {
  const { env, enviados } = ambiente();
  const r1 = await pedirCodigo(env, 'ana@exemplo.pt');
  const repor = comRelogio(11 * 60_000);
  try {
    const r = await pedir(worker, env, 'POST', '/conta/api/entrar', { corpo: { email: 'ana@exemplo.pt', pedido: r1.json.pedido, codigo: ultimoCodigo(enviados) }, cabecalhos: ORIGEM });
    assert.equal(r.status, 400);
    assert.equal(r.json.novo, true);
  } finally { repor(); }
});

test('a conta mostra as encomendas do email dela (também com o Gmail escrito de outra maneira) e nenhuma de outra pessoa', async () => {
  const rede = redeFalsa({ catalogo: catalogoBase() });
  try {
    const { env, enviados } = ambiente();
    const dela1 = await registar(worker, env, { cliente: { nome: 'Joana Silva', email: 'Joana.Silva+loja@gmail.com', telefone: '912 345 678' } });
    const dela2 = await registar(worker, env, { cliente: { nome: 'Joana Silva', email: 'joanasilva@gmail.com', telefone: '912 345 678' } });
    const outra = await registar(worker, env, { cliente: { nome: 'Rui Costa', email: 'rui@exemplo.pt', telefone: '913 333 333' } });
    const cookie = await entrar(env, enviados, 'joana.silva@gmail.com');

    const eu = await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } });
    assert.equal(eu.status, 200, eu.texto);
    assert.equal(eu.json.email, 'joana.silva@gmail.com', 'mostra o email como a pessoa o escreveu ao entrar');
    assert.deepEqual(eu.json.encomendas.map((x) => x.encomenda).sort(), [dela1.encomenda, dela2.encomenda].sort());
    const um = eu.json.encomendas[0];
    assert.deepEqual(Object.keys(um).sort(), ['criada_em', 'encomenda', 'entrega', 'estado', 'linhas', 'total_cents']);
    assert.equal(um.estado, 'registada');
    assert.deepEqual(um.linhas, [{ nome: um.linhas[0].nome, qtd: 2 }]);
    assert.equal(eu.headers.get('cache-control'), 'no-store');

    // a ficha: a dela sim; a de outra pessoa não existe para ela
    const ficha = await pedir(worker, env, 'GET', `/conta/api/encomenda?e=${dela1.encomenda}`, { cabecalhos: { Cookie: cookie } });
    assert.equal(ficha.status, 200, ficha.texto);
    assert.equal(ficha.json.encomenda, dela1.encomenda);
    assert.ok(!/@|912 345 678|chave/.test(ficha.texto), 'sem email, telefone nem a chave da encomenda');
    assert.deepEqual(ficha.json.historico.map((h) => h.estado), ['registada']);
    const alheia = await pedir(worker, env, 'GET', `/conta/api/encomenda?e=${outra.encomenda}`, { cabecalhos: { Cookie: cookie } });
    assert.equal(alheia.status, 404);
    const torta = await pedir(worker, env, 'GET', '/conta/api/encomenda?e=LF-1', { cabecalhos: { Cookie: cookie } });
    assert.equal(torta.status, 404);
  } finally { rede.repor(); }
});

test('sem conta, ou com um cookie adulterado: 401 e o cookie apaga-se; uma conta sem encomendas vem vazia', async () => {
  const { env, enviados } = ambiente();
  const sem = await pedir(worker, env, 'GET', '/conta/api/eu');
  assert.equal(sem.status, 401);
  assert.match(sem.headers.get('set-cookie'), /^__Host-lf-sessao=; Path=\/; Max-Age=0/);
  const cookie = await entrar(env, enviados, 'nova@exemplo.pt');
  const vazia = await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } });
  assert.deepEqual(vazia.json.encomendas, []);
  const [id] = cookie.split('=')[1].split('.');
  const adulterado = `__Host-lf-sessao=${id}.${'A'.repeat(43)}`;
  assert.equal((await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: adulterado } })).status, 401);
  assert.equal((await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: '__Host-lf-sessao=lixo' } })).status, 401);
});

test('o caminho da encomenda: cada estado com a data; a nota só na enviada (o rastreio) e na anulada', async () => {
  const rede = redeFalsa({ catalogo: catalogoBase() });
  try {
    const { env, enviados } = ambiente();
    const enc = await registar(worker, env, { entrega: 'continente', cliente: { nome: 'Marta Reis', email: 'marta@exemplo.pt', telefone: '912 345 678', ...moradaValida() } });
    const marcar = (estado, nota) => pedir(worker, env, 'POST', `/painel/encomendas/${enc.encomenda}/estado`, { corpo: { estado, nota, por: 'dono@exemplo.pt' }, cabecalhos: bearer() });
    assert.equal((await marcar('paga', 'Pagou em dinheiro ao balcão — confirmar troco')).status, 200);
    assert.equal((await pedir(worker, env, 'POST', `/painel/encomendas/${enc.encomenda}/nota`, { corpo: { texto: 'Cliente difícil', por: 'dono@exemplo.pt' }, cabecalhos: bearer() })).status, 200);
    assert.equal((await marcar('enviada', 'CTT RR123456789PT')).status, 200);
    const cookie = await entrar(env, enviados, 'marta@exemplo.pt');
    const r = await pedir(worker, env, 'GET', `/conta/api/encomenda?e=${enc.encomenda}`, { cabecalhos: { Cookie: cookie } });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.historico.map((h) => [h.estado, h.nota || null]), [['registada', null], ['paga', null], ['enviada', 'CTT RR123456789PT']]);
    assert.ok(r.json.historico.every((h) => /^\d{4}-\d{2}-\d{2}T/.test(h.em)));
    assert.doesNotMatch(r.texto, /dinheiro|difícil|dono@/, 'as notas internas não saem');
    assert.equal(r.json.morada, 'Rua das Flores, 10, 2.º Esq., 3720-100 Oliveira de Azeméis');
  } finally { rede.repor(); }
});

test('o caminho salta as linhas que não mudam o estado (as da Stripe que ficaram só no histórico)', () => {
  const h = historicoDoCliente({ historico: [
    { em: '2026-11-13T10:00:00.000Z', estado: 'pendente', por: 'site' },
    { em: '2026-11-13T10:01:00.000Z', estado: 'pendente', por: 'stripe', nota: 'Evento da Stripe ignorado (…). Confirme na Stripe.' },
    { em: '2026-11-13T10:02:00.000Z', estado: 'paga', por: 'stripe' },
    { em: '2026-11-13T11:00:00.000Z', estado: 'anulada', por: 'dono@exemplo.pt', nota: 'Sem stock: o reembolso segue amanhã.' },
    { em: '2026-11-13T11:01:00.000Z', estado: 'qualquer', por: 'x' },
  ] });
  assert.deepEqual(h, [
    { em: '2026-11-13T10:00:00.000Z', estado: 'pendente' },
    { em: '2026-11-13T10:02:00.000Z', estado: 'paga' },
    { em: '2026-11-13T11:00:00.000Z', estado: 'anulada', nota: 'Sem stock: o reembolso segue amanhã.' },
  ]);
});

test('um email comprido (cortado nos metadados do KV) também aparece na conta', async () => {
  const rede = redeFalsa({ catalogo: catalogoBase() });
  try {
    const { env, enviados } = ambiente();
    const longo = `${'a'.repeat(90)}@exemplo.pt`;
    const enc = await registar(worker, env, { cliente: { nome: 'Ana', email: longo, telefone: '912 345 678' } });
    const cookie = await entrar(env, enviados, longo);
    const eu = await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } });
    assert.deepEqual(eu.json.encomendas.map((x) => x.encomenda), [enc.encomenda]);
  } finally { rede.repor(); }
});

test('sair apaga a sessão (o cookie antigo já não entra) e o cookie', async () => {
  const { env, enviados } = ambiente();
  const cookie = await entrar(env, enviados, 'ana@exemplo.pt');
  const r = await pedir(worker, env, 'POST', '/conta/api/sair', { cabecalhos: { ...ORIGEM, Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /^__Host-lf-sessao=; Path=\/; Max-Age=0/);
  assert.equal((await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } })).status, 401);
  assert.equal((await pedir(worker, env, 'POST', '/conta/api/sair', { cabecalhos: { Cookie: cookie } })).status, 403, 'sair também só vindo do site');
});

test('a sessão renova-se com o uso (uma vez por dia) e acaba 30 dias depois do último uso', async () => {
  const { env, enviados } = ambiente();
  const cookie = await entrar(env, enviados, 'ana@exemplo.pt');
  const mesmoDia = await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } });
  assert.equal(mesmoDia.headers.get('set-cookie'), null, 'no mesmo dia não se renova');
  let repor = comRelogio(2 * 86400_000);
  try {
    const depois = await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } });
    assert.equal(depois.status, 200);
    assert.match(depois.headers.get('set-cookie'), new RegExp(`Max-Age=${SESSAO_DIAS * 86400}`));
    repor(); repor = comRelogio((2 + SESSAO_DIAS - 1) * 86400_000);
    assert.equal((await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } })).status, 200, 'renovada, ainda vale');
    repor(); repor = comRelogio((2 + SESSAO_DIAS - 1 + SESSAO_DIAS + 1) * 86400_000);
    assert.equal((await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } })).status, 401, 'passou o prazo');
  } finally { repor(); }
});

test('as rotas da conta: métodos e caminhos desconhecidos', async () => {
  const { env } = ambiente();
  assert.equal((await pedir(worker, env, 'GET', '/conta/api/codigo')).status, 405);
  assert.equal((await pedir(worker, env, 'POST', '/conta/api/eu', { cabecalhos: ORIGEM })).status, 405);
  assert.equal((await pedir(worker, env, 'GET', '/conta/api/outra')).status, 404);
});

/* ---------------------------------------------------------------- o cartão das películas */
import { ehHidrogel, cartaoDe, idDaConta as idDaContaDe } from '../conta.js';

const cartao = (env, email) => pedir(worker, env, 'GET', `/painel/cartoes?email=${encodeURIComponent(email)}`, { cabecalhos: bearer() });
const carimbar = (env, email, n, extra = {}) => pedir(worker, env, 'POST', '/painel/cartoes/carimbo', { corpo: { email, n, por: 'dono@exemplo.pt', ...extra }, cabecalhos: bearer() });
const oferta = (env, email) => pedir(worker, env, 'POST', '/painel/cartoes/oferta', { corpo: { email, por: 'dono@exemplo.pt' }, cabecalhos: bearer() });
const HIDROGEL = (qtd) => ({ linhas: [{ produto: 'pelicula-hidrogel', opcoes: [], qtd }], total_cents: 1250 * qtd });

test('o cartão: as películas de hidrogel pelo nome; cada 5 dão uma oferta; as entregues descontam-se', () => {
  assert.ok(ehHidrogel('Película de Hidrogel Privacidade Cerâmica Matte'));
  assert.ok(ehHidrogel('película de hidrogel aplicada'));
  assert.ok(!ehHidrogel('Película de vidro temperado'));
  assert.deepEqual(cartaoDe(0), { por_cartao: 5, site: 0, loja: 0, total: 0, atuais: 0, disponiveis: 0, entregues: 0 });
  assert.deepEqual(cartaoDe(3, { carimbos: [{ n: 2 }] }), { por_cartao: 5, site: 3, loja: 2, total: 5, atuais: 0, disponiveis: 1, entregues: 0 });
  assert.deepEqual(cartaoDe(2, { carimbos: [{ n: 5 }], ofertas: [{}] }), { por_cartao: 5, site: 2, loja: 5, total: 7, atuais: 2, disponiveis: 0, entregues: 1 });
  assert.equal(cartaoDe(0, { carimbos: [{ n: 2 }, { n: -5 }] }).loja, 0, 'nunca abaixo de zero');
});

test('o cartão no painel: só com o segredo; as da loja marcam-se e corrigem-se; a oferta só quando a há', async () => {
  const { env } = ambiente();
  assert.equal((await pedir(worker, env, 'GET', '/painel/cartoes?email=ana@exemplo.pt')).status, 401);
  assert.equal((await cartao(env, 'ana@')).status, 400);
  const vazio = await cartao(env, 'Ana@Exemplo.pt');
  assert.equal(vazio.status, 200, vazio.texto);
  assert.equal(vazio.json.email, 'ana@exemplo.pt');
  assert.deepEqual(vazio.json.cartao, cartaoDe(0));
  assert.deepEqual(vazio.json.movimentos, []);
  assert.equal((await carimbar(env, 'ana@exemplo.pt', 0)).status, 400);
  assert.equal((await carimbar(env, 'ana@exemplo.pt', 11)).status, 400);
  assert.equal((await carimbar(env, 'ana@exemplo.pt', -1)).status, 400, 'não se tira o que não há');
  const tres = await carimbar(env, 'ana@exemplo.pt', 3, { nota: 'cartão de papel com 3' });
  assert.equal(tres.status, 200, tres.texto);
  assert.equal(tres.json.cartao.loja, 3);
  assert.equal((await oferta(env, 'ana@exemplo.pt')).status, 409, 'com 3, ainda não há oferta');
  assert.equal((await carimbar(env, 'ana@exemplo.pt', -1)).json.cartao.loja, 2, 'corrigir um engano');
  const cinco = await carimbar(env, 'ana@exemplo.pt', 3);
  assert.deepEqual([cinco.json.cartao.total, cinco.json.cartao.disponiveis, cinco.json.cartao.atuais], [5, 1, 0]);
  const dada = await oferta(env, 'ana@exemplo.pt');
  assert.equal(dada.status, 200, dada.texto);
  assert.deepEqual([dada.json.cartao.disponiveis, dada.json.cartao.entregues, dada.json.cartao.atuais], [0, 1, 0]);
  assert.equal((await oferta(env, 'ana@exemplo.pt')).status, 409, 'a mesma oferta não se dá duas vezes');
  assert.deepEqual(dada.json.movimentos.map((m) => `${m.tipo}${m.n ?? ''}`).sort(), ['loja-1', 'loja3', 'loja3', 'oferta']);
  assert.equal(dada.json.movimentos.filter((m) => m.tipo === 'loja').length, 3);
  assert.equal(dada.json.movimentos.find((m) => m.nota).nota, 'cartão de papel com 3');
  assert.ok(dada.json.movimentos.every((m) => m.por === 'dono@exemplo.pt'));
});

test('as películas do site contam sozinhas quando a encomenda está paga; a conta do cliente mostra o cartão', async () => {
  const rede = redeFalsa({ catalogo: catalogoBase() });
  try {
    const { env, enviados } = ambiente();
    const cliente = { nome: 'Rita Lopes', email: 'rita@exemplo.pt', telefone: '912 345 678' };
    const paga = await registar(worker, env, { ...HIDROGEL(2), cliente });
    const porPagar = await registar(worker, env, { ...HIDROGEL(1), cliente });
    await registar(worker, env, { cliente }); // auscultadores: não são películas
    assert.equal((await pedir(worker, env, 'POST', `/painel/encomendas/${paga.encomenda}/estado`, { corpo: { estado: 'paga', por: 'dono@exemplo.pt' }, cabecalhos: bearer() })).status, 200);
    const c = await cartao(env, 'rita@exemplo.pt');
    assert.equal(c.json.cartao.site, 2, 'só a paga conta');
    assert.deepEqual(c.json.movimentos.map((m) => [m.tipo, m.n, m.encomenda]), [['site', 2, paga.encomenda]]);
    assert.ok(porPagar.encomenda);
    await carimbar(env, 'rita@exemplo.pt', 4);
    const cookie = await entrar(env, enviados, 'rita@exemplo.pt');
    const eu = await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } });
    assert.equal(eu.status, 200, eu.texto);
    assert.deepEqual(eu.json.cartao, { por_cartao: 5, total: 6, atuais: 1, disponiveis: 1 });
    assert.doesNotMatch(eu.texto, /dono@exemplo\.pt/, 'quem marcou não sai para o cliente');
  } finally { rede.repor(); }
});

test('um cartão feito no painel (de quem nunca entrou no site) aparece quando o cliente entra; e fica quando as sessões acabam', async () => {
  const { env, enviados } = ambiente();
  await carimbar(env, 'Joana.Reis@gmail.com', 2);
  const cookie = await entrar(env, enviados, 'joanareis@gmail.com');
  const eu = await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } });
  assert.equal(eu.json.cartao.atuais, 2);
  // o alarme do objecto: com as sessões vencidas, o cartão fica; 3 anos depois do último movimento, sai
  const id = await idDaContaDe(emailDaConta('joanareis@gmail.com'));
  const objecto = env.CONTA.instancias.get(id);
  let repor = comRelogio((SESSAO_DIAS + 5) * 86400_000);
  try {
    await objecto.alarm();
    assert.equal((await cartao(env, 'joanareis@gmail.com')).json.cartao.loja, 2, 'o cartão ficou');
    assert.equal((await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } })).status, 401, 'a sessão acabou');
    repor(); repor = comRelogio(3 * 366 * 86400_000);
    await objecto.alarm();
    assert.equal((await cartao(env, 'joanareis@gmail.com')).json.cartao.loja, 0, 'passados 3 anos sem movimentos, sai');
  } finally { repor(); }
});

/* ---------------------------------------------------------------- a conta, mais (14 nov 2026): os dados, as garantias,
   desistir, sair em todos os aparelhos, apagar, o QR e o Google */
import { garantiasDasLinhas, prazoDeDesistir, validarDados, somarMeses, enderecoDoCartao, verificarTokenDoGoogle } from '../conta.js';
import { renderSVG } from '../vendor/uqr.mjs';

const marcar = (env, id, estado, nota) => pedir(worker, env, 'POST', `/painel/encomendas/${id}/estado`, { corpo: { estado, ...(nota ? { nota } : {}), por: 'dono@exemplo.pt' }, cabecalhos: bearer() });

test('os dados da conta: conferidos como no checkout; sem eles, a sugestão vem da última encomenda', async () => {
  const rede = redeFalsa({ catalogo: catalogoBase() });
  try {
    const { env, enviados } = ambiente();
    assert.equal((await pedir(worker, env, 'GET', '/conta/api/dados')).status, 401);
    await registar(worker, env, { cliente: { nome: 'Sara Matos', email: 'sara@exemplo.pt', telefone: '912 345 678', nif: '123456789' } });
    const cookie = await entrar(env, enviados, 'sara@exemplo.pt');
    const d0 = await pedir(worker, env, 'GET', '/conta/api/dados', { cabecalhos: { Cookie: cookie } });
    assert.equal(d0.status, 200, d0.texto);
    assert.equal(d0.json.dados, null);
    assert.deepEqual(d0.json.sugestao, { nome: 'Sara Matos', telefone: '912 345 678', nif: '123456789' });
    const gravar = (corpo) => pedir(worker, env, 'POST', '/conta/api/dados', { corpo, cabecalhos: { ...ORIGEM, Cookie: cookie } });
    assert.equal((await gravar({ nif: '123456780' })).json.campo, 'nif');
    assert.equal((await gravar({ telefone: '12' })).json.campo, 'telefone');
    assert.equal((await gravar({ codigoPostal: '3720' })).json.campo, 'codigoPostal');
    assert.equal((await pedir(worker, env, 'POST', '/conta/api/dados', { corpo: { nome: 'X' }, cabecalhos: { Cookie: cookie } })).status, 403, 'só vindo do site');
    const ok = await gravar({ nome: ' Sara  Matos ', telefone: '912 345 678', morada: 'Rua A, 1', codigoPostal: '3720-100', localidade: 'São Roque', inventado: 'x' });
    assert.equal(ok.status, 200, ok.texto);
    assert.deepEqual(Object.keys(ok.json.dados).sort(), ['actualizado_em', 'codigoPostal', 'localidade', 'morada', 'nome', 'telefone']);
    assert.equal(ok.json.dados.nome, 'Sara Matos');
    const eu = await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } });
    assert.equal(eu.json.nome, 'Sara');
    assert.equal(eu.json.dados.localidade, 'São Roque');
    assert.equal(eu.json.sugestao, null, 'com os dados gravados, já não há sugestão');
  } finally { rede.repor(); }
});

test('validarDados: tudo opcional; o que vem confere-se; o NIF sem espaços', () => {
  assert.deepEqual(validarDados({}), { dados: {} });
  assert.deepEqual(validarDados({ nif: '123 456 789' }), { dados: { nif: '123456789' } });
  assert.equal(validarDados({ nif: '1' }).campo, 'nif');
});

test('as garantias: da entrega, 3 anos nos novos e a da loja nos recondicionados; um artigo fora do catálogo não diz', () => {
  const cat = { produtos: { novo: { estado: 'novo' }, recond: { estado: 'recondicionado' } }, garantias: { recondicionados: 18 } };
  const enc = { estado: 'levantada', linhas: [{ produto: 'novo', nome: 'A' }, { produto: 'recond', nome: 'B' }, { produto: 'saiu', nome: 'C' }],
    historico: [{ em: '2026-11-13T10:00:00.000Z', estado: 'registada' }, { em: '2026-11-14T10:00:00.000Z', estado: 'paga' }, { em: '2026-11-15T10:00:00.000Z', estado: 'levantada' }] };
  assert.deepEqual(garantiasDasLinhas(enc, cat), [{ meses: 36, ate: '2029-11-15' }, { meses: 18, ate: '2028-05-15' }, null]);
  assert.equal(garantiasDasLinhas({ ...enc, estado: 'paga' }, cat), null, 'antes de entregar não há garantia a contar');
  assert.equal(garantiasDasLinhas({ ...enc, estado: 'anulada' }, cat), null);
  assert.deepEqual(garantiasDasLinhas(enc, { ...cat, garantias: { recondicionados: null } })[1], { meses: 18, ate: '2028-05-15' }, 'sem o valor da loja, 18 meses');
  assert.equal(somarMeses('2026-01-31T12:00:00.000Z', 1), '2026-02-28', 'o fim do mês não passa para o seguinte');
  // uma linha depois da entrega com o mesmo estado (o pedido para desistir, uma da Stripe) não muda o dia da entrega
  const depois = { ...enc, historico: [...enc.historico, { em: '2026-11-20T10:00:00.000Z', estado: 'levantada', por: 'cliente', nota: 'Pediu para desistir da compra, na conta do site.' }] };
  assert.deepEqual(garantiasDasLinhas(depois, cat)[0], { meses: 36, ate: '2029-11-15' }, 'conta da levantada, não da linha do pedido');
  assert.equal(prazoDeDesistir(depois, Date.parse('2026-11-20T11:00:00.000Z')).ate, '2026-11-29T10:00:00.000Z', 'o prazo para desistir também');
});

test('a ficha diz a garantia de cada artigo entregue, e a conta lista as que correm', async () => {
  const rede = redeFalsa({ catalogo: catalogoBase() });
  try {
    const { env, enviados } = ambiente();
    const enc = await registar(worker, env, { cliente: { nome: 'Rui', email: 'rui.g@exemplo.pt', telefone: '912 345 678' } });
    assert.equal((await marcar(env, enc.encomenda, 'paga')).status, 200);
    assert.equal((await marcar(env, enc.encomenda, 'pronta')).status, 200);
    const cookie = await entrar(env, enviados, 'rui.g@exemplo.pt');
    let f = await pedir(worker, env, 'GET', `/conta/api/encomenda?e=${enc.encomenda}`, { cabecalhos: { Cookie: cookie } });
    assert.equal(f.json.garantias, null, 'pronta, ainda não foi entregue');
    assert.equal((await marcar(env, enc.encomenda, 'levantada')).status, 200);
    f = await pedir(worker, env, 'GET', `/conta/api/encomenda?e=${enc.encomenda}`, { cabecalhos: { Cookie: cookie } });
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const daqui3 = `${Number(hoje.slice(0, 4)) + 3}${hoje.slice(4)}`;
    assert.deepEqual(f.json.garantias, [{ meses: 36, ate: daqui3 }]);
    const eu = await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } });
    assert.deepEqual(eu.json.garantias, [{ encomenda: enc.encomenda, nome: eu.json.encomendas[0].linhas[0].nome, ate: daqui3 }]);
  } finally { rede.repor(); }
});

test('desistir da compra: antes de receber pode sempre; depois, 14 dias (no envio, mais uma semana); fica registado e os emails saem', async () => {
  const rede = redeFalsa({ catalogo: catalogoBase() });
  try {
    const { env, enviados } = ambiente({ STORE_EMAIL: 'dono@exemplo.pt' });
    const enc = await registar(worker, env, { cliente: { nome: 'Inês Cruz', email: 'ines@exemplo.pt', telefone: '912 345 678' } });
    const outra = await registar(worker, env, { cliente: { nome: 'Outro', email: 'outro@exemplo.pt', telefone: '913 333 333' } });
    const cookie = await entrar(env, enviados, 'ines@exemplo.pt');
    const desistir = (e, nota) => pedir(worker, env, 'POST', '/conta/api/desistir', { corpo: { e, ...(nota ? { nota } : {}) }, cabecalhos: { ...ORIGEM, Cookie: cookie } });
    let f = await pedir(worker, env, 'GET', `/conta/api/encomenda?e=${enc.encomenda}`, { cabecalhos: { Cookie: cookie } });
    assert.deepEqual(f.json.desistir, { pode: true, ate: null, pedidos: [] }, 'registada: ainda não recebeu, pode');
    assert.equal((await desistir(outra.encomenda)).status, 404, 'a de outra pessoa não existe para ela');
    const antes = enviados.length;
    const r = await desistir(enc.encomenda, 'Encomendei a cor errada.');
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.desistir.pedidos.length, 1);
    const novos = enviados.slice(antes);
    assert.deepEqual(novos.map((m) => m.to).sort(), ['dono@exemplo.pt', 'ines@exemplo.pt']);
    assert.ok(novos.some((m) => /^Recebemos o seu pedido para desistir/.test(m.subject) && /14 dias/.test(m.text)));
    // o recibo (função de retratação): a data E a hora do pedido, e o que o cliente escreveu
    assert.ok(novos.some((m) => /^Recebemos o seu pedido para desistir/.test(m.subject) && /a \d{1,2} de [a-zç]+ de \d{4}, às \d{2}:\d{2}\./.test(m.text)
      && /Escreveu: «Encomendei a cor errada\.»/.test(m.text) && /Escreveu: «Encomendei a cor errada\.»/.test(m.html)), 'o recibo diz a data, a hora e o que o cliente escreveu');
    assert.ok(novos.some((m) => /^Pedido para desistir: /.test(m.subject) && /na conta do site, a \d{1,2} de [a-zç]+ de \d{4}, às \d{2}:\d{2}\)/.test(m.text)), 'o da loja também diz a hora');
    assert.ok(novos.some((m) => /^Pedido para desistir: /.test(m.subject) && /Encomendei a cor errada/.test(m.text)));
    assert.equal((await desistir(enc.encomenda)).json.desistir.pedidos.length, 1, 'um duplo toque não repete o pedido nem os emails');
    assert.equal(enviados.length, antes + 2);
    // no painel: a linha do cliente no histórico, sem mudar o estado
    const noPainel = (await pedir(worker, env, 'GET', `/painel/encomendas/${enc.encomenda}`, { cabecalhos: bearer() })).json;
    assert.equal(noPainel.estado, 'registada');
    assert.match(noPainel.historico.at(-1).nota, /Pediu para desistir da compra, na conta do site\. «Encomendei a cor errada\.»/);
    // levantada: 14 dias
    await marcar(env, enc.encomenda, 'paga'); await marcar(env, enc.encomenda, 'pronta'); await marcar(env, enc.encomenda, 'levantada');
    f = await pedir(worker, env, 'GET', `/conta/api/encomenda?e=${enc.encomenda}`, { cabecalhos: { Cookie: cookie } });
    assert.equal(f.json.desistir.pode, true);
    const repor = comRelogio(15 * 86400_000);
    try {
      assert.equal(prazoDeDesistir(noPainel, Date.now()).pode, true, 'a registada (sem entrega) pode sempre');
      const tarde = await desistir(enc.encomenda);
      assert.equal(tarde.status, 409);
      assert.match(tarde.json.erro, /já passou/);
    } finally { repor(); }
  } finally { rede.repor(); }
});

test('prazoDeDesistir: no envio conta mais uma semana; anulada não pode', () => {
  const base = { historico: [{ em: '2026-11-01T10:00:00.000Z', estado: 'enviada' }], estado: 'enviada' };
  assert.equal(prazoDeDesistir(base, Date.parse('2026-11-21T09:00:00.000Z')).pode, true);
  assert.equal(prazoDeDesistir(base, Date.parse('2026-11-23T10:00:00.000Z')).pode, false);
  assert.equal(prazoDeDesistir({ ...base, estado: 'anulada' }).pode, false);
});

test('sair em todos os aparelhos fecha as sessões todas (os dados ficam); apagar a conta tira tudo menos as encomendas', async () => {
  const rede = redeFalsa({ catalogo: catalogoBase() });
  try {
    const { env, enviados } = ambiente();
    const enc = await registar(worker, env, { cliente: { nome: 'Vera', email: 'vera@exemplo.pt', telefone: '912 345 678' } });
    const a = await entrar(env, enviados, 'vera@exemplo.pt');
    let b;
    const repor = comRelogio(60_000);
    try { b = await entrar(env, enviados, 'vera@exemplo.pt'); } finally { repor(); }
    await pedir(worker, env, 'POST', '/conta/api/dados', { corpo: { nome: 'Vera Lima' }, cabecalhos: { ...ORIGEM, Cookie: a } });
    const todos = await pedir(worker, env, 'POST', '/conta/api/sair-todos', { cabecalhos: { ...ORIGEM, Cookie: a } });
    assert.equal(todos.status, 200);
    assert.match(todos.headers.get('set-cookie'), /Max-Age=0/);
    for (const c of [a, b]) assert.equal((await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: c } })).status, 401);
    const c = await entrar(env, enviados, 'vera@exemplo.pt');
    assert.equal((await pedir(worker, env, 'GET', '/conta/api/dados', { cabecalhos: { Cookie: c } })).json.dados.nome, 'Vera Lima', 'os dados ficaram');
    await carimbar(env, 'vera@exemplo.pt', 2);
    const ap = await pedir(worker, env, 'POST', '/conta/api/apagar', { cabecalhos: { ...ORIGEM, Cookie: c } });
    assert.equal(ap.status, 200);
    assert.equal((await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: c } })).status, 401);
    assert.equal((await cartao(env, 'vera@exemplo.pt')).json.cartao.loja, 0, 'o cartão saiu com a conta');
    assert.ok(await env.ORDERS.get(`order:${enc.encomenda}`), 'a encomenda fica (a lei manda guardá-la)');
    const d = await entrar(env, enviados, 'vera@exemplo.pt');
    assert.equal((await pedir(worker, env, 'GET', '/conta/api/dados', { cabecalhos: { Cookie: d } })).json.dados, null, 'entrar de novo começa sem dados');
  } finally { rede.repor(); }
});

test('o código QR do cartão: só com sessão; leva o endereço do cartão no painel; o painel abre o cartão pelo id da conta', async () => {
  const { env, enviados } = ambiente({ PAINEL_URL: 'https://painel.exemplo.pt/' });
  assert.equal((await pedir(worker, env, 'GET', '/conta/api/cartao.svg')).status, 401);
  const cookie = await entrar(env, enviados, 'Lara@exemplo.pt');
  const id = cookie.split('=')[1].split('.')[0];
  const qr = await pedir(worker, env, 'GET', '/conta/api/cartao.svg', { cabecalhos: { Cookie: cookie } });
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get('content-type'), /^image\/svg\+xml/);
  assert.match(qr.headers.get('cache-control'), /no-store/);
  assert.equal(enderecoDoCartao(env, id), `https://painel.exemplo.pt/#/cartoes?conta=${id}`);
  assert.equal(qr.texto, renderSVG(enderecoDoCartao(env, id), { ecc: 'M', border: 3, pixelSize: 8 }), 'o QR é o deste endereço');
  await carimbar(env, 'lara@exemplo.pt', 2);
  const peloQr = await pedir(worker, env, 'GET', `/painel/cartoes?conta=${id}`, { cabecalhos: bearer() });
  assert.equal(peloQr.status, 200, peloQr.texto);
  assert.equal(peloQr.json.email, 'lara@exemplo.pt', 'o email com que entrou');
  assert.equal(peloQr.json.conta, id);
  assert.equal(peloQr.json.cartao.loja, 2);
  assert.equal((await pedir(worker, env, 'GET', '/painel/cartoes?conta=xyz', { cabecalhos: bearer() })).status, 404);
  assert.equal((await pedir(worker, env, 'GET', `/painel/cartoes?conta=${'0'.repeat(64)}`, { cabecalhos: bearer() })).status, 404, 'uma conta que não existe');
  assert.equal((await pedir(worker, env, 'GET', `/painel/cartoes?conta=${id}`)).status, 401, 'sem o segredo do painel, nada');
});

/* O Google de faz-de-conta: um par de chaves RSA nosso, as chaves públicas servidas no endereço do Google. */
const b64u = (u8) => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const CLIENTE = '123456789-abcdefghij.apps.googleusercontent.com';
const parGoogle = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const outroPar = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwkGoogle = { ...(await crypto.subtle.exportKey('jwk', parGoogle.publicKey)), kid: 'chave-1', use: 'sig', alg: 'RS256' };
async function tokenGoogle(carga, { par = parGoogle, kid = 'chave-1' } = {}) {
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64u(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })));
  const c = b64u(new TextEncoder().encode(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENTE, iat: agora, exp: agora + 3600, email_verified: true, nonce: 'n'.repeat(24), ...carga })));
  const ass = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', par.privateKey, new TextEncoder().encode(`${cab}.${c}`)));
  return `${cab}.${c}.${b64u(ass)}`;
}
function comChavesDoGoogle(rede) {
  const anterior = globalThis.fetch;
  globalThis.fetch = (url, init) => (String(url) === 'https://www.googleapis.com/oauth2/v3/certs' ? Promise.resolve(Response.json({ keys: [jwkGoogle] })) : anterior(url, init));
  return () => { globalThis.fetch = anterior; rede.repor(); };
}

test('verificarTokenDoGoogle: a assinatura, o emissor, o cliente, o prazo, o nonce e o email verificado', async () => {
  const opcoes = { cliente: CLIENTE, nonce: 'n'.repeat(24), chaves: [jwkGoogle] };
  assert.deepEqual(await verificarTokenDoGoogle(await tokenGoogle({ email: 'Ana@Gmail.com' }), opcoes), { email: 'ana@gmail.com' });
  const casos = [
    [{ email: 'a@gmail.com', aud: 'outro.apps.googleusercontent.com' }, {}, 'aud'],
    [{ email: 'a@gmail.com', iss: 'https://evil.example' }, {}, 'iss'],
    [{ email: 'a@gmail.com', exp: Math.floor(Date.now() / 1000) - 3600 }, {}, 'exp'],
    [{ email: 'a@gmail.com', nonce: 'outro-nonce-com-24-letras' }, {}, 'nonce'],
    [{ email: 'a@gmail.com', email_verified: false }, {}, 'email'],
    [{ email: 'a@gmail.com' }, { par: outroPar }, 'assinatura'],
    [{ email: 'a@gmail.com' }, { kid: 'outra' }, 'chave'],
  ];
  for (const [carga, extra, erro] of casos) assert.equal((await verificarTokenDoGoogle(await tokenGoogle(carga, extra), opcoes)).erro, erro, erro);
  assert.equal((await verificarTokenDoGoogle('nada', opcoes)).erro, 'forma');
  assert.equal((await verificarTokenDoGoogle(await tokenGoogle({ email: 'a@gmail.com' }), { ...opcoes, nonce: 'curto' })).erro, 'nonce');
});

test('entrar com o Google: o email verificado entra na conta dele (as mesmas encomendas); sem o cliente configurado, não há botão', async () => {
  const semGoogle = ambiente();
  const sem = await pedir(worker, semGoogle.env, 'GET', '/conta/api/eu');
  assert.equal(sem.json.google, null, 'sem GOOGLE_CLIENTE a página não mostra o botão');
  assert.equal((await pedir(worker, semGoogle.env, 'POST', '/conta/api/google', { corpo: { id_token: 'x', nonce: 'n'.repeat(24) }, cabecalhos: ORIGEM })).status, 503);
  const rede = redeFalsa({ catalogo: catalogoBase() });
  const repor = comChavesDoGoogle(rede);
  try {
    const { env } = ambiente({ GOOGLE_CLIENTE: CLIENTE });
    assert.equal((await pedir(worker, env, 'GET', '/conta/api/eu')).json.google, CLIENTE);
    const enc = await registar(worker, env, { cliente: { nome: 'Tiago', email: 'Tiago.Reis@gmail.com', telefone: '912 345 678' } });
    const ok = await pedir(worker, env, 'POST', '/conta/api/google', { corpo: { id_token: await tokenGoogle({ email: 'tiagoreis@gmail.com' }), nonce: 'n'.repeat(24) }, cabecalhos: ORIGEM });
    assert.equal(ok.status, 200, ok.texto);
    const cookie = cookieDe(ok);
    assert.match(cookie, /^__Host-lf-sessao=[0-9a-f]{64}\./);
    const eu = await pedir(worker, env, 'GET', '/conta/api/eu', { cabecalhos: { Cookie: cookie } });
    assert.deepEqual(eu.json.encomendas.map((x) => x.encomenda), [enc.encomenda], 'a mesma conta do email (o Gmail sem os pontos)');
    const mau = await pedir(worker, env, 'POST', '/conta/api/google', { corpo: { id_token: await tokenGoogle({ email: 'x@gmail.com', aud: 'outro' }), nonce: 'n'.repeat(24) }, cabecalhos: ORIGEM });
    assert.equal(mau.status, 400);
    assert.equal(mau.headers.get('set-cookie'), null);
    assert.equal((await pedir(worker, env, 'POST', '/conta/api/google', { corpo: { id_token: 'x', nonce: 'n'.repeat(24) } })).status, 403, 'só vindo do site');
  } finally { repor(); }
});
