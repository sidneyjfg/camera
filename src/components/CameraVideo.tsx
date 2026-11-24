import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js/light'
import { Expand, LoaderCircle, RefreshCw } from 'lucide-react'
import type { Camera, CameraStatus } from '../types'

export default function CameraVideo({ camera, muted, onExpand }: { camera: Camera; muted: boolean; onExpand: () => void }) {
  const [status, setStatus] = useState<CameraStatus>('connecting')
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const src = `/media/${camera.streamPath}/index.m3u8`
    let hls: Hls | undefined
    let timer = 0
    let disposed = false

    const connect = () => {
      if (disposed) return
      setStatus('connecting')
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 25 })
        hls.loadSource(src)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => undefined))
        hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) retry() })
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = src
      else setStatus('error')
    }
    const retry = () => {
      hls?.destroy()
      hls = undefined
      if (disposed) return
      setStatus('offline')
      window.clearTimeout(timer)
      timer = window.setTimeout(connect, 4000)
    }
    const playing = () => setStatus('live')
    const waiting = () => setStatus('connecting')
    // Aba oculta: para download e decodificação HEVC; volta na ponta ao vivo.
    const visibility = () => {
      if (document.hidden) { hls?.stopLoad(); video.pause() }
      else { hls?.startLoad(-1); void video.play().catch(() => undefined) }
    }

    connect()
    video.addEventListener('playing', playing)
    video.addEventListener('waiting', waiting)
    video.addEventListener('error', retry)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visibility)
      hls?.destroy()
      video.removeEventListener('playing', playing)
      video.removeEventListener('waiting', waiting)
      video.removeEventListener('error', retry)
      video.removeAttribute('src')
      video.load()
    }
  }, [camera.streamPath, camera.id])

  return (
    <div className="video-frame">
      <video ref={videoRef} muted={muted} autoPlay playsInline preload="none" />
      {status !== 'live' && (
        <div className="stream-state">
          <span className="state-symbol">{status === 'offline' ? <RefreshCw size={15} /> : <LoaderCircle className={status === 'error' ? '' : 'spin'} size={16} />}</span>
          <span>{status === 'offline' ? 'Sem sinal — reconectando' : status === 'error' ? 'Formato de vídeo indisponível' : 'Estabelecendo conexão'}</span>
        </div>
      )}
      {status === 'live' && <div className="live-tag"><span className="live-dot" /> LIVE</div>}
      <button className="icon-button expand-button" aria-label={`Ampliar ${camera.name}`} onClick={onExpand}><Expand size={16} /></button>
    </div>
  )
}
