/* Configuração central. Todos os módulos compartilham o namespace window.DB
   (scripts clássicos, para o projeto continuar abrindo com duplo clique em file://). */
(function () {
  'use strict';
  window.DB = window.DB || {};

  DB.config = {
    GRAPHQL_URL: 'https://api.dadosbrasil.net/graphql',
    SOURCE_NAME: 'API Dados Brasil',
    SOURCE_URL: 'https://dadosbrasil.net/pt/',
    PAGE_SIZE: 50,            // resultados por página (o máximo da API é 100)
    API_MAX_PAGE: 100,
    EXPORT_MAX_PAGES: 20,     // "Exportar CSV" baixa no máx. 20 páginas de 100 (= 2.000 linhas)
    COUNT_MAX_PAGES: 20,     // "Contar total" varre no máx. 20 páginas de 100 (= 2.000 resultados)
    SIZE_SCAN_PAGES: 5,      // máx. de páginas da API varridas por página exibida ao filtrar por porte
    TIMEOUT_MS: 25000,
    CACHE_TTL_MS: 5 * 60 * 1000,
    CACHE_MAX_ENTRIES: 120,
    REF_TTL_MS: 24 * 60 * 60 * 1000,   // listas de referência (UFs, CNAEs, naturezas)
    DEBOUNCE_MS: 300,
    MIN_TEXT: 3,
    SUGGESTIONS: 40,
    DETAIL_ESTABLISHMENTS_PAGE: 20,
  };

  // A API não filtra por região: a região só restringe a lista de UFs.
  DB.REGIONS = {
    Norte: ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'],
    Nordeste: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
    'Centro-Oeste': ['DF', 'GO', 'MS', 'MT'],
    Sudeste: ['ES', 'MG', 'RJ', 'SP'],
    Sul: ['PR', 'RS', 'SC'],
  };

  // Códigos de porte retornados pela API (CompanySize.code).
  DB.SIZE_LABELS = { 0: 'Não informado', 1: 'Microempresa', 3: 'Empresa de pequeno porte', 5: 'Demais' };

  // Explicações do porte (classificação da Receita Federal; limites da LC 123/2006).
  DB.SIZE_HINTS = {
    0: 'A Receita Federal não informou o porte desta empresa.',
    1: 'Receita bruta anual de até R$ 360 mil (LC 123/2006).',
    3: 'Receita bruta anual entre R$ 360 mil e R$ 4,8 milhões (LC 123/2006).',
    5: 'Categoria residual da Receita Federal: reúne as empresas que não se enquadram como Microempresa nem como Empresa de Pequeno Porte, seja por faturamento acima de R$ 4,8 milhões, seja por impedimento legal (como S.A., cooperativas e órgãos públicos) ou por não terem enquadramento declarado. Não significa, necessariamente, empresa grande.',
  };

  // Enum RegistrationStatus da API.
  DB.STATUS_LABELS = { NULA: 'Nula', ATIVA: 'Ativa', SUSPENSA: 'Suspensa', INAPTA: 'Inapta', BAIXADA: 'Baixada' };
})();
