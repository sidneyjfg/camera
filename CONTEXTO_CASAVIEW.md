# CasaView — Contexto do projeto para o Codex

> Documento de continuidade. Leia junto com o código existente. O conteúdo abaixo descreve decisões e testes relatados pelo usuário; **não presume que todas as funcionalidades já foram implementadas**.

## Objetivo

Criar uma aplicação **web**, moderna, clean e minimalista para monitoramento de câmeras IP da residência, substituindo o uso cotidiano do iCSee e do VMS no Windows 11. Prioridades: estabilidade, baixo consumo de RAM, facilidade de uso, segurança e evolução incremental.

## Ambiente e restrições

- Computador: Windows 11.
- **Não utilizar Docker, Docker Compose nem WSL**. Não exigir virtualização ou alterações na BIOS.
- Executar serviços nativamente no Windows.
- Acesso pelo navegador no PC e, futuramente, por outros dispositivos na rede local.
- Preferir inicialização simples, por exemplo um script `iniciar.bat` (validar o que já existe no repositório).

## Câmeras existentes

São três câmeras compatíveis com iCSee, acessíveis no VMS pela rede local e por credenciais configuradas pelo usuário:

| Local | IP na rede local | Observação |
|---|---|---|
| Cachorros / frente / fundos | `192.168.15.3` | Câmera testada diretamente; associação exata IP/local deve ser confirmada |
| Outra câmera | `192.168.15.9` | Aparece no VMS; protocolos ainda não testados individualmente |
| Outra câmera | `192.168.15.12` | Aparece no VMS; protocolos ainda não testados individualmente |

Não fixar esses IPs no código: são referências para teste e podem mudar. O usuário deve conseguir descobrir, cadastrar e renomear câmeras.

### Testes realizados com 192.168.15.3

No PowerShell, `Test-NetConnection <IP> -Port <porta>` retornou `TcpTestSucceeded : True` para:

- `8899` — porta configurada no VMS para ONVIF.
- `34567` — porta TCP usada por alguns equipamentos da família DVRIP.
- `554` — RTSP.
- `80` — HTTP.

`Test-NetConnection 192.168.15.3` também retornou `PingSucceeded : True`.

**Teste decisivo:** o usuário conseguiu visualizar a imagem dessa câmera no **VLC via URL RTSP**, com credenciais próprias. Portanto, a transmissão RTSP dessa câmera está confirmada. Não incluir senhas reais neste documento, no repositório ou em logs.

Para as câmeras `.9` e `.12`, o VMS permite acesso e o usuário espera que funcionem, mas compatibilidade RTSP/ONVIF específica ainda não foi comprovada.

## Arquitetura planejada

- Frontend: **React + TypeScript** (Vite, se já utilizado no repositório).
- Backend: **Node.js** para descoberta, gerenciamento, autenticação e integração com serviços locais.
- Vídeo: RTSP das câmeras como origem; **MediaMTX nativo para Windows** como ponte para reprodução no navegador (WebRTC e/ou HLS, conforme suporte e implementação).
- ONVIF: descoberta WS-Discovery, capacidades, perfis de mídia e, depois, controles compatíveis.
- Persistência local leve; avaliar a solução já escolhida no projeto antes de alterar.
- Não transcodificar quando desnecessário; evitar abrir múltiplas conexões e gastar RAM sem necessidade.

**Nota:** a necessidade do `mediamtx.exe` depende da implementação atual; no plano arquitetural escolhido, é o componente de distribuição do vídeo para o navegador. O executável deve ser obtido de uma versão oficial e ser iniciado pelo projeto conforme a configuração real.

## Interface e experiência de uso

- Aparência limpa, moderna, minimalista, responsiva e com pouca distração visual.
- Dashboard dinâmico com cartões de câmeras, estado online/offline e visualização ampliada.
- Não deixar apenas três câmeras fixas: permitir adicionar mais sem mudar o código.
- Nomear câmeras de forma amigável: por exemplo, **Cachorros**, **Frente da casa**, **Fundos da casa**.
- Priorizar desempenho; evitar animações pesadas e vídeo ativo fora da área visível quando isso fizer sentido.

## Descoberta e cadastro

A experiência desejada é:

