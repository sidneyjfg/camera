# CasaView

Painel local de câmeras IP para Windows 11. A interface React/Vite conversa com uma API Node local; a API realiza WS-Discovery ONVIF na porta UDP 3702, consulta credenciais/capacidades e provisiona os streams RTSP no MediaMTX. A imagem chega ao navegador por HLS sem transcodificação solicitada pelo CasaView. HLS tem mais latência que WebRTC, mas segue a integração de player já implementada.

## Requisitos

- Windows 11 x64 ou ARM64 e Node.js LTS
- MediaMTX Windows amd64/arm64 (binário oficial, baixado separadamente)
- Câmeras e computador na rede local; multicast WS-Discovery permitido pelo firewall/segmento de rede

## Primeira execução

1. No PowerShell, na pasta do projeto:

   ```powershell
   npm install
   Copy-Item .env.example .env
   Copy-Item mediamtx.example.yml mediamtx.local.yml
   ```

2. Baixe o MediaMTX na página oficial de releases: <https://github.com/bluenviron/mediamtx/releases> e extraia `mediamtx.exe` nesta pasta.

3. Inicie o MediaMTX em um PowerShell:

   ```powershell
   .\mediamtx.exe .\mediamtx.local.yml
   ```

   A configuração mantém HLS, WebRTC, RTSP e a API de controle apenas em `127.0.0.1` (RTMP e SRT desligados). CasaView usa a API (`:9997`) para adicionar/remover paths sem gravar URLs RTSP em YAML, e o navegador recebe o vídeo por `/media`, servido pelo backend somente com login. Não altere esses endereços para `0.0.0.0`: isso deixaria o vídeo acessível a toda a rede sem senha. Se você já tinha um `mediamtx.local.yml`, copie as linhas de endereço de `mediamtx.example.yml` e reinicie o MediaMTX.

4. Em outro PowerShell, inicie backend e frontend juntos:

   ```powershell
   npm run dev
   ```

   Abra o endereço local indicado pelo Vite, normalmente `http://localhost:5173`. O backend permanece em `127.0.0.1:3001`. `npm run build` gera os arquivos de frontend em `dist`; a API local continua necessária durante o uso.

## Senha do painel

- No primeiro acesso, o painel pede para **criar a senha** (12 a 128 caracteres; prefira uma frase longa). Isso só funciona neste computador: uma requisição que chegue por túnel ou proxy reverso é recusada.
- A senha é guardada apenas como hash scrypt, cifrado por DPAPI, em `%APPDATA%\CasaView\auth.dpapi`. A sessão dura 7 dias, vale por cookie `HttpOnly`/`SameSite=Strict` e é encerrada em **Sair** ou ao reiniciar o backend.
- Após 3 senhas erradas o login passa a bloquear por tempo crescente (5 s, 10 s, … até 15 min). O bloqueio vale para todos, porque atrás de um túnel o IP real não é confiável.
- **Esqueceu a senha?** Feche o CasaView, apague `%APPDATA%\CasaView\auth.dpapi` e abra o painel de novo para criar outra. Não há recuperação por e-mail. Também não há tela para trocar a senha; o mesmo procedimento serve.
- O monitoramento de IA se identifica ao backend com o token de `%APPDATA%\CasaView\servico.token` (criado automaticamente), que só libera as quatro rotas que ele usa. Não compartilhe esse arquivo.
- `npm test` executa os testes de autenticação.

## Adicionar câmeras

- Clique **Buscar câmeras** para enviar WS-Discovery. Dispositivos que não respondem ao multicast não aparecem; a busca mostra apenas equipamentos que responderam. Nome e hardware vêm dos scopes ONVIF disponíveis, então podem estar incompletos.
- Se uma câmera não anunciar WS-Discovery, `CASAVIEW_DISCOVERY_HOSTS` no `.env` permite consultar diretamente os endereços locais selecionados nos serviços ONVIF comuns (`8899,80` por padrão). Essa verificação só apresenta candidatos na tela; não cadastra câmeras. O formulário pede usuário e senha e o cadastro exige teste de conexão.
- Clique **Configurar**, informe usuário/senha e pressione **Testar conexão**. A API autentica no serviço ONVIF, consulta informações, capacidades, perfis e tenta obter uma URI RTSP via Media. Se uma URI for retornada, a API testa a mídia pelo MediaMTX antes do cadastro.
- Se não houver descoberta ou URI automática, use **Adicionar câmera**, desmarque ONVIF quando necessário e informe o host e endereço RTSP. O teste RTSP exige o MediaMTX em execução com a API ativada na configuração acima.
- A senha fica num arquivo cifrado por DPAPI para o usuário Windows atual em `%APPDATA%\CasaView\cameras.dpapi`. O navegador nunca recebe a senha nem a URL de origem autenticada. Em **Editar**, senha e URL RTSP em branco mantêm os valores salvos; para trocar credenciais, informe usuário e senha novos.
- **Minhas câmeras** atualiza o estado periodicamente, permite editar/remover, retestar e consultar novamente capacidades ONVIF.

## Limites de rede e compatibilidade

WS-Discovery usa multicast UDP 3702 e depende do adaptador/rede local permitir multicast; roteadores, VLANs e firewall podem bloquear a busca. Um serviço/porta ONVIF acessível não garante que a câmera anuncie WS-Discovery. Nesses casos, cadastre pelo formulário manual.

O stream HLS é remultiplexado pelo MediaMTX. Não há transcodificação configurada. H.264 é o formato mais compatível; H.265 pode depender do navegador. A reprodução HLS costuma ter alguns segundos de atraso. O código não consulta nem afirma recursos ONVIF que não tenham sido respondidos pelo dispositivo.

Não abra portas no roteador. A API de controle MediaMTX e o backend são limitados a localhost; mantenha o painel local neste MVP. O serviço de vídeo é para consumo pelo CasaView local.

## Validação

Execute `npm run build` para verificar o frontend. Para validar hardware real, inicie MediaMTX e CasaView, busque/adicone as câmeras, confira o teste RTSP e a reprodução no navegador. A descoberta e os streams dependem da rede e de credenciais fornecidas localmente; nenhuma conexão física é presumida. CPU/RAM não foram medidos.
