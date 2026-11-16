# POSTZ — visão do produto e estado verificável

Atualizado em 16/11/2026 · repositório Dionatanertal/postz · branch `feat/local-ai-clipping-pilot-20261115`.

## Visão

O POSTZ é uma plataforma de inteligência, produção, distribuição e otimização
de conteúdo com IA, construída sobre a base open source do Postiz. O ciclo
começa com material autorizado na biblioteca, passa por produção e revisão,
usa o editor e o calendário para distribuir com autorização e termina com
resultados que informam a próxima produção. A futura rede de clipadores é uma
expansão do produto. O MVP opera com o painel, o worker e os canais próprios do
POSTZ.

O menor fluxo integrado é **biblioteca ou upload → corte aprovado → post no
editor nativo → distribuição autorizada → estatísticas do mesmo post →
reutilização do material para nova produção**.

## Capacidades

| Capacidade | Existente no Postiz | Implementado no POSTZ | Pendente |
| --- | --- | --- | --- |
| Biblioteca inteligente | Upload, busca por arquivos, biblioteca por organização e seleção de mídia. | Clipagem por upload ou seleção de um MP4 já na biblioteca. Histórico de trabalhos no painel de clipagem. | Catálogo semântico e análise persistente de outros materiais. |
| Produção autônoma | Ferramentas de geração do Postiz e fluxo de clipagem em nuvem para YouTube, dependentes dos provedores configurados. | Whisper local, seleção automática de trechos com modelo local, título e texto inicial a partir da fala, cortes verticais com legendas e normalização de áudio, aprovação e rejeição. | Variações de título e formato orientadas a canal, com validação editorial. |
| Distribuição inteligente | Editor nativo, rascunho, calendário, agendamento, publicação e configurações por provedor. O editor de Instagram oferece Reel de Teste em canais compatíveis e o provedor trata erros de elegibilidade. | Corte aprovado gera rascunho idempotente. O cartão acompanha o estado do post e abre o post vinculado no calendário, com acesso ao editor nativo. | Homologar publicação autorizada e Reel de Teste em conta elegível. |
| Inteligência de resultados | Análises por canal e por post, conforme os dados fornecidos pela plataforma. Estatísticas de cliques quando há links rastreados e provedor configurado. O código de atribuição de cadastro do próprio Postiz tem escopo separado. | O post publicado vinculado ao corte encaminha às estatísticas nativas daquele post. O painel mostra o estado do post sem consultar provedores de métricas em segundo plano. | Confirmar métricas em contas autorizadas e vincular conversões externas rastreáveis ao conteúdo. Clique e conversão são medidas distintas. |
| Otimização contínua | Estatísticas e materiais podem ser consultados no painel existente. | O operador consulta os resultados do post e pode voltar a produzir a partir de um vídeo da biblioteca. | Transformar sinais medidos em recomendações verificáveis e validar o efeito de novas versões. |

## Evidências

- O piloto editorial obteve transcrição e cortes locais do vídeo autorizado de
  1h44. O SHA-256 do original coincidiu antes e depois do teste.
- O MVP de clipagem foi validado por navegador em ambiente descartável.
  Enviou o MP4 original de 185 MB, iniciou a análise em 00:40:00 e produziu
  dois cortes com Whisper `small-q5_1` e Qwen2.5 0.5B Instruct Q4_K_M locais.
  O primeiro corte, de 00:40:19,280 a 00:40:49,800, rendeu um MP4 de 30,533 s
  em 720×1280 com áudio normalizado. A rejeição bloqueou a criação do
  rascunho, a aprovação criou um único `DRAFT`, a repetição devolveu o mesmo
  ID e outra organização recebeu 404. Houve zero workflows de publicação.
  Os 23 testes do clipper passaram.
- Um segundo candidato abriu com uma resposta curta dependente da fala anterior.
  O filtro passou a descartar esse padrão e o ajuste foi exercitado sobre a
  transcrição real.
- O MP4 de QA está em
  `tmp/local-clipper-videoplayback/mvp-browser-approved.mp4`, ignorado pelo Git.
- A opção do piloto `select-clips.ts` conserva a ponte opcional para o
  seletor pago do Postiz. Seu teste anterior usou SDK simulado. O fluxo de
  clipagem no painel usa os modelos locais.
- O teste integrado reutilizou mídia real e estados de post sintéticos em
  uma instância descartável. Conferiu os estados no cartão, a abertura do
  rascunho no editor nativo e a abertura das estatísticas para o ID da
  publicação vinculada. O rascunho não disparou consultas de métricas.
  O cenário de publicação sem métricas exibiu o aviso nativo do Postiz.

## Avanço posterior à sincronização local (16/11/2026)

- O cartão de um corte **publicado** ganhou a opção "Ver resultados deste
  corte", integrada às APIs nativas `/analytics/post/:postId` e
  `/posts/:postId/statistics`. Exibe indicadores conforme o provedor e
  cliques de links rastreados, com escolha de 7, 30 ou 90 dias.
- As consultas são feitas **somente quando o operador abre ou atualiza** os
  resultados; rascunhos não provocam consulta de estatísticas. A informação
  permanece vinculada ao mesmo ID do post criado a partir do corte.
- Sem novo serviço, banco, automação de publicação ou API paga. Cliques não são
  classificados como leads, reuniões ou vendas.
- Código gravado e lido novamente no GitHub. **Ainda não houve execução de
  build TypeScript, teste de navegador ou homologação com conta real para essa
  melhoria após a sincronização**. Esses testes precisam ocorrer antes de
  ativar uma nova versão na instalação do usuário.

## Operação e homologação

- Limites do MVP local: MP4 de até 1 GiB e janela de até cinco minutos por
  execução. O operador escolhe o início, aprova cada corte e define o canal.
  O editor já oferece o refinamento da legenda do post, data, formato do
  canal e opções como Reel de Teste quando disponíveis.
- Para reproduzir, consulte `tools/local-clipper/README.md`. Os caminhos do
  fluxo são a biblioteca e o painel de mídia, `/clipping/local`, o workflow
  `localClippingWorkflowV1`, o editor do calendário e as estatísticas de post.
- A instalação em uso depende de autorização para receber o build da branch,
  a alteração aditiva do Prisma do MVP de clipagem e a configuração do worker
  local. A integração de distribuição e resultados reutiliza o ID do post e
  dispensa mudanças adicionais de schema.
- O próximo teste de produto, quando autorizado, é acompanhar um post real
  da aprovação às métricas disponíveis do canal e registrar quais delas
  orientam a próxima produção. Conversões exigem uma fonte de evento e um
  vínculo rastreável ao conteúdo.

## Restrições de execução

Sem deploy, migrações na instalação em uso, publicações reais ou chamadas
pagas sem autorização. Preservar `main`, a configuração Docker, os dados e
volumes existentes, as integrações Meta, as credenciais e os projetos SAMACON.
