# POSTZ — entrega operacional única (estado em 15/11/2026)

Este documento substitui listas de tarefas extensas. Não cria outro produto,
repositório ou plano paralelo. Atualizar **este arquivo** a cada marco
validado, sem ampliar o escopo antes da primeira entrega operacional.

## Objetivo v1 (definição de pronto)

**Um vídeo autorizado entra pelo POSTZ; a IA identifica trechos com sentido,
gera cortes verticais e legendados; o operador aprova; o POSTZ publica por uma
conta conectada com autorização; a publicação e suas métricas ficam rastreáveis.**

Não inclui no v1: criar contas de redes sociais, disparar conteúdo em massa,
simular influenciadores, comercializar SaaS, agentes temáticos independentes,
fazer deploy não autorizado ou mudar o fluxo da SAMACON.

## Evidências e estado verificável

| Capacidade | Estado | Evidência |
| --- | --- | --- |
| Código da base instalado no repositório pessoal | Localizado, sem deploy novo | Dionatanertal/postz, branch main |
| Triagem de vídeo local curto/vertical | Implementado em branch isolada | tools/local-clipper/intake.py |
| Renderização e normalização de áudio | Teste real executado | 3 cortes verticais H.264/AAC de arquivo de 1h44 |
| QA técnico de vídeo exportado | Testado | 6 testes unitários aprovados; 3 cortes reais aprovados tecnicamente |
| Fluxo de clipagem local com transcrição | Código piloto, não validado ponta a ponta | tools/local-clipper/clip.py; faster-whisper ausente no ambiente de teste |
| Seleção semântica e legendagem precisas | Não homologado | requer transcrição real, avaliação de trechos e correção das falas |
| Revisão/aprovação dentro do Postiz | Não implementado | não confundir manifest local com interface integrada |
| Publicação via conta e dados reais de alcance | Não validado | depende das autorizações de cada rede social e teste real |

A amostra de 1h44 fornecida pelo usuário foi usada para testes técnicos, mas
**os cortes não foram escolhidos semanticamente**. Não chamar isso de IA
clipadora pronta nem de homologação comercial.

## Próximo trabalho prioritário e único

Fechar a **seleção semântica a partir da transcrição** de um trecho real do
vídeo longo; medir se a seleção conserva frases e contexto e testar o render
automaticamente. Depois integrar ao painel existente do Postiz com aprovação
humana. Reutilizar funcionalidades nativas antes de escrever serviços próprios.

O código já contém um fluxo de clipagem original baseado em YouTube/RunPod,
Deepgram, R2 e OpenAI. O piloto local é isolado justamente para não romper
a operação existente e para testar processamento em máquina local antes
de contratar serviços pagos. Não substituir o fluxo original sem validação.

## Restrições de execução

- Repositório: **Dionatanertal/postz**, nunca alcancehub-wq ou Samacon.
- Branch: **feat/local-ai-clipping-pilot-20261115**; main intacta.
- Não houve alteração na instalação do computador do usuário.
- Sem deploy, ações pagas, publicação automática ou acesso a contas sociais.
- Verificação técnica não é aprovação editorial.
- Um marco só é concluído mediante evidência e resultado observável.
