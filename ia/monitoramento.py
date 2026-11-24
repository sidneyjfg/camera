"""Analisa os streams locais do CasaView com RF-DETR e Supervision."""

from __future__ import annotations

import base64
import json
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

try:
    import cv2
    import numpy as np
    import supervision as sv
    from rfdetr import RFDETRNano
    from rfdetr.assets.coco_classes import COCO_CLASSES
    from trackers import ByteTrackTracker
except ImportError as erro:
    print(
        "Dependências da IA ausentes. Execute ia\\instalar_dependencias.bat "
        f"antes de iniciar o CasaView. Detalhe: {erro.name or 'pacote não encontrado'}",
        flush=True,
    )
    raise SystemExit(1)


PASTA_PROJETO = Path(__file__).resolve().parents[1]
ARQUIVO_CONFIGURACAO = Path(__file__).resolve().with_name("configuracao.json")
INTERVALO_ATUALIZAR_CAMERAS = 15
INTERVALO_PULSO_SEGUNDOS = 5
TEMPO_RECONEXAO_SEGUNDOS = 3
PORTA_RTSP_MEDIAMTX = 8554

NOMES_COCO_PARA_PORTUGUES = {
    "person": "pessoa",
    "dog": "cachorro",
    "cat": "gato",
    "bird": "pássaro",
    "horse": "cavalo",
    "sheep": "ovelha",
    "cow": "vaca",
    "elephant": "elefante",
    "bear": "urso",
    "zebra": "zebra",
    "giraffe": "girafa",
}


def carregar_variaveis_locais() -> dict[str, str]:
    """Lê somente as configurações locais sem imprimir ou persistir segredos."""
    variaveis: dict[str, str] = {}
    arquivo_env = PASTA_PROJETO / ".env"
    if not arquivo_env.exists():
        return variaveis
    for linha in arquivo_env.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        nome, valor = linha.split("=", 1)
        nome = nome.strip()
        valor = valor.strip().strip('"').strip("'")
        if nome and nome not in os.environ:
            variaveis[nome] = valor
    return variaveis


VARIAVEIS_LOCAIS = carregar_variaveis_locais()
PORTA_CASAVIEW = int(os.environ.get("CASAVIEW_PORT", VARIAVEIS_LOCAIS.get("CASAVIEW_PORT", "3001")))
ENDERECO_API = f"http://127.0.0.1:{PORTA_CASAVIEW}"


def ler_configuracao() -> dict[str, Any]:
    return json.loads(ARQUIVO_CONFIGURACAO.read_text(encoding="utf-8"))


def ler_token_servico() -> str:
    """Token que o backend cria em %APPDATA%\\CasaView; lido a cada chamada para sobreviver a reinícios."""
    pasta = Path(os.environ.get("APPDATA") or Path.home()) / "CasaView"
    try:
        return (pasta / "servico.token").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def requisicao_api(caminho: str, metodo: str = "GET", dados: dict[str, Any] | None = None) -> Any:
    corpo = json.dumps(dados).encode("utf-8") if dados is not None else None
    requisicao = urllib.request.Request(
        f"{ENDERECO_API}{caminho}",
        data=corpo,
        method=metodo,
        headers={"Content-Type": "application/json", "X-CasaView-Servico": ler_token_servico()},
    )
    with urllib.request.urlopen(requisicao, timeout=4) as resposta:
        if resposta.status == 204 or not resposta.readable():
            return None
        conteudo = resposta.read()
        return json.loads(conteudo) if conteudo else None


def capturar_quadro_jpeg_base64(quadro: np.ndarray) -> str:
    """Prepara uma imagem leve do quadro detectado para o cartão do evento."""
    altura, largura = quadro.shape[:2]
    escala = min(1.0, 960 / max(largura, altura))
    if escala < 1.0:
        quadro = cv2.resize(quadro, (round(largura * escala), round(altura * escala)), interpolation=cv2.INTER_AREA)
    sucesso, imagem = cv2.imencode(".jpg", quadro, [cv2.IMWRITE_JPEG_QUALITY, 65])
    if not sucesso or len(imagem) > 280_000:
        sucesso, imagem = cv2.imencode(".jpg", quadro, [cv2.IMWRITE_JPEG_QUALITY, 45])
    if not sucesso or len(imagem) > 280_000:
        return ""
    return base64.b64encode(imagem).decode("ascii")


