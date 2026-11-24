import { Camera as CameraIcon } from 'lucide-react'
import type { EstadoIA } from '../types'

const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

export default function ActivityPanel({ estado }: { estado: EstadoIA }) {
  const stateLabel = estado.state === 'iniciando'
    ? (estado.message.includes('carregando modelo') ? 'Carregando modelo' : 'Aguardando câmera')
    : estado.online ? 'Monitorando' : 'IA parada'
  const emptyText = estado.state === 'iniciando' ? estado.message : estado.online ? 'Aguardando pessoas ou animais nas áreas monitoradas.' : estado.message

  return (
    <section className="ai-activity">
      <div className="section-heading ai-activity-heading">
        <div><h2>Atividade recente</h2></div>
        <span className={`ai-state ${estado.online ? 'ai-state--active' : ''}`}><i />{stateLabel}</span>
      </div>
      {estado.state === 'erro' && <p className="ai-message ai-message--error">{estado.message}</p>}
      {estado.events.length === 0 ? <div className="ai-empty">{emptyText}</div> : (
        <div className="ai-events">
          {estado.events.map(event => {
            const img = `/api/ia/eventos/${event.id}/imagem`
            return (
              <article className="ai-event" key={event.id}>
                <span className="ai-event-mark"><CameraIcon size={15} /></span>
                <div className="ai-event-copy">
                  <b>{event.className[0].toLocaleUpperCase('pt-BR') + event.className.slice(1)} detectado{event.count > 1 ? 's' : ''} · {event.cameraName}</b>
                  <small>{event.cameraHost} · {event.zone} · confiança {Math.round(event.confidence * 100)}%</small>
                </div>
                {event.hasSnapshot && (
                  <a className="ai-event-snapshot" href={img} target="_blank" rel="noreferrer" aria-label={`Abrir captura do evento da câmera ${event.cameraName} em ${event.cameraHost}`}>
                    <img src={img} alt={`Captura: ${event.className} detectado por ${event.cameraName} em ${event.cameraHost}`} />
                  </a>
                )}
                <time>{hora.format(new Date(event.createdAt))}</time>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
