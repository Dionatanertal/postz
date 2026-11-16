# POSTZ — Porta de homologação e implantação (16/11/2026)

> Status: **NÃO HOMOLOGADO PARA IMPLANTAÇÃO NA INSTALAÇÃO PRINCIPAL**.
> Este documento separa evidências verificadas de pendências. Não é uma ordem
> para executar comandos no computador do usuário.

## Situação de origem

- Repositório pessoal: `Dionatanertal/postz`.
- Branch isolada: `feat/local-ai-clipping-pilot-20261115`.
- A instalação atual roda a imagem oficial `ghcr.io/gitroomhq/postiz-app:latest`
  e utiliza PostgreSQL, Redis e armazenamento local persistente.
- O build do MVP foi compilado pelo Codex no Windows e a clipagem integrada foi
  exercitada em ambiente descartável. A exportação/carregamento de uma imagem
  de release foi interrompida pelo esgotamento do disco C:.
- A tela de indicadores foi testada com dados simulados; **não existe ainda
  comprovação de métricas reais, conversões ou publicação em canais reais**.
- Foram mostradas edições locais em
  `tmp/postz-toolchain/linux-release/qa-data.cjs`,
  `tmp/postz-toolchain/linux-release/migration.sh` e
  `POSTZ_EXECUTION.md`. Os arquivos em `tmp/` são ignorados pelo Git:
  **não são parte do release remoto**. Não recriar, substituir ou apagar
  esses arquivos sem recuperar e conferir seu conteúdo original.
- O Docker Desktop chegou a parar de responder; a recuperação de armazenamento
  deve ser tratada separadamente da evolução do código.

## Impedimentos objetivos

1. **Banco de dados:** o script `pm2-run` em `package.json` executa
   `pnpm run prisma-db-push` na inicialização. Portanto, iniciar uma imagem
   personalizada contra o banco atual pode modificar o esquema automaticamente.
   Conferir diferenças e migrações num banco restaurado/descartável antes de
   qualquer troca de imagem. Fazer backup consistente, testar restauração e
   obter autorização explícita antes de apontar o release para dados reais.
2. **Orquestração:** o fluxo usa `localClippingWorkflowV1` no Temporal. A
   inicialização de um workflow e as transições de agendamento não podem ser
   consideradas homologadas até serem observadas em Temporal isolado,
   inclusive falha e repetição. Não ativar uma publicação real no teste.
3. **Empacotamento:** a imagem final contendo FFmpeg, renderização de legendas,
   Python, whisper.cpp/llama.cpp e modelos locais precisa ser validada com
   limites de espaço e tempo. O build simples de frontend/backend/orquestrador
   não demonstra a presença dessas dependências dentro do contêiner.
4. **Capacidade:** não repetir builds Docker no disco C: do operador. O espaço
   em disco e os artefatos temporários precisam de limite definido antes de
   iniciar qualquer ambiente remoto de homologação. Evitar workflows Actions
   automáticos e custos de serviços não autorizados.
5. **Integrações reais:** autenticação de canais, publicação autorizada,
   Reel de Teste, métricas, leads e atribuição de conversões exigem suas
   próprias permissões e fontes de dados. Nenhuma destas capacidades deve
   ser apresentada como comprovada por respostas simuladas.

## Correções de robustez revisadas remotamente

- O contexto Docker foi restringido no `.dockerignore` para **não incorporar**
  `tmp/`, arquivos de vídeo, pesos locais de IA, relatórios de teste,
  arquivos `.env` nem `docker-compose*.yaml`. Este filtro reduz a chance
  de copiar material privado e artefatos grandes para cada imagem. **Não
  resolve por si só o cache de camadas do Docker Desktop**.
- A tela de resultados foi corrigida para impedir que uma requisição antiga
  substitua dados de um período mais novo após uma troca rápida entre
  7, 30 e 90 dias.
- As alterações foram lidas novamente no GitHub. **Não houve build, teste
  de navegador nem alteração dos contêineres locais nesta rodada**.
- A branch contém alterações remotas que ainda precisarão ser conciliadas
  com os arquivos locais não enviados do Codex antes do próximo deploy.
- Nenhuma GitHub Action foi iniciada por esta rodada, conforme consulta
  à lista de execuções para a branch.

## Integridade e limitação de disco adicionadas (16/11/2026)

- Na falha ou repetição do processamento, os MP4s enviados e **não
  referenciados no banco** são eliminados do armazenamento de mídia. O
  código consulta as referências persistidas antes de excluir para preservar
  os arquivos de transações que possam ter sido concluídas apesar de falha
  no retorno ao worker.
- O caminho temporário da clipagem pode ser configurado com
  `LOCAL_CLIPPING_TMP_DIR` (diretório preexistente, gravável e montado).
  O worker recusa um novo trabalho se o filesystem temporário não tiver
  **2 GiB disponíveis**.
- Antes de gravar os cortes finais no armazenamento permanente, o worker
  soma o tamanho real dos arquivos gerados e exige espaço suficiente para
  copiá-los e ainda preservar **1 GiB livre** no volume de mídia.
