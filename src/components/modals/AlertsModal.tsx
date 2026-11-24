import { useState } from 'react'
import { api } from '../../api'
import type { Camera, PreferenciasAlerta } from '../../types'
import { Modal, ModalHeading } from './Modal'

type Props = { camera: Camera; initial?: PreferenciasAlerta; onClose: () => void; onSaved: (cameraId: string, saved: PreferenciasAlerta) => void }

export default function AlertsModal({ camera, initial, onClose, onSaved }: Props) {
  const [form, setForm] = useState<PreferenciasAlerta>(initial || { pessoas: true, animais: true })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const save = async () => {
    setBusy(true); setNotice('')
    try {
      const saved = await api<PreferenciasAlerta>(`/ia/alertas/${camera.id}`, { method: 'PUT', body: JSON.stringify(form) })
      onSaved(camera.id, saved)
    } catch (e) { setNotice((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Modal label={`Alertas de IA para ${camera.name}`} className="alert-modal" onClose={onClose}>
      <ModalHeading title={`Alertas · ${camera.name}`} subtitle={camera.host} onClose={onClose} />
      <p className="alert-description">Escolha quais detecções desta câmera aparecem em Atividade recente.</p>
      <label className="alert-option">
        <span><b>Pessoas</b><small>Alertar quando uma pessoa for detectada.</small></span>
        <input type="checkbox" checked={form.pessoas} onChange={e => setForm(v => ({ ...v, pessoas: e.target.checked }))} />
      </label>
      <label className="alert-option">
        <span><b>Animais</b><small>Inclui cachorros, gatos e outras classes de animais.</small></span>
        <input type="checkbox" checked={form.animais} onChange={e => setForm(v => ({ ...v, animais: e.target.checked }))} />
      </label>
      <p className="alert-description">Desativar alertas não interrompe a análise nem a transmissão ao vivo.</p>
      {notice && <div className="form-notice">{notice}</div>}
      <div className="modal-actions">
        <button className="secondary-button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" onClick={() => void save()} disabled={busy}>{busy ? 'Salvando…' : 'Salvar preferências'}</button>
      </div>
    </Modal>
  )
}
