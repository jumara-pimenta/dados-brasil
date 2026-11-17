/* Orquestração: estado da pesquisa, paginação por cursor, detalhe e abas. */
(function () {
  'use strict';
  const { config, format: F, api, filters, render } = DB;
  const $ = id => document.getElementById(id);

  // Estado da pesquisa corrente (os filtros ficam congelados entre as páginas).
  const S = {
    filter: null, size: null, chips: [],
    cursors: [null],           // cursors[n] = cursor que abre a página n
    page: 0, rows: [], hasNext: false,
    loading: false, seq: 0, ctl: null,
    total: null,               // { n, exact } após "Contar total"
    counting: false, countCtl: null,
    exporting: false, exportCtl: null,
  };
  const nf = n => n.toLocaleString('pt-BR');
  const D = { seq: 0, ctl: null, trigger: null, lastCnpj: null };

  const sizeOf = r => (r.company?.size?.code == null ? 0 : +r.company.size.code);

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
    ['q', 'uf', 'city', 'nature', 'cnae'].forEach(id => $(id).removeAttribute('aria-invalid'));
    if (field && message) { $(field).setAttribute('aria-invalid', 'true'); $(field).focus(); }
  }

  function setLoading(on) {
    S.loading = on;
    $('submit').disabled = on;
    $('submit').textContent = on ? 'Pesquisando…' : 'Pesquisar';
    $('refresh').disabled = on;
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
    const sizeMode = S.size !== null;
    let cursor = S.cursors[page];
    const out = [];
    let hasNext = false, scanned = 0, scannedRows = 0;
    do {
      if (sizeMode) $('count').textContent = `Varrendo resultados para filtrar por porte… (lote ${scanned + 1} de até ${config.SIZE_SCAN_PAGES})`;
      const r = await api.searchEstablishments(S.filter, {
        cursor, first: sizeMode ? config.API_MAX_PAGE : config.PAGE_SIZE, signal, force,
      });
      scanned++;
      scannedRows += r.rows.length;
      out.push(...(sizeMode ? r.rows.filter(x => sizeOf(x) === +S.size) : r.rows));
      cursor = r.endCursor;
      hasNext = r.hasNext;
    } while (sizeMode && hasNext && out.length < config.PAGE_SIZE && scanned < config.SIZE_SCAN_PAGES);
    return { rows: out, hasNext, nextCursor: cursor, scannedRows };
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
      if (res.hasNext) S.cursors[page + 1] = res.nextCursor;
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
    const sizeMode = S.size !== null;
    const n = S.rows.length;
    $('scope').innerHTML = render.scope(S.chips);
    $('scope').hidden = !S.chips.length;
    $('refresh').hidden = false;
    $('exportBtn').hidden = n === 0;
    $('rows').innerHTML = render.rows(S.rows);
    $('tableWrap').hidden = n === 0;

    renderCount();

    if (sizeMode) {
      $('notice').textContent = `Porte filtrado no navegador: ${res.scannedRows} estabelecimentos varridos nesta página` +
        (res.hasNext && n < config.PAGE_SIZE ? '. A varredura foi interrompida por segurança; use "Próxima" para continuar buscando.' : '.');
      $('notice').hidden = false;
    }

    if (!n) {
      showStateBox(res.hasNext
        ? `<h3>Nenhum resultado neste lote</h3><p>Nenhum estabelecimento com o porte escolhido entre os varridos. Use <strong>Próxima</strong> para continuar a busca.</p>`
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
    $('count').innerHTML = html;
    $('countBtn').hidden = !S.filter || !!S.total;
    $('countBtn').disabled = S.counting;
  }

  // A API não fornece totais: conta percorrendo as páginas (limitado por COUNT_MAX_PAGES).
  async function countResults() {
    if (S.counting || !S.filter || S.total) return;
    const same = () => S.filter === filterRef;     // a contagem sobrevive à troca de página, não a uma nova pesquisa
    const filterRef = S.filter;
    S.counting = true;
    S.countCtl = new AbortController();
    const { signal } = S.countCtl;
    const withSize = S.size !== null;
    const btn = $('countBtn');
    let n = 0, cursor = null, hasNext = true, pages = 0;
    btn.disabled = true;
    try {
      while (hasNext && pages < config.COUNT_MAX_PAGES) {
        const r = await api.scanPage(S.filter, { cursor, withSize, signal });
        pages++;
        n += withSize ? r.rows.filter(x => sizeOf(x) === +S.size).length : r.rows.length;
        cursor = r.endCursor;
        hasNext = r.hasNext;
        btn.textContent = `Contando… ${nf(n)}`;
      }
      if (!same()) return;
      S.total = { n, exact: !hasNext };
    } catch (e) {
      if (e.kind === 'aborted' || !same()) return;
      $('notice').textContent = 'Não foi possível contar o total: ' + api.friendly(e, { hasText: !!S.filter?.query });
      $('notice').hidden = false;
    } finally {
      S.counting = false;
      btn.textContent = 'Contar total';
      if (same()) renderCount();
    }
  }

  // Baixa os resultados da pesquisa corrente em CSV, até EXPORT_MAX_PAGES páginas de 100.
  async function exportCsv() {
    if (S.exporting || !S.filter) return;
    const filterRef = S.filter, size = S.size, chips = S.chips;
    const same = () => S.filter === filterRef;
    const btn = $('exportBtn');
    S.exporting = true;
    S.exportCtl = new AbortController();
    const { signal } = S.exportCtl;
    btn.disabled = true;
    const rows = [];
    let cursor = null, hasNext = true, pages = 0;
    try {
      while (hasNext && pages < config.EXPORT_MAX_PAGES) {
        const r = await api.searchEstablishments(filterRef, { cursor, first: config.API_MAX_PAGE, signal });
        pages++;
        rows.push(...(size !== null ? r.rows.filter(x => sizeOf(x) === +size) : r.rows));
        cursor = r.endCursor;
        hasNext = r.hasNext;
        btn.textContent = `Exportando… ${nf(rows.length)}`;
      }
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
      const name = DB.exporter.download(
        DB.exporter.toCsv(rows, { collectedAt: date, filters: chips.map(([k, v]) => `${k}: ${v}`).join('; ') }), date);
      $('notice').textContent = `${nf(rows.length)} linhas exportadas em ${name}` +
        (hasNext ? `. A pesquisa tem mais resultados: o limite é ${nf(config.EXPORT_MAX_PAGES * config.API_MAX_PAGE)} por arquivo; refine os filtros para exportar o restante.` : '.') +
        ' O arquivo contém telefones e e-mails: use-os conforme a LGPD e as regras do seu comitê de ética.';
      $('notice').hidden = false;
    } catch (e) {
      if (e.kind === 'aborted' || !same()) return;
      $('notice').textContent = 'Não foi possível exportar: ' + api.friendly(e, { hasText: !!filterRef.query });
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
    showStateBox(`<h3>Erro na consulta</h3><p>${F.esc(api.friendly(e, { hasText: !!S.filter?.query }))}</p>
      <button type="button" class="btn primary" id="retry" data-page="${page}">Tentar novamente</button>`, 'error');
    $('pager').hidden = !(S.page > 0);
    $('stats').innerHTML = render.stats([], { chips: S.chips, page: 1 });
  }

  function newSearch() {
    const c = filters.collect();
    if (!c.ok) { setFormError(c.message, c.field); return; }
    setFormError('');
    S.filter = c.filter; S.size = c.size; S.chips = c.chips;
    S.cursors = [null]; S.hasNext = false;
    resetCount(); resetExport();
    runSearch({ page: 0 });
  }

  function resetAll() {
    S.seq++; S.ctl?.abort(); resetCount(); resetExport();
    S.filter = null; S.size = null; S.chips = []; S.cursors = [null];
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
      <p>Pesquise por nome ou CNPJ e combine filtros de localização e características da empresa. Filtros por estado, município, situação, CNAE e natureza jurídica têm resposta mais rápida.</p>`, 'empty');
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
    $('exportBtn').addEventListener('click', exportCsv);
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
