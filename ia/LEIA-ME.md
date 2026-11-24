# Monitoramento com RF-DETR e Supervision

Esta pasta concentra a análise de vídeo do CasaView. O monitoramento roda em um processo Python separado do painel web.

## Arquivos

- `monitoramento.py`: abre os streams locais do MediaMTX, analisa quadros com RF-DETR, rastreia objetos com Supervision e envia alertas ao backend do CasaView.
- `configuracao.json`: define modelo, confiança mínima, frequência de análise, classes observadas e zonas por câmera.
- `dependencias.txt`: lista os pacotes Python necessários.
- `instalar_dependencias.bat`: cria o ambiente isolado `ambiente` e instala os pacotes.
- `LEIA-ME.md`: este guia.

## Instalação

1. Feche o CasaView se estiver aberto.
2. Execute `instalar_dependencias.bat` uma vez e aguarde a instalação.
3. Abra `..\iniciar.bat`. Ele iniciará a IA quando o ambiente `ambiente` existir.

Na primeira inicialização, o worker espera receber pelo menos um quadro de vídeo de uma câmera antes de carregar o RF-DETR; assim o modelo não ocupa recursos enquanto as câmeras ainda estão conectando. Nessa primeira vez, RF-DETR baixa os pesos do modelo. O processo usa o modelo Nano, CPU e amostragem ajustável para manter o consumo moderado. O fluxo de vídeo continua no MediaMTX; o worker lê a cópia RTSP local (`127.0.0.1:8554`) sem receber senha da câmera.

## Configuração

O padrão exige confiança mínima de 60% e confirmação por dois quadros consecutivos. Edite `configuracao.json` para ajustar `confianca_minima`, `intervalo_analise_por_camera_segundos` ou as classes observadas. A confirmação leva pelo menos dois ciclos de análise (2 segundos por padrão). Para definir uma zona específica, use o ID da câmera como chave dentro de `zonas_por_camera` e informe os vértices em coordenadas normalizadas de 0 a 1. Sem zona personalizada, a imagem inteira é monitorada.

Exemplo de zona retangular cobrindo o lado esquerdo da imagem:

```json
"zonas_por_camera": {
  "ID_DA_CAMERA": {
    "nome": "Portão",
    "pontos": [[0.0, 0.0], [0.5, 0.0], [0.5, 1.0], [0.0, 1.0]]
  }
}
```

O worker consulta `/api/cameras` e usa somente os nomes e caminhos MediaMTX públicos do backend. As credenciais e as URLs RTSP originais permanecem no armazenamento protegido do CasaView.

## Execução e diagnóstico

`iniciar.bat` mostra que o monitoramento de IA foi iniciado. A janela minimizada `CasaView - Monitoramento IA` contém o diagnóstico do worker. O painel mostra o estado da IA e as detecções recentes.

O histórico de até 30 eventos e suas capturas JPEG reduzidas são mantidos somente na memória enquanto o backend está ativo; são limpos quando o CasaView reinicia. Clique na miniatura de um evento para abrir a imagem maior em outra aba. Se a câmera usar um nome genérico ou repetido, a captura ajuda a reconhecer qual enquadramento gerou o alerta.

Em cada cartão de câmera, abra **Alertas** para ligar ou desligar separadamente eventos de pessoas e de animais. Essa preferência fica em `%APPDATA%\CasaView\alertas_ia.json`; ela não contém senhas. Desligar uma categoria só esconde os eventos novos daquela categoria naquela câmera, sem parar a análise nem o vídeo.
