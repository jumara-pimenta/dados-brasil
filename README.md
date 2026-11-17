# Dados Brasil – Inteligência e Consulta Empresarial

Interface web para pesquisar e analisar empresas brasileiras a partir da [API Dados Brasil](https://dadosbrasil.net/pt/).
Construída para fins de pesquisa acadêmica, no contexto do projeto **Mulheres & Inovação**.

HTML5, CSS3 e JavaScript puro (sem frameworks, sem etapa de build).

## Como executar

Não há instalação. É preciso ter acesso à internet.

- Abra o `index.html` no navegador (duplo clique), **ou**
- sirva a pasta localmente:

```bash
python -m http.server 8000   # ou: npx serve
# acesse http://localhost:8000
```

## Funcionalidades

- Pesquisa por razão social, nome fantasia ou CNPJ (com máscara automática).
- Filtros combináveis: região (auxiliar dos estados), UF, município, situação cadastral, porte, natureza jurídica e atividade econômica (CNAE).
- Município, CNAE e natureza jurídica com sugestões (busca por código ou descrição, sem diferenciar acentos, com navegação por teclado).
- Tabela com razão social, nome fantasia, CNPJ, tipo, porte, situação, município/UF, capital social e contato (telefone e e-mail).
- Paginação por cursor, botão **Contar total** (até 2.000 resultados) e **Exportar CSV** (até 2.000 linhas, pronto para o Excel em português).
- Detalhe da empresa em abas: geral, atividade econômica, estabelecimentos e quadro societário.
- Aba **Indicadores** com distribuições dos resultados carregados.

## Limitações da API (confirmadas por introspecção do schema GraphQL)

- Não há filtro por **porte** nem por **região**: o porte é filtrado no navegador e a região só restringe a lista de estados.
- Não há **total de resultados** nem **data de atualização** da base (a base é importada mensalmente dos dados abertos do CNPJ da Receita Federal).
- Buscas por nome muito comuns, ou algumas combinações de filtros, podem estourar o limite de ~10 s do servidor.
- Os indicadores descrevem apenas a página carregada, nunca totais nacionais.

## Estrutura

```
index.html        página e estrutura dos filtros
style.css         identidade visual e responsividade
assets/logo.png   logo do projeto
js/config.js      constantes e limites
js/format.js      formatação (CNPJ, datas, moeda, telefone)
js/api.js         cliente GraphQL (timeout, cache, tratamento de erros)
js/filters.js     formulário, comboboxes e validação
js/render.js      tabela, detalhe e indicadores
js/export.js      exportação CSV
js/app.js         estado, busca, paginação e eventos
```

## Uso responsável dos dados

Telefones e e-mails de Empresário Individual e MEI podem ser dados pessoais. Ao usar a exportação para contatar empresas, observe a LGPD e as regras do comitê de ética da instituição.
