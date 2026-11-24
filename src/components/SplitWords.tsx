// Revelação palavra por palavra (mesma ideia do SplitReveal do site Sidware), só no carregamento.
export default function SplitWords({ text, from = 0 }: { text: string; from?: number }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <span className="split-word" aria-hidden="true">
            <span className="split-word-inner" style={{ animationDelay: `${0.05 + (from + i) * 0.06}s` }}>{word}</span>
          </span>
        </span>
      ))}
    </>
  )
}
