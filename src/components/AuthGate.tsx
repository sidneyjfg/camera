import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import LoginScreen from './LoginScreen'

type Estado = 'carregando' | 'erro' | 'setup' | 'login' | 'ok'

// Só monta o painel (e seus pedidos periódicos) depois de a sessão estar válida.
export default function AuthGate({ children }: { children: (sair: () => void) => ReactNode }) {
  const [estado, setEstado] = useState<Estado>('carregando')
  const [erro, setErro] = useState('')

  const verificar = useCallback(() => {
    setEstado('carregando')
    api<{ configurado: boolean; autenticado: boolean }>('/auth/estado')
      .then(e => setEstado(!e.configurado ? 'setup' : e.autenticado ? 'ok' : 'login'))
      .catch(e => { setErro((e as Error).message); setEstado('erro') })
  }, [])
  useEffect(verificar, [verificar])
  useEffect(() => {
    const expirou = () => setEstado(s => (s === 'ok' ? 'login' : s))
    window.addEventListener('casaview:sessao-expirada', expirou)
    return () => window.removeEventListener('casaview:sessao-expirada', expirou)
  }, [])

  const sair = () => { api('/auth/sair', { method: 'POST' }).catch(() => undefined).finally(() => setEstado('login')) }

  if (estado === 'ok') return <>{children(sair)}</>
  if (estado === 'setup' || estado === 'login') return <LoginScreen key={estado} modo={estado} onDone={() => setEstado('ok')} />
  return (
    <main className="auth-screen">
      <div className="auth-card">
        {estado === 'erro' ? (
          <>
            <p className="auth-hint" role="alert">{erro}</p>
            <button className="secondary-button" onClick={verificar}>Tentar de novo</button>
          </>
        ) : <p className="auth-hint">Carregando…</p>}
      </div>
    </main>
  )
}
