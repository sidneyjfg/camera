import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Dpapi } from '@primno/dpapi'
import express from 'express'

const scryptAsync = promisify(scrypt)
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const entropy = Buffer.from('CasaView panel password v1', 'utf8')
const COOKIE = 'casaview_sessao'
const SESSION_MS = 7 * 24 * 60 * 60 * 1000
const SERVICE_HEADER = 'x-casaview-servico'
const PUBLIC_ROUTES = new Set(['GET /api/health', 'GET /api/auth/estado', 'POST /api/auth/setup', 'POST /api/auth/login', 'POST /api/auth/sair'])
// Só o que o worker de IA (ia/monitoramento.py) precisa; o resto exige sessão.
const SERVICE_ROUTES = new Set(['GET /api/cameras', 'GET /api/ia/alertas', 'POST /api/ia/pulso', 'POST /api/ia/eventos'])
// Cabeçalhos que um túnel/proxy reverso acrescenta; a criação da senha só vale sem eles.
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'cf-ray']

const digest = value => createHash('sha256').update(value).digest()
const sameSecret = (a, b) => timingSafeEqual(digest(a), digest(b))
const derive = (senha, salt) => scryptAsync(senha.normalize('NFKC'), salt, 64, SCRYPT)

function passwordProblem(senha) {
  if (typeof senha !== 'string') return 'Informe a senha.'
  if (senha.length < 12) return 'Use pelo menos 12 caracteres. Uma frase longa é mais segura que símbolos.'
  if (senha.length > 128) return 'Use no máximo 128 caracteres.'
  if (new Set(senha).size < 5) return 'Use uma senha com mais variedade de caracteres.'
  return ''
}

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return ''
}

function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted)
}

// Bloqueia escrita vinda de outro site; o cookie SameSite=Strict já cobre o caso comum.
function sameOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true
  const origin = req.headers.origin
  if (!origin) return true
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

