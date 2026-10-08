# Análise Semanal e Automações Agendadas

> **Status: implementado** em `supabase/functions/analyze-expenses/` — ver o
> [README da função](../supabase/functions/analyze-expenses/README.md) para configuração e testes.
> O texto abaixo descreve o desenho; o que mudou na implementação está anotado em cada ponto.
> A concepção original supunha um backend FastAPI com APScheduler (ver
> [`docs/api-endpoints-futuro.md`](api-endpoints-futuro.md)); a arquitetura atual usa uma Edge
> Function agendada por `pg_cron`, mantendo os mesmos princípios de design.

## Análise semanal

São dois jobs de `pg_cron`, um semanal (segundas, 12:00 UTC) e outro com polling horário sobre
`scheduled_analyses`, ambos chamando a mesma Edge Function `analyze-expenses` — o primeiro com
`{"mode":"weekly"}`, o segundo com `{"mode":"followups"}`. Internamente os dois convergem para a
mesma função `runAnalysis()`, o equivalente ao `run_analysis()` do desenho original.

O modelo nunca roda SQL — nem leitura livre, nem escrita. A RPC `get_analysis_context(period_start, period_end)` pré-agrega
os dados relevantes da semana (totais por categoria, comparação com a média móvel de 4 semanas,
top merchants, split por forma de pagamento, contagem de `pending_expenses` com `needs_detail`
acumulado) e tudo vai pronto no prompt, numa única chamada — sem loop de tool calling, mais barato
e sem superfície de validação de SQL para manter. O modelo responde só com JSON estruturado; é o
worker quem interpreta essa resposta e decide o que persistir — o modelo nunca tem uma tool de
escrita direta.

**Escolha de modelo**: o desenho original previa Kimi K2. Como Gemini e Kimi falam o mesmo
protocolo (OpenAI Chat Completions), o worker tem um só caminho de código e o provedor é
configuração (`ANALYSIS_PROVIDER`). O default é Gemini, porque a chave de free tier já roda o
`process-receipts` — custo zero e nenhum destino novo para dados financeiros, o que importa sob a
restrição de LGPD registrada no [`README`](../README.md). Kimi é opt-in e pago.

O relatório é armazenado em `reports` (migração
`20260930000001_create_reports_and_scheduled_analyses.sql`), com campos estruturados —
`headline`, `changes`, `consistencies`, `taxonomy_notes`, `forward_looking`, `full_content`,
`notification_decision` (enum `silent` / `report_ready` / `observation`), `model_notes`. Itens de
`forward_looking` que pedem acompanhamento futuro (`revisit_in_days`) viram novas linhas em
`scheduled_analyses`, processadas pelo job de polling horário.

`taxonomy_notes` é um objeto estruturado desde a migração `20260930000007_create_behavior_tags.sql`
(`{kind, name, rationale, trigger_pattern?, example_merchants?, parent_category?}`; relatórios
gravados antes dessa migração guardam strings simples, e tanto `parseAnalysis` quanto a tela de
Relatórios leem as duas formas). Cada nota com `kind: 'behavior_tag'` ou `kind: 'category'` é
promovida pelo próprio worker, logo depois de salvar o relatório, a uma linha `status='candidate'`
em `behavior_tags` ou em `categories` — `'behavior_tag'` é o caso comum; `'category'` é para um
tipo de estabelecimento genuinamente ausente das categorias atuais e deve ser raro, já que venues
devem ser estáveis. Um slug já existente em qualquer status (aprovado, rejeitado ou ainda candidato
de outro relatório) não é promovido de novo, e um re-run do mesmo período substitui os candidatos
que ele próprio havia proposto em vez de duplicá-los — o mesmo padrão já usado para
`scheduled_analyses`. A tabela `expense_behavior_tags` existe desde a mesma migração, mas nada
ainda a preenche (ver `docs/backlog.md`).

Notificação via Telegram é decidida a cada execução pelo próprio `notification_decision` — não é
automática. Uma semana sem nada relevante fica `silent`; um relatório padrão pronto gera
`report_ready`; algo urgente o suficiente para não esperar gera `observation` imediata.

Categorias/tags em `status = 'candidate'` esperam aprovação humana — via `/taxonomia` no Telegram
(lista os pendentes com botões Aprovar/Rejeitar) ou pela aba "Taxonomia" do app. Os dois caminhos
chamam a mesma RPC `review_taxonomy_candidate(p_kind, p_id, p_action)` (migração
`20260930000008_review_taxonomy_candidate.sql`), que muda o `status`, grava `reviewed_at` (quando é
`behavior_tag`) e registra em `audit_log` com `source='user_manual'`. Não existe promoção
automática — a aprovação é sempre humana.

Sob demanda, `/analisar` no bot dispara o modo `weekly` na hora e `/relatorio` lê o último
relatório salvo.

```mermaid
sequenceDiagram
  participant Sched as pg_cron
  participant App as analyze-expenses
  participant D as Supabase<br />(PostgREST)
  participant K as Modelo<br />(Gemini/Kimi)
  participant T as Telegram

  Sched->>App: Trigger semanal (cron)
  App->>D: RPC get_analysis_context(period_start, period_end)
  D-->>App: jsonb pré-agregado
  App->>K: Contexto + prompt de análise semanal (uma única chamada)
  K-->>App: JSON estruturado (headline, changes, consistencies, taxonomy_notes, forward_looking, notification_decision, model_notes)

  App->>D: Insere em reports (headline, changes, consistencies, taxonomy_notes, forward_looking, full_content, notification_decision, model_notes)

  alt forward_looking contém item a investigar
    App->>D: Insere em scheduled_analyses (run_at futuro, prompt customizado)
  end

  alt notification_decision = report_ready
    App->>T: Envia "relatório semanal pronto"
  else notification_decision = observation
    App->>T: Envia observação específica
  else notification_decision = silent
    Note over App,T: Nenhuma mensagem enviada
  end
```

## Automações agendadas (follow-ups)

```mermaid
sequenceDiagram
  participant Sched as pg_cron
  participant App as analyze-expenses
  participant D as Supabase<br />(PostgREST)
  participant K as Modelo<br />(Gemini/Kimi)
  participant T as Telegram

  Sched->>App: Trigger horário (poll)
  App->>D: GET scheduled_analyses?status=pending&run_at=lte.now()
  D-->>App: Lista de análises vencidas

  loop Para cada análise vencida
    App->>D: Busca contexto necessário (conforme prompt customizado do follow-up)
    D-->>App: Dados
    App->>K: Envia prompt customizado (definido pelo próprio Kimi na análise anterior)
    K-->>App: JSON estruturado (mesmos campos)

    App->>D: Insere em reports (mesmos campos estruturados)
    App->>D: Atualiza scheduled_analyses.status = completed

    alt forward_looking contém novo item a investigar
      App->>D: Insere novo registro em scheduled_analyses
    end

    alt notification_decision = report_ready
      App->>T: Envia "relatório semanal pronto"
    else notification_decision = observation
      App->>T: Envia observação específica
    else notification_decision = silent
      Note over App,T: Nenhuma mensagem enviada
    end
  end
```
