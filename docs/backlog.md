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

## Resolvidos

Nada aqui por enquanto.
