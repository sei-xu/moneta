# analyze-expenses — Worker de análise e relatórios

Edge Function agendada que transforma um período de gastos em um relatório armazenado em `reports` e decide, sozinha, se aquilo vale interromper você no Telegram.

O modelo **nunca** consulta o banco: a RPC `get_analysis_context` pré-agrega o período (totais por categoria contra a média das 4 semanas anteriores, top merchants, split por forma de pagamento, saúde da fila) e tudo vai numa **única** requisição — sem loop de tool calling, sem superfície de SQL para validar. Desenho completo em [`docs/automacoes-futuras.md`](../../../docs/automacoes-futuras.md).

## Os dois modos

| Modo | Body | Quando roda | O que faz |
|---|---|---|---|
| `weekly` | `{"mode":"weekly"}` | Segundas, 12:00 UTC | Analisa a semana ISO que acabou de fechar |
| `followups` | `{"mode":"followups"}` | De hora em hora | Roda cada linha vencida de `scheduled_analyses`, com o prompt que um relatório anterior escreveu |

Para reprocessar um período específico, passe as datas: `{"mode":"weekly","period_start":"2026-09-21","period_end":"2026-09-27"}`. O período semanal é único em `reports`, então **reprocessar sobrescreve** em vez de duplicar — um tick de cron repetido é inofensivo.

## Falhas do provedor

O relatório semanal tem uma única chance agendada, então um 503 passageiro não pode custar a semana inteira: em 429 ou 5xx o worker tenta de novo (`ANALYSIS_MAX_RETRIES`, backoff 2s e 6s). Erros de chamador — chave inválida, modelo inexistente, request malformado — falham igual na segunda tentativa, então não são retentados.

Isso não é hipotético: a primeira execução em produção levou 503 (`This model is currently experiencing high demand`) duas vezes seguidas antes do retry existir.

## A decisão de notificar

O próprio modelo devolve `notification_decision`, e é ela que governa o envio:

- **`silent`** — nada no período justifica interromper; o relatório fica salvo e nenhuma mensagem sai.
- **`report_ready`** — chega o headline e um convite para `/relatorio`.
- **`observation`** — urgente o suficiente para mandar o achado em si, não um ponteiro.

Itens de `forward_looking` que pedem `revisit_in_days` viram linhas em `scheduled_analyses` (no máximo `ANALYSIS_MAX_FOLLOWUPS` por relatório, padrão 3) e são consumidos pelo poll horário.

## Provedor do modelo

Gemini e Kimi falam o mesmo protocolo (OpenAI Chat Completions), então há um só caminho de código. O **default é Gemini**, pelo endpoint compatível `generativelanguage.googleapis.com/v1beta/openai` — é a chave de free tier que já roda o `process-receipts`, custo zero e nenhum destino novo para dados financeiros.

Kimi fica **opt-in**: é paga (~US$ 0,45–0,60 por milhão de tokens de entrada) e adiciona um segundo terceiro recebendo dados financeiros, o que o [`README`](../../../README.md) lista como restrição sob LGPD. Para trocar:

```sh
supabase secrets set ANALYSIS_PROVIDER=kimi KIMI_API_KEY=<chave do Moonshot>
```