async function readOrCreateServiceToken(dataDir) {
  const file = join(dataDir, 'servico.token')
  try {
    const token = (await readFile(file, 'utf8')).trim()
    if (/^[0-9a-f]{64}$/.test(token)) return token
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const token = randomBytes(32).toString('hex')
  await mkdir(dataDir, { recursive: true })
  await writeFile(file, token, 'utf8')
  return token
}

async function readCredential(file) {
  try {
    const stored = JSON.parse(Dpapi.unprotectData(await readFile(file), entropy, 'CurrentUser').toString('utf8'))
    return { salt: Buffer.from(stored.salt, 'base64'), hash: Buffer.from(stored.hash, 'base64') }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    // Não cai em "criar senha nova" se o arquivo existe mas não abre: pode ser outro usuário Windows.
    throw new Error('O arquivo da senha do painel não pôde ser aberto por este usuário Windows. Apague auth.dpapi em %APPDATA%\\CasaView para criar outra senha.')
  }
}

async function saveCredential(file, dataDir, { salt, hash }) {
  await mkdir(dataDir, { recursive: true })
  const payload = JSON.stringify({ v: 1, salt: salt.toString('base64'), hash: hash.toString('base64') })
  const tmp = `${file}.tmp`
  await writeFile(tmp, Dpapi.protectData(Buffer.from(payload), entropy, 'CurrentUser'))
  await rename(tmp, file)
}

export async function createAuth({ dataDir, mediaTarget = 'http://127.0.0.1:8888' }) {
  const authFile = join(dataDir, 'auth.dpapi')
  let credential = await readCredential(authFile)
  const serviceToken = await readOrCreateServiceToken(dataDir)
  const sessions = new Map() // sha256(token) -> expira em; em memória, reiniciar o backend desconecta todos
  let failures = 0
  let lockedUntil = 0
  let verifying = false // uma verificação por vez: rajada paralela não multiplica as tentativas

  const sessionKey = req => digest(cookieValue(req, COOKIE)).toString('hex')
  const hasSession = req => (sessions.get(sessionKey(req)) || 0) > Date.now() && Boolean(cookieValue(req, COOKIE))
  const cookieHeader = (req, value, maxAge) =>
    `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`

  function startSession(req, res) {
    const now = Date.now()
    for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key)
    const token = randomBytes(32).toString('base64url')
    sessions.set(digest(token).toString('hex'), now + SESSION_MS)
    res.setHeader('Set-Cookie', cookieHeader(req, token, SESSION_MS / 1000))
  }

  const lockSeconds = () => Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000))

  function guard(req, res, next) {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Origem não permitida.' })
    const route = `${req.method} ${req.originalUrl.split('?')[0]}`
    if (PUBLIC_ROUTES.has(route) || hasSession(req)) return next()
    const token = String(req.headers[SERVICE_HEADER] || '')
    if (SERVICE_ROUTES.has(route) && token && sameSecret(token, serviceToken)) return next()
    res.status(401).json({ error: 'Faça login para continuar.' })
  }

  const router = express.Router()
  router.get('/estado', (req, res) => res.json({ configurado: Boolean(credential), autenticado: hasSession(req) }))

  router.post('/setup', async (req, res, next) => {
    try {
      if (credential) return res.status(409).json({ error: 'A senha do painel já foi definida.' })
      if (PROXY_HEADERS.some(name => name in req.headers)) return res.status(403).json({ error: 'A senha só pode ser criada neste computador, sem passar pelo túnel.' })
      const senha = req.body?.senha
      const problem = passwordProblem(senha)
      if (problem) return res.status(400).json({ error: problem })
      const salt = randomBytes(16)
      const hash = await derive(senha, salt)
      if (credential) return res.status(409).json({ error: 'A senha do painel já foi definida.' })
      await saveCredential(authFile, dataDir, { salt, hash })
      credential = { salt, hash }
      startSession(req, res)
      res.status(204).end()
    } catch (error) { next(error) }
  })

  router.post('/login', async (req, res, next) => {
    try {
      if (!credential) return res.status(409).json({ error: 'Defina a senha do painel primeiro.' })
      const wait = lockSeconds()
      if (wait > 0 || verifying) {
        return res.status(429).set('Retry-After', String(wait || 1)).json({ error: `Muitas tentativas. Tente de novo em ${wait || 1} s.` })
      }
      const senha = req.body?.senha
      verifying = true
      let ok = false
      try { ok = typeof senha === 'string' && senha.length <= 128 && timingSafeEqual(await derive(senha, credential.salt), credential.hash) }
      finally { verifying = false }
      if (!ok) {
        failures += 1
        // shortcut: bloqueio global (o IP real some atrás do túnel); quem errar a senha pode atrasar o dono em até 15 min.
        if (failures >= 3) lockedUntil = Date.now() + Math.min(900, 5 * 2 ** (failures - 3)) * 1000
        return res.status(401).json({ error: 'Senha incorreta.' })
      }
      failures = 0
      lockedUntil = 0
      startSession(req, res)
      res.status(204).end()
    } catch (error) { next(error) }
  })

  router.post('/sair', (req, res) => {
    sessions.delete(sessionKey(req))
    res.setHeader('Set-Cookie', cookieHeader(req, '', 0))
    res.status(204).end()
  })

  // O vídeo HLS passa pelo backend para exigir a mesma sessão; o MediaMTX fica só no loopback.
  const target = new URL(mediaTarget)
  function mediaProxy(req, res) {
    const headers = { ...req.headers, host: target.host }
    delete headers.connection
    const cookies = String(req.headers.cookie || '').split(';').map(item => item.trim()).filter(item => item && !item.startsWith(`${COOKIE}=`))
    if (cookies.length) headers.cookie = cookies.join('; ')
    else delete headers.cookie
    const upstream = httpRequest({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers }, upstreamRes => {
      const outHeaders = { ...upstreamRes.headers }
      // MediaMTX redireciona para /<path>/index.m3u8?cookieCheck=1; mantém o prefixo /media.
      if (typeof outHeaders.location === 'string' && outHeaders.location.startsWith('/')) outHeaders.location = `/media${outHeaders.location}`
      res.writeHead(upstreamRes.statusCode || 502, outHeaders)
      upstreamRes.pipe(res)
    })
    upstream.on('error', () => {
      if (res.headersSent) res.destroy()
      else res.status(502).json({ error: 'Vídeo indisponível. Confira se o MediaMTX está em execução.' })
    })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  }

  return { guard, router, mediaProxy }
}