1. Abrir **Minhas câmeras** e clicar em **Buscar câmeras**.
2. O backend tenta descoberta via **ONVIF WS-Discovery (UDP 3702)** na rede local.
3. Exibir os dispositivos encontrados sem duplicar os já cadastrados.
4. Permitir selecionar, informar nome, usuário e senha, testar acesso e salvar.
5. Consultar capacidades ONVIF e tentar obter URI RTSP via serviço de mídia.
6. Se não houver descoberta ou URI disponível, permitir **cadastro manual** com IP, porta e RTSP.
7. Persistir as configurações e carregar as câmeras no dashboard após reiniciar.

A porta 8899 aberta **não garante** resposta à descoberta ONVIF; ter fallback manual é requisito.

## Segurança

- Não inserir credenciais reais de câmeras em código, README, prompts, logs nem respostas públicas.
- Não retornar senhas ou URL RTSP com senha em APIs do frontend.
- Armazenar credenciais com proteção apropriada ao Windows sempre que viável; documentar qualquer limitação.
- Não abrir acesso externo à internet por padrão; priorizar rede local.
- Evitar exibir credenciais em mensagens de erro ou diagnósticos.

## Escopo por etapas

**MVP:** execução nativa no Windows; dashboard web; cadastro manual e/ou descoberta ONVIF; reproduzir pelo menos uma câmera funcional; persistência; mensagens claras de erro; iniciar e parar serviços facilmente.

**Próximas versões:** melhorar cadastro e descoberta, controle ONVIF/PTZ se suportado, configurações de imagem e eventos; monitoramento dos cachorros; IA/Roboflow para detecção de pessoas e animais; notificações relevantes. Não implementar IA prematuramente.

## Situação atual do desenvolvimento

O usuário informou que **o Codex já desenvolveu uma versão do CasaView**, mas ainda estava iniciando os testes. O Codex solicitou baixar `mediamtx.exe`. **Não assumir que o sistema está testado ou que as funcionalidades estão prontas**: conferir código, scripts, dependências, funcionamento de reprodução, cadastro e persistência antes de propor alterações.

### Verificações e decisões em 2026-10-30

- A tela de descoberta foi ajustada visualmente; a busca não cadastra dispositivos por conta própria. Cada resultado exige ação do usuário, autenticação e teste antes de salvar.
- A descoberta ONVIF foi ampliada para aceitar ProbeMatches sem `Scopes` e consultar, adicionalmente, endpoints ONVIF nos hosts/portas locais definidos em `.env` (`CASAVIEW_DISCOVERY_HOSTS`, `CASAVIEW_DISCOVERY_PORTS`). O código não contém os IPs locais como defaults.
- Testes TCP feitos do computador CasaView: `.3`, `.9` e `.12` responderam em 80, 8899 e 554. `.2` não respondeu nessas três portas. Isso confirma somente conectividade TCP, não autenticação ONVIF nem stream.
- A lista de endereços de `.env` serve apenas de alvo de busca; não cria cadastros persistentes. O usuário fará a busca pelo painel e informará login e senha por câmera.
- Ao revisar o formulário de configuração, foi corrigida a leitura da resposta `GetStreamUri` do `node-onvif` 0.1.x: a URI vem envelopada em `data.GetStreamUriResponse.MediaUri.Uri`. O campo RTSP agora é ocultado no fluxo ONVIF e aparece como alternativa manual recolhida; nenhuma câmera foi cadastrada durante a alteração. A compilação ainda precisa ser verificada.
- Em seguida, os logs do navegador mostraram `500` e a queda da API durante o teste. A inspeção do `node-onvif` 0.1.x encontrou uma chamada inválida de `getCapabilities({ Category: 'All' })`: o método aceita só callback opcional e a chamada podia gerar rejeição não tratada. Corrigido para `getCapabilities()` e a extração agora segue o wrapper SOAP real. Verificar compilação; autenticação contra câmera ainda depende do teste do usuário.
- O próximo erro foi `MediaMTX API indisponível`. Verificado no computador: `mediamtx.local.yml` habilita API em `127.0.0.1:9997`, mas o processo MediaMTX não estava ativo; iniciado manualmente com `mediamtx.exe mediamtx.local.yml`, a API respondeu em `/v3/config/paths/list` com lista vazia. `iniciar.bat` agora verifica essa API, inicia o MediaMTX com a configuração local quando necessário e espera a API antes de iniciar CasaView. Isso não adiciona câmeras nem paths de streams.
- A busca mostrou os três dispositivos locais; o usuário adicionou `192.168.15.12` e o card aparecia offline. Diagnóstico local confirmou que a câmera e o path MediaMTX existem; a rota HLS envia redirecionamento para `/<path>/index.m3u8?cookieCheck=1`. Como o frontend está sob Vite e a origem HLS passa por `/media`, esse redirecionamento perdia o prefixo e o Vite retornava `index.html` em vez da playlist. `vite.config.ts` agora reescreve o cabeçalho `Location` para manter `/media`; verificado que o endpoint via proxy devolve `application/vnd.apple.mpegurl` com `#EXTM3U`, e o path MediaMTX marca `ready` com bytes recebidos. A compilação ainda precisa ser confirmada; não foi criada câmera nova.

