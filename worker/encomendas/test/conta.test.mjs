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
