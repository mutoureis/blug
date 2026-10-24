import {useEffect, useRef, useState} from 'react'
import type {CSSProperties, ReactNode} from 'react'
import {useLanyard, DISCORD_STATUS_META} from '../hooks/use-lanyard.js'

/* Menu "Social" — bottom sheet di HP, popover di desktop (gayanya ada di tailwind.css: .social-*).
   - Ikon garis SVG (seragam dengan ikon nav), bukan emoji.
   - Dikelompokkan + handle akun di bawah nama.
   - Email: tombol Copy (alamat dirakit di JS, tidak tertulis polos di HTML).
   - Status Discord live (Lanyard) — WebSocket cuma dibuka saat sheet terbuka.
   - Esc / tap area gelap / tarik ke bawah untuk menutup. */

const ICONS: Record<string, ReactNode> = {
  discord: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12z" />,
  threads: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 12v1.6a2.6 2.6 0 0 0 5.2 0V12a9.2 9.2 0 1 0-3.6 7.3" />
    </>
  ),
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.3" cy="6.7" r="0.6" />
    </>
  ),
  letterboxd: (
    <>
      <circle cx="6.5" cy="12" r="3.5" />
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="17.5" cy="12" r="3.5" />
    </>
  ),
  spotify: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 9.5c3-1 6.5-0.7 9 0.8M8 12.5c2.5-0.7 5-0.5 7.5 0.8M8.5 15.3c2-0.5 4-0.3 6 0.6" />
    </>
  ),
  steam: (
    <>
      <rect x="2.5" y="7" width="19" height="11" rx="5" />
      <path d="M8 10.5v4M6 12.5h4" />
      <circle cx="16" cy="11.5" r="0.8" />
      <circle cx="18" cy="13.5" r="0.8" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
}

function Icon({name}: {name: string}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
      aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

function ArrowOut() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="#4a4a52"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4 shrink-0"
      aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  )
}

type Item = {key: string; label: string; sub: string; href: string; color: string}
type Group = {title: string; items: Item[]}

const GROUPS: Group[] = [
  {
    title: 'Community',
    items: [{key: 'discord', label: 'Discord', sub: 'KIKEN server', href: 'https://discord.gg/DNcNBQaqgM', color: '#7c6ff7'}],
  },
  {
    title: 'Social',
    items: [
      {key: 'threads', label: 'Threads', sub: '@rioumoe', href: 'https://www.threads.com/@rioumoe', color: '#4a9eff'},
      {key: 'instagram', label: 'Instagram', sub: '@mthrrbrqh', href: 'https://www.instagram.com/mthrrbrqh', color: '#e1306c'},
    ],
  },
  {
    title: 'Interests',
    items: [
      {key: 'letterboxd', label: 'Letterboxd', sub: 'film log', href: 'https://boxd.it/hBByx', color: '#40bcf4'},
      {
        key: 'spotify',
        label: 'Spotify',
        sub: 'profile & playlists',
        href: 'https://open.spotify.com/user/zq8df1jprwpxyiu9mkn691ai8',
        color: '#1ed760',
      },
      {key: 'steam', label: 'Steam', sub: 'moebatsu', href: 'https://steamcommunity.com/id/moebatsu', color: '#9aa7b8'},
    ],
  },
]

const TOTAL_LINKS = GROUPS.reduce((n, g) => n + g.items.length, 0) + 1 // + email

function IconBox({name, color, dot}: {name: string; color: string; dot?: string}) {
  return (
    <span
      className="relative w-10 h-10 rounded-xl bg-[#141416] border border-[#232326] flex items-center justify-center shrink-0"
      style={{color}}>
      <Icon name={name} />
      {dot && (
        <span
          className="absolute -right-[3px] -bottom-[3px] w-[11px] h-[11px] rounded-full border-2 border-[#121214]"
          style={{background: dot}}
        />
      )}
    </span>
  )
}

