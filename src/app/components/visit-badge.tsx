import {useVisits} from '../hooks/use-visits.js'

/** Penghitung pengunjung unik — kecil, di pojok kanan atas. Tersembunyi selama memuat atau kalau belum ada data. */
export function VisitBadge({className = ''}: {className?: string}) {
  const counts = useVisits()
  if (!counts || counts.unique === 0) return null
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[12px] text-[#666] whitespace-nowrap ${className}`}
      title="Unique visitors">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3.5 h-3.5"
        aria-hidden="true">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
      <span>
        <span className="text-[#8b8b93]">{counts.unique.toLocaleString('en-US')}</span> visitors
      </span>
    </span>
  )
}
