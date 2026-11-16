# POSTZ — plano de migração Prisma isolada

> **Somente planejamento. NÃO executar no banco atual.** Este arquivo não é
> acionado pelo build, por GitHub Actions ou pelo Docker. É uma referência
> para homologação em um banco PostgreSQL descartável/restaurado.

## Fonte da comparação

Comparados os arquivos `libraries/nestjs-libraries/src/database/prisma/schema.prisma`
das branches `main` e `feat/local-ai-clipping-pilot-20261115`, em 16/11/2026.

**Resultado:** somente três campos opcionais foram acrescentados:

| Modelo | Campo novo | Tipo Prisma | Coluna PostgreSQL esperada |
|---|---|---|---|
| `Clipping` | `localStartSeconds` | `Int?` | `INTEGER NULL` |
| `ClippingClip` | `reviewState` | `String?` | `TEXT NULL` |
| `ClippingClip` | `draftIntegrationId` | `String?` | `TEXT NULL` |

Os modelos `Post`, `Media` e `Organization` permanecem idênticos.
A comparação da fonte **não prova que o banco principal esteja nesse estado**,
pois nele podem existir migrações aplicadas fora do GitHub.

## Pré-condições obrigatórias

1. Criar cópia consistente e **testar a restauração** do PostgreSQL em um
   ambiente que não compartilhe volumes nem credenciais de escrita com
   a instalação atual.
2. Inspecionar a estrutura efetiva do banco restaurado e comparar com a
   `main`. Se alguma coluna existir com tipo ou semântica diferente,
   **interromper**: não usar `IF NOT EXISTS` para esconder incompatibilidades.
3. Executar primeiro a diferença oficial do Prisma entre o esquema anterior,
   o esquema da branch e a estrutura do banco restaurado. Analisar o SQL
   gerado antes de rodá-lo.
4. Não utilizar `prisma db push --force-reset`, `prisma migrate reset`,
   `docker compose down -v`, `DROP COLUMN` ou qualquer limpeza de volumes.
5. A inicialização `pm2-run` chama `prisma-db-push`; ela **não pode** ser
   executada contra dados reais até esse fluxo estar homologado.

## Verificação inicial somente leitura (no banco restaurado)

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND table_name IN ('Clipping', 'ClippingClip')
  AND column_name IN (
    'localStartSeconds', 'reviewState', 'draftIntegrationId'
  )
ORDER BY table_name, column_name;

SELECT
  (SELECT COUNT(*) FROM "Clipping") AS clippings_antes,
  (SELECT COUNT(*) FROM "ClippingClip") AS cortes_antes;
```

A primeira consulta deve retornar **zero linhas** se o banco restaurado
corresponder à `main`; caso contrário, investigar as diferenças.

## DDL esperado para o ambiente descartável

Este trecho ilustra a modificação aditiva inferida do Prisma. Deve ser
confrontado com o `migrate diff` oficial antes da execução. **Não executar
contra o banco principal.**

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "Clipping"
  ADD COLUMN "localStartSeconds" INTEGER;

ALTER TABLE "ClippingClip"
  ADD COLUMN "reviewState" TEXT,
  ADD COLUMN "draftIntegrationId" TEXT;

COMMIT;
```

Não há `NOT NULL`, valor padrão, alteração das linhas existentes, remoção
de coluna ou índice novo. O PostgreSQL ainda precisa obter locks de esquema
durante as alterações, daí o `lock_timeout` conservador.

## Critérios de homologação (ambiente restaurado)

- Três colunas presentes, tipos esperados e `is_nullable = YES`.
- Todas as linhas antigas permanecem; as três colunas novas de linhas
  preexistentes devem estar `NULL` imediatamente após a migração.
- Quantidade de linhas de `Clipping` e `ClippingClip` preservada.
- Criação e consulta de tarefa local testadas; revisão e rascunho não
  alteram posts existentes indevidamente.
- Prisma Client gerado e API/orquestrador iniciados no ambiente isolado.
- Backup, restauração e procedimento de retorno à imagem oficial validados.

**Retorno à versão anterior:** restaurar os dados a partir da cópia
verificada se houver necessidade. Não apagar as novas colunas do banco
principal como atalho: isso poderia perder registros novos.

## Evidência existente e bloqueio restante

A comparação de código comprovou as três adições e nenhuma remoção no
`schema.prisma`. **Nenhuma migração foi executada**: o estado efetivo do
PostgreSQL da instalação atual e a restauração do backup ainda não foram
verificados. Não declarar `aprovado para implantação` com base apenas
nesta análise estática.