- Um post vinculado excluído não pode ser interpretado como um rascunho
  válido, e a tela explica por que outro rascunho não é criado
  automaticamente.
- São verificações de proteção pontuais, **não um limite total para
  Docker, cache de build ou vídeos já armazenados**. Ainda não foram
  executados build, testes automatizados ou homologação após essas
  alterações. Devem constar na bateria de testes em ambiente isolado.
- Para o teste de regressão, exercitar espaço temporário insuficiente,
  espaço de mídia insuficiente, commit de clipagem bem-sucedido com
  perda de resposta, upload órfão, post vinculado excluído e tentativa de
  duplicar o rascunho original.

## Regressão sem Docker — executada em ambiente isolado (16/11/2026)

- As verificações de reserva de capacidade e de preservação de uploads
  persistidos foram extraídas para
  `libraries/nestjs-libraries/src/database/prisma/clipping/local.clipping.safety.ts`
  e integradas ao serviço de clipagem.
- Criados seis testes offline em
  `tools/local-clipper/tests/local-clipping-safety.test.mjs`.
  Execução com Node.js 22.16.0 e `--experimental-strip-types`: **6 testes
  passaram, 0 falharam**. O helper também passou na checagem `tsc --noEmit
  --skipLibCheck --target es2022 --module commonjs --strict`.
- A equivalência dos dois arquivos testados com os conteúdos versionados
  no GitHub foi verificada pelo hash de blob Git, respectivamente
  `da28fb06358221ac894744ed7462830e3a7e8585` e
  `051cbd503305daabb4d4b125abc1a568aed939f7`.
- Os testes verificam limites de espaço, dados inválidos, retenção de
  arquivos já comprometidos no banco e remoção apenas de caminhos órfãos.
  **Não testam o serviço NestJS, persistência Prisma, FFmpeg, integração
  Temporal nem o build completo**. Essas pendências permanecem no aceite.
- A execução ocorreu fora do computador do usuário, sem Docker nem
  qualquer chamada de serviço paga ou publicação.

## Pré-instalação do worker e testes offline (16/11/2026)

- Criado o comando de diagnóstico **somente leitura**
  `node tools/local-clipper/preflight.mjs`. Ele verifica arquivos dos
  modelos, ferramentas de linha de comando, codecs e legendas do FFmpeg,
  permissões dos diretórios e capacidade dos volumes de mídia e scratch.
  Não instala nem baixa componentes e não imprime segredos.
- Criados seis cenários simulados de pré-instalação em
  `tools/local-clipper/tests/preflight.test.mjs`.
- **Execução realizada fora do computador do usuário:** Node.js 22.16.0,
  `node --experimental-strip-types --test` nos dois arquivos de testes
  de segurança e de pré-instalação: **12 testes passaram, 0 falharam**.
  O comando de pré-instalação também foi executado no ambiente isolado sem
  configuração, retornando `ok: false` conforme esperado.
- Os dois arquivos novos foram comparados por hash Git de conteúdo com o
  remoto: `preflight.mjs` = `a59d80fb7e43321a07bb6c7a012cfd531a07b3da`,
  `preflight.test.mjs` = `d46f8c27b8c96e99b95fd99de7b943775437bf0c`.
- **Pendente:** executar esse comando no contêiner de release efetivo,
  observar o Temporal, completar o build integrado e restaurar um backup
  de banco em ambiente separado. Um resultado do preflight não prova
  o funcionamento dos modelos ou do sistema em produção.

## Falhas do Temporal — tratamento e testes isolados (16/11/2026)

- A atividade de clipagem não deve parecer bem-sucedida quando o serviço
  registrou `failed` no banco. Os caminhos de falha (modelo local, mídia
  inválida, armazenamento insuficiente, transição encerrada ou erro de
  persistência) agora rejeitam a execução do worker e são repassados ao
  workflow.
- O workflow executa `runClippingWithFailureReport`: tenta persistir a
  falha via atividade `failLocalClipping`, **sem ocultar o erro original**
  quando a gravação do estado é bem-sucedida. Se a gravação falhar, o
  workflow também permanece com erro.
- Criados testes offline em
  `tools/local-clipper/tests/local-clipping-outcome.test.mjs`.
  **4 testes passaram, 0 falharam**, executados com Node.js 22.16.0 e
  `--experimental-strip-types`. O helper TypeScript também passou com
  `tsc --noEmit --skipLibCheck --strict --target ES2022 --module ESNext`.
- Os arquivos testados foram confrontados com o conteúdo remoto via hash Git:
  helper `3701fb16a5ecb7eb36ec942bf85f0c40e6014532`, testes
  `7afa0caa527d261564a3c60d35d9038bfbb2eba6`.
- **Limite da evidência:** os testes cobrem as transições das funções puras
  com callbacks simulados. Ainda é necessário executar o workflow completo
  no Temporal isolado, validar timeouts/cancelamentos, observar estado
  `FAILED` no histórico e conferir a consistência do status no Prisma.
  Não houve GitHub Action, build Docker ou publicação.

