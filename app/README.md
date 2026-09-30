# app — UI de exibição

SPA de leitura sobre os dados do Moneta: resumo mensal, despesas com filtros, saúde da fila e os relatórios da análise. Vite + React + TypeScript, sem framework de UI.

**Somente leitura.** Escrita continua nas RPCs `security definer` chamadas pelas Edge Functions; o app nunca escreve em tabela.

## Comandos

Rodar de dentro de `app/` — este é o único diretório do repositório com `package.json`.

| | |
|---|---|
| `npm install` | instala as dependências |
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | `tsc --noEmit` + build de produção em `dist/` |
| `npm run preview` | serve o `dist/` já construído |
| `npm test` | Vitest (29 testes) |

## Configuração

```sh
cp .env.example .env.local   # preencher URL e anon key
```

Ambos os valores são públicos por construção — vão dentro do bundle. O que protege os dados é a RLS. **A `service_role` key nunca entra aqui.**

### Autorizar sua conta

Entrar não é o mesmo que ter acesso. O login é por magic link, e a RLS só libera leitura para quem tem linha em `app_users`. Depois do primeiro login:

```sql
insert into public.app_users (user_id, email)
select id, email from auth.users where email = '<seu e-mail>';
```

Antes disso o app autentica normalmente e mostra um aviso explicando que a conta não está autorizada — em vez de telas vazias sem explicação.

## Telas

- **Resumo** — total, contagem e ticket médio do mês; gasto por categoria; uso das formas de pagamento.
- **Despesas** — lista paginada com filtros de mês, categoria e forma de pagamento; clicar numa linha abre os itens do recibo.
- **Pendências** — taxa de sucesso, fila por situação, idade do item mais antigo.
- **Relatórios** — os relatórios da `analyze-expenses`, com seções estruturadas e o markdown completo.

## Notas de design

As cores vêm da paleta validada de referência de dataviz, sem alteração. O gráfico de categorias usa **uma** cor de série: a identidade da categoria está no eixo, e colorir cada barra sugeriria uma codificação que não existe. As cores de status (fila) nunca aparecem sozinhas — sempre com rótulo em texto, para não depender de percepção de cor.

Dark mode é declarado em `styles.css` sob `prefers-color-scheme` e sob `[data-theme]`, com os passos próprios da paleta para superfície escura — não é inversão automática.

## Deploy

Estático: qualquer host de arquivos serve o `dist/`. Defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no build.

O bundle passa de 500 kB (Recharts + supabase-js). Para um app pessoal está bom; se incomodar, o caminho é `manualChunks` ou import dinâmico das páginas.
