/* Geração de HTML: tabela, detalhe, indicadores. Só exibe o que a API devolveu. */
(function () {
  'use strict';
  const { format: F, api } = DB;
  const esc = F.esc;

  const statusBadge = s =>
    s ? `<span class="badge ${esc(String(s).toLowerCase())}">${esc(F.statusLabel(s))}</span>` : '';
  const typeLabel = isHead => (isHead ? 'Matriz' : 'Filial');
  const cityUf = e => {
    const name = e.city?.name || api.cityName(e.city?.id);
    const uf = e.state?.uf || '';
    return [name, uf].filter(Boolean).join(' / ');
  };

  // Porte com dica (tooltip nativo, que não é cortado pela rolagem da tabela).
  function sizeCell(code) {
    const label = F.sizeLabel(code);
    if (!label) return '<span class="mute">—</span>';
    const tip = DB.SIZE_HINTS[+code];
    return tip
      ? `<span class="tip" title="${esc(label + ': ' + tip)}">${esc(label)} <span class="tip-i" aria-hidden="true">ⓘ</span></span>`
      : esc(label);
  }

  // ---------- Tabela ----------
  function row(r) {
    const phone = F.phone(F.validPhones(r.contact?.phones)[0]);
    const email = F.validEmail(r.contact?.email);
    const place = cityUf(r);
    const name = r.company?.legalName || '';
    return `<tr data-cnpj="${esc(r.cnpj)}">
      <td class="c-name" title="${esc(name)}"><span class="clip strong">${esc(name)}</span></td>
      <td class="c-trade" title="${esc(r.tradeName)}"><span class="clip">${esc(r.tradeName) || '<span class="mute">—</span>'}</span></td>
      <td class="c-cnpj nowrap mono">${F.cnpj(r.cnpj)}</td>
      <td><span class="pill ${r.isHeadOffice ? 'head' : ''}">${typeLabel(r.isHeadOffice)}</span></td>
      <td>${sizeCell(r.company?.size?.code)}</td>
      <td>${statusBadge(r.status)}</td>
      <td class="c-city" title="${esc(place)}"><span class="clip">${esc(place) || '<span class="mute">—</span>'}</span></td>
      <td class="c-capital nowrap mono" title="Capital social da empresa (raiz do CNPJ)">${esc(F.money(r.company?.shareCapital)) || '<span class="mute">—</span>'}</td>
      <td class="c-contact">${phone ? `<span class="nowrap">${esc(phone)}</span>` : ''}${email ? `<span class="clip sub" title="${esc(email)}">${esc(email)}</span>` : ''}${phone || email ? '' : '<span class="mute">—</span>'}</td>
      <td class="c-act"><button type="button" class="btn small" data-detail="${esc(r.cnpj)}" aria-label="Ver detalhes de ${esc(name || F.cnpj(r.cnpj))}">Detalhes</button></td>
    </tr>`;
  }

  const rows = list => list.map(row).join('');

  function skeletonRows(n = 8) {
    const cell = w => `<td><span class="skel" style="width:${w}"></span></td>`;
    return Array.from({ length: n }, () =>
      `<tr class="skel-row" aria-hidden="true">${cell('80%')}${cell('60%')}${cell('90px')}${cell('50px')}${cell('70px')}${cell('55px')}${cell('70%')}${cell('75%')}${cell('70%')}${cell('60px')}</tr>`).join('');
  }

  const scope = chips => chips.length
    ? `<span class="scope-title">Filtros aplicados:</span> ` +
      chips.map(([k, v]) => `<span class="chip"><b>${esc(k)}:</b> ${esc(v)}</span>`).join('')
    : '';

  // ---------- Detalhe ----------
  const dl = pairs => {
    const items = pairs.filter(([, v]) => v !== '' && v != null && v !== false);
    return items.length
      ? `<dl>${items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
      : '<p class="mute">Nenhuma informação disponível.</p>';
  };
  const section = (title, body) => `<section class="dsec"><h3>${esc(title)}</h3>${body}</section>`;

  function detailHead(e) {
    const co = e.company;
    return `<h2 id="detailTitle">${esc(co.legalName)}</h2>
      <div class="dsub">${e.tradeName ? esc(e.tradeName) + ' · ' : ''}<span class="mono">${F.cnpj(e.cnpj)}</span>
        <span class="pill ${e.isHeadOffice ? 'head' : ''}">${typeLabel(e.isHeadOffice)}</span> ${statusBadge(e.status)}</div>`;
  }

  function estabItem(x) {
    return `<li><span class="mono">${F.cnpj(x.cnpj)}</span>
      <span class="pill ${x.isHeadOffice ? 'head' : ''}">${typeLabel(x.isHeadOffice)}</span>
      <span class="grow">${esc(cityUf(x))}</span> ${statusBadge(x.status)}</li>`;
  }

  function detailTabs(e) {
    const co = e.company;
    const simples = co.simplesNacional;
    const general =
      section('Identificação', dl([
        ['CNPJ', F.cnpj(e.cnpj)], ['Razão social', co.legalName], ['Nome fantasia', e.tradeName],
        ['Tipo', typeLabel(e.isHeadOffice)], ['Porte', F.sizeLabel(co.size?.code)],
        ['Sobre o porte', co.size?.code != null && DB.SIZE_HINTS[+co.size.code]],
        ['Natureza jurídica', co.legalNature && `${co.legalNature.id} – ${co.legalNature.description}`],
        ['Capital social', F.money(co.shareCapital)],
        ['Simples Nacional', simples && (simples.optedIn ? 'Optante' : 'Não optante')],
        ['MEI', simples && (simples.meiOptedIn ? 'Sim' : 'Não')],
      ])) +
      section('Situação cadastral', dl([
        ['Situação', F.statusLabel(e.status)], ['Data da situação', F.date(e.statusDate)],
        ['Data de abertura', F.date(e.activityStartDate)],
        ['Código do motivo da situação', e.statusReasonCode],
        ['Situação especial', e.specialSituation], ['Data da situação especial', F.date(e.specialSituationDate)],
      ])) +
      section('Localização', dl([
        ['Endereço', F.address(e.address)], ['Bairro', e.address?.neighborhood], ['CEP', F.cep(e.address?.zipCode)],
        ['Município', e.city?.name || api.cityName(e.city?.id)], ['UF', e.state?.uf && (e.state.name ? `${e.state.uf} – ${e.state.name}` : e.state.uf)],
        ['Cidade no exterior', e.address?.foreignCity],
      ])) +
      section('Contato', dl([
        ['Telefone', F.validPhones(e.contact?.phones).map(F.phone).join(' · ')],
        ['Fax', F.validPhones([e.contact?.fax]).map(F.phone)[0]], ['E-mail', F.validEmail(e.contact?.email)],
      ]));

    const sec = e.secondaryActivities || [];
    const activity =
      section('CNAE principal', e.primaryActivity
        ? `<p><span class="mono">${esc(e.primaryActivity.id)}</span> – ${esc(e.primaryActivity.description)}</p>`
        : '<p class="mute">Não informado.</p>') +
      section(`CNAEs secundários (${sec.length})`, sec.length
        ? `<ul class="list">${sec.map(a => `<li><span class="mono">${esc(a.id)}</span> – ${esc(a.description)}</li>`).join('')}</ul>`
        : '<p class="mute">Nenhum CNAE secundário.</p>');

    const ests = co.establishments;
    const estabs =
      `<p class="mute">Estabelecimentos desta empresa (raiz ${esc(co.cnpjRoot)}): ${esc(co.establishmentsCount)} no total.</p>
       <ul class="list estab" id="estabList">${ests.edges.map(x => estabItem(x.node)).join('')}</ul>
       <button type="button" class="btn small" id="estabMore" data-root="${esc(co.cnpjRoot)}" data-cursor="${esc(ests.pageInfo.endCursor || '')}" ${ests.pageInfo.hasNextPage ? '' : 'hidden'}>Carregar mais estabelecimentos</button>`;

    const partners = co.partners || [];
    const quadro = partners.length
      ? `<table class="mini"><thead><tr><th>Nome</th><th>Qualificação</th><th>Entrada</th></tr></thead><tbody>${
          partners.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.qualification?.description || '')}</td><td class="nowrap">${esc(F.date(p.entryDate))}</td></tr>`).join('')
        }</tbody></table>`
      : '<p class="mute">Nenhum sócio ou administrador informado.</p>';

    return [
      { id: 'general', label: 'Geral', html: general },
      { id: 'activity', label: 'Atividade econômica', html: activity },
      { id: 'estabs', label: `Estabelecimentos (${co.establishmentsCount})`, html: estabs },
      { id: 'partners', label: `Quadro societário (${partners.length})`, html: quadro },
    ];
  }

  // ---------- Indicadores (apenas sobre os resultados carregados) ----------
  function tally(list, keyFn) {
    const m = new Map();
    list.forEach(r => { const k = keyFn(r); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  function bars(title, entries, total, limit = 8) {
    if (!entries.length) return `<div class="chart"><h4>${esc(title)}</h4><p class="mute">Sem dados.</p></div>`;
    const shown = entries.slice(0, limit);
    const max = shown[0][1];
    const rest = entries.slice(limit).reduce((s, [, n]) => s + n, 0);
    const line = ([label, n]) => `<li><span class="bl" title="${esc(label)}">${esc(label)}</span>
      <span class="bt" aria-hidden="true"><span class="bf" style="width:${Math.max(2, n / max * 100).toFixed(1)}%"></span></span>
      <span class="bv">${n} <small>(${(n / total * 100).toFixed(0)}%)</small></span></li>`;
    return `<div class="chart"><h4>${esc(title)}</h4><ul class="bars">${shown.map(line).join('')}${
      rest ? line([`Outros (${entries.length - limit})`, rest]) : ''}</ul></div>`;
  }

  function stats(list, ctx) {
    if (!list.length) {
      return `<div class="empty-state"><h3>Sem dados para analisar</h3>
        <p>Faça uma pesquisa para ver a distribuição dos resultados carregados.</p></div>`;
    }
    const total = list.length;
    const cn = r => r.primaryActivity ? `${r.primaryActivity.id} – ${r.primaryActivity.description}` : '';
    return `<div class="universe"><strong>Universo analisado:</strong> ${total} estabelecimentos exibidos na página ${ctx.page}
        da pesquisa atual${ctx.chips.length ? ' (' + ctx.chips.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('; ') + ')' : ''}.
        <br><span class="mute">Estes números descrevem somente os resultados carregados; não são totais da pesquisa nem do Brasil.
        A API não fornece contagens agregadas.</span></div>
      <div class="charts">
        ${bars('Por porte', tally(list, r => F.sizeLabel(r.company?.size?.code) || 'Não informado'), total)}
        ${bars('Por situação cadastral', tally(list, r => F.statusLabel(r.status)), total)}
        ${bars('Por região', tally(list, r => F.regionOf(r.state?.uf)), total)}
        ${bars('Por UF', tally(list, r => r.state?.uf), total)}
        ${bars('Por atividade econômica (CNAE principal)', tally(list, cn), total, 6)}
        ${bars('Por tipo de estabelecimento', tally(list, r => typeLabel(r.isHeadOffice)), total)}
      </div>`;
  }

  DB.render = { rows, skeletonRows, scope, detailHead, detailTabs, estabItem, stats };
})();
