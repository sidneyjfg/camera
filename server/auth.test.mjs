import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import express from 'express'
import { createAuth } from './auth.mjs'

const SENHA = 'frase longa e segura 2026'
let dir, upstream, server, base, token

// fetch do Node não deixa controlar Origin/Cookie como o navegador; http.request deixa.
function call(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = httpRequest(`${base}${path}`, { method, headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode, headers: res.headers, text, json: text.startsWith('{') ? JSON.parse(text) : null })
      })
    })
    req.on('error', reject)
    req.end(payload)
  })
}
const cookieOf = res => String(res.headers['set-cookie']?.[0] || '').split(';')[0]

async function start() {
  dir = await mkdtemp(join(tmpdir(), 'casaview-auth-'))
  upstream = createServer((req, res) => {
    if (req.url === '/cam/index.m3u8') return res.writeHead(302, { Location: '/cam/index.m3u8?cookieCheck=1' }).end()
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`cookie=${req.headers.cookie || ''}`)
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const auth = await createAuth({ dataDir: dir, mediaTarget: `http://127.0.0.1:${upstream.address().port}` })
  token = (await readFile(join(dir, 'servico.token'), 'utf8')).trim()
  const app = express()
  app.use(express.json())
  app.use(['/api', '/media'], auth.guard)
  app.use('/api/auth', auth.router)
  app.use('/media', auth.mediaProxy)
  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.get('/api/cameras', (_req, res) => res.json([]))
  app.post('/api/ia/pulso', (_req, res) => res.status(204).end())
  app.delete('/api/cameras/:id', (_req, res) => res.status(204).end())
  server = createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
}

describe('autenticação', () => {
  before(start)
  after(async () => { server.close(); upstream.close(); await rm(dir, { recursive: true, force: true }) })

  it('antes de definir a senha, login pede a criação e rotas exigem sessão', async () => {
    assert.deepEqual((await call('GET', '/api/auth/estado')).json, { configurado: false, autenticado: false })
    assert.equal((await call('POST', '/api/auth/login', { body: { senha: SENHA } })).status, 409)
    assert.equal((await call('GET', '/api/cameras')).status, 401)
    assert.equal((await call('GET', '/api/health')).status, 200)
  })

  it('recusa senha fraca e criação atrás de túnel', async () => {
    assert.equal((await call('POST', '/api/auth/setup', { body: { senha: 'curta' } })).status, 400)
    assert.equal((await call('POST', '/api/auth/setup', { body: { senha: 'aaaaaaaaaaaaaaaa' } })).status, 400)
    const viaTunel = await call('POST', '/api/auth/setup', { body: { senha: SENHA }, headers: { 'cf-connecting-ip': '203.0.113.9' } })
    assert.equal(viaTunel.status, 403)
  })

  let cookie
  it('cria a senha, abre sessão HttpOnly/Strict e não grava a senha em texto', async () => {
    const res = await call('POST', '/api/auth/setup', { body: { senha: SENHA } })
    assert.equal(res.status, 204)
    assert.match(res.headers['set-cookie'][0], /HttpOnly/)
    assert.match(res.headers['set-cookie'][0], /SameSite=Strict/)
    cookie = cookieOf(res)
    assert.ok(!(await readFile(join(dir, 'auth.dpapi'))).includes(Buffer.from(SENHA)))
    assert.equal((await call('POST', '/api/auth/setup', { body: { senha: SENHA } })).status, 409)
  })

  it('sessão libera rotas; sem cookie continua 401; sair encerra a sessão', async () => {
    assert.equal((await call('GET', '/api/cameras', { headers: { cookie } })).status, 200)
    assert.equal((await call('GET', '/api/cameras', { headers: { cookie: 'casaview_sessao=falso' } })).status, 401)
    assert.deepEqual((await call('GET', '/api/auth/estado', { headers: { cookie } })).json, { configurado: true, autenticado: true })
    assert.equal((await call('POST', '/api/auth/sair', { headers: { cookie } })).status, 204)
    assert.equal((await call('GET', '/api/cameras', { headers: { cookie } })).status, 401)
  })

  it('bloqueia escrita com Origin de outro site', async () => {
    const login = await call('POST', '/api/auth/login', { body: { senha: SENHA } })
    cookie = cookieOf(login)
    const evil = await call('DELETE', '/api/cameras/x', { headers: { cookie, origin: 'https://evil.example' } })
    assert.equal(evil.status, 403)
    const own = await call('DELETE', '/api/cameras/x', { headers: { cookie, origin: base } })
    assert.equal(own.status, 204)
  })

  it('token de serviço vale só nas rotas do worker', async () => {
    const h = { 'x-casaview-servico': token }
    assert.equal((await call('POST', '/api/ia/pulso', { headers: h, body: {} })).status, 204)
    assert.equal((await call('GET', '/api/cameras', { headers: h })).status, 200)
    assert.equal((await call('DELETE', '/api/cameras/x', { headers: h })).status, 401)
    assert.equal((await call('POST', '/api/ia/pulso', { headers: { 'x-casaview-servico': 'errado' }, body: {} })).status, 401)
  })

  it('vídeo só com sessão, mantém /media nos redirecionamentos e não repassa o cookie da sessão', async () => {
    assert.equal((await call('GET', '/media/cam/index.m3u8')).status, 401)
    const redirect = await call('GET', '/media/cam/index.m3u8', { headers: { cookie } })
    assert.equal(redirect.status, 302)
    assert.equal(redirect.headers.location, '/media/cam/index.m3u8?cookieCheck=1')
    const body = await call('GET', '/media/outro', { headers: { cookie: `${cookie}; mtx=1` } })
    assert.equal(body.text, 'cookie=mtx=1')
  })

  it('erra 3 vezes e passa a bloquear, inclusive a senha certa', async () => {
    for (let i = 0; i < 3; i += 1) assert.equal((await call('POST', '/api/auth/login', { body: { senha: 'errada errada errada' } })).status, 401)
    const bloqueado = await call('POST', '/api/auth/login', { body: { senha: SENHA } })
    assert.equal(bloqueado.status, 429)
    assert.ok(Number(bloqueado.headers['retry-after']) >= 1)
  })
})
