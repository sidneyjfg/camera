import { useState } from 'react'
import { Camera as CameraIcon, Check, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import { api } from '../api'
import type { Device } from '../types'

export default function DiscoveryPanel({ onConfigure }: { onConfigure: (device: Device) => void }) {
  const [searching, setSearching] = useState(false)
  const [found, setFound] = useState<Device[]>([])
  const [message, setMessage] = useState('')

  const discover = async () => {
    setSearching(true)
    setMessage('Enviando busca ONVIF na rede local…')
    try {
      const data = await api<{ cameras: Device[]; message?: string }>('/discover', { method: 'POST' })
      setFound(data.cameras)
      setMessage(data.message || (data.cameras.length ? `${data.cameras.length} dispositivo(s) encontrado(s)` : 'Nenhum dispositivo respondeu à descoberta ONVIF. Você ainda pode adicionar uma câmera manualmente.'))
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setSearching(false)
    }
  }

  return (
    <>
      <section className="discovery-panel">
        <div className="discovery-copy">
          <span className="discovery-icon"><Search size={17} /></span>
          <div>
            <h2>Descubra câmeras na sua rede</h2>
            <p>A busca lista dispositivos; cada câmera pede login e senha antes de salvar.</p>
          </div>
        </div>
        <button className="secondary-button" onClick={() => void discover()} disabled={searching}>
          {searching ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} {searching ? 'Buscando…' : 'Buscar câmeras'}
        </button>
      </section>
      {message && <div className="scan-message">{message}</div>}
      {found.length > 0 && (
        <section className="found-panel">
          <div className="section-heading">
            <h2>Dispositivos encontrados</h2>
            <button className="text-button" onClick={() => void discover()}>Atualizar lista</button>
          </div>
          <div className="found-list">
            {found.map(device => (
              <div className="found-row" key={device.id}>
                <span className="found-device-icon"><CameraIcon size={17} /></span>
                <div className="found-details">
                  <b>{device.name}</b>
                  <small>{device.host} · {device.model || 'ONVIF'}{device.manufacturer ? ` · ${device.manufacturer}` : ''}{device.detectedBy === 'onvif-auth-required' ? ' · autenticação pendente' : ''}</small>
                </div>
                {device.registered
                  ? <span className="registered-tag"><Check size={13} /> Cadastrada</span>
                  : <button className="small-button" onClick={() => onConfigure(device)}>Configurar</button>}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
