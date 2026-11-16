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
