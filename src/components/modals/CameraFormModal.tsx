import { useState } from 'react'
import { Check, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { api } from '../../api'
import { blankForm, type Camera, type Device, type Form, type TestInfo } from '../../types'
import { Modal, ModalHeading } from './Modal'

type Props = { editing: Camera | null; device?: Device; onClose: () => void; onSaved: () => void }

export default function CameraFormModal({ editing, device, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Form>(() => editing
    ? { ...blankForm, name: editing.name, host: editing.host, onvifPort: String(editing.onvifPort || 80), useOnvif: editing.onvif }
    : { ...blankForm, ...(device ? { name: device.name || '', host: device.host || '', onvifPort: String(device.onvifPort || 80), serviceUrl: device.serviceUrl || '', useOnvif: true } : {}) })
  const [testInfo, setTestInfo] = useState<TestInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const change = (key: keyof Form, value: string | boolean) => { setForm(f => ({ ...f, [key]: value })); setTestInfo(null) }

  const test = async () => {
    setBusy(true); setNotice(''); setTestInfo(null)
    try {
      const result = await api<TestInfo>(editing ? `/cameras/${editing.id}/test` : '/cameras/test', { method: 'POST', body: JSON.stringify(form) })
      setTestInfo(result)
      const identity = [result.manufacturer, result.model].filter(Boolean).join(' ')
      setNotice(`${identity ? `${identity} · ` : ''}${result.rtspTested ? 'Conexão ONVIF e transmissão RTSP verificadas.' : `ONVIF autenticado${result.profiles?.length ? ` · ${result.profiles.length} perfil(is)` : ''}. Informe o RTSP manualmente se a câmera não fornecer uma URI.`}`)
    } catch (e) { setNotice((e as Error).message) } finally { setBusy(false) }
  }

  const save = async () => {
    setBusy(true); setNotice('')
    try {
      if (editing) await api(`/cameras/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ ...form, password: form.password || undefined, username: form.username || undefined }) })
      else await api('/cameras', { method: 'POST', body: JSON.stringify({ ...form, testToken: testInfo?.rtspToken || undefined }) })
      onSaved()
    } catch (e) { setNotice((e as Error).message) } finally { setBusy(false) }
  }

  const rtspPlaceholder = 'rtsp://192.168.1.20:554/caminho'
  const profileCount = testInfo?.profiles?.length ?? 0

  return (
    <Modal label={editing ? 'Editar câmera' : 'Adicionar câmera'} onClose={onClose}>
      <ModalHeading title={editing ? 'Editar câmera' : 'Adicionar câmera'} onClose={onClose} />
      <div className="form-grid">
        <label>Nome da câmera<input value={form.name} onChange={e => change('name', e.target.value)} placeholder="Ex.: Entrada principal" /></label>
        <label>IP ou hostname<input value={form.host} onChange={e => change('host', e.target.value)} placeholder="192.168.1.20" /></label>
        <label className="toggle-row"><input type="checkbox" checked={form.useOnvif} onChange={e => change('useOnvif', e.target.checked)} /> Usar ONVIF para consultar dispositivo</label>
        {form.useOnvif && <label>Porta ONVIF<input type="number" value={form.onvifPort} onChange={e => change('onvifPort', e.target.value)} placeholder="80" /></label>}
        <label>Usuário<input autoComplete="username" value={form.username} onChange={e => change('username', e.target.value)} placeholder="Usuário da câmera" /></label>
        <label>Senha<input type="password" autoComplete="new-password" value={form.password} onChange={e => change('password', e.target.value)} placeholder={editing ? 'Em branco mantém a senha atual' : 'Senha da câmera'} /></label>
        {form.useOnvif
          ? <div className="field-wide rtsp-auto-note">A rota RTSP será consultada automaticamente na câmera após testar a conexão.</div>
          : <label className="field-wide">Endereço RTSP<input value={form.rtspUri} onChange={e => change('rtspUri', e.target.value)} placeholder={rtspPlaceholder} /></label>}
      </div>
      {form.useOnvif && (
        <details className="rtsp-fallback">
          <summary>Informar endereço RTSP manualmente (opcional)</summary>
          <label>Endereço RTSP<input value={form.rtspUri} onChange={e => change('rtspUri', e.target.value)} placeholder={rtspPlaceholder} /></label>
        </details>
      )}
      <p className="privacy-note"><ShieldCheck size={14} /> Senha enviada somente ao backend local e protegida com DPAPI do Windows.</p>
      {profileCount > 0 && <div className="test-result"><Check size={15} />{profileCount} perfis ONVIF encontrados{testInfo?.rtspTested ? ' e RTSP confirmado' : ''}</div>}
      {notice && <div className="form-notice">{notice}</div>}
      <div className="modal-actions">
        <button className="secondary-button" onClick={() => void test()} disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} Testar conexão</button>
        <button className="primary-button" onClick={() => void save()} disabled={busy || !form.name || !form.host || (!editing && !testInfo?.rtspToken)}>{busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Adicionar câmera'}</button>
      </div>
    </Modal>
  )
}
