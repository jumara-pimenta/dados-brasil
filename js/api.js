/* Comunicação com a API Dados Brasil (GraphQL). Todos os campos abaixo foram
   confirmados por introspecção do schema em https://api.dadosbrasil.net/graphql. */
(function () {
  'use strict';
  const { config } = DB;
  const cache = new Map();

  class ApiError extends Error {
    constructor(kind, message) { super(message); this.kind = kind; }
  }

  // Mensagem amigável para o usuário a partir do tipo de erro.
  function friendly(e, { hasText = true } = {}) {
    switch (e.kind) {
      case 'slow':
        return hasText
          ? 'A busca é pesada demais para a API (o servidor interrompeu após ~10 s). Isso acontece com nomes muito comuns. Deixe a busca mais específica: use o nome completo, ou combine com município, atividade (CNAE) ou natureza jurídica.'
          : 'A API não conseguiu concluir essa combinação de filtros a tempo (o servidor interrompeu após ~10 s). Algumas combinações ficam pesadas, como estado + situação + atividade. Tente remover um filtro (por exemplo, a situação cadastral) ou usar município em vez de estado.';
      case 'timeout': return 'A consulta demorou demais e foi interrompida. Tente novamente ou use filtros mais específicos.';
      case 'unavailable': return 'A API está temporariamente indisponível. Aguarde alguns instantes e tente novamente.';
      case 'network': return 'Não foi possível conectar à API. Verifique sua conexão com a internet.';
      case 'invalid': return 'A API retornou uma resposta inesperada.';
      case 'http': return 'A API respondeu com erro (' + e.message + ').';
      default: return 'Erro na consulta: ' + e.message;
    }
  }

  async function gql(query, variables = {}, { signal, force = false } = {}) {
    const key = JSON.stringify([query, variables]);
    if (!force) {
      const hit = cache.get(key);
      if (hit && hit.exp > Date.now()) return hit.data;
    }
    if (signal?.aborted) throw new ApiError('aborted', 'cancelada');

    const ctl = new AbortController();
    let timedOut = false;
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, config.TIMEOUT_MS);
    try {
      let res;
      try {
        res = await fetch(config.GRAPHQL_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables }),
          signal: ctl.signal,
        });
      } catch (e) {
        if (timedOut) throw new ApiError('timeout', 'tempo esgotado');
        if (e.name === 'AbortError') throw new ApiError('aborted', 'cancelada');
        throw new ApiError('network', e.message);
      }
      let body = null;
      try { body = await res.json(); } catch { /* corpo não-JSON (ex.: 502 do proxy) */ }
      // A API devolve HTTP 503 + GraphQL TIMEOUT quando a busca estoura o limite do servidor:
      // isso é "consulta pesada", não indisponibilidade.
      if (body?.errors?.[0]?.extensions?.code === 'TIMEOUT') throw new ApiError('slow', body.errors[0].message);
      if (!res.ok) throw new ApiError([502, 503, 504].includes(res.status) ? 'unavailable' : 'http', String(res.status));
      if (body === null) throw new ApiError('invalid', 'JSON inválido');
      if (body?.errors?.length) {
        const err = body.errors[0];
        throw new ApiError(err.extensions?.code === 'TIMEOUT' ? 'slow' : 'server', err.message);
      }
      if (!body?.data) throw new ApiError('invalid', 'sem dados');
      cache.set(key, { data: body.data, exp: Date.now() + config.CACHE_TTL_MS });
      if (cache.size > config.CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
      return body.data;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  // ---- Listas de referência (com cache de 24h no navegador; sem dados pessoais) ----
  const REF_KEY = 'dadosbrasil.refs.v1';
  async function loadReferences() {
    try {
      const c = JSON.parse(localStorage.getItem(REF_KEY) || 'null');
      if (c && c.exp > Date.now()) return c.data;
    } catch { /* localStorage indisponível */ }
    const data = await gql('{ states { uf name } cnaes { id description } legalNatures { id description } }');
    try { localStorage.setItem(REF_KEY, JSON.stringify({ exp: Date.now() + config.REF_TTL_MS, data })); } catch { /* ignora */ }
    return data;
  }

  // A base guarda nomes em MAIÚSCULAS e sem acento ("SAO PAULO"); consultas acentuadas retornam vazio.
  async function searchCities(query, { after = null, signal } = {}) {
    const d = await gql(
      `query($q:String,$n:Int,$a:String){ cities(query:$q, first:$n, after:$a){
         pageInfo { hasNextPage endCursor } edges { node { id name state { uf } } } } }`,
      { q: DB.format.norm(query).trim().toUpperCase(), n: config.API_MAX_PAGE, a: after }, { signal });
    return { items: d.cities.edges.map(e => e.node), hasNext: d.cities.pageInfo.hasNextPage, endCursor: d.cities.pageInfo.endCursor };
  }

  // Nomes de município vêm vazios dentro de establishments; resolvemos em lote com aliases.
  const cityNames = new Map();
  async function resolveCityNames(ids, opts) {
    const todo = [...new Set(ids.map(DB.format.cityId).filter(i => /^\d{4}$/.test(i) && i !== '0000' && !cityNames.has(i)))];
    if (!todo.length) return;
    const body = todo.map((id, i) => `c${i}: city(id: "${id}") { name }`).join(' ');
    try {
      const d = await gql(`{ ${body} }`, {}, opts);
      todo.forEach((id, i) => cityNames.set(id, d['c' + i]?.name || ''));
    } catch (e) {
      if (e.kind === 'aborted') throw e;   // falha ao resolver nomes não deve derrubar a pesquisa
    }
  }
  const cityName = id => cityNames.get(DB.format.cityId(id)) || '';

  // ---- Estabelecimentos ----
  const LIST_FIELDS = `cnpj isHeadOffice tradeName status
    primaryActivity { id description }
    city { id name } state { uf }
    contact { email phones }
    company { legalName shareCapital size { code } }`;

  async function searchEstablishments(filter, { cursor = null, first = config.PAGE_SIZE, signal, force } = {}) {
    const d = await gql(
      `query($f:EstablishmentFilter!,$n:Int,$a:String){ establishments(filter:$f, first:$n, after:$a){
         pageInfo { hasNextPage endCursor } edges { node { ${LIST_FIELDS} } } } }`,
      { f: filter, n: Math.min(first, config.API_MAX_PAGE), a: cursor }, { signal, force });
    const conn = d.establishments;
    return { rows: conn.edges.map(e => e.node), hasNext: conn.pageInfo.hasNextPage, endCursor: conn.pageInfo.endCursor };
  }

  // Página enxuta, só para contagem (a API não fornece totais). Traz o porte apenas se necessário.
  async function scanPage(filter, { cursor = null, withSize = false, withContact = false, signal } = {}) {
    const extra = (withSize ? ' company { size { code } }' : '') + (withContact ? ' contact { email phones }' : '');
    const d = await gql(
      `query($f:EstablishmentFilter!,$n:Int,$a:String){ establishments(filter:$f, first:$n, after:$a){
         pageInfo { hasNextPage endCursor } edges { node { cnpj${extra} } } } }`,
      { f: filter, n: config.API_MAX_PAGE, a: cursor }, { signal });
    const c = d.establishments;
    return { rows: c.edges.map(e => e.node), hasNext: c.pageInfo.hasNextPage, endCursor: c.pageInfo.endCursor };
  }

  // A API aceita uma UF por consulta. Para várias UFs, `filters` traz um filtro por UF e a
  // posição { i, cursor } indica em qual UF e cursor estamos; devolve a posição seguinte (ou null).
  function nextPos(filters, pos, r) {
    if (r.hasNext) return { i: pos.i, cursor: r.endCursor };
    return pos.i + 1 < filters.length ? { i: pos.i + 1, cursor: null } : null;
  }

  const ESTAB_MINI = 'cnpj isHeadOffice tradeName status city { id name } state { uf }';

  async function getEstablishment(cnpj, opts) {
    const d = await gql(
      `query($c:String!,$n:Int){ establishment(cnpj:$c){
         cnpj isHeadOffice tradeName status statusDate statusReasonCode activityStartDate
         specialSituation specialSituationDate
         primaryActivity { id description } secondaryActivities { id description }
         address { streetType street number complement neighborhood zipCode foreignCity }
         contact { email phones fax }
         city { id name } state { uf name }
         company { cnpjRoot legalName shareCapital size { code } legalNature { id description }
           establishmentsCount simplesNacional { optedIn meiOptedIn }
           partners { name kind qualification { description } entryDate }
           establishments(first:$n){ pageInfo { hasNextPage endCursor } edges { node { ${ESTAB_MINI} } } } } } }`,
      { c: cnpj, n: config.DETAIL_ESTABLISHMENTS_PAGE }, opts);
    return d.establishment;
  }

  async function getCompanyEstablishments(cnpjRoot, cursor, opts) {
    const d = await gql(
      `query($r:String!,$n:Int,$a:String){ company(cnpj:$r){ establishments(first:$n, after:$a){
         pageInfo { hasNextPage endCursor } edges { node { ${ESTAB_MINI} } } } } }`,
      { r: cnpjRoot, n: config.DETAIL_ESTABLISHMENTS_PAGE, a: cursor }, opts);
    const c = d.company.establishments;
    return { rows: c.edges.map(e => e.node), hasNext: c.pageInfo.hasNextPage, endCursor: c.pageInfo.endCursor };
  }

  DB.api = { ApiError, friendly, gql, loadReferences, searchCities, resolveCityNames, cityName,
             searchEstablishments, scanPage, nextPos, getEstablishment, getCompanyEstablishments };
})();