function LinkRow({item, index, sub, dot}: {item: Item; index: number; sub?: string; dot?: string}) {
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      className="social-row flex items-center gap-3.5 rounded-[14px] px-2 py-2.5 min-h-[56px] hover:bg-[rgba(255,255,255,0.05)] active:bg-[rgba(255,255,255,0.07)] transition-colors"
      style={{'--i': index} as CSSProperties}>
      <IconBox name={item.key} color={item.color} dot={dot} />
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[15px] text-[#f0f0f0]">{item.label}</span>
        <span className="block font-mono text-[12px] text-[#8b8b93] mt-0.5 truncate">{sub ?? item.sub}</span>
      </span>
      <ArrowOut />
    </a>
  )
}

/** Baris Discord dengan status live — hanya di-mount saat sheet terbuka, jadi WebSocket Lanyard tidak jalan di tiap halaman. */
function LiveDiscordRow({item, index}: {item: Item; index: number}) {
  const {data} = useLanyard()
  const meta = data ? DISCORD_STATUS_META[data.discord_status] ?? DISCORD_STATUS_META.offline : null
  return <LinkRow item={item} index={index} sub={meta ? `${item.sub} · ${meta.label}` : item.sub} dot={meta?.color} />
}

export function SocialSheet({open, onClose}: {open: boolean; onClose: () => void}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const startY = useRef<number | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (open) sheetRef.current?.focus({preventScroll: true})
  }, [open])

  const copyEmail = async () => {
    const email = ['amuthohhari', 'gmail.com'].join('@')
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      window.location.href = `mailto:${email}`
    }
  }

  let rowIndex = 0

  return (
    <>
      <div className="social-scrim" data-open={open} onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Social links"
        tabIndex={-1}
        data-open={open}
        className="social-sheet outline-none"
        onTouchStart={e => {
          startY.current = e.currentTarget.scrollTop === 0 ? e.touches[0].clientY : null
        }}
        onTouchEnd={e => {
          if (startY.current !== null && e.changedTouches[0].clientY - startY.current > 80) onClose()
          startY.current = null
        }}>
        <div className="social-grab" />
        <div className="flex items-baseline justify-between px-1 mb-1">
          <span className="font-display text-[20px] text-[#f0f0f0]">Find me</span>
          <span className="font-mono text-[11px] text-[#8b8b93]">{TOTAL_LINKS} links</span>
        </div>

        {GROUPS.map(group => (
          <div key={group.title}>
            <p className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-[#6c6c74] mt-3.5 mb-1.5 px-1">
              {group.title}
            </p>
            {group.items.map(item => {
              const i = rowIndex++
              return item.key === 'discord' && open ? (
                <LiveDiscordRow key={item.key} item={item} index={i} />
              ) : (
                <LinkRow key={item.key} item={item} index={i} />
              )
            })}
          </div>
        ))}

        <p className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-[#6c6c74] mt-3.5 mb-1.5 px-1">Contact</p>
        <button
          type="button"
          onClick={copyEmail}
          className="social-row w-full text-left flex items-center gap-3.5 rounded-[14px] px-2 py-2.5 min-h-[56px] hover:bg-[rgba(255,255,255,0.05)] active:bg-[rgba(255,255,255,0.07)] transition-colors"
          style={{'--i': rowIndex} as CSSProperties}>
          <IconBox name="email" color="#4a9eff" />
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[15px] text-[#f0f0f0]">Email</span>
            <span className="block font-mono text-[12px] text-[#8b8b93] mt-0.5">Tap to copy address</span>
          </span>
          <span
            className="font-mono text-[11px] rounded-full px-3 py-1.5 border shrink-0"
            style={{color: '#4a9eff', borderColor: 'rgba(74,158,255,0.4)', background: 'rgba(74,158,255,0.08)'}}
            aria-live="polite">
            {copied ? 'Copied ✓' : 'Copy'}
          </span>
        </button>
      </div>
    </>
  )
}
