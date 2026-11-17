/* Formulário de filtros: listas dependentes, comboboxes com sugestões, validação e
   conversão para o EstablishmentFilter aceito pela API. */
(function () {
  'use strict';
  const { format: F, api, config } = DB;
  const $ = id => document.getElementById(id);

  let states = [];
  const combos = {};   // city, nature, cnae

  const fail = (field, message) => ({ ok: false, field, message });

  function fillRegions() {
    Object.keys(DB.REGIONS).forEach(r => $('region').add(new Option(r, r)));
  }

  // A região apenas restringe os estados disponíveis.
  function fillUfs() {
    const region = $('region').value, current = $('uf').value;
    $('uf').length = 1;
    states
      .filter(s => !region || DB.REGIONS[region].includes(s.uf))
      .forEach(s => $('uf').add(new Option(`${s.name} (${s.uf})`, s.uf)));
    if ([...$('uf').options].some(o => o.value === current)) $('uf').value = current;
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
    const uf = $('uf').value;
    let found = [], after = null, hasNext = false;
    // Com UF escolhida a API ainda devolve todos os estados: varre algumas páginas até achar o bastante.
    for (let p = 0; p < (uf ? CITY_MAX_PAGES : 1); p++) {
      const r = await api.searchCities(raw, { after, signal });
      found = found.concat(uf ? r.items.filter(c => c.state?.uf === uf) : r.items);
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
    fillRegions();
    fillUfs();

    combos.city = createCombo({
      id: 'city', minChars: 2, maxShown: CITY_SHOWN, async: true,
      search: searchCity,
      label: cityLabel,
      optionHtml: (c, q) => `<span class="opt-desc">${highlight(c.name, q)}</span><span class="uf-tag">${F.esc(c.state?.uf || '')}</span>`,
      emptyText: () => ($('uf').value ? `Nenhum município encontrado em ${$('uf').value}.` : 'Nenhum município encontrado.'),
      byText: (text, items) => {
        const exact = items.filter(c => F.norm(cityLabel(c)) === F.norm(text) || F.norm(c.name) === F.norm(text));
        return exact.length === 1 ? exact[0] : null;
      },
      // Ao escolher um município, preenche o estado (e a região) correspondente.
      onPick: c => {
        const uf = c.state?.uf || '';
        if (uf && $('uf').value !== uf) {
          $('region').value = F.regionOf(uf);
          fillUfs();
          $('uf').value = uf;
        }
      },
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
    $('region').addEventListener('change', fillUfs);
    $('uf').addEventListener('change', () => {
      // O município escolhido deixa de valer se pertencer a outro estado.
      const pk = combos.city.pick;
      if (pk && $('uf').value && pk.state?.uf !== $('uf').value) combos.city.clear();
      else if (!pk) combos.city.reset();
    });
    $('size').addEventListener('change', showSizeInfo);
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

  // Explica o porte escolhido logo abaixo do filtro.
  function showSizeInfo() {
    const v = $('size').value;
    const el = $('sizeInfo');
    el.textContent = v === '' ? '' : `${DB.SIZE_LABELS[+v]}: ${DB.SIZE_HINTS[+v]}`;
    el.hidden = v === '';
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

    const region = $('region').value;
    let uf = $('uf').value;
    if (region && !uf) {
      return fail('uf', 'Escolha um estado da região selecionada: a API filtra por estado, não por região.');
    }

    const city = combos.city.resolve();
    if (city.error) return fail('city', 'Escolha um município da lista de sugestões (digite o nome e selecione).');
    if (city.item) {
      filter.cityId = city.item.id;
      if (!uf) uf = city.item.state?.uf || '';
      chips.push(['Município', cityLabel(city.item)]);
    }
    if (uf) {
      filter.uf = uf;
      chips.push(['UF', uf]);
      if (region) chips.unshift(['Região', region]);
    }

    const status = $('status').value;
    if (status) { filter.status = status; chips.push(['Situação', F.statusLabel(status)]); }

    const nat = combos.nature.resolve();
    if (nat.error) return fail('nature', 'Natureza jurídica: escolha uma das sugestões da lista.');
    if (nat.item) { filter.legalNature = nat.item.id; chips.push(['Natureza', codeLabel(nat.item)]); }

    const cn = combos.cnae.resolve();
    if (cn.error) return fail('cnae', 'Atividade (CNAE): escolha uma das sugestões da lista.');
    if (cn.item) { filter.cnae = cn.item.id; chips.push(['CNAE', codeLabel(cn.item)]); }

    if (!Object.keys(filter).length) {
      return fail('q', 'Informe ao menos um filtro (nome ou CNPJ, estado, município, situação, natureza jurídica ou CNAE). O porte sozinho não basta, pois é aplicado no navegador.');
    }

    const size = $('size').value;
    if (size !== '') chips.push(['Porte', DB.SIZE_LABELS[+size]]);

    return { ok: true, filter, size: size === '' ? null : size, chips };
  }

  function clear() {
    $('filters').reset();
    fillUfs();
    Object.values(combos).forEach(c => c.clear());
    showSizeInfo();
  }

  DB.filters = { init, collect, clear };
})();
