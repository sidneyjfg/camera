import { useEffect, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { api } from '../../api'
import type { Camera, Caps } from '../../types'
import { Modal, ModalHeading } from './Modal'

const firstAvailable = (caps: Caps) => caps.selectedProfileIndex ?? caps.profiles?.find(p => p.available)?.index ?? 0

export default function CapabilitiesModal({ camera, onClose, onProfileChanged }: { camera: Camera; onClose: () => void; onProfileChanged: () => void }) {
  const [caps, setCaps] = useState<Caps | null>(null)
  const [profileIndex, setProfileIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    api<Caps>(`/cameras/${camera.id}/capabilities`)
      .then(result => { if (!cancelled) { setCaps(result); setProfileIndex(firstAvailable(result)) } })
      .catch(e => { if (!cancelled) setCaps({ error: (e as Error).message }) })
    return () => { cancelled = true }
  }, [camera.id])

  const apply = async () => {
    setBusy(true); setNotice('')
    try {
      await api(`/cameras/${camera.id}/profile`, { method: 'PUT', body: JSON.stringify({ profileIndex }) })
      setNotice('Perfil de vídeo atualizado. A imagem vai reconectar.')
      onProfileChanged()
      const result = await api<Caps>(`/cameras/${camera.id}/capabilities`)
      setCaps(result)
      setProfileIndex(result.selectedProfileIndex ?? profileIndex)
    } catch (e) { setNotice((e as Error).message) } finally { setBusy(false) }
  }

  const available = (caps?.profiles || []).filter(p => p.available)

  return (
    <Modal label={`Qualidade de vídeo de ${camera.name}`} className="capability-modal" onClose={onClose}>
      <ModalHeading title={`Qualidade de vídeo · ${camera.name}`} onClose={onClose} />
      {!caps ? <div className="empty-state">Consultando perfis da câmera…</div> : caps.error ? <p className="form-notice">{caps.error}</p> : (
        <>
          <h3>Resolução transmitida</h3>
          {available.length > 0 ? (
            <>
              <label className="profile-selector">Perfil da câmera
                <select value={profileIndex} onChange={e => setProfileIndex(Number(e.target.value))}>
                  {available.map(p => <option key={p.index} value={p.index}>{p.name} · {[p.width && p.height ? `${p.width} × ${p.height}` : 'Resolução não informada', p.encoding].filter(Boolean).join(' · ')}</option>)}
                </select>
              </label>
              <div className="profile-actions">
                <span>{profileIndex === caps.selectedProfileIndex ? 'Perfil em uso' : 'Perfil selecionado'}</span>
                <button className="secondary-button" onClick={() => void apply()} disabled={busy || profileIndex === caps.selectedProfileIndex}>
                  {busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} {busy ? 'Testando…' : 'Aplicar resolução'}
                </button>
              </div>
              {notice && <div className="form-notice">{notice}</div>}
            </>
          ) : <div className="empty-state">A câmera não forneceu perfis ONVIF com transmissão RTSP selecionável.</div>}
          <h3>Serviços disponíveis</h3>
          <div className="capability-list">{(caps.capabilities || []).map(c => <span key={c}>{c}</span>)}</div>
        </>
      )}
    </Modal>
  )
}
