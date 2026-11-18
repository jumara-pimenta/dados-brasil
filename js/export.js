/* Exportação CSV: pensada para abrir direto no Excel em português
   (UTF-8 com BOM, separador ";", decimal com vírgula). */
(function () {
  'use strict';
  const { format: F, api } = DB;

  const money = v => {
    const n = Number(v);
    return v == null || v === '' || !isFinite(n) ? '' : n.toFixed(2).replace('.', ',');
  };

  const COLUMNS = [
    ['Razão social', r => r.company?.legalName],
    ['Nome fantasia', r => r.tradeName],
    ['CNPJ', r => F.cnpj(r.cnpj)],
    ['Tipo', r => (r.isHeadOffice ? 'Matriz' : 'Filial')],
    ['Porte', r => F.sizeLabel(r.company?.size?.code)],
    ['Situação cadastral', r => F.statusLabel(r.status)],
    ['Município', r => r.city?.name || api.cityName(r.city?.id)],
    ['UF', r => r.state?.uf],
    ['Telefones', r => F.validPhones(r.contact?.phones).map(F.phone).join(' / ')],
    ['E-mail', r => F.validEmail(r.contact?.email)],
    ['Capital social (R$)', r => money(r.company?.shareCapital)],
    ['CNAE principal', r => (r.primaryActivity ? `${r.primaryActivity.id} - ${r.primaryActivity.description}` : '')],
  ];

  // Aspas para ; " e quebras de linha. Prefixa ' em textos que o Excel interpretaria como fórmula.
  function cell(value) {
    let s = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const pad = n => String(n).padStart(2, '0');
  const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // meta: { collectedAt: Date, filters: "UF: AM; Situação: Ativa" } – registra a origem para reprodutibilidade.
  function toCsv(rows, meta) {
    const when = `${stamp(meta.collectedAt)} ${pad(meta.collectedAt.getHours())}:${pad(meta.collectedAt.getMinutes())}`;
    const head = [...COLUMNS.map(c => c[0]), 'Coletado em', 'Filtros da pesquisa'];
    const lines = [head.map(cell).join(';')];
    for (const r of rows) {
      lines.push([...COLUMNS.map(c => c[1](r)), when, meta.filters].map(cell).join(';'));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function download(text, date) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `dadosbrasil_${stamp(date)}_${pad(date.getHours())}${pad(date.getMinutes())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return a.download;
  }

  DB.exporter = { toCsv, download };
})();
