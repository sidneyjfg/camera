import type { CSSProperties } from 'react'
import { Bell, ChevronDown, Settings2, Trash2, Volume2, VolumeX } from 'lucide-react'
import type { Camera } from '../types'
import CameraVideo from './CameraVideo'

type Props = {
  camera: Camera
  index: number
  muted: boolean
  expanded: boolean
  onExpand: () => void
  onCapabilities: () => void
  onEdit: () => void
  onAlerts: () => void
  onToggleMute: () => void
  onRemove: () => void
}

export default function CameraCard({ camera, index, muted, expanded, onExpand, onCapabilities, onEdit, onAlerts, onToggleMute, onRemove }: Props) {
  const online = camera.status === 'online'
  return (
    <article className="camera-card" style={{ '--i': Math.min(index, 6) } as CSSProperties}>
      {expanded
        ? <div className="video-frame"><div className="stream-state"><span>Visualização ampliada</span></div></div>
        : <CameraVideo camera={camera} muted={muted} onExpand={onExpand} />}
      <div className="camera-info">
        <div><h2>{camera.name}</h2><p>{camera.host}</p></div>
        <div className={`connection ${online ? 'connection--live' : ''}`}><span className="connection-dot" />{online ? 'Online' : 'Offline'}</div>
      </div>
      <div className="camera-controls">
        <button onClick={onCapabilities}><Settings2 size={14} /> Capacidades</button>
        <button onClick={onEdit}><ChevronDown size={14} /> Editar</button>
        <button onClick={onAlerts}><Bell size={14} /> Alertas</button>
        <button aria-label="Silenciar ou ativar áudio" onClick={onToggleMute}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
        <button className="delete-camera" aria-label="Remover câmera" onClick={onRemove}><Trash2 size={14} /></button>
      </div>
    </article>
  )
}
