/* Formulário de filtros: listas dependentes, comboboxes com sugestões, validação e
   conversão para o EstablishmentFilter aceito pela API. */
(function () {
  'use strict';
  const { format: F, api, config } = DB;
  const $ = id => document.getElementById(id);

  let states = [];
  const combos = {};   // city, nature, cnae

  const fail = (field, message) => ({ ok: false, field, message });

  // ---------- Regiões e estados (checkboxes) ----------
  // A API aceita uma UF por consulta; o app consulta cada UF marcada em sequência (ver app.js).
  // Regiões e estados compartilham a mesma seleção: marcar uma região marca todos os seus estados,
  // e uma região aparece marcada quando todos os seus estados estão marcados.
  let selectedUfs = new Set();
  const ufList = () => states.map(s => s.uf).filter(uf => selectedUfs.has(uf));   // ordem alfabética por nome
  const regionNames = () => Object.keys(DB.REGIONS);
  const regionCount = r => DB.REGIONS[r].filter(u => selectedUfs.has(u)).length;
  const fullRegions = () => regionNames().filter(r => regionCount(r) === DB.REGIONS[r].length);

  // Abre/fecha um painel de checkboxes: clique fora, Esc e saída do foco fecham.
  function dropdown(btnId, panelId, boxId) {
    const btn = $(btnId), panel = $(panelId), box = $(boxId);
    const set = open => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', () => set(panel.hidden));
    document.addEventListener('click', ev => { if (!box.contains(ev.target)) set(false); });
    document.addEventListener('focusin', ev => { if (!box.contains(ev.target)) set(false); });
    box.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && !panel.hidden) { ev.preventDefault(); set(false); btn.focus(); }
    });
    return { set };
  }
  const drops = {};   // region, uf
  const multis = {};  // status, size

  // Lista de checkboxes em dropdown (situação cadastral, porte). Marcar todas equivale a não filtrar.
  function createMultiCheck(cfg) {
    const btn = $(cfg.id), list = $(cfg.id + 'List');
    let selected = new Set();
    const drop = dropdown(cfg.id, cfg.id + 'Panel', cfg.id + 'Multi');
    list.innerHTML = cfg.options.map(o =>
      `<label class="chk"><input type="checkbox" value="${F.esc(o.value)}"> ${F.esc(o.label)}</label>`).join('');
    const values = () => cfg.options.map(o => o.value).filter(v => selected.has(v));
    function sync() {
      list.querySelectorAll('input').forEach(cb => { cb.checked = selected.has(cb.value); });
      const labels = cfg.options.filter(o => selected.has(o.value)).map(o => o.label);
      btn.textContent = !labels.length ? cfg.emptyLabel
        : labels.length === cfg.options.length ? cfg.allLabel
        : labels.length <= cfg.maxNames ? labels.join(', ') : `${labels.length} ${cfg.plural}`;
      btn.title = labels.join(', ');
      btn.classList.toggle('has', labels.length > 0);
      cfg.onChange?.();
    }
    list.addEventListener('change', ev => {
      const cb = ev.target;
      if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
      sync();
    });
    $(cfg.id + 'All').addEventListener('click', () => { selected = new Set(cfg.options.map(o => o.value)); sync(); });
    $(cfg.id + 'None').addEventListener('click', () => { selected.clear(); sync(); });
    sync();
    return {
      values,
      // todas marcadas = sem filtro (evita consultas desnecessárias)
      effective: () => (values().length === cfg.options.length ? [] : values()),
      clear() { selected.clear(); sync(); drop.set(false); },
    };
  }

  function buildPanels() {
    $('regionList').innerHTML = regionNames().map(r =>
      `<label class="chk"><input type="checkbox" data-region="${F.esc(r)}"> <strong>${F.esc(r)}</strong> <span class="mute">(${DB.REGIONS[r].length} estados)</span></label>`).join('');
    $('ufGroups').innerHTML = Object.entries(DB.REGIONS).map(([region, ufs]) => {
      const list = ufs.map(uf => states.find(s => s.uf === uf)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
      return `<fieldset class="multi-region"><legend><label class="chk"><input type="checkbox" data-region="${F.esc(region)}"> <strong>${F.esc(region)}</strong></label></legend>
        <div class="multi-states">${list.map(s =>
          `<label class="chk"><input type="checkbox" value="${s.uf}"> ${F.esc(s.name)} <span class="mute">(${s.uf})</span></label>`).join('')}</div></fieldset>`;
    }).join('');
  }

  function syncUfs() {
    const list = ufList();
    document.querySelectorAll('#ufGroups input[value]').forEach(cb => { cb.checked = selectedUfs.has(cb.value); });
    // caixas das regiões (nos dois painéis): marcada, parcial (indeterminada) ou vazia
    document.querySelectorAll('input[data-region]').forEach(cb => {
      const n = regionCount(cb.dataset.region), total = DB.REGIONS[cb.dataset.region].length;
      cb.checked = n === total;
      cb.indeterminate = n > 0 && n < total;
    });
    $('uf').textContent = !list.length ? 'Todos'
      : list.length === states.length ? `Todos os ${states.length} estados`
      : list.length <= 2 ? list.map(uf => states.find(s => s.uf === uf).name).join(', ')
      : `${list.length} estados`;
    $('uf').classList.toggle('has', list.length > 0);

    const full = fullRegions();
    const extra = list.length - full.reduce((n, r) => n + DB.REGIONS[r].length, 0);   // estados fora de regiões completas
    $('region').textContent = !list.length ? 'Todas'
      : !full.length ? 'Seleção por estados'
      : (full.length <= 2 ? full.join(', ') : `${full.length} regiões`) + (extra ? ` + ${extra} estado${extra > 1 ? 's' : ''}` : '');
    $('region').classList.toggle('has', list.length > 0);
  }

  // O município escolhido só vale se for do único estado selecionado.
  function onUfChange() {
    const pk = combos.city.pick, l = ufList();
    if (pk && !(l.length === 1 && l[0] === pk.state?.uf)) combos.city.clear();
    else if (!pk) combos.city.reset();
  }

  function setUfs(list, { silent = false } = {}) {
    selectedUfs = new Set(list);
    syncUfs();
    if (!silent) onUfChange();
  }

  // Caixa de região marcada/desmarcada: aplica a todos os estados dela.
  function applyRegionToggle(cb) {
    DB.REGIONS[cb.dataset.region].forEach(uf => (cb.checked ? selectedUfs.add(uf) : selectedUfs.delete(uf)));
    syncUfs();
    onUfChange();
  }

  function bindPickers() {
    buildPanels();
    syncUfs();
    drops.region = dropdown('region', 'regionPanel', 'regionMulti');
    drops.uf = dropdown('uf', 'ufPanel', 'ufMulti');

    $('regionPanel').addEventListener('change', ev => { if (ev.target.dataset.region) applyRegionToggle(ev.target); });
    $('ufPanel').addEventListener('change', ev => {
      const cb = ev.target;
      if (cb.dataset.region) return applyRegionToggle(cb);
      if (cb.value) (cb.checked ? selectedUfs.add(cb.value) : selectedUfs.delete(cb.value));
      syncUfs();
      onUfChange();
    });
    $('ufAll').addEventListener('click', () => setUfs(states.map(s => s.uf)));
    $('ufNone').addEventListener('click', () => setUfs([]));
    $('regionAll').addEventListener('click', () => setUfs(states.map(s => s.uf)));
    $('regionNone').addEventListener('click', () => setUfs([]));
  }

  // ---------- Combobox genérico (acessível, com teclado) ----------
  // cfg: id, minChars, maxShown, async, search(raw,{signal}) -> {items, more, q},
  //      label(item), optionHtml(item,q), onPick(item), byText(text,items) -> item|null
  function createCombo(cfg) {
    const input = $(cfg.id), box = $(cfg.id + 'Listbox'), clearBtn = $(cfg.id + 'Clear');
    let pick = null, items = [], active = -1, seq = 0, ctl = null, lastQ = '';
    const optId = i => `${cfg.id}Opt${i}`;
    const len = () => F.norm(input.value).trim().length;

    function openList(html) {
      box.innerHTML = html;
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
    function closeList() {
      box.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }
    const note = text => openList(`<li class="lb-note" role="presentation">${F.esc(text)}</li>`);

    function render(more) {
      if (!items.length) return note(cfg.emptyText ? cfg.emptyText() : 'Nenhum resultado encontrado.');
      openList(items.map((it, i) =>
        `<li role="option" id="${optId(i)}" data-i="${i}" aria-selected="${i === active}">${cfg.optionHtml(it, lastQ)}</li>`).join('') +
        (more ? '<li class="lb-note" role="presentation">Há mais resultados: digite mais para refinar a busca.</li>' : ''));
      if (active >= 0) input.setAttribute('aria-activedescendant', optId(active));
    }

    function setActive(i) {
      active = i;
      [...box.querySelectorAll('[role=option]')].forEach((el, k) => el.setAttribute('aria-selected', String(k === i)));
      if (i >= 0) {
        input.setAttribute('aria-activedescendant', optId(i));
        $(optId(i))?.scrollIntoView({ block: 'nearest' });
      }
    }

    function choose(item) {
      pick = item;
      input.value = cfg.label(item);
      clearBtn.hidden = false;
      closeList();
      cfg.onPick?.(item);
    }

    function reset() { items = []; seq++; ctl?.abort(); closeList(); }

    function clear(focus) {
      pick = null;
      reset();
      input.value = '';
      clearBtn.hidden = true;
      if (focus) input.focus();
    }

    async function run(raw) {
      const s = ++seq;
      ctl?.abort();
      ctl = new AbortController();
      try {
        const r = await cfg.search(raw, { signal: ctl.signal });
        if (s !== seq) return;
        lastQ = r.q;
        items = r.items.slice(0, cfg.maxShown);
        active = items.length ? 0 : -1;
        render(!!r.more || r.items.length > cfg.maxShown);
      } catch (e) {
        if (s !== seq || e.kind === 'aborted') return;
        note('Não foi possível buscar agora. Tente novamente.');
      }
    }

    const debounced = F.debounce(run, config.DEBOUNCE_MS);

    input.addEventListener('input', () => {
      pick = null;                              // editar o texto invalida a escolha anterior
      clearBtn.hidden = !input.value;
      if (len() < cfg.minChars) {
        reset();
        if (cfg.minChars === 0) run(input.value);
        return;
      }
      if (cfg.async) { note('Buscando…'); debounced(input.value); } else run(input.value);
    });

    input.addEventListener('keydown', ev => {
      const open = !box.hidden && items.length > 0;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!open) {
          // Seta para baixo reabre a lista (por exemplo, depois de Esc).
          if (ev.key === 'ArrowDown' && !pick && (cfg.minChars === 0 || (items.length && len() >= cfg.minChars))) {
            ev.preventDefault();
            openIfUseful();
          }
          return;
        }
        ev.preventDefault();
        const n = items.length;
        setActive(ev.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n);
      } else if (ev.key === 'Enter' && open && active >= 0) {
        ev.preventDefault();                    // escolhe a sugestão em vez de enviar o formulário
        choose(items[active]);
      } else if (ev.key === 'Escape' && !box.hidden) {
        ev.preventDefault();
        closeList();
      }
    });

    // mousedown (e não click) evita que o input perca o foco antes da escolha
    box.addEventListener('mousedown', ev => {
      const li = ev.target.closest('[role=option]');
      if (li) { ev.preventDefault(); choose(items[+li.dataset.i]); }
    });

    input.addEventListener('blur', () => {
      // Texto que corresponde a uma única sugestão é aceito automaticamente.
      if (!pick && items.length === 1 && !box.hidden && len() >= Math.max(cfg.minChars, 1)) choose(items[0]);
      else closeList();
    });

    const openIfUseful = () => {
      if (pick) return;
      if (items.length && len() >= cfg.minChars) { if (active < 0) active = 0; render(false); }
      else if (cfg.minChars === 0) run(input.value);   // lista curta: mostra tudo ao focar
    };
    input.addEventListener('focus', openIfUseful);
    input.addEventListener('click', () => { if (box.hidden) openIfUseful(); });
    clearBtn.addEventListener('click', () => clear(true));

    // Valida o texto atual: aceita a escolha feita, ou um texto que identifique um único item.
    function resolve() {
      const text = input.value.trim();
      if (!text) return { empty: true };
      if (pick) return { item: pick };
      const hit = cfg.byText ? cfg.byText(text, items) : null;
      if (hit) { choose(hit); return { item: hit }; }
      return { error: true };
    }

    return { clear, reset, resolve, get pick() { return pick; } };
  }

  // ---------- Realce do termo buscado ----------
  function highlight(text, q) {
    const n = F.norm(text);
    const i = q ? n.indexOf(q) : -1;
    if (i < 0 || n.length !== text.length) return F.esc(text);
    return F.esc(text.slice(0, i)) + '<mark>' + F.esc(text.slice(i, i + q.length)) + '</mark>' + F.esc(text.slice(i + q.length));
  }

  // ---------- Município (busca no servidor) ----------
  const CITY_SHOWN = 12, CITY_MAX_PAGES = 3;
  const cityLabel = c => c.name + (c.state?.uf ? ' – ' + c.state.uf : '');

  // Relevância: nome exato > começa com > palavra começa com > contém.
  function cityScore(name, q) {
    const n = F.norm(name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    return n.includes(' ' + q) ? 2 : 3;
  }

  async function searchCity(raw, { signal }) {
    const q = F.norm(raw).trim();
    const ufs = ufList();
    let found = [], after = null, hasNext = false;
    // Com UF(s) escolhida(s) a API ainda devolve todos os estados: varre algumas páginas até achar o bastante.
    for (let p = 0; p < (ufs.length ? CITY_MAX_PAGES : 1); p++) {
      const r = await api.searchCities(raw, { after, signal });
      found = found.concat(ufs.length ? r.items.filter(c => ufs.includes(c.state?.uf)) : r.items);
      after = r.endCursor;
      hasNext = r.hasNext;
      if (!hasNext || found.length >= CITY_SHOWN) break;
    }
    found.sort((a, b) => cityScore(a.name, q) - cityScore(b.name, q)
      || a.name.localeCompare(b.name, 'pt') || (a.state?.uf || '').localeCompare(b.state?.uf || ''));
    return { items: found, more: hasNext, q };
  }

  // ---------- CNAE e natureza jurídica (listas locais, código ou descrição) ----------
  // Número digitado (com ou sem pontuação) busca pelo prefixo do código; texto busca na descrição.
  function localSearch(getList) {
    return async raw => {
      const t = raw.trim();
      const numeric = /^[\d.\-/\s]+$/.test(t) && /\d/.test(t);
      const q = numeric ? F.digits(t) : F.norm(t);
      const list = getList();
      if (!q) return { items: list, q };
      if (numeric) return { items: list.filter(i => i.id.startsWith(q)), q };
      // Várias palavras: todas precisam aparecer, em qualquer ordem ("varejista padaria").
      const tokens = q.split(/\s+/).filter(Boolean);
      const scored = [];
      for (const i of list) {
        const d = i._n;
        if (!tokens.every(w => d.includes(w) || i.id.startsWith(w))) continue;
        const s = d.startsWith(q) ? 0 : d.includes(' ' + q) ? 1 : d.includes(q) ? 2 : 3;
        scored.push([s, i]);
      }
      scored.sort((a, b) => a[0] - b[0] || a[1]._n.localeCompare(b[1]._n, 'pt'));
      return { items: scored.map(x => x[1]), q };
    };
  }

  const codeLabel = i => `${i.id} – ${i.description}`;
  const codeOption = (i, q) =>
    `<span class="opt-code mono">${highlight(i.id, q)}</span><span class="opt-desc">${highlight(i.description, q)}</span>`;

  // Texto que identifica um item: código completo ou descrição idêntica.
  function codeByText(list, digitsLen) {
    return text => {
      const m = text.match(/^\s*([\d.\-/]+)/);
      const code = m ? F.digits(m[1]) : '';
      if (code.length === digitsLen) return list().find(i => i.id === code) || null;
      const t = F.norm(text);
      const same = list().filter(i => F.norm(i.description) === t || F.norm(codeLabel(i)) === t);
      return same.length === 1 ? same[0] : null;
    };
  }

  function init(refs) {
    states = [...refs.states].sort((a, b) => a.name.localeCompare(b.name, 'pt'));
    const cnaes = refs.cnaes.map(c => ({ ...c, _n: F.norm(c.description) }));
    const natures = refs.legalNatures.map(n => ({ ...n, _n: F.norm(n.description) }));
    combos.city = createCombo({
      id: 'city', minChars: 2, maxShown: CITY_SHOWN, async: true,
      search: searchCity,
      label: cityLabel,
      optionHtml: (c, q) => `<span class="opt-desc">${highlight(c.name, q)}</span><span class="uf-tag">${F.esc(c.state?.uf || '')}</span>`,
      emptyText: () => { const u = ufList(); return u.length ? `Nenhum município encontrado em ${u.join(', ')}.` : 'Nenhum município encontrado.'; },
      byText: (text, items) => {
        const exact = items.filter(c => F.norm(cityLabel(c)) === F.norm(text) || F.norm(c.name) === F.norm(text));
        return exact.length === 1 ? exact[0] : null;
      },
      // Ao escolher um município, preenche o estado (e a região) correspondente.
      onPick: c => { if (c.state?.uf) setUfs([c.state.uf], { silent: true }); },
    });

    combos.nature = createCombo({
      id: 'nature', minChars: 0, maxShown: 60,                 // ~90 itens: mostra a lista ao focar
      search: localSearch(() => natures),
      label: codeLabel, optionHtml: codeOption,
      emptyText: () => 'Nenhuma natureza jurídica encontrada.',
      byText: codeByText(() => natures, 4),
    });

    combos.cnae = createCombo({
      id: 'cnae', minChars: 2, maxShown: 15,
      search: localSearch(() => cnaes),
      label: codeLabel, optionHtml: codeOption,
      emptyText: () => 'Nenhuma atividade encontrada.',
      byText: codeByText(() => cnaes, 7),
    });

    bindCnpjMask();
    bindPickers();
    multis.status = createMultiCheck({
      id: 'status', emptyLabel: 'Todas', allLabel: 'Todas as situações', plural: 'situações', maxNames: 2,
      options: ['ATIVA', 'SUSPENSA', 'INAPTA', 'BAIXADA'].map(   // a API não aceita filtrar por NULA
        v => ({ value: v, label: DB.STATUS_LABELS[v] })),
    });
    multis.size = createMultiCheck({
      id: 'size', emptyLabel: 'Todos', allLabel: 'Todos os portes', plural: 'portes', maxNames: 1,
      options: [1, 3, 5, 0].map(v => ({ value: String(v), label: DB.SIZE_LABELS[v] })),
      onChange: showSizeInfo,
    });
  }

  function bindCnpjMask() {
    $('q').addEventListener('input', () => {
      const v = $('q').value;
      if (F.looksLikeCnpj(v)) {
        const masked = F.cnpjMask(v);
        if (masked !== v) $('q').value = masked;
      }
    });
  }

  // Explica cada porte marcado logo abaixo do filtro.
  function showSizeInfo() {
    const el = $('sizeInfo');
    const vals = (multis.size?.values() || []).map(Number);
    el.innerHTML = vals.map(v => `<strong>${F.esc(DB.SIZE_LABELS[v])}:</strong> ${F.esc(DB.SIZE_HINTS[v])}`).join('<br>');
    el.hidden = !vals.length;
  }

  function collect() {
    const filter = {};
    const chips = [];

    const q = $('q').value.trim();
    if (q) {
      if (F.looksLikeCnpj(q)) {
        const d = F.digits(q);
        if (d.length !== 14) return fail('q', 'Informe o CNPJ completo (14 dígitos) ou pesquise por nome.');
        filter.query = d;
        chips.push(['CNPJ', F.cnpj(d)]);
      } else {
        if (q.length < config.MIN_TEXT) return fail('q', `Digite ao menos ${config.MIN_TEXT} caracteres para buscar por nome.`);
        filter.query = q;
        chips.push(['Nome', q]);
      }
    }

    const city = combos.city.resolve();
    if (city.error) return fail('city', 'Escolha um município da lista de sugestões (digite o nome e selecione).');
    if (city.item) {
      filter.cityId = city.item.id;
      chips.push(['Município', cityLabel(city.item)]);
    }

    // Estados marcados (o município escolhido já restringe a seleção ao seu estado).
    let ufs = ufList();
    if (city.item && !ufs.length && city.item.state?.uf) ufs = [city.item.state.uf];
    if (ufs.length) {
      const full = fullRegions();
      const fullCount = full.reduce((n, r) => n + DB.REGIONS[r].length, 0);
      chips.unshift(full.length && fullCount === ufs.length
        ? ['Região', `${full.join(', ')} (${ufs.length} estados)`]
        : ['UF', ufs.length > 6 ? `${ufs.length} estados: ${ufs.join(', ')}` : ufs.join(', ')]);
    }

    const statuses = multis.status.effective();
    if (statuses.length) chips.push(['Situação', statuses.map(F.statusLabel).join(', ')]);

    const nat = combos.nature.resolve();
    if (nat.error) return fail('nature', 'Natureza jurídica: escolha uma das sugestões da lista.');
    if (nat.item) { filter.legalNature = nat.item.id; chips.push(['Natureza', codeLabel(nat.item)]); }

    const cn = combos.cnae.resolve();
    if (cn.error) return fail('cnae', 'Atividade (CNAE): escolha uma das sugestões da lista.');
    if (cn.item) { filter.cnae = cn.item.id; chips.push(['CNAE', codeLabel(cn.item)]); }

    if (!Object.keys(filter).length && !ufs.length && !statuses.length) {
      return fail('q', 'Informe ao menos um filtro (nome ou CNPJ, estado, município, situação, natureza jurídica ou CNAE). O porte sozinho não basta, pois é aplicado no navegador.');
    }

    const sizeSel = multis.size.effective().map(Number);
    if (sizeSel.length) chips.push(['Porte', sizeSel.map(v => DB.SIZE_LABELS[v]).join(', ')]);

    // A API aceita um valor de UF e um de situação por consulta: uma consulta por combinação.
    const n = (ufs.length || 1) * (statuses.length || 1);
    if (n > config.MAX_COMBINATIONS) {
      return fail(ufs.length > 1 ? 'uf' : 'status',
        `Combinações demais: ${ufs.length || 1} estado(s) × ${statuses.length || 1} situação(ões) = ${n} consultas (máximo ${config.MAX_COMBINATIONS}). Reduza a seleção de estados ou de situações.`);
    }
    const filters = [];
    for (const uf of ufs.length ? ufs : [null]) {
      for (const st of statuses.length ? statuses : [null]) {
        filters.push({ ...filter, ...(uf && { uf }), ...(st && { status: st }) });
      }
    }
    return { ok: true, filters, sizes: sizeSel.length ? sizeSel : null, chips };
  }

  function clear() {
    $('filters').reset();
    setUfs([], { silent: true });
    drops.uf?.set(false);
    drops.region?.set(false);
    multis.status?.clear();
    multis.size?.clear();
    Object.values(combos).forEach(c => c.clear());
    showSizeInfo();
  }

  DB.filters = { init, collect, clear };
})();