| Secret | Default | Para quê |
|---|---|---|
| `ANALYSIS_PROVIDER` | `gemini` | `gemini` ou `kimi` |
| `ANALYSIS_MODEL` | `gemini-3.6-flash` / `kimi-k2.6` | Sobrescreve o modelo do provedor |
| `ANALYSIS_MAX_FOLLOWUPS` | `3` | Teto de follow-ups por relatório e por rodada de poll |
| `ANALYSIS_MAX_RETRIES` | `3` | Tentativas quando o provedor devolve 429/5xx (backoff 2s, 6s) |
| `WORKER_SECRET` | — | Mesmo secret do `process-receipts` |
| `GEMINI_API_KEY` / `KIMI_API_KEY` | — | Conforme o provedor |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_IDS` | — | Já definidos pelo `telegram-ingest` |

## Configuração

### 1. Migrações

No SQL Editor, em ordem:

- `20260930000001_create_reports_and_scheduled_analyses.sql` — tabelas `reports` e `scheduled_analyses` + enum `notification_decision_type`
- `20260930000002_create_analysis_context_function.sql` — a RPC de pré-agregação
- `20260930000003_schedule_analysis_jobs.sql` — os jobs de cron (**substitua `<project-ref>`**; o segredo vem do Vault, ver abaixo)

### 1b. O segredo do cron (Vault)

O `pg_cron` roda dentro do Postgres, que **não** enxerga um `.env` nem os secrets das Edge Functions. Para não hardcodar o valor no SQL do job (onde ele ficaria visível em `cron.job.command` e no dashboard), guarde-o uma vez no Vault:

```sql
select vault.create_secret(
  '<mesmo valor do WORKER_SECRET>',
  'worker_secret',
  'Shared secret for pg_cron -> Edge Function calls'
);
```

Os jobs decifram na hora de rodar. Para trocar depois:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'worker_secret'),
  '<novo valor>'
);
```

Lembre de manter esse valor igual ao secret `WORKER_SECRET` das Edge Functions — é a divergência entre os dois que derrubou o job do `process-receipts` (ver o fim deste arquivo).

### 2. Deploy

```sh
supabase functions deploy analyze-expenses --no-verify-jwt
```

`--no-verify-jwt` porque a autenticação é o header `x-worker-secret`, não o JWT do Supabase — mesmo padrão do `process-receipts`.

## Testar

Testes de unidade da lógica pura (períodos ISO, validação do JSON do modelo, roteamento de notificação, extração de follow-ups):

```sh
deno test supabase/functions/analyze-expenses/
```

Verificação do SQL (semeia, afirma e faz rollback — não deixa nada no banco):

```sh
supabase db query --linked -f supabase/tests/analysis_checks.sql
```

Ou cole o arquivo inteiro no SQL Editor. Uma execução limpa significa que todas as asserções passaram; uma falha aborta e imprime a mensagem.

Para validar num banco onde estas migrações ainda não foram aplicadas, concatene `20260930000001` e `20260930000002` antes do arquivo de checks dentro de **um único** `begin; ... rollback;` — o DDL também é revertido e o banco fica intacto. Foi assim que este script foi validado contra o schema real antes do primeiro deploy.

Fim a fim:

```sh
curl -X POST "https://<project-ref>.supabase.co/functions/v1/analyze-expenses" \
  -H "x-worker-secret: $WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mode":"weekly"}'
```

Esperado: uma linha nova em `reports` e — conforme `notification_decision` — nenhuma mensagem, o headline com convite para `/relatorio`, ou a observação direta. Pelo bot, `/analisar` dispara o mesmo e `/relatorio` lê o último relatório.

Logs: `supabase functions logs analyze-expenses`.

## Dois jobs quebrados que esta migração corrige

Descobertos ao agendar a análise, inspecionando `net._http_response`: **todas** as respostas retidas eram 401.

1. **`process-receipts`** — o job tinha um `WORKER_SECRET` hardcodado que **não** corresponde ao secret implantado nas Edge Functions. Todo tick do cron levava 401, ou seja, o processamento agendado da fila nunca funcionou; ela só avançava quando você mandava `/processar` no bot (aí é function→function, os dois lados leem o mesmo env e sempre batem).
2. **`notify-pending-review-daily`** — a migração `20260724000011` usava `current_setting('app.supabase_url')` e `current_setting('app.service_role_key')`, GUCs que nenhuma migração define. Na prática o job nem chegou a existir: só `process-receipts` aparecia em `cron.job`.

A `20260930000003` recria os quatro jobs lendo o segredo do Vault, o que elimina a classe inteira do problema — não há mais duas cópias do valor para divergirem.

Para conferir se os ticks estão de fato passando:

```sql
select status_code, count(*), max(created) from net._http_response group by status_code;
```
