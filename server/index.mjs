import 'dotenv/config'
import express from 'express'
import onvif from 'node-onvif'
import { Dpapi, isPlatformSupported } from '@primno/dpapi'
import { randomUUID } from 'node:crypto'
import dgram from 'node:dgram'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createAuth } from './auth.mjs'

if (process.platform !== 'win32' || !isPlatformSupported) {
  console.error('CasaView precisa do Windows x64/ARM64 para proteger credenciais com DPAPI.')
  process.exit(1)
}

const app = express()
const PORT = Number(process.env.CASAVIEW_PORT || 3001)
const DATA_DIR = join(process.env.APPDATA || homedir(), 'CasaView')
const DB_FILE = join(DATA_DIR, 'cameras.dpapi')
const AI_ALERTS_FILE = join(DATA_DIR, 'alertas_ia.json')
const MTX_API = process.env.MEDIAMTX_API_URL || 'http://127.0.0.1:9997'
const MTX_HLS = process.env.MEDIAMTX_HLS_URL || 'http://127.0.0.1:8888'
const DISCOVERY_HOSTS = (process.env.CASAVIEW_DISCOVERY_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean)
const DISCOVERY_PORTS = (process.env.CASAVIEW_DISCOVERY_PORTS || '8899,80').split(',').map(Number).filter(port => Number.isInteger(port) && port > 0 && port < 65536)
const entropy = Buffer.from('CasaView local camera settings v1', 'utf8')
const testedStreams = new Map()
const aiEvents = []
const aiSnapshots = new Map()
const aiWorker = { state: 'parado', model: 'RF-DETR Nano', lastHeartbeat: 0, message: '' }
app.use(express.json({ limit: '512kb' }))
const auth = await createAuth({ dataDir: DATA_DIR, mediaTarget: MTX_HLS })
app.use(['/api', '/media'], auth.guard)
app.use('/api/auth', auth.router)
app.use('/media', auth.mediaProxy)

