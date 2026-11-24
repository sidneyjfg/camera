export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  } catch {
    throw new Error('A API local do CasaView está desconectada. Abra iniciar.bat e mantenha a janela aberta.')
  }
  const data = await response.json().catch(() => ({}))
  if (response.status === 401) window.dispatchEvent(new Event('casaview:sessao-expirada'))
  if (!response.ok) throw new Error(data.error || `A API local respondeu com erro (${response.status}).`)
  return data as T
}
