/* Funções puras de formatação e utilidades. */
(function () {
  'use strict';
  const F = (DB.format = {});

  F.esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  F.digits = s => String(s ?? '').replace(/\D/g, '');

  F.cnpj = c => {
    const d = F.digits(c);
    return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(c ?? '');
  };

  // Máscara progressiva para digitação de CNPJ (só números).
  F.cnpjMask = raw => {
    const d = F.digits(raw).slice(0, 14);
    return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
  };

  // Texto que só contém dígitos e pontuação de CNPJ é tratado como CNPJ.
  F.looksLikeCnpj = s => /^[\d.\-/\s]+$/.test(s) && /\d/.test(s);

  F.date = d => {
    d = String(d ?? '');
    if (!d || /^0+$/.test(d)) return '';
    if (/^\d{8}$/.test(d)) return `${d.slice(6)}/${d.slice(4, 6)}/${d.slice(0, 4)}`;
    return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split('-').reverse().join('/') : d;
  };

  F.money = v => {
    const n = Number(v);
    return v == null || v === '' || !isFinite(n) ? '' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  F.cep = z => { const d = F.digits(z); return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, '$1-$2') : (z || ''); };

  F.phone = p => {
    const m = String(p ?? '').match(/^\(?(\d{2})\)?\s*(\d{4,5})(\d{4})$/);
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(p ?? '');
  };

  F.sizeLabel = code => {
    if (code == null || code === '') return '';
    return DB.SIZE_LABELS[+code] ?? '';
  };

  F.statusLabel = s => DB.STATUS_LABELS[s] || s || '';

  F.regionOf = uf => Object.keys(DB.REGIONS).find(r => DB.REGIONS[r].includes(uf)) || '';

  // IDs de município têm 4 dígitos em /cities e vêm sem zeros à esquerda nos estabelecimentos.
  F.cityId = id => String(id ?? '').padStart(4, '0');

  F.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  F.norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  F.address = a => a
    ? [[a.streetType, a.street].filter(Boolean).join(' '), a.number, a.complement].filter(Boolean).join(', ')
    : '';
})();
