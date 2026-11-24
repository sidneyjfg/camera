import { X } from 'lucide-react'
import type { Camera } from '../../types'
import CameraVideo from '../CameraVideo'

export default function ExpandedModal({ camera, muted, onClose }: { camera: Camera; muted: boolean; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <article className="camera-card">
          <CameraVideo camera={camera} muted={muted} onExpand={onClose} />
          <div className="camera-info">
            <h2>{camera.name}</h2>
            <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={16} /></button>
          </div>
        </article>
      </div>
    </div>
  )
}
