import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({ label, className = '', onClose, children }: { label: string; className?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <section className={`form-modal ${className}`.trim()} role="dialog" aria-modal="true" aria-label={label}>{children}</section>
    </div>
  )
}

export function ModalHeading({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div className="modal-heading">
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={17} /></button>
    </div>
  )
}