async function readCameras() {
  try {
    const encrypted = await readFile(DB_FILE)
    return JSON.parse(Dpapi.unprotectData(encrypted, entropy, 'CurrentUser').toString('utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    if (error.code === 'ERR_OSSL_BAD_DE_DECRYPT' || error.code === 'ERR_CRYPTO_INVALID_KEYLEN') throw new Error('O arquivo protegido não pôde ser aberto por este usuário Windows.')
    if (String(error.message).includes('CryptUnprotectData')) throw new Error('O arquivo protegido não pôde ser aberto por este usuário Windows.')
    throw error
  }
}
async function writeCameras(cameras) {
  await mkdir(DATA_DIR, { recursive: true })
  const encrypted = Dpapi.protectData(Buffer.from(JSON.stringify(cameras)), entropy, 'CurrentUser')
  const tmp = `${DB_FILE}.tmp`
  await writeFile(tmp, encrypted)
  await rename(tmp, DB_FILE)
}
async function readAiAlerts() {
  try { return JSON.parse(await readFile(AI_ALERTS_FILE, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error }
}
async function writeAiAlerts(alerts) {
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${AI_ALERTS_FILE}.tmp`
  await writeFile(tmp, JSON.stringify(alerts, null, 2), 'utf8')
  await rename(tmp, AI_ALERTS_FILE)
}
function publicCamera(camera, status = camera.status || 'offline') {
  return { id: camera.id, name: camera.name, host: camera.host, onvifPort: camera.onvifPort || '', onvif: camera.onvif, rtspConfigured: Boolean(camera.rtspUri), streamPath: `cam_${camera.id.replaceAll('-', '')}`, selectedProfileIndex: camera.selectedProfileIndex ?? null, profiles: publicProfiles(camera.profiles || []), capabilities: camera.capabilities || [], status }
}
function publicProfiles(profiles) {
  return profiles.map(profile => ({ index: profile.index, name: profile.name, encoding: profile.encoding, width: profile.width, height: profile.height, available: Boolean(profile.streamUri) }))
}
function safeError(error) {
  const text = String(error?.message || '')
  if (text.startsWith('MediaMTX')) return text
  if (text.startsWith('Informe')) return text
  if (/password|credential|unauthor|not.?authorized|401|403/i.test(text)) return 'Autenticação ONVIF recusada. Confira usuário e senha.'
  if (/timeout|timed out|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(text)) return 'Dispositivo não respondeu. Confira endereço, porta e rede local.'
  if (/GetStreamUri|profile|media/i.test(text)) return 'ONVIF autenticou, mas a câmera não forneceu a URI RTSP pelo serviço de mídia.'
  return 'Não foi possível consultar o dispositivo. Verifique o suporte ONVIF e os dados informados.'
}
function normalizeHost(value) {
  const host = String(value || '').trim().replace(/^\[|\]$/g, '')
  if (!host || /[\s/@?#]/.test(host)) throw new Error('Informe um IP ou hostname válido.')
  return host
}
function buildServiceUrl(host, port, serviceUrl) {
  if (serviceUrl) {
    const parsed = new URL(serviceUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL de serviço ONVIF inválida.')
    return parsed.toString()
  }
  return `http://${host}:${Number(port || 80)}/onvif/device_service`
}
function secureRtsp(uri, username, password) {
  const parsed = new URL(uri)
  if (!['rtsp:', 'rtsps:'].includes(parsed.protocol)) throw new Error('Informe uma URL RTSP válida.')
  parsed.username = username || ''
  parsed.password = password || ''
  return parsed.toString()
}
function newDevice(xaddr, username, password) {
  return new onvif.OnvifDevice({ xaddr, user: username || '', pass: password || '' })
}
async function onvifDetails({ host, onvifPort, serviceUrl, username, password }) {
  const xaddr = buildServiceUrl(host, onvifPort, serviceUrl)
  const device = newDevice(xaddr, username, password)
  const info = await device.init()
  const profiles = device.getProfileList().map((profile, index) => ({
    index, token: profile.token || '', name: profile.name || `Perfil ${index + 1}`,
    encoding: profile.video?.encoder?.encoding || '', width: profile.video?.encoder?.resolution?.width || null,
    height: profile.video?.encoder?.resolution?.height || null, streamUri: '',
  }))
  let caps = {}
  try {
    // node-onvif 0.1.x accepts only an optional callback here. Passing
    // { Category: 'All' } is interpreted as a callback and can create an
    // unhandled rejection that terminates the API process.
    const result = await device.services.device.getCapabilities()
    caps = result?.data?.GetCapabilitiesResponse?.Capabilities
      || result?.data?.Capabilities
      || result?.data
      || {}
  } catch {}
  for (const profile of profiles) {
    if (!profile.token) continue
    try {
      const result = await device.services.media.getStreamUri({ ProfileToken: profile.token, Protocol: 'RTSP' })
      // node-onvif 0.1.x returns the SOAP Body wrapper in `data`:
      // { GetStreamUriResponse: { MediaUri: { Uri } } }.
      // Compatible implementations may return the inner object directly.
      profile.streamUri = result?.data?.GetStreamUriResponse?.MediaUri?.Uri
        || result?.data?.MediaUri?.Uri
        || result?.data?.GetStreamUriResponse?.Uri
        || result?.data?.Uri
        || ''
    } catch {}
  }
  const firstStreamProfile = profiles.find(profile => profile.streamUri)
  const streamUri = firstStreamProfile?.streamUri || ''
  const capsNames = Object.keys(caps).filter(key => caps[key] && (typeof caps[key] !== 'object' || Object.keys(caps[key]).length))
  return { info: info || {}, profiles, capabilities: capsNames, streamUri, streamProfileIndex: firstStreamProfile?.index ?? null }
}

function decodeXml(value) {
  return value.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()
}
function xmlValue(xml, tag) {
  const match = xml.match(new RegExp(`<(?:(?:[\\w.-]+):)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${tag}\\s*>`, 'i'))
  return match ? decodeXml(match[1]) : ''
}
function parseDiscoveryPacket(xml) {
  const blocks = [...xml.matchAll(/<(?:[\w.-]+:)?ProbeMatch\b[\s\S]*?<\/(?:[\w.-]+:)?ProbeMatch\s*>/gi)].map(match => match[0])
  return blocks.flatMap(block => {
    const endpoint = block.match(/<(?:[\w.-]+:)?EndpointReference\b[\s\S]*?<\/(?:[\w.-]+:)?EndpointReference\s*>/i)?.[0] || block
    const urn = xmlValue(endpoint, 'Address')
    const xaddrs = xmlValue(block, 'XAddrs').split(/\s+/).filter(Boolean)
    const scopes = xmlValue(block, 'Scopes').split(/\s+/).filter(Boolean)
    const scope = name => {
      const item = scopes.find(value => value.includes(`/www.onvif.org/${name}/`))
      if (!item) return ''
      try { return decodeURIComponent(item.split(`/www.onvif.org/${name}/`).pop().replace(/_/g, ' ')) } catch { return '' }
    }
    return xaddrs.map(serviceUrl => {
      try {
        const parsed = new URL(serviceUrl)
        parsed.username = ''; parsed.password = ''
        return { id: urn || parsed.hostname, host: parsed.hostname, name: scope('name') || scope('hardware') || 'Câmera ONVIF', model: scope('hardware'), manufacturer: '', serviceUrl: parsed.toString(), onvifPort: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)), detectedBy: 'ws-discovery' }
      } catch { return null }
    }).filter(Boolean)
  })
}
async function wsDiscovery() {
  const socket = dgram.createSocket('udp4')
  const found = new Map()
  const message = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><e:Header><w:MessageID>uuid:${randomUUID()}</w:MessageID><w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action><w:ReplyTo><w:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</w:Address></w:ReplyTo></e:Header><e:Body><d:Probe/></e:Body></e:Envelope>`)
  await new Promise((resolve, reject) => {
    let settled = false
    const finish = error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close(() => error ? reject(error) : resolve()) }
      catch (closeError) { error || closeError ? reject(error || closeError) : resolve() }
    }
    socket.on('message', packet => {
      for (const device of parseDiscoveryPacket(packet.toString('utf8'))) {
        const key = device.host.toLowerCase()
        if (!found.has(key)) found.set(key, device)
      }
    })
    socket.once('error', error => finish(error))
    const timer = setTimeout(() => finish(), 3500)
    socket.bind(0, () => {
      let sends = 0
      const send = () => {
        socket.send(message, 3702, '239.255.255.250', error => {
          if (error) { finish(error); return }
          if (++sends < 3) setTimeout(send, 250)
        })
      }
      send()
    })
  })
  return [...found.values()]
}
async function probeOnvifEndpoint(host, port) {
  const serviceUrl = `http://${host}:${port}/onvif/device_service`
  const envelope = '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><s:Body><tds:GetDeviceInformation/></s:Body></s:Envelope>'
  try {
    const response = await fetch(serviceUrl, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation"' }, body: envelope, signal: AbortSignal.timeout(1400) })
    const body = await response.text()
    const onvifReply = /GetDeviceInformationResponse|www\.onvif\.org\/ver10\/device\/wsdl|NotAuthorized/i.test(body)
    const authChallenge = response.status === 401 || response.status === 403
    if (!onvifReply && !authChallenge) return null
    const manufacturer = xmlValue(body, 'Manufacturer')
    const model = xmlValue(body, 'Model')
    return { id: `${host}:${port}`, host, name: manufacturer || model || `Dispositivo ONVIF · ${host}`, manufacturer, model, serviceUrl, onvifPort: port, detectedBy: authChallenge ? 'onvif-auth-required' : 'onvif-endpoint' }
  } catch { return null }
}
async function discoverOnvif() {
  const [wsResults, directResults] = await Promise.all([
    wsDiscovery().catch(() => []),
    Promise.all(DISCOVERY_HOSTS.flatMap(host => DISCOVERY_PORTS.map(port => probeOnvifEndpoint(host, port)))),
  ])
  const results = new Map()
  for (const item of [...wsResults, ...directResults.filter(Boolean)]) {
    const key = item.host.toLowerCase()
    const previous = results.get(key)
    if (!previous || (previous.detectedBy === 'onvif-auth-required' && item.detectedBy !== 'onvif-auth-required')) results.set(key, item)
  }
  return [...results.values()]
}
async function mtxRequest(path, options = {}) {
  let response
  try { response = await fetch(`${MTX_API}/v3/${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(1600) }) }
  catch { throw new Error('MediaMTX API indisponível. Inicie MediaMTX com a API local ativada.') }
  if (!response.ok) throw new Error(`MediaMTX API respondeu ${response.status}`)
  const type = response.headers.get('content-type') || ''
  return type.includes('json') ? response.json() : response.text()
}
async function provision(camera) {
  const name = publicCamera(camera).streamPath
  const source = secureRtsp(camera.rtspUri, camera.username, camera.password)
  const body = JSON.stringify({ source, sourceOnDemand: true, rtspTransport: 'tcp' })
  let exists = false
  try { await mtxRequest(`config/paths/get/${encodeURIComponent(name)}`); exists = true } catch {}
  await mtxRequest(`config/paths/${exists ? 'patch' : 'add'}/${encodeURIComponent(name)}`, { method: exists ? 'PATCH' : 'POST', body })
}
async function removePath(camera) {
  try {
    await mtxRequest(`config/paths/delete/${encodeURIComponent(publicCamera(camera).streamPath)}`, { method: 'DELETE' })
  } catch {}
}
async function cameraStatus(camera) {
  try {
    const path = await mtxRequest(`paths/get/${encodeURIComponent(publicCamera(camera).streamPath)}`)
    return path?.ready ? 'online' : 'offline'
  } catch { return 'offline' }
}
async function testRtspWithMtx(uri, username, password) {
  const testName = `casaview_test_${randomUUID().replaceAll('-', '')}`
  const source = secureRtsp(uri, username, password)
  try {
    await mtxRequest(`config/paths/add/${testName}`, { method: 'POST', body: JSON.stringify({ source, sourceOnDemand: true, rtspTransport: 'tcp' }) })
    const deadline = Date.now() + 9000
    let ready = false
    while (Date.now() < deadline) {
      try { await fetch(`${MTX_HLS}/${testName}/index.m3u8`, { signal: AbortSignal.timeout(900) }) } catch {}
      try { const path = await mtxRequest(`paths/get/${testName}`); if (path?.ready) { ready = true; break } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    if (!ready) throw new Error('MediaMTX não recebeu vídeo. Confirme caminho RTSP, autenticação e codec.')
    return true
  } finally {
    try { await mtxRequest(`config/paths/delete/${testName}`, { method: 'DELETE' }) } catch {}
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.get('/api/ia/alertas', async (_req, res) => {
  try {
    const [cameras, saved] = await Promise.all([readCameras(), readAiAlerts()])
    res.json(Object.fromEntries(cameras.map(camera => [camera.id, {
      pessoas: saved[camera.id]?.pessoas !== false,
      animais: saved[camera.id]?.animais !== false,
    }])))
  } catch (error) { res.status(500).json({ error: safeError(error) }) }
})
app.put('/api/ia/alertas/:cameraId', async (req, res) => {
  try {
    const cameras = await readCameras()
    if (!cameras.some(camera => camera.id === req.params.cameraId)) return res.status(404).json({ error: 'Câmera não encontrada.' })
    if (typeof req.body.pessoas !== 'boolean' || typeof req.body.animais !== 'boolean') {
      return res.status(400).json({ error: 'Escolha se deseja receber alertas de pessoas e de animais.' })
    }
    const alerts = await readAiAlerts()
    alerts[req.params.cameraId] = { pessoas: req.body.pessoas, animais: req.body.animais }
    await writeAiAlerts(alerts)
    res.json(alerts[req.params.cameraId])
  } catch (error) { res.status(500).json({ error: safeError(error) }) }
})
app.get('/api/ia', (_req, res) => {
  const heartbeatAtual = Date.now() - aiWorker.lastHeartbeat < 20000
  const online = heartbeatAtual && ['iniciando', 'ativo'].includes(aiWorker.state)
  res.json({
    online,
    state: heartbeatAtual ? aiWorker.state : 'parado',
    model: aiWorker.model,
    message: heartbeatAtual ? aiWorker.message : 'Execute iniciar.bat com as dependências da IA instaladas.',
    events: aiEvents.slice(0, 30),
  })
})
app.post('/api/ia/pulso', (req, res) => {
  const allowedStates = new Set(['iniciando', 'ativo', 'erro'])
  const state = String(req.body.state || '')
  if (!allowedStates.has(state)) return res.status(400).json({ error: 'Estado do monitoramento inválido.' })
  aiWorker.state = state
  aiWorker.model = String(req.body.model || 'RF-DETR Nano').slice(0, 60)
  aiWorker.message = String(req.body.message || '').slice(0, 160)
  aiWorker.lastHeartbeat = Date.now()
  res.status(204).end()
})
app.post('/api/ia/eventos', async (req, res) => {
  try {
    const cameraId = String(req.body.cameraId || '')
    const className = String(req.body.className || '')
    const allowedClasses = new Set(['pessoa', 'cachorro', 'gato', 'pássaro', 'cavalo', 'ovelha', 'vaca', 'elefante', 'urso', 'zebra', 'girafa'])
    if (!allowedClasses.has(className)) return res.status(400).json({ error: 'Classe de detecção inválida.' })
    const cameras = await readCameras()
    const camera = cameras.find(item => item.id === cameraId)
    if (!camera) return res.status(404).json({ error: 'Câmera não encontrada.' })
    const confidence = Math.max(0, Math.min(1, Number(req.body.confidence) || 0))
    const event = {
      id: randomUUID(), cameraId, cameraName: camera.name, cameraHost: camera.host, className, confidence,
      count: Math.max(1, Math.min(50, Math.trunc(Number(req.body.count) || 1))),
      zone: String(req.body.zone || 'Área inteira').slice(0, 60), createdAt: new Date().toISOString(),
    }
    const imagemBase64 = String(req.body.snapshot || '')
    if (imagemBase64) {
      if (imagemBase64.length > 400_000 || !/^\/9j\/[A-Za-z0-9+/]+=*$/.test(imagemBase64)) {
        return res.status(400).json({ error: 'Imagem do evento inválida ou muito grande.' })
      }
      const imagem = Buffer.from(imagemBase64, 'base64')
      if (imagem.length > 300_000 || imagem[0] !== 0xff || imagem[1] !== 0xd8 || imagem.at(-2) !== 0xff || imagem.at(-1) !== 0xd9) {
        return res.status(400).json({ error: 'A captura do evento não é um JPEG válido.' })
      }
      aiSnapshots.set(event.id, imagem)
      event.hasSnapshot = true
    }
    aiEvents.unshift(event)
    if (aiEvents.length > 30) {
      const removidos = aiEvents.splice(30)
      for (const antigo of removidos) aiSnapshots.delete(antigo.id)
    }
    res.status(201).json({ ok: true })
  } catch (error) { res.status(500).json({ error: safeError(error) }) }
})
app.get('/api/ia/eventos/:id/imagem', (req, res) => {
  const imagem = aiSnapshots.get(req.params.id)
  if (!imagem) return res.status(404).end()
  // IDs são UUID e a captura nunca muda: o navegador pode reaproveitar.
  res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'private, max-age=86400, immutable').send(imagem)
})
app.get('/api/cameras', async (_req, res) => {
  try {
    const cameras = await readCameras()
    res.json(await Promise.all(cameras.map(async c => publicCamera(c, await cameraStatus(c)))))
  } catch (error) { res.status(500).json({ error: safeError(error) }) }
})
app.post('/api/discover', async (_req, res) => {
  try {
    const [found, cameras] = await Promise.all([discoverOnvif(), readCameras()])
    const existing = new Set(cameras.map(camera => camera.host.toLowerCase()))
    const unique = new Map()
    for (const device of found || []) {
      const serviceUrl = device.serviceUrl || device.xaddrs?.[0]
      if (!serviceUrl) continue
      try {
        const parsed = new URL(serviceUrl)
        const host = device.host || parsed.hostname
        if (!host) continue
        if (!unique.has(host.toLowerCase())) unique.set(host.toLowerCase(), { ...device, host, serviceUrl, registered: existing.has(host.toLowerCase()) })
      } catch {}
    }
    res.json({ cameras: [...unique.values()] })
  } catch { res.status(200).json({ cameras: [], message: 'Nenhuma câmera respondeu à descoberta ONVIF. Dispositivos sem WS-Discovery podem ser adicionados manualmente.' }) }
})
app.post('/api/cameras/test', async (req, res) => {
  try {
    const host = normalizeHost(req.body.host)
    const input = { host, onvifPort: req.body.onvifPort, serviceUrl: req.body.serviceUrl, username: String(req.body.username || ''), password: String(req.body.password || '') }
    const hasOnvif = req.body.useOnvif !== false && Boolean(input.onvifPort || input.serviceUrl)
    let details = { info: {}, profiles: [], capabilities: [], streamUri: '' }
    if (hasOnvif) details = await onvifDetails(input)
    const selectedUri = String(req.body.rtspUri || details.streamUri || '')
    let rtspTested = false
    if (selectedUri) { await testRtspWithMtx(selectedUri, input.username, input.password); rtspTested = true }
    else if (!hasOnvif) throw new Error('Informe uma URL RTSP para testar o stream.')
    const rtspToken = randomUUID()
    if (selectedUri) testedStreams.set(rtspToken, { uri: selectedUri, profileIndex: req.body.rtspUri ? null : details.streamProfileIndex, host, username: input.username, password: input.password, created: Date.now() })
    for (const [token, item] of testedStreams) if (Date.now() - item.created > 10 * 60 * 1000) testedStreams.delete(token)
    res.json({ ok: true, onvif: hasOnvif, rtspTested, rtspToken: selectedUri ? rtspToken : '', manufacturer: details.info.Manufacturer || '', model: details.info.Model || '', profiles: publicProfiles(details.profiles), selectedProfileIndex: details.streamProfileIndex, capabilities: details.capabilities, rtspAvailable: Boolean(selectedUri) })
  } catch (error) { res.status(400).json({ error: safeError(error) }) }
})
app.post('/api/cameras', async (req, res) => {
  try {
    const host = normalizeHost(req.body.host)
    const name = String(req.body.name || '').trim().slice(0, 80)
    const username = String(req.body.username || '')
    const password = String(req.body.password || '')
    if (!name) return res.status(400).json({ error: 'Informe um nome para a câmera.' })
    let details = { info: {}, profiles: [], capabilities: [], streamUri: '' }
    const hasOnvif = req.body.useOnvif !== false && Boolean(req.body.onvifPort || req.body.serviceUrl)
    if (hasOnvif) details = await onvifDetails({ host, onvifPort: req.body.onvifPort, serviceUrl: req.body.serviceUrl, username, password })
    const tokenResult = req.body.testToken ? testedStreams.get(String(req.body.testToken)) : null
    if (!tokenResult || tokenResult.host !== host || tokenResult.username !== username || tokenResult.password !== password || (req.body.rtspUri && tokenResult.uri !== req.body.rtspUri)) {
      return res.status(400).json({ error: 'Teste a conexão depois de preencher os dados antes de adicionar a câmera.' })
    }
    const rtspUri = String(req.body.rtspUri || (tokenResult?.host === host && tokenResult?.username === username ? tokenResult.uri : '') || details.streamUri || '')
    if (!rtspUri) return res.status(400).json({ error: 'Não foi possível obter a URI automaticamente. Informe o endereço RTSP.' })
    secureRtsp(rtspUri, username, password)
    const cameras = await readCameras()
    if (cameras.some(camera => camera.host.toLowerCase() === host.toLowerCase())) return res.status(409).json({ error: 'Este endereço já está cadastrado.' })
    const camera = { id: randomUUID(), name, host, onvifPort: hasOnvif ? Number(req.body.onvifPort || 80) : '', serviceUrl: String(req.body.serviceUrl || ''), onvif: hasOnvif, username, password, rtspUri, selectedProfileIndex: req.body.rtspUri ? null : tokenResult?.profileIndex ?? details.streamProfileIndex, profiles: details.profiles, capabilities: details.capabilities, manufacturer: details.info.Manufacturer || '', model: details.info.Model || '' }
    cameras.push(camera)
    if (req.body.testToken) testedStreams.delete(String(req.body.testToken))
    await writeCameras(cameras)
    await provision(camera).catch(() => {})
    res.status(201).json(publicCamera(camera, await cameraStatus(camera)))
  } catch (error) { res.status(400).json({ error: safeError(error) }) }
})
app.patch('/api/cameras/:id', async (req, res) => {
  try {
    const cameras = await readCameras()
    const camera = cameras.find(item => item.id === req.params.id)
    if (!camera) return res.status(404).json({ error: 'Câmera não encontrada.' })
    camera.name = String(req.body.name || camera.name).trim().slice(0, 80)
    const fields = ['host', 'onvifPort', 'username', 'password', 'rtspUri']
    for (const field of fields) if (req.body[field] !== undefined && !(field === 'password' && !req.body[field]) && !(field === 'username' && !req.body[field])) {
      if (field === 'rtspUri' && !req.body[field]) continue
      camera[field] = field === 'host' ? normalizeHost(req.body[field]) : String(req.body[field])
    }
    if (req.body.useOnvif !== undefined) camera.onvif = Boolean(req.body.useOnvif)
    if (req.body.refreshOnvif && camera.onvif) {
      const details = await onvifDetails({ host: camera.host, onvifPort: camera.onvifPort, username: camera.username, password: camera.password })
      camera.profiles = details.profiles; camera.capabilities = details.capabilities
      if (!camera.rtspUri) camera.rtspUri = details.streamUri
    }
    secureRtsp(camera.rtspUri, camera.username, camera.password)
    await writeCameras(cameras)
    await provision(camera).catch(() => {})
    res.json(publicCamera(camera, await cameraStatus(camera)))
  } catch (error) { res.status(400).json({ error: safeError(error) }) }
})
app.post('/api/cameras/:id/test', async (req, res) => {
  try {
    const camera = (await readCameras()).find(item => item.id === req.params.id)
    if (!camera) return res.status(404).json({ error: 'Câmera não encontrada.' })
    const candidate = { ...camera, ...req.body, onvif: req.body.useOnvif ?? camera.onvif, onvifPort: req.body.onvifPort || camera.onvifPort, serviceUrl: req.body.serviceUrl || camera.serviceUrl, username: req.body.username || camera.username, password: req.body.password || camera.password, host: normalizeHost(req.body.host || camera.host), rtspUri: req.body.rtspUri || camera.rtspUri }
    const details = candidate.onvif ? await onvifDetails(candidate) : { profiles: [], capabilities: [], streamUri: '' }
    const uri = candidate.rtspUri || details.streamUri
    if (!uri) return res.status(400).json({ error: 'Informe o endereço RTSP para testar a transmissão.' })
    await testRtspWithMtx(uri, candidate.username, candidate.password)
    res.json({ ok: true, status: 'online', profiles: publicProfiles(details.profiles), capabilities: details.capabilities, selectedProfileIndex: camera.selectedProfileIndex ?? details.streamProfileIndex, rtspTested: true })
  } catch (error) { res.status(400).json({ error: safeError(error) }) }
})
app.delete('/api/cameras/:id', async (req, res) => {
  try {
    const cameras = await readCameras()
    const camera = cameras.find(item => item.id === req.params.id)
    if (!camera) return res.status(404).json({ error: 'Câmera não encontrada.' })
    await removePath(camera)
    await writeCameras(cameras.filter(item => item.id !== camera.id))
    res.status(204).end()
  } catch (error) { res.status(500).json({ error: safeError(error) }) }
})
app.get('/api/cameras/:id/capabilities', async (req, res) => {
  try {
    const camera = (await readCameras()).find(item => item.id === req.params.id)
    if (!camera) return res.status(404).json({ error: 'Câmera não encontrada.' })
    const details = await onvifDetails(camera)
    res.json({ profiles: publicProfiles(details.profiles), capabilities: details.capabilities, selectedProfileIndex: camera.selectedProfileIndex ?? details.streamProfileIndex })
  } catch (error) { res.status(400).json({ error: safeError(error) }) }
})
app.put('/api/cameras/:id/profile', async (req, res) => {
  try {
    const cameras = await readCameras()
    const camera = cameras.find(item => item.id === req.params.id)
    if (!camera) return res.status(404).json({ error: 'Câmera não encontrada.' })
    if (!camera.onvif) return res.status(400).json({ error: 'Esta câmera não disponibiliza perfis ONVIF.' })
    const profileIndex = Number(req.body.profileIndex)
    if (!Number.isInteger(profileIndex) || profileIndex < 0) return res.status(400).json({ error: 'Selecione um perfil de vídeo válido.' })
    const details = await onvifDetails(camera)
    const profile = details.profiles.find(item => item.index === profileIndex && item.streamUri)
    if (!profile) return res.status(400).json({ error: 'A câmera não forneceu uma transmissão para esse perfil.' })
    await testRtspWithMtx(profile.streamUri, camera.username, camera.password)
    const cameraAtualizada = { ...camera, rtspUri: profile.streamUri, selectedProfileIndex: profile.index, profiles: details.profiles, capabilities: details.capabilities }
    await provision(cameraAtualizada)
    Object.assign(camera, cameraAtualizada)
    await writeCameras(cameras)
    res.json({ ok: true, selectedProfileIndex: profile.index, profile: publicProfiles([profile])[0] })
  } catch (error) { res.status(400).json({ error: safeError(error) }) }
})

app.listen(PORT, '127.0.0.1', () => console.log(`CasaView API pronta em http://127.0.0.1:${PORT}`))
const reconcile = async () => {
  try { for (const camera of await readCameras()) await provision(camera).catch(() => {}) } catch {}
}
setTimeout(reconcile, 3000)
setInterval(reconcile, 30000)
