export type CameraStatus = 'connecting' | 'live' | 'offline' | 'error'

export type Profile = { index: number; name: string; encoding: string; width: number | null; height: number | null; available?: boolean }

export type Camera = {
  id: string
  name: string
  host: string
  onvifPort: string | number
  onvif: boolean
  rtspConfigured: boolean
  streamPath: string
  selectedProfileIndex: number | null
  profiles: Profile[]
  capabilities: string[]
  status: string
}

// Dispositivo achado pela descoberta ONVIF (ainda não cadastrado).
export type Device = {
  id: string
  host: string
  name?: string
  model?: string
  manufacturer?: string
  onvifPort?: number
  serviceUrl?: string
  detectedBy?: string
  registered?: boolean
}

export type Form = { name: string; host: string; onvifPort: string; username: string; password: string; rtspUri: string; useOnvif: boolean; serviceUrl: string }
export const blankForm: Form = { name: '', host: '', onvifPort: '80', username: '', password: '', rtspUri: '', useOnvif: true, serviceUrl: '' }

export type TestInfo = { rtspToken?: string; rtspTested?: boolean; profiles?: Profile[]; manufacturer?: string; model?: string }
export type Caps = { error?: string; profiles?: Profile[]; capabilities?: string[]; selectedProfileIndex?: number | null }

export type EventoIA = { id: string; cameraId: string; cameraName: string; cameraHost: string; className: string; confidence: number; count: number; zone: string; createdAt: string; hasSnapshot?: boolean }
export type EstadoIA = { online: boolean; state: 'parado' | 'iniciando' | 'ativo' | 'erro'; model: string; message: string; events: EventoIA[] }
export type PreferenciasAlerta = { pessoas: boolean; animais: boolean }
