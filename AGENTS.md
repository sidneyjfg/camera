# Instruções ao Codex — CasaView

## Antes de agir

1. Leia `CONTEXTO_CASAVIEW.md` e este `AGENTS.md`.
2. Inspecione a estrutura e os arquivos **reais** do repositório antes de sugerir ou implementar mudanças.
3. Resuma o estado atual: funcionalidades encontradas, dependências, comando de inicialização e possíveis problemas.
4. Diferencie explicitamente **implementado**, **testado** e **planejado**; não presuma que o plano já foi concluído.

## Diretrizes obrigatórias

- Aplicação **web** e execução **nativa no Windows 11**.
- **Não exigir Docker, Docker Compose, WSL, virtualização ou alterações na BIOS.**
- Preservar a base de código já construída; evitar reescritas sem necessidade.
- Priorizar baixo consumo de RAM e CPU, simplicidade e estabilidade.
- Frontend com design moderno, clean e minimalista.
- Nunca colocar credenciais reais das câmeras no frontend, Git ou logs.
- Usar as três câmeras locais como referências de teste, sem hardcode permanente dos IPs.
- As APIs e serviços de vídeo devem operar na rede local por padrão, sem exposição pública automática.

## Arquitetura e integração

- Respeitar o stack já existente; preferências planejadas: React + TypeScript no frontend e Node.js no backend.
- Vídeo: câmera RTSP -> MediaMTX para Windows -> navegador via WebRTC/HLS, conforme a implementação.
- ONVIF: descoberta WS-Discovery e, se compatível, mídia, eventos e PTZ em etapas posteriores.
- Fallback de cadastro manual para câmeras que não responderem à descoberta.
- Evitar transcodificação desnecessária e múltiplos fluxos redundantes.
- Se depender do `mediamtx.exe`, identificar o caminho esperado, como baixar da fonte oficial, configurar e iniciar sem Docker.

## Método de trabalho

- Trabalhar de modo incremental: primeiro garantir um fluxo completo funcional, depois ampliar.
- Antes de adicionar pacotes, avaliar se as dependências existentes atendem.
- Incluir tratamento de erros e instruções simples de execução no Windows.
- Após mudanças, executar testes disponíveis e reportar o que não foi possível verificar.
- Não apagar configurações locais nem sobrescrever arquivos sensíveis sem autorização.
- Registrar brevemente as alterações, os arquivos afetados e como testar.
- Atualizar `CONTEXTO_CASAVIEW.md` somente com informações verificadas ou decisões explicitamente confirmadas.

## Primeiro pedido ao abrir o projeto

> Leia `AGENTS.md` e `CONTEXTO_CASAVIEW.md`, analise todo o código existente e me diga o estado real do CasaView: o que já está implementado, como iniciar nativamente no Windows 11 sem Docker/WSL, o papel e o caminho do `mediamtx.exe`, e qual é o menor teste possível para confirmar uma câmera no dashboard. **Não reescreva nem acrescente funcionalidades antes desse diagnóstico.**