## Intake de mídia e validação remota manual (16/11/2026)

- O serviço de clipagem confirma a presença do arquivo físico
  da biblioteca e seu tamanho antes de criar uma tarefa no Temporal.
  Arquivos ausentes, vazios ou acima do limite de **1 GiB** não geram
  processamento. A interface também bloqueia o upload de arquivos
  vazios ou acima desse limite antes da transferência.
- A função pura `isValidLocalClippingSourceSize` e sua regressão
  foram adicionadas ao conjunto de testes de proteção. O serviço faz
  ainda `stat` real do caminho local; este acesso ao filesystem
  permanece pendente de teste integrado com um volume montado.
- Os arquivos `local.clipping.safety.ts` e
  `local-clipping-safety.test.mjs` foram executados em ambiente
  isolado, com correspondência exata dos hashes Git
  `27836e1e94bb49547b516bb1848cc2f7cd1fa2a4` e
  `af32fe21f2de9dfcd9fb7e810d7e0644081aa482`.
  **7 testes aprovados**, TypeScript isolado válido.
- O conjunto completo de segurança, pré-instalação e propagação
  de erros do Temporal foi executado com Node.js 22.16.0,
  `node --experimental-strip-types --test`:
  **17 testes aprovados, 0 falhas**. Os arquivos de preflight e
  outcome usados tinham hashes Git idênticos aos objetos remotos.
- Criado o workflow `.github/workflows/postz-offline-qa.yml`,
  **somente `workflow_dispatch`**, com `contents: read`,
  `timeout-minutes: 6` e execução apenas de testes offline.
  O arquivo YAML foi analisado em ambiente isolado; hash Git
  `8fdd6f2f7e3d2e26b01697aaf4c5b9c12099c422`.
  **O workflow manual de QA não foi acionado.** Contudo, o workflow
  `Build` preexistente disparou duas vezes automaticamente por `push`
  nesta branch. A execução
  [43928619406](https://github.com/Dionatanertal/postz/actions/runs/43928619406)
  concluiu `success` em `280ded2`: dependências instaladas e
  `pnpm run build` aprovado. A segunda execução,
  [43929398371](https://github.com/Dionatanertal/postz/actions/runs/43929398371),
  também concluiu `success` em `1aebed8`.
  **Ambos os builds completos passaram.**
  Para evitar novos custos não planejados, o `.github/workflows/build.yml`
  **na branch isolada** foi alterado para limitar eventos automáticos
  de `push` à branch `main`; o workflow de QA continua apenas manual.
  A alteração não modifica a `main`.
- O fluxo manual não instala dependências do POSTZ, não usa Docker,
  não baixa modelos e não modifica esquemas, dados ou canais sociais.
  **Não comprova** compilação do monorepo, integração real do Temporal,
  migrações Prisma, integridade de vídeos grandes ou readiness da
  imagem final. Tais portas de liberação continuam abertas.

## Critério mínimo de aceite

- [x] Código do MVP versionado em branch independente.
- [x] Teste anterior de clipagem real, revisão, rejeição e rascunho único em
      ambiente descartável, conforme evidências em `POSTZ_EXECUTION.md`.
- [x] Ligação dos cortes aprovados ao calendário e às APIs nativas de
      estatísticas, com consulta sob demanda.
- [ ] Últimas mudanças locais do Codex recuperadas, revisadas e reconciliadas
      com a branch remota sem descartar nada.
- [ ] Build da imagem final em ambiente isolado, com orçamento de disco.
- [ ] Imagem inspecionada para dependências locais e ausência de credenciais.
- [ ] Migração aditiva aplicada e revertida **em banco descartável/restaurado**,
      com conferência dos dados preexistentes.
- [ ] Workflow Temporal registrado, iniciado, observado e concluído no teste;
      agenda e post continuam com o mesmo vínculo sem publicar em redes reais.
- [ ] Pós-deploy testado em ambiente de homologação com UI e APIs funcionais.
- [ ] Backup restaurável, plano de rollback e concordância expressa antes da
      troca da imagem ou das alterações no banco principal.

## Padrão remoto primeiro

- Fazer correções e revisões na branch de desenvolvimento no GitHub.
- Não usar `git reset --hard`, `git clean -fd`, `docker system prune --volumes`
  nem `docker compose down -v` para preparar testes.
- Sem atualização automática da instalação principal, sem migração em produção,
  sem início de GitHub Actions pagos e sem publicação real antes de autorização.
- Uma versão do código no GitHub **não equivale** a um backup dos uploads,
  credenciais e volumes. Essas cópias são realizadas e verificadas à parte.

## Próximo marco

Validar pacote, migração e Temporal em infraestrutura isolada **com recursos
controlados**, sem usar o disco C: como ambiente recorrente de build.
Somente então apresentar um parecer de `pronto para implantação` com evidências
e procedimento de retorno à versão oficial.
