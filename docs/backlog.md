# Backlog — Monēta

Dívida em aberto e decisões deliberadas de adiar algo. Segue a metodologia Ḫprj: arquivo versionado, atualizado no mesmo PR da mudança que gerou ou resolveu o item.

Itens são identificados pelo título, com data de início; ao resolver, ganham data de fim e vão para "Resolvidos" (não são apagados).

## Em aberto

### `expense_behavior_tags` existe mas nada a preenche
Início: 2026-10-02.

A migração `20260930000007_create_behavior_tags.sql` criou `expense_behavior_tags` (associação
N:N entre `expenses` e `behavior_tags`, com `confidence`/`reasoning`/`source`) junto com
`behavior_tags`, porque uma tabela de tags sem associação não serve para nada depois — mas nenhum
código escreve nela ainda. Aplicar um `behavior_tag` aprovado a despesas específicas (automaticamente
pela IA ou manualmente) é trabalho futuro, fora do escopo da promoção de candidatos entregue junto
com esta tabela.

### 503 isolado de "worker secret unavailable" em `net._http_response`
Início: 2026-10-13.

Durante a investigação do item "revisão de gastos por remetente" (ver "Resolvidos"), foi encontrado em
produção um registro de `net._http_response` com `status_code` indicando falha e corpo
"worker secret unavailable" (o 503 que `authorizeWorker()` devolve quando o Vault não tem o segredo —
ver a seção "O segredo do worker" no `CLAUDE.md`), datado de 2026-10-13 03:00Z, provavelmente do tick
de `process-receipts`. Ocorrência única até agora, sem recorrência observada nas chamadas vizinhas.
Fica registrado para observar se volta a ocorrer; investigar a causa raiz (rotação do Vault em voo?
isolate reciclando no momento exato do tick?) é trabalho futuro, fora do escopo desta mudança.

## Resolvidos

### Lembrete diário e `/revisar` concordam sobre o que é "revisável"
Início: 2026-10-13. Fim: 2026-10-13.

`notify-pending-review` contava `pending`+`waiting_user` sem filtrar por remetente e avisava sempre o
mesmo chat fixo (`TELEGRAM_ALLOWED_CHAT_IDS[0]`); `/revisar` listava só `waiting_user` do chat que
pediu. Os dois conjuntos nunca se cruzavam — por isso o lembrete dizia "10 para revisar" e `/revisar`
respondia "nada a revisar" para o mesmo usuário. A RPC `get_pending_review_queue()` (migração
`20260930000009`) passa a ser a única definição de "revisável" (`waiting_user`+`error`, opcionalmente
por remetente), usada pelos dois lados; o lembrete agora manda uma mensagem por remetente com a
contagem daquele remetente, e `/revisar` passa a alcançar também as linhas `error` (antes inatingíveis
por qualquer um dos dois caminhos), com um card reduzido e um botão de "tentar de novo".
