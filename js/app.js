/* Orquestração: estado da pesquisa, paginação por cursor, detalhe e abas. */
(function () {
  'use strict';
  const { config, format: F, api, filters, render } = DB;
  const $ = id => document.getElementById(id);

  // Estado da pesquisa corrente (os filtros ficam congelados entre as páginas).
  const S = {
    filters: null, sizes: null, chips: [],  // filters: um filtro por combinação UF × situação; sizes: portes (filtro no navegador)
    sort: null,                             // { key: 'legal' | 'trade', dir: 1 | -1 } — a API não ordena: vale só para a página/exportação
    contact: '', baseChips: [],            // contact: '' | any | email | phone (filtro no navegador, aplicado após a busca)
    positions: [{ i: 0, cursor: null }],    // positions[n] = { UF, cursor } que abre a página n
    page: 0, rows: [], hasNext: false,
    loading: false, seq: 0, ctl: null,
    total: null,               // { n, exact } após "Contar total"
    counting: false, countCtl: null,
    exporting: false, exportCtl: null,
  };
  const nf = n => n.toLocaleString('pt-BR');
  const D = { seq: 0, ctl: null, trigger: null, lastCnpj: null };

  const sizeOf = r => (r.company?.size?.code == null ? 0 : +r.company.size.code);

  // Filtros aplicados no navegador (a API não os oferece): porte e contato disponível.
  // Ordenação A–Z no navegador (sem diferenciar acentos/maiúsculas); nomes vazios ficam sempre no fim.
  const SORT_KEYS = { legal: r => r.company?.legalName, trade: r => r.tradeName };
  const SORT_LABELS = { legal: 'razão social', trade: 'nome fantasia' };
  const collator = new Intl.Collator('pt', { sensitivity: 'base', numeric: true });
  const sortRows = (rows, sort) => {
    if (!sort) return rows;
    const get = SORT_KEYS[sort.key];
    return [...rows].sort((a, b) => {
      const x = String(get(a) ?? '').trim(), y = String(get(b) ?? '').trim();
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return sort.dir * collator.compare(x, y);
    });
  };

  function updateSortHeaders() {
    document.querySelectorAll('.th-sort').forEach(btn => {
      const active = S.sort?.key === btn.dataset.sort;
      btn.closest('th').setAttribute('aria-sort', !active ? 'none' : S.sort.dir === 1 ? 'ascending' : 'descending');
      btn.querySelector('.sort-ind').textContent = !active ? '↕' : S.sort.dir === 1 ? '▲' : '▼';
      btn.title = !active || S.sort.dir === -1 ? 'Ordenar de A a Z (apenas os resultados desta página)'
        : 'Ordenar de Z a A (apenas os resultados desta página)';
    });
  }

  // Cada clique alterna: A–Z → Z–A → ordem original (por CNPJ).
  function toggleSort(key) {
    S.sort = S.sort?.key !== key ? { key, dir: 1 } : S.sort.dir === 1 ? { key, dir: -1 } : null;
    $('rows').innerHTML = render.rows(sortRows(S.rows, S.sort));
    updateSortHeaders();
    renderCount();
  }

  // Só conta contato válido: ignora telefone de zeros e e-mail malformado.
  const hasEmail = r => !!F.validEmail(r.contact?.email);
  const hasPhone = r => F.validPhones(r.contact?.phones).length > 0;
  const CONTACT = {
    any:   { label: 'com algum contato', test: r => hasEmail(r) || hasPhone(r) },   // e-mail ou telefone
    email: { label: 'com e-mail', test: hasEmail },
    phone: { label: 'com telefone', test: hasPhone },
  };
  const makeKeep = (sizes, contact) => r =>
    (sizes === null || sizes.includes(sizeOf(r))) && (contact === '' || CONTACT[contact].test(r));
  const clientMode = () => S.sizes !== null || S.contact !== '';
  const clientParts = () => [S.sizes !== null && 'porte', S.contact !== '' && 'contato'].filter(Boolean).join(' e ');
  // Chips da pesquisa + chip do filtro de contato (aparece nos filtros aplicados, indicadores e CSV).
  const syncChips = () => { S.chips = [...S.baseChips, ...(S.contact ? [['Contato', CONTACT[S.contact].label]] : [])]; };

  // ---------- Mensagens e estados visuais ----------
  function showStateBox(html, kind = '') {
    $('stateBox').className = 'statebox ' + kind;
    $('stateBox').innerHTML = html;
    $('stateBox').hidden = false;
  }
  const hideStateBox = () => { $('stateBox').hidden = true; };

  function setFormError(message, field) {
    const el = $('formError');
    el.textContent = message || '';
    el.hidden = !message;
    ['q', 'region', 'uf', 'city', 'status', 'size', 'nature', 'cnae'].forEach(id => $(id).removeAttribute('aria-invalid'));
    if (field && message) { $(field).setAttribute('aria-invalid', 'true'); $(field).focus(); }
  }

  function setLoading(on) {
    S.loading = on;
    $('submit').disabled = on;
    $('submit').textContent = on ? 'Pesquisando…' : 'Pesquisar';
    $('refresh').disabled = on;
    $('contactSel').disabled = on;
    if (on) $('countBtn').disabled = true; else $('countBtn').disabled = S.counting;
    $('prev').disabled = on || S.page === 0;
    $('next').disabled = on || !S.hasNext;
    $('tableWrap').setAttribute('aria-busy', String(on));
    if (on) {
      hideStateBox();
      $('notice').hidden = true;
      $('tableWrap').hidden = false;
      $('rows').innerHTML = render.skeletonRows();
    }
  }

  // ---------- Pesquisa ----------
  async function loadPage(page, signal, force) {
    const sizeMode = clientMode();            // porte e/ou contato: varre lotes maiores e filtra no navegador
    const keep = makeKeep(S.sizes, S.contact);
    let pos = S.positions[page];
    const out = [];
    let scanned = 0, scannedRows = 0;
    // Preenche a página percorrendo as UFs em sequência quando há mais de uma.
    const maxSteps = sizeMode ? config.SIZE_SCAN_PAGES : S.filters.length + 1;
    do {
      if (sizeMode) $('count').textContent = `Varrendo resultados para filtrar por ${clientParts()}… (lote ${scanned + 1} de até ${config.SIZE_SCAN_PAGES})`;
      const r = await api.searchEstablishments(S.filters[pos.i], {
        cursor: pos.cursor, first: sizeMode ? config.API_MAX_PAGE : config.PAGE_SIZE - out.length, signal, force,
      });
      scanned++;
      scannedRows += r.rows.length;
      out.push(...(sizeMode ? r.rows.filter(keep) : r.rows));
      pos = api.nextPos(S.filters, pos, r);
    } while (pos && out.length < config.PAGE_SIZE && scanned < maxSteps);
    return { rows: out, hasNext: pos !== null, nextPos: pos, scannedRows };
  }

  async function runSearch({ page = 0, force = false } = {}) {
    if (S.loading) return;
    const seq = ++S.seq;
    S.ctl = new AbortController();
    const { signal } = S.ctl;
    const prevPage = S.page;
    S.page = page;
    setLoading(true);
    $('count').textContent = 'Consultando a API…';
    try {
      const res = await loadPage(page, signal, force);
      await api.resolveCityNames(res.rows.map(r => r.city?.id), { signal });
      if (seq !== S.seq) return;
      S.rows = res.rows;
      S.hasNext = res.hasNext;
      if (res.hasNext) S.positions[page + 1] = res.nextPos;
      showResults(res);
    } catch (e) {
      if (e.kind === 'aborted' || seq !== S.seq) return;
      S.page = prevPage;
      showSearchError(e, page);
    } finally {
      if (seq === S.seq) setLoading(false);
    }
  }

  function showResults(res) {
    const sizeMode = clientMode();
    const n = S.rows.length;
    $('scope').innerHTML = render.scope(S.chips);
    $('scope').hidden = !S.chips.length;
    $('refresh').hidden = false;
    $('contactFilter').hidden = false;
    $('exportBtn').hidden = n === 0;
    $('rows').innerHTML = render.rows(sortRows(S.rows, S.sort));
    updateSortHeaders();
    $('tableWrap').hidden = n === 0;

    renderCount();

    // Só avisa quando a varredura parou antes de completar a página; do contrário os chips já mostram o filtro.
    if (sizeMode && res.hasNext && n < config.PAGE_SIZE) {
      $('notice').textContent = `Filtro de ${clientParts()}: foram varridos ${res.scannedRows} estabelecimentos e a busca parou por segurança antes de completar a página. Use "Próxima" para continuar buscando.`;
      $('notice').hidden = false;
    }

    if (!n) {
      showStateBox(res.hasNext
        ? `<h3>Nenhum resultado neste lote</h3><p>Nenhum estabelecimento com o filtro de ${clientParts()} escolhido entre os varridos. Use <strong>Próxima</strong> para continuar a busca.</p>`
        : sizeMode
          ? `<h3>Nenhuma empresa atende ao filtro de ${clientParts()}</h3><p>Entre os resultados desta pesquisa, nenhum atende a esse filtro. Escolha "Todos" no filtro de contato (ou ajuste o porte) para ver todas as empresas.</p>`
          : `<h3>Nenhuma empresa encontrada</h3><p>Revise os filtros: remova algum critério, confira a grafia do nome ou amplie o estado/município.</p>`, 'empty');
    }

    $('pager').hidden = !(S.page > 0 || S.hasNext);
    $('pageInfo').textContent = `Página ${S.page + 1}`;
    $('prev').disabled = S.page === 0;
    $('next').disabled = !S.hasNext;
    $('stats').innerHTML = render.stats(S.rows, { chips: S.chips, page: S.page + 1 });
  }

  function renderCount() {
    const n = S.rows.length;
    let html = `${n} estabelecimento${n === 1 ? '' : 's'} nesta página`;
    if (S.total) {
      const t = S.total;
      html += t.exact
        ? ` · <strong>Total: ${nf(t.n)}</strong>`
        : ` · <strong>Total: mais de ${nf(t.n)}</strong> (contagem limitada a ${nf(t.n)} por segurança)`;
    } else {
      html += ' · total não informado pela API';
    }
    if (S.sort) html += ` · ordenado de ${S.sort.dir === 1 ? 'A a Z' : 'Z a A'} por ${SORT_LABELS[S.sort.key]} (só nesta página)`;
    $('count').innerHTML = html;
    $('countBtn').hidden = !S.filters || !!S.total;
    $('countBtn').disabled = S.counting;
  }

  // A API não fornece totais: conta percorrendo as páginas (limitado por COUNT_MAX_PAGES).
  // Com várias UFs, percorre uma após a outra e soma.
  async function countResults() {
    if (S.counting || !S.filters || S.total) return;
    const filterRef = S.filters;
    const same = () => S.filters === filterRef;    // a contagem sobrevive à troca de página, não a uma nova pesquisa
    S.counting = true;
    S.countCtl = new AbortController();
    const { signal } = S.countCtl;
    const withSize = S.sizes !== null, withContact = S.contact !== '';
    const keep = makeKeep(S.sizes, S.contact);
    const btn = $('countBtn');
    let n = 0, pos = { i: 0, cursor: null }, pages = 0;
    btn.disabled = true;
    try {
      while (pos && pages < config.COUNT_MAX_PAGES) {
        const r = await api.scanPage(filterRef[pos.i], { cursor: pos.cursor, withSize, withContact, signal });
        pages++;
        n += (withSize || withContact) ? r.rows.filter(keep).length : r.rows.length;
        pos = api.nextPos(filterRef, pos, r);
        btn.textContent = `Contando… ${nf(n)}`;
      }
      if (!same()) return;
      S.total = { n, exact: pos === null };
    } catch (e) {
      if (e.kind === 'aborted' || !same()) return;
      $('notice').textContent = 'Não foi possível contar o total: ' + api.friendly(e, { hasText: !!filterRef[0]?.query });
      $('notice').hidden = false;
    } finally {
      S.counting = false;
      btn.textContent = 'Contar total';
      if (same()) renderCount();
    }
  }

  // Baixa os resultados da pesquisa corrente em CSV, até EXPORT_MAX_PAGES páginas de 100.
  async function exportCsv() {
    if (S.exporting || !S.filters) return;
    const filterRef = S.filters, chips = S.chips, filtered = clientMode(), keep = makeKeep(S.sizes, S.contact), sort = S.sort;
    const same = () => S.filters === filterRef;
    const btn = $('exportBtn');
    S.exporting = true;
    S.exportCtl = new AbortController();
    const { signal } = S.exportCtl;
    btn.disabled = true;
    const rows = [];
    let pos = { i: 0, cursor: null }, pages = 0;
    try {
      while (pos && pages < config.EXPORT_MAX_PAGES) {
        const r = await api.searchEstablishments(filterRef[pos.i], { cursor: pos.cursor, first: config.API_MAX_PAGE, signal });
        pages++;
        rows.push(...(filtered ? r.rows.filter(keep) : r.rows));
        pos = api.nextPos(filterRef, pos, r);
        btn.textContent = `Exportando… ${nf(rows.length)}`;
      }
      const hasNext = pos !== null;
      if (!same()) return;
      if (!rows.length) {
        $('notice').textContent = 'Não há resultados para exportar nesta pesquisa.';
        $('notice').hidden = false;
        return;
      }
      btn.textContent = 'Preparando arquivo…';
      const ids = [...new Set(rows.map(r => r.city?.id).filter(Boolean))];
      for (let i = 0; i < ids.length; i += 80) await api.resolveCityNames(ids.slice(i, i + 80), { signal });
      if (!same()) return;
      const date = new Date();
      // Se há ordenação ativa, o arquivo inteiro sai ordenado (todas as linhas exportadas, não só uma página).
      const name = DB.exporter.download(
        DB.exporter.toCsv(sortRows(rows, sort), { collectedAt: date, filters: chips.map(([k, v]) => `${k}: ${v}`).join('; ') }), date);
      $('notice').textContent = `${nf(rows.length)} linhas exportadas em ${name}` +
        (hasNext ? `. A pesquisa tem mais resultados: o limite é ${nf(config.EXPORT_MAX_PAGES * config.API_MAX_PAGE)} por arquivo; refine os filtros para exportar o restante.` : '.') +
        ' O arquivo contém telefones e e-mails: use-os conforme a LGPD e as regras do seu comitê de ética.';
      $('notice').hidden = false;
    } catch (e) {
      if (e.kind === 'aborted' || !same()) return;
      $('notice').textContent = 'Não foi possível exportar: ' + api.friendly(e, { hasText: !!filterRef[0]?.query });
      $('notice').hidden = false;
    } finally {
      S.exporting = false;
      btn.disabled = false;
      btn.textContent = '⬇ Exportar CSV';
    }
  }

  const resetExport = () => { S.exportCtl?.abort(); S.exporting = false; $('exportBtn').disabled = false; $('exportBtn').textContent = '⬇ Exportar CSV'; };

  const resetCount = () => { S.countCtl?.abort(); S.counting = false; S.total = null; $('countBtn').textContent = 'Contar total'; };

  function showSearchError(e, page) {
    $('tableWrap').hidden = true;
    $('refresh').hidden = false;
    $('count').textContent = 'Não foi possível concluir a consulta.';
    showStateBox(`<h3>Erro na consulta</h3><p>${F.esc(api.friendly(e, { hasText: !!S.filters?.[0]?.query }))}</p>
      <button type="button" class="btn primary" id="retry" data-page="${page}">Tentar novamente</button>`, 'error');
    $('pager').hidden = !(S.page > 0);
    $('stats').innerHTML = render.stats([], { chips: S.chips, page: 1 });
  }

  function newSearch() {
    const c = filters.collect();
    if (!c.ok) { setFormError(c.message, c.field); return; }
    setFormError('');
    S.filters = c.filters; S.sizes = c.sizes; S.baseChips = c.chips; S.contact = $('contactSel').value;
    syncChips();
    S.positions = [{ i: 0, cursor: null }]; S.hasNext = false;
    resetCount(); resetExport();
    runSearch({ page: 0 });
  }

  function resetAll() {
    S.seq++; S.ctl?.abort(); resetCount(); resetExport();
    S.filters = null; S.sizes = null; S.chips = []; S.baseChips = []; S.contact = ''; S.positions = [{ i: 0, cursor: null }];
    $('contactSel').value = ''; $('contactFilter').hidden = true;
    S.sort = null; updateSortHeaders();
    S.page = 0; S.rows = []; S.hasNext = false;
    setLoading(false);
    filters.clear();
    setFormError('');
    $('rows').innerHTML = '';
    $('tableWrap').hidden = true; $('pager').hidden = true; $('scope').hidden = true;
    $('notice').hidden = true; $('refresh').hidden = true; $('exportBtn').hidden = true;
    $('count').textContent = 'Defina os filtros e clique em Pesquisar.';
    showWelcome();
    $('stats').innerHTML = render.stats([], { chips: [], page: 1 });
  }

  function showWelcome() {
    showStateBox(`<h3>Comece sua consulta</h3>
      <p>O nome é opcional: você pode pesquisar apenas com os filtros (estado, município, situação, atividade…) ou combiná-los com um nome ou CNPJ. Filtros estruturados costumam responder mais rápido que a busca por nome.</p>`, 'empty');
  }

  // ---------- Abas (acessíveis por teclado) ----------
  function wireTabs(tabs, onSelect) {
    const select = tab => {
      tabs.forEach(t => { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
      onSelect(tab);
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', ev => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
        if (ev.key === 'Home' || ev.key === 'End' || d) {
          ev.preventDefault();
          const next = ev.key === 'Home' ? tabs[0] : ev.key === 'End' ? tabs[tabs.length - 1] : tabs[(i + d + tabs.length) % tabs.length];
          select(next); next.focus();
        }
      });
    });
    return select;
  }

  function showView(name) {
    $('panelResults').hidden = name !== 'results';
    $('panelStats').hidden = name !== 'stats';
  }

  // ---------- Detalhe ----------
  async function openDetail(cnpj, trigger) {
    D.trigger = trigger; D.lastCnpj = cnpj;
    const seq = ++D.seq;
    D.ctl?.abort(); D.ctl = new AbortController();
    const { signal } = D.ctl;
    $('detailHead').innerHTML = `<h2 id="detailTitle">Carregando…</h2>`;
    $('detailTabs').innerHTML = '';
    $('detailBody').innerHTML = '<p class="mute">Buscando detalhes na API…</p>';
    if (!$('detail').open) $('detail').showModal();
    try {
      const e = await api.getEstablishment(cnpj, { signal });
      if (!e) throw new api.ApiError('invalid', 'estabelecimento não encontrado');
      await api.resolveCityNames([e.city?.id, ...e.company.establishments.edges.map(x => x.node.city?.id)], { signal });
      if (seq !== D.seq) return;
      $('detailHead').innerHTML = render.detailHead(e);
      const tabs = render.detailTabs(e);
      $('detailTabs').innerHTML = tabs.map((t, i) =>
        `<button type="button" role="tab" class="tab" id="dt-${t.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" aria-controls="detailBody">${F.esc(t.label)}</button>`).join('');
      const els = [...$('detailTabs').querySelectorAll('[role=tab]')];
      const select = wireTabs(els, el => {
        const t = tabs[els.indexOf(el)];
        $('detailBody').setAttribute('role', 'tabpanel');
        $('detailBody').setAttribute('aria-labelledby', el.id);
        $('detailBody').innerHTML = t.html;
      });
      select(els[0]);
    } catch (err) {
      if (err.kind === 'aborted' || seq !== D.seq) return;
      $('detailHead').innerHTML = `<h2 id="detailTitle">Detalhes indisponíveis</h2>`;
      $('detailBody').innerHTML = `<div class="statebox error"><p>${F.esc(api.friendly(err))}</p>
        <button type="button" class="btn primary" id="detailRetry">Tentar novamente</button></div>`;
    }
  }

  async function moreEstablishments(btn) {
    btn.disabled = true;
    try {
      const r = await api.getCompanyEstablishments(btn.dataset.root, btn.dataset.cursor, { signal: D.ctl?.signal });
      await api.resolveCityNames(r.rows.map(x => x.city?.id));
      $('estabList').insertAdjacentHTML('beforeend', r.rows.map(x => render.estabItem(x)).join(''));
      btn.dataset.cursor = r.endCursor || '';
      btn.hidden = !r.hasNext;
    } catch (err) {
      if (err.kind !== 'aborted') btn.insertAdjacentHTML('afterend', `<p class="form-error" role="alert">${F.esc(api.friendly(err))}</p>`);
    } finally { btn.disabled = false; }
  }

  // ---------- Eventos ----------
  function bindEvents() {
    $('filters').addEventListener('submit', e => { e.preventDefault(); newSearch(); });
    $('clear').addEventListener('click', resetAll);
    $('refresh').addEventListener('click', () => { resetCount(); runSearch({ page: S.page, force: true }); });
    $('countBtn').addEventListener('click', countResults);
    // Filtro de contato após a busca: refaz a listagem desde a página 1 com os mesmos filtros da pesquisa.
    $('contactSel').addEventListener('change', () => {
      if (!S.filters || S.loading) return;
      S.contact = $('contactSel').value;
      syncChips();
      resetCount(); resetExport();
      S.positions = [{ i: 0, cursor: null }]; S.hasNext = false;
      runSearch({ page: 0 });
    });
    $('exportBtn').addEventListener('click', exportCsv);
    $('tableWrap').querySelector('thead').addEventListener('click', ev => {
      const btn = ev.target.closest('.th-sort');
      if (btn && S.rows.length) toggleSort(btn.dataset.sort);
    });
    const goto = page => { runSearch({ page }); $('scope').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    $('prev').addEventListener('click', () => goto(S.page - 1));
    $('next').addEventListener('click', () => goto(S.page + 1));
    $('filters').addEventListener('input', () => { if (!$('formError').hidden) setFormError(''); });

    $('panelResults').addEventListener('click', e => {
      if (e.target.closest('#retry')) { runSearch({ page: +e.target.closest('#retry').dataset.page, force: true }); return; }
      const btn = e.target.closest('[data-detail]');
      const tr = e.target.closest('tbody tr[data-cnpj]');
      if (btn) openDetail(btn.dataset.detail, btn);
      else if (tr) openDetail(tr.dataset.cnpj, tr);
    });

    $('detail').addEventListener('click', e => {
      if (e.target === $('detail')) $('detail').close();
      else if (e.target.closest('#estabMore')) moreEstablishments(e.target.closest('#estabMore'));
      else if (e.target.closest('#detailRetry')) openDetail(D.lastCnpj, D.trigger);
    });
    $('closeDetail').addEventListener('click', () => $('detail').close());
    $('detail').addEventListener('close', () => { D.seq++; D.ctl?.abort(); D.trigger?.focus?.(); });

    wireTabs([$('tabResults'), $('tabStats')], t => showView(t.id === 'tabStats' ? 'stats' : 'results'));
  }

  // ---------- Inicialização ----------
  async function boot() {
    try {
      filters.init(await api.loadReferences());
      showWelcome();
    } catch (e) {
      showStateBox(`<h3>Não foi possível carregar as listas de apoio</h3><p>${F.esc(api.friendly(e))}</p>
        <button type="button" class="btn primary" id="bootRetry">Tentar novamente</button>`, 'error');
      $('bootRetry').addEventListener('click', boot);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    $('stats').innerHTML = render.stats([], { chips: [], page: 1 });
    boot();
  });
})();