class LeitorDeStream(threading.Thread):
    """Mantém o último quadro de uma câmera sem acumular fila de vídeo."""

    def __init__(self, camera: dict[str, Any]) -> None:
        super().__init__(daemon=True, name=f"leitor-{camera['id'][:8]}")
        self.camera = camera
        self.parar = threading.Event()
        self.trava_quadro = threading.Lock()
        self.quadro: np.ndarray | None = None
        self.ultimo_recebido = 0.0

    def obter_quadro(self) -> tuple[np.ndarray | None, float]:
        with self.trava_quadro:
            if self.quadro is None:
                return None, 0.0
            return self.quadro.copy(), self.ultimo_recebido

    def run(self) -> None:
        caminho = self.camera.get("streamPath", "")
        if not caminho:
            return
        endereco = f"rtsp://127.0.0.1:{PORTA_RTSP_MEDIAMTX}/{caminho}"
        while not self.parar.is_set():
            captura = cv2.VideoCapture()
            try:
                parametros = [
                    cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000,
                    cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000,
                ]
                aberta = captura.open(endereco, cv2.CAP_FFMPEG, parametros)
            except (TypeError, cv2.error):
                aberta = captura.open(endereco, cv2.CAP_FFMPEG)
            if not aberta:
                captura.release()
                self.parar.wait(TEMPO_RECONEXAO_SEGUNDOS)
                continue
            captura.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            while not self.parar.is_set():
                sucesso, quadro = captura.read()
                if not sucesso:
                    break
                with self.trava_quadro:
                    self.quadro = quadro
                    self.ultimo_recebido = time.monotonic()
            captura.release()
            self.parar.wait(TEMPO_RECONEXAO_SEGUNDOS)


def nome_da_classe(indice: int) -> str | None:
    try:
        nome = COCO_CLASSES.get(indice) if isinstance(COCO_CLASSES, dict) else COCO_CLASSES[indice]
    except (IndexError, KeyError, TypeError):
        return None
    nome_normalizado = str(nome).strip().lower()
    return NOMES_COCO_PARA_PORTUGUES.get(nome_normalizado)


def criar_zona(camera_id: str, largura: int, altura: int, configuracao: dict[str, Any]) -> sv.PolygonZone:
    zonas = configuracao.get("zonas_por_camera", {})
    dados_zona = zonas.get(camera_id, {}) if isinstance(zonas, dict) else {}
    pontos = dados_zona.get("pontos") if isinstance(dados_zona, dict) else None
    if not pontos:
        pontos = [[0, 0], [1, 0], [1, 1], [0, 1]]
    poligono = np.asarray(
        [[round(float(x) * (largura - 1)), round(float(y) * (altura - 1))] for x, y in pontos],
        dtype=np.int32,
    )
    if poligono.ndim != 2 or poligono.shape[0] < 3 or poligono.shape[1] != 2:
        raise ValueError("A zona precisa de pelo menos três pontos [x, y].")
    return sv.PolygonZone(polygon=poligono, triggering_anchors=(sv.Position.BOTTOM_CENTER,))