### Monitoramento local com RF-DETR e Supervision

- Foi implementada a integração inicial em `ia/monitoramento.py`: processo Python separado que lê apenas os streams RTSP locais do MediaMTX, analisa quadros com RF-DETR Nano, acompanha objetos com ByteTrack/Supervision e envia eventos de pessoa/animais ao backend local. As credenciais de câmera não são lidas pelo worker.
- `ia/configuracao.json` concentra classes, confiança, intervalo de análise e zonas opcionais por câmera; sem zona configurada, a imagem inteira conta como zona monitorada.
- `ia/dependencias.txt` lista dependências Python; `ia/instalar_dependencias.bat` cria o ambiente virtual isolado; `ia/LEIA-ME.md` explica a função dos arquivos e como instalar/configurar. `iniciar.bat` inicia o monitoramento quando o ambiente já existe.
- O dashboard consulta `/api/ia` e exibe estado e eventos recentes. A API valida que os eventos pertencem a uma câmera cadastrada; eventos ficam em memória e são limpos ao reiniciar o backend.
- Verificação em 2026-10-30: `npm run build`, `node --check server/index.mjs`, compilação sintática do worker Python e leitura do JSON de configuração passaram. Dependências Python e pesos RF-DETR ainda não foram instalados/carregados, portanto a análise real de vídeo e o consumo de recursos ainda não foram verificados. Próximo passo operacional: executar `ia\\instalar_dependencias.bat` uma vez e então iniciar CasaView por `iniciar.bat`.
- Nenhuma câmera foi criada, alterada ou removida nesta etapa. Os eventos de IA não são persistidos em disco ainda.
- O usuário confirmou eventos de gato e cachorro e pediu capturas para saber qual câmera gerou cada evento, pois várias têm nomes iguais. O worker agora comprime o quadro detectado em JPEG reduzido, envia junto ao evento e o backend mantém as imagens dos últimos 30 eventos apenas em memória; a atividade recente mostra miniaturas clicáveis e o IP da câmera. Capturas são apagadas ao reiniciar o backend. Verificados: `npm run build`, `node --check server/index.mjs` e compilação sintática do worker Python. A exibição ao vivo da miniatura depende do usuário reiniciar CasaView e ainda precisa de confirmação visual.
- O usuário pediu controle separado de alertas de animais e pessoas por câmera, para silenciar animais na câmera dos dogs e manter pessoas. Adicionada ação **Alertas** em cada cartão, modal com opções separadas, API que grava preferências sem credenciais em `%APPDATA%\CasaView\alertas_ia.json`, e worker que atualiza as preferências periodicamente e só envia as classes habilitadas. Por padrão ambas ficam ativas para preservar o comportamento existente. `npm run build`, `node --check server/index.mjs` e compilação sintática Python passaram. Para usar, o usuário reinicia CasaView, abre **Alertas** no cartão da câmera dos dogs, deixa **Pessoas** ligado, desliga **Animais** e salva. A mudança no worker é aplicada na próxima leitura das preferências (até 15 segundos); eventos já exibidos no histórico permanecem até o backend reiniciar.
- Investigação da inicialização: o dashboard usa HLS.js e MediaMTX com `sourceOnDemand`; por isso o primeiro quadro depende da conexão RTSP da câmera, do primeiro keyframe e do segmento HLS. Não há como mostrar imagem antes de a fonte entregar quadros; atraso de 15 s pode vir do handshake/GOP do equipamento. O worker agora abre os leitores primeiro e só carrega RF-DETR depois de receber um quadro real de alguma câmera; o estado da IA indica se aguarda câmera ou carrega o modelo. `npm run build`, `node --check server/index.mjs` e compilação sintática Python passaram após a alteração. Para reduzir mais a latência do vídeo, o próximo passo é medir no próximo início e então ajustar o player HLS ou migrar para WebRTC; MediaMTX já tem WebRTC habilitado, mas o frontend ainda usa HLS. As mensagens HEVC no log mostram que a câmera está entregando HEVC; conferir perfil e suporte do navegador antes de mudar o player.
- A pedido do usuário, foi adicionado seletor de perfil/resolução ONVIF no modal **Capacidades**. O backend consulta URI para cada perfil, apresenta ao frontend só nome/codec/resolução e disponibilidade, testa o novo perfil pelo MediaMTX antes de substituir a fonte ativa e persiste `selectedProfileIndex` junto às configurações protegidas. Câmeras manuais/sem perfis ONVIF não têm seletor. `npm run build`, `node --check server/index.mjs` e sintaxe Python passaram; a troca real de perfil precisa ser exercitada pelo usuário na câmera (nenhuma alteração de câmera foi feita automaticamente nesta etapa).
- O usuário mostrou um quadro sem pessoa que RF-DETR classificou como pessoa. A pedido do usuário, reduzido o falso positivo configurando confiança mínima em 0,60 e ByteTrack com `minimum_consecutive_frames=2`. A confirmação leva dois ciclos de análise (2 segundos por padrão), podendo atrasar alerta e deixar passar pessoas pequenas/distantes. Verificados: compilação sintática do worker Python e leitura/valor do JSON. Para aplicar, reiniciar `iniciar.bat`.
- Sobre acesso remoto solicitado: recomendar tunnel para a aplicação CasaView com controle de acesso (por exemplo Cloudflare Tunnel + Access por e-mail) e nunca publicar RTSP/MediaMTX ou a API de câmera diretamente. Atualmente `iniciar.bat` usa Vite dev server e o projeto não tem login próprio nem servidor de produção integrado; preparar uma origem de produção e autenticação antes de expor o painel. Alternativa privada para apenas a esposa: acesso via Tailscale/compartilhamento de dispositivo, sem URL pública. Ver documentação oficial atual do Cloudflare Tunnel e Tailscale ao orientar.
- Foi preparado `iniciar_producao.bat` e o script `start:production`: constrói o dashboard e serve o build via Vite Preview somente no loopback, enquanto mantém API e proxy HLS locais. A UI chama `/api` e `/media` no mesmo host, então só um hostname público precisa ser mapeado; backend, MediaMTX e RTSP não devem receber links públicos separados. Build/sintaxe passaram. `cloudflared` não está instalado e nenhuma rota/túnel público foi criado; requer instalação e autenticação/hostname Cloudflare. O preview de produção também ainda não foi iniciado em runtime.

