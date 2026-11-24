import { useCallback, useEffect, useState } from 'react'
import { Camera as CameraIcon, LogOut, Plus, RefreshCw, ShieldCheck, Video } from 'lucide-react'
import { api } from './api'
import type { Camera, Device, EstadoIA, PreferenciasAlerta } from './types'
import ActivityPanel from './components/ActivityPanel'
import CameraCard from './components/CameraCard'
import DiscoveryPanel from './components/DiscoveryPanel'
import SplitWords from './components/SplitWords'
import AlertsModal from './components/modals/AlertsModal'
import CameraFormModal from './components/modals/CameraFormModal'
import CapabilitiesModal from './components/modals/CapabilitiesModal'
import ExpandedModal from './components/modals/ExpandedModal'

const iaInicial: EstadoIA = { online: false, state: 'parado', model: 'RF-DETR Nano', message: 'Execute iniciar.bat com as dependências da IA instaladas.', events: [] }

// Executa `fn` agora e a cada `ms`, pulando as rodadas com a aba oculta.
function usePolling(fn: () => void, ms: number) {
  useEffect(() => {
    fn()
    const id = window.setInterval(() => { if (!document.hidden) fn() }, ms)
    return () => window.clearInterval(id)
  }, [fn, ms])
}

export default function App({ onLogout }: { onLogout: () => void }) {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(true)
  const [estadoIA, setEstadoIA] = useState<EstadoIA>(iaInicial)
  const [alertas, setAlertas] = useState<Record<string, PreferenciasAlerta>>({})
  const [formModal, setFormModal] = useState<{ editing: Camera | null; device?: Device } | null>(null)
  const [expanded, setExpanded] = useState<Camera | null>(null)
  const [capCamera, setCapCamera] = useState<Camera | null>(null)
  const [alertCamera, setAlertCamera] = useState<Camera | null>(null)

  const load = useCallback(async () => {
    try { setCameras(await api<Camera[]>('/cameras')); setError('') }
    catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [])
  const loadIA = useCallback(async () => {
    try { setEstadoIA(await api<EstadoIA>('/ia')) }
    catch { setEstadoIA(s => ({ ...s, online: false, state: 'parado' })) }
  }, [])
  usePolling(load, 15000)
  usePolling(loadIA, 5000)
  useEffect(() => { api<Record<string, PreferenciasAlerta>>('/ia/alertas').then(setAlertas).catch(() => undefined) }, [])

  const remove = async (camera: Camera) => {
    if (!window.confirm(`Remover “${camera.name}” do CasaView?`)) return
    try { await api(`/cameras/${camera.id}`, { method: 'DELETE' }); await load() }
    catch (e) { setError((e as Error).message) }
  }
  const online = cameras.filter(c => c.status === 'online').length

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top"><span className="brand-mark"><Video size={18} /></span><span>Casa<span className="brand-light">View</span></span></a>
        <div className="header-divider" />
        <span className="header-caption">Monitoramento residencial</span>
        <div className="header-right">
          <div className="secure-label"><ShieldCheck size={15} /> Rede local</div>
          <span className="header-status"><i className={`status-pip ${online ? 'status-pip--live' : ''}`} />{online} de {cameras.length} online</span>
          <button className="text-button logout-button" onClick={onLogout}><LogOut size={14} /> Sair</button>
        </div>
      </header>

      <section className="dashboard" id="top">
        <div className="page-heading">
          <div>
            <h1 aria-label="Sua casa, em cada detalhe."><SplitWords text="Sua casa," /> <em><SplitWords text="em cada detalhe." from={2} /></em></h1>
            <p className="intro">Câmeras e espaços monitorados em tempo real.</p>
          </div>
          <button className="primary-button" onClick={() => setFormModal({ editing: null })}><Plus size={16} /> Adicionar câmera</button>
        </div>

        <DiscoveryPanel onConfigure={device => setFormModal({ editing: null, device })} />
        {error && <div className="scan-message scan-message--error" role="alert">{error}</div>}

        <div className="section-heading mine-heading">
          <div><h2>Minhas câmeras <span className="camera-total">{cameras.length.toString().padStart(2, '0')}</span></h2></div>
          <button className="icon-button refresh-list" onClick={() => void load()} aria-label="Atualizar estado"><RefreshCw size={15} /></button>
        </div>
        {loading ? <div className="empty-state">Carregando câmeras…</div> : cameras.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon"><CameraIcon size={21} /></span>
            <b>Nenhuma câmera cadastrada</b>
            <span>Busque dispositivos ONVIF ou adicione uma câmera manualmente.</span>
            <button className="secondary-button" onClick={() => setFormModal({ editing: null })}><Plus size={15} /> Adicionar manualmente</button>
          </div>
        ) : (
          <div className="camera-grid camera-grid-dynamic">
            {cameras.map((camera, i) => (
              <CameraCard key={camera.id} camera={camera} index={i} muted={muted} expanded={expanded?.id === camera.id}
                onExpand={() => setExpanded(camera)} onCapabilities={() => setCapCamera(camera)}
                onEdit={() => setFormModal({ editing: camera })} onAlerts={() => setAlertCamera(camera)}
                onToggleMute={() => setMuted(v => !v)} onRemove={() => void remove(camera)} />
            ))}
          </div>
        )}

        <ActivityPanel estado={estadoIA} />
        <footer><span><i className="footer-dot" />Credenciais protegidas pelo Windows</span><span>CASAVIEW <b>·</b> REDE LOCAL</span></footer>
      </section>

      {formModal && <CameraFormModal editing={formModal.editing} device={formModal.device} onClose={() => setFormModal(null)} onSaved={() => { setFormModal(null); void load() }} />}
      {alertCamera && <AlertsModal camera={alertCamera} initial={alertas[alertCamera.id]} onClose={() => setAlertCamera(null)} onSaved={(id, saved) => { setAlertas(a => ({ ...a, [id]: saved })); setAlertCamera(null) }} />}
      {expanded && <ExpandedModal camera={expanded} muted={muted} onClose={() => setExpanded(null)} />}
      {capCamera && <CapabilitiesModal camera={capCamera} onClose={() => setCapCamera(null)} onProfileChanged={() => void load()} />}
    </main>
  )
}