def executar() -> None:
    configuracao = ler_configuracao()
    confianca = max(0.05, min(0.99, float(configuracao.get("confianca_minima", 0.5))))
    intervalo_analise = max(0.5, float(configuracao.get("intervalo_analise_por_camera_segundos", 2.0)))
    intervalo_alerta = max(1, int(configuracao.get("intervalo_repeticao_alerta_segundos", 30)))
    classes_observadas = set(configuracao.get("classes_observadas", NOMES_COCO_PARA_PORTUGUES.values()))
    nomes_modelo: dict[str, str] = {"rfdetr-nano": "RF-DETR Nano"}
    nome_modelo = str(configuracao.get("modelo", "rfdetr-nano"))
    if nome_modelo != "rfdetr-nano":
        print("Este worker está configurado para RF-DETR Nano.", flush=True)
        nome_modelo = "rfdetr-nano"
    nome_modelo_exibicao = nomes_modelo[nome_modelo]
    if hasattr(cv2, "setNumThreads"):
        cv2.setNumThreads(1)
    try:
        import torch
        torch.set_num_threads(1)
    except (ImportError, RuntimeError):
        pass

    print("Iniciando monitoramento local. Aguardando vídeo de uma câmera...", flush=True)
    while True:
        try:
            requisicao_api("/api/ia/pulso", "POST", {"model": nome_modelo_exibicao, "state": "iniciando"})
            break
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(2)

    estado_pulso = {"state": "iniciando", "message": "Aguardando vídeo de uma câmera para carregar o modelo."}
    parar_pulso = threading.Event()

    def manter_pulso() -> None:
        while not parar_pulso.is_set():
            try:
                requisicao_api("/api/ia/pulso", "POST", {"model": nome_modelo_exibicao, **estado_pulso})
            except (urllib.error.URLError, TimeoutError, OSError):
                pass
            parar_pulso.wait(INTERVALO_PULSO_SEGUNDOS)

    threading.Thread(target=manter_pulso, daemon=True, name="pulso-ia").start()
    modelo = None
    leitores: dict[str, LeitorDeStream] = {}
    rastreadores: dict[str, ByteTrackTracker] = {}
    zonas_cache: dict[tuple[str, int, int], sv.PolygonZone] = {}
    proxima_analise: dict[str, float] = {}
    ultimo_alerta: dict[tuple[str, str], float] = {}
    alertas_por_camera: dict[str, dict[str, bool]] = {}
    ultima_atualizacao = 0.0

    while True:
        agora = time.monotonic()
        if agora - ultima_atualizacao >= INTERVALO_ATUALIZAR_CAMERAS:
            try:
                cameras = requisicao_api("/api/cameras") or []
                try:
                    configuracao_alertas = requisicao_api("/api/ia/alertas") or {}
                    if isinstance(configuracao_alertas, dict):
                        alertas_por_camera = configuracao_alertas
                except (urllib.error.URLError, TimeoutError, OSError, ValueError):
                    pass
                cameras_ativas = {
                    str(camera["id"]): camera
                    for camera in cameras
                    if camera.get("id") and camera.get("rtspConfigured") and camera.get("streamPath")
                }
                for camera_id in list(leitores):
                    if camera_id not in cameras_ativas:
                        leitores[camera_id].parar.set()
                        del leitores[camera_id]
                        rastreadores.pop(camera_id, None)
                for camera_id, camera in cameras_ativas.items():
                    if camera_id not in leitores:
                        leitor = LeitorDeStream(camera)
                        leitor.start()
                        leitores[camera_id] = leitor
                        rastreadores[camera_id] = ByteTrackTracker(
                            track_activation_threshold=0.25,
                            minimum_consecutive_frames=2,
                        )
                        print(f"Câmera conectada ao monitoramento: {camera.get('name', 'Câmera')}", flush=True)
                ultima_atualizacao = agora
            except (urllib.error.URLError, TimeoutError, OSError, ValueError) as erro:
                print(f"Aguardando o backend do CasaView: {type(erro).__name__}.", flush=True)

        for camera_id, leitor in list(leitores.items()):
            agora = time.monotonic()
            if agora < proxima_analise.get(camera_id, 0.0):
                continue
            quadro, recebido_em = leitor.obter_quadro()
            if quadro is None or agora - recebido_em > 5:
                continue
            if modelo is None:
                nome_camera = leitor.camera.get("name", "Câmera")
                print(f"Vídeo recebido de {nome_camera}. Carregando RF-DETR Nano...", flush=True)
                estado_pulso.update(state="iniciando", message=f"Vídeo conectado · carregando modelo ({nome_camera}).")
                modelo = RFDETRNano()
                estado_pulso.update(state="ativo", message="Monitoramento local ativo.")
                print("RF-DETR Nano carregado. Monitoramento ativo.", flush=True)
            proxima_analise[camera_id] = agora + intervalo_analise
            try:
                quadro_rgb = cv2.cvtColor(quadro, cv2.COLOR_BGR2RGB)
                deteccoes = modelo.predict(quadro_rgb, threshold=confianca)
                deteccoes = rastreadores[camera_id].update(deteccoes)
                altura, largura = quadro.shape[:2]
                chave_zona = (camera_id, largura, altura)
                zona = zonas_cache.get(chave_zona)
                if zona is None:
                    zona = criar_zona(camera_id, largura, altura, configuracao)
                    zonas_cache[chave_zona] = zona
                dentro_da_zona = deteccoes[zona.trigger(deteccoes)]
                contagens: dict[str, list[float]] = {}
                for indice, classe_id in enumerate(dentro_da_zona.class_id):
                    classe = nome_da_classe(int(classe_id))
                    if not classe or classe not in classes_observadas:
                        continue
                    confianca_objeto = float(dentro_da_zona.confidence[indice]) if dentro_da_zona.confidence is not None else confianca
                    contagens.setdefault(classe, []).append(confianca_objeto)

                camera = leitor.camera
                for classe, confiancas in contagens.items():
                    preferencias = alertas_por_camera.get(camera_id, {})
                    if classe == "pessoa" and preferencias.get("pessoas") is False:
                        continue
                    if classe != "pessoa" and preferencias.get("animais") is False:
                        continue
                    chave_alerta = (camera_id, classe)
                    if agora - ultimo_alerta.get(chave_alerta, 0.0) < intervalo_alerta:
                        continue
                    evento = {
                        "cameraId": camera_id,
                        "className": classe,
                        "confidence": round(max(confiancas), 3),
                        "count": len(confiancas),
                        "zone": configuracao.get("zonas_por_camera", {}).get(camera_id, {}).get("nome", "Área inteira"),
                        "snapshot": capturar_quadro_jpeg_base64(quadro),
                    }
                    try:
                        requisicao_api("/api/ia/eventos", "POST", evento)
                        ultimo_alerta[chave_alerta] = agora
                        print(f"Detecção: {classe} · {camera.get('name', 'Câmera')} · {len(confiancas)} objeto(s)", flush=True)
                    except (urllib.error.URLError, TimeoutError, OSError):
                        print("Não foi possível enviar uma detecção ao CasaView.", flush=True)
            except Exception as erro:
                print(f"Falha ao analisar um quadro: {type(erro).__name__}.", flush=True)

        time.sleep(0.05)


if __name__ == "__main__":
    try:
        executar()
    except KeyboardInterrupt:
        print("Monitoramento de IA encerrado.", flush=True)
    except Exception as erro:
        print(f"O monitoramento de IA parou: {type(erro).__name__}.", flush=True)
        try:
            requisicao_api(
                "/api/ia/pulso",
                "POST",
                {"model": "RF-DETR Nano", "state": "erro", "message": "Falha ao iniciar ou analisar vídeo. Consulte a janela do monitoramento de IA."},
            )
        except Exception:
            pass
        raise SystemExit(1)
