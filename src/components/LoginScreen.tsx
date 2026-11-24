import { useState, type FormEvent } from 'react'
import { LoaderCircle, Video } from 'lucide-react'
import { api } from '../api'

export default function LoginScreen({ modo, onDone }: { modo: 'setup' | 'login'; onDone: () => void }) {
  const setup = modo === 'setup'
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (setup && senha !== confirmacao) { setErro('As duas senhas precisam ser iguais.'); return }
    setBusy(true); setErro('')
    try {
      await api(setup ? '/auth/setup' : '/auth/login', { method: 'POST', body: JSON.stringify({ senha }) })
      onDone()
    } catch (e) {
      setErro((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={e => void submit(e)}>
        <span className="brand auth-brand"><span className="brand-mark"><Video size={18} /></span><span>Casa<span className="brand-light">View</span></span></span>
        <h1>{setup ? 'Crie a senha do painel' : 'Entrar'}</h1>
        <p className="auth-hint">
          {setup ? 'Use pelo menos 12 caracteres. Uma frase longa é mais segura que símbolos. Esta senha só pode ser criada neste computador.' : 'Digite a senha do painel para ver as câmeras.'}
        </p>
        <label>Senha
          <input type="password" autoFocus required autoComplete={setup ? 'new-password' : 'current-password'} value={senha} onChange={e => setSenha(e.target.value)} />
        </label>
        {setup && (
          <label>Repita a senha
            <input type="password" required autoComplete="new-password" value={confirmacao} onChange={e => setConfirmacao(e.target.value)} />
          </label>
        )}
        {erro && <div className="form-notice auth-error" role="alert">{erro}</div>}
        <button className="primary-button auth-submit" type="submit" disabled={busy || !senha}>
          {busy && <LoaderCircle size={15} className="spin" />} {setup ? 'Criar senha e entrar' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