### Design e desempenho em 2026-11-06

- Tipografia ampliada (mínimo 11–12px; antes havia textos de 8–9px), rótulos "eyebrow" removidos, superfícies do navegador temadas (seleção, barra de rolagem, cursor, números tabulares).
- Animações adaptadas do site Sidware (`D:\mazyOs\sidware\site`), só CSS: título palavra por palavra, cartões em cascata ao montar, brilho do botão principal no hover, entrada de modais e eventos de IA, pulso nos indicadores ao vivo. `prefers-reduced-motion` desliga todas.
- Desempenho: vídeo HLS e polling param com a aba oculta; `hls.js/light` (JS 771 → 548 KB); sem `backdrop-filter` sobre vídeo; capturas de IA com cache `immutable` (IDs UUID); fontes via `<link>` com preconnect.
- Verificado: `npm run build`, `node --check server/index.mjs`, detector de design sem achados, capturas desktop/500px sem câmeras. Não verificado: cartões com vídeo real e retomada após a aba voltar a ficar visível.

### Plano acordado em 2026-11-06 (ordem: 1 → 2 → 3 → 4)

1. **Limpeza** — *implementada e compilada (build + sintaxe); ver abaixo.*
2. **Login** — *implementado e testado (2026-11-06); ver abaixo.*
3. **PTZ** — *planejado:* as 3 câmeras têm PTZ (informado pelo usuário, ainda não testado). ONVIF PTZ via `node-onvif`: mover/parar/zoom/presets na visualização ampliada, com `stop` automático.
4. **Alertas de ameaça** — *planejado:* a IA continua registrando tudo, mas só notifica por regras: pessoa em zona desenhada, parada ≥ 5 s; modos Em casa / Ausente / Noite; animais não alertam por padrão; um incidente = uma notificação; níveis Registrar / Atenção / Alto. Notificação por **Telegram** (token via DPAPI, chat pareado por `/start`, só conexões de saída; a foto passa pelos servidores do Telegram, com opção só texto). Incidentes e fotos persistidos em `%APPDATA%\CasaView\incidentes\` com retenção.

**Etapa 1 (2026-11-06):** `mediamtx_v1.21.3_windows_amd64.zip` apagado (o `mediamtx.exe` permanece). `src/App.tsx` dividido em `api.ts`, `types.ts` e `components/` (`CameraVideo`, `CameraCard`, `DiscoveryPanel`, `ActivityPanel`, `SplitWords`, `modals/*`), sem mudança visual. Mudança de comportamento intencional: erros da API (ex.: `iniciar.bat` fechado) agora aparecem na tela em vez de serem descartados; o estado de cada modal passou a viver no próprio modal, então a mensagem "Câmera salva." não reaparece mais ao reabrir. Verificado: `npm run build`, `node --check`, screenshot da tela vazia. **Não verificado com câmeras reais:** abrir/salvar o formulário, Alertas, Capacidades e ampliação.

**Etapa 2 — login (2026-11-06):**
- `server/auth.mjs` (novo): senha única com scrypt (N=32768), hash cifrado por DPAPI em `%APPDATA%\CasaView\auth.dpapi`; sessão em memória, cookie `casaview_sessao` (`HttpOnly`, `SameSite=Strict`, `Secure` quando `X-Forwarded-Proto: https`), 7 dias; bloqueio global crescente após 3 erros (5 s … 15 min); uma verificação de senha por vez; checagem de `Origin` em escritas; criação da senha só sem cabeçalhos de proxy/túnel; senha de 12–128 caracteres.
- `server/index.mjs` aplica o `guard` a `/api` e `/media`. Rotas públicas: `health`, `auth/estado|setup|login|sair`. O worker de IA usa o cabeçalho `X-CasaView-Servico` com o token de `%APPDATA%\CasaView\servico.token` (texto simples, mesmo nível de proteção do DPAPI para o mesmo usuário), aceito só em `GET /api/cameras`, `GET /api/ia/alertas`, `POST /api/ia/pulso`, `POST /api/ia/eventos`. `ia/monitoramento.py` lê o token a cada chamada.
- **`/media` agora passa pelo backend** (proxy HLS autenticado, reescreve o `Location` do `cookieCheck` do MediaMTX); `vite.config.ts` só encaminha `/api` e `/media` para `127.0.0.1:3001`.
- **Mudança de segurança em `mediamtx.local.yml` e `mediamtx.example.yml`:** HLS, WebRTC e RTSP presos a `127.0.0.1`, RTMP e SRT desligados. Antes, HLS (`:8888`) e WebRTC (`:8889`) escutavam em todas as interfaces e qualquer dispositivo da rede poderia abrir o vídeo sem passar pelo login. **Exige reiniciar o MediaMTX** (o `iniciar.bat` só o inicia se a API 9997 não responder).
- Frontend: `AuthGate`, `LoginScreen`, botão **Sair**; qualquer 401 volta para o login.
- Verificado: `npm test` (8 testes, node:test), `npm run build`, `node --check`; teste ponta a ponta do backend real com `APPDATA` temporário e porta 3011 passando pelo proxy do Vite (criação de senha, 401 sem sessão em `/api` e `/media`, 403 com `Origin` externo, token de serviço aceito/recusado, logout invalida o cookie, 502 em `/media` com MediaMTX desligado); worker Python autenticado nas 4 rotas; screenshots das telas de criação e de login. **Não verificado:** vídeo HLS real passando pelo proxy `/media` com câmeras (só com um upstream falso), troca de sessão após reinício do backend no navegador real, `Secure` atrás de túnel real, acesso pela rede local a `:8888` depois de reiniciar o MediaMTX. Atenção: sessões não sobrevivem a reinício do backend; não há tela para trocar senha (apagar `auth.dpapi` e criar outra).

## Como trabalhar daqui em diante

- **Continuar o repositório existente**, sem recriar do zero.
- Antes de mudanças, ler `AGENTS.md` e o código; mapear o que está pronto, o que falta e o que está quebrado.
- Preferir mudanças pequenas e testáveis, preservando o design clean e a execução sem Docker/WSL.
- Explicar comandos de PowerShell e caminhos Windows de forma objetiva.
- Não assumir que o usuário quer mexer em BIOS/virtualização.
- Ao concluir uma etapa, atualizar este documento com decisões, estado real e próximos passos.
