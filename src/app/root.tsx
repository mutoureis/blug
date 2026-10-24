import React from 'react'
import {
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useRouteError,
} from '@remix-run/react'
import {json, LinksFunction} from '@remix-run/node'
import styles from './tailwind.css?url'
import {getProfile} from 'src/atproto'
import {AppBskyActorDefs} from '@atproto/api'

export const links: LinksFunction = () => [
  {rel: 'stylesheet', href: styles},
  {rel: 'icon', href: '/favicon.ico'},
  {rel: 'preconnect', href: 'https://fonts.googleapis.com'},
  {rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous'},
  {href: 'https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,300..900;1,7..72,300..900&display=swap', rel: 'stylesheet'},
  {href: 'https://fonts.googleapis.com/css2?family=Recursive:slnt,wght,CASL,MONO@-15..0,300..900,0..1,0..1&display=swap', rel: 'stylesheet'},
]

export const loader = async () => {
  try {
    const profile = await getProfile()
    return json({profile})
  } catch (err) {
    console.error('Failed to load profile:', err)
    return json({profile: null})
  }
}

const SOCIALS = [
  {icon: '🧵', label: 'Threads',   href: 'https://www.threads.com/@rioumoe'},
  {icon: '📸', label: 'Instagram', href: 'https://www.instagram.com/mthrrbrqh'},
  {icon: '🎬', label: 'Letterboxd', href: 'https://boxd.it/hBByx'},
  {icon: '💬', label: 'Discord',   href: 'https://discord.gg/DNcNBQaqgM'},
  {icon: '🎵', label: 'Spotify',   href: 'https://open.spotify.com/user/zq8df1jprwpxyiu9mkn691ai8'},
  {icon: '🎮', label: 'Steam',     href: 'https://steamcommunity.com/id/moebatsu'},
  {icon: '✉️', label: 'Email',     href: 'mailto:amuthohhari@gmail.com'},
]

const PAGE_ORDER = ['/', '/blog', '/gallery']

export function Layout({children}: {children: React.ReactNode}) {
  const data = useLoaderData<{profile: AppBskyActorDefs.ProfileViewDetailed | null}>()
  const profile = data?.profile ?? null
  const location = useLocation()
  const navigate = useNavigate()
  const navigation = useNavigation()
  const isNavigating = navigation.state !== 'idle'

  const isOn = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

  const isMainPage = PAGE_ORDER.includes(location.pathname)
  const currentIndex = PAGE_ORDER.indexOf(location.pathname)

  // Swipe state — live drag offset tracked in a ref, committed to state only for re-render
  const touchStartX = React.useRef(0)
  const touchStartY = React.useRef(0)
  const dragging = React.useRef(false)
  const [dragOffset, setDragOffset] = React.useState(0)
  const [contactOpen, setContactOpen] = React.useState(false)

  const navItems: NavItemDef[] = [
    {key: 'home', label: 'Home', icon: 'home', href: '/', selected: location.pathname === '/'},
    {key: 'blog', label: 'Writing', icon: 'blog', href: '/blog', selected: isOn('/blog')},
    {key: 'gallery', label: 'Gallery', icon: 'gallery', href: '/gallery', selected: isOn('/gallery')},
    {key: 'social', label: 'Social', icon: 'social', selected: contactOpen, onClick: () => setContactOpen(o => !o)},
  ]

  // Juttu (kolom komentar) sengaja dimuat lewat effect, bukan <script> statis di <head>.
  // Kalau statis, script-nya (defer) bisa nyuntik konten ke #juttu-comments SEBELUM React
  // selesai hydrate elemen itu -> hydration mismatch (React error #418/#423) -> widget
  // ke-reset/ilang. useEffect di sini baru jalan SETELAH commit awal selesai, jadi aman.
  React.useEffect(() => {
    setContactOpen(false)
  }, [location.pathname])

  React.useEffect(() => {
    const SRC = 'https://cdn.jsdelivr.net/npm/juttu@latest/juttu-embed.js'
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`)
    if (existing) {
      // Sudah pernah dimuat (mis. navigasi client-side ke post lain) — Juttu belum tentu
      // auto rescan, jadi re-append supaya browser re-run script-nya buat scan ulang DOM.
      existing.remove()
    }
    const script = document.createElement('script')
    script.src = SRC
    script.defer = true
    script.dataset.theme = 'dark'
    document.head.appendChild(script)
  }, [location.pathname])

  React.useEffect(() => {
    if (!isMainPage) return

    const onTouchStart = (e: TouchEvent) => {
      // Jangan aktifkan page swipe kalau lightbox sedang terbuka
      if (document.querySelector('[style*="z-index: 9999"]')) return
      touchStartX.current = e.touches[0].clientX
      touchStartY.current = e.touches[0].clientY
      dragging.current = false
      setDragOffset(0)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (document.querySelector('[style*="z-index: 9999"]')) return
      const dx = e.touches[0].clientX - touchStartX.current
      const dy = Math.abs(e.touches[0].clientY - touchStartY.current)
      // Only hijack if mostly horizontal
      if (!dragging.current && Math.abs(dx) < 8) return
      if (!dragging.current && dy > Math.abs(dx) * 0.8) return
      dragging.current = true
      // Resist at edges
      if ((dx > 0 && currentIndex === 0) || (dx < 0 && currentIndex === PAGE_ORDER.length - 1)) {
        setDragOffset(dx * 0.2) // rubber-band
      } else {
        setDragOffset(dx)
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (document.querySelector('[style*="z-index: 9999"]')) return
      const dx = touchStartX.current - e.changedTouches[0].clientX
      const dy = Math.abs(touchStartY.current - e.changedTouches[0].clientY)
      setDragOffset(0)
      dragging.current = false
      if (Math.abs(dx) < 60 || dy > Math.abs(dx) * 0.6) return
      if (dx > 0 && currentIndex < PAGE_ORDER.length - 1) {
        navigate(PAGE_ORDER[currentIndex + 1])
      } else if (dx < 0 && currentIndex > 0) {
        navigate(PAGE_ORDER[currentIndex - 1])
      }
    }

    document.addEventListener('touchstart', onTouchStart, {passive: true})
    document.addEventListener('touchmove', onTouchMove, {passive: true})
    document.addEventListener('touchend', onTouchEnd, {passive: true})
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
    }
  }, [isMainPage, currentIndex, navigate])

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Site-wide social preview defaults — individual routes can still
            override title/description via their own meta() export. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="mutho." />
        <meta property="og:image" content="https://www.mutho.my.id/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <Meta />
        <Links />
        <script async src="https://embed.bsky.app/static/embed.js" />
      </head>
      <body
        className="flex flex-col min-h-screen bg-[#0a0a0a] text-[#f0f0f0] antialiased font-sans pb-24 sm:pb-0">
        {/* Ambient gradient mesh, sits below the existing film-grain layer (tailwind.css body::before) */}
        <div className="bg-mesh" aria-hidden="true" />

        {/* Scroll progress bar */}
        <div id="scroll-progress" className="fixed top-0 left-0 h-[2px] bg-[#4a9eff] z-[200] w-0 transition-[width] duration-100" />

        <div className="flex flex-col flex-1">
          {/* NAV — cuma dipakai di desktop, karena mobile udah dihandle pill bawah */}
          <header
            className="hidden sm:block sticky top-0 z-50 border-b border-[#222]"
            style={{background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(12px)'}}>

            <div className="mx-auto w-full max-w-[1600px] px-4 h-[52px] flex items-center justify-between">

              {/* ── Kiri: Brand ── */}
              <Link to="/" prefetch="intent" className="flex items-center gap-2 group sm:gap-2.5">
                <span className="font-display text-[20px] text-[#f0f0f0] hidden sm:inline tracking-[-0.01em]">
                  mutho<span className="text-[#4a9eff]">.</span>my.id
                </span>
              </Link>

              {/* ── Desktop: pill nav nempel di header ── */}
              <nav className="hidden sm:flex items-center gap-1 rounded-full p-1 border border-[#222]"
                style={{background: 'rgba(255,255,255,0.03)'}}>
                {navItems.map(item => <PillNavItem key={item.key} item={item} />)}
              </nav>

              <div className="w-8 sm:w-9" />
            </div>
          </header>

          {/* ── Mobile: pill nav ngambang di bawah layar ── */}
          <nav className="sm:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-50
            flex items-center gap-1 rounded-full p-1 border border-[#242424] shadow-2xl shadow-black/50"
            style={{background: 'rgba(18,18,18,0.9)', backdropFilter: 'blur(16px)'}}>
            {navItems.map(item => <PillNavItem key={item.key} item={item} />)}
          </nav>

          {/* ── Social popover: dibuka lewat item "Social" di pill nav, posisinya ngikutin
              pill-nya sendiri (nempel bawah pill di mobile, nempel bawah header di desktop) ── */}
          {contactOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setContactOpen(false)} />
              <div className="fixed z-50 left-1/2 -translate-x-1/2 w-[240px] rounded-2xl
                border border-[#242424] p-2 bottom-[84px] sm:bottom-auto sm:top-[62px] shadow-2xl shadow-black/50"
                style={{background: 'rgba(18,18,18,0.97)', backdropFilter: 'blur(16px)'}}>
                {SOCIALS.map(({icon, label, href}) => (
                  <a
                    key={label}
                    href={href}
                    target={href.startsWith('mailto') ? undefined : '_blank'}
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-white/5 transition-colors">
                    <div className="w-7 h-7 rounded-lg bg-[#1e1e1e] flex items-center justify-center text-sm shrink-0">
                      {icon}
                    </div>
                    <span className="font-mono text-[14px] text-[#cccccc]">{label}</span>
                  </a>
                ))}
              </div>
            </>
          )}

          {/* Konten — live drag transform saat swipe, plus fade halus tiap ganti halaman/loader jalan */}
          <main
            className="flex-1"
            style={{
              transform: isMainPage && dragOffset !== 0 ? `translateX(${dragOffset}px)` : 'none',
              opacity: isNavigating ? 0.6 : 1,
              transition: dragOffset === 0
                ? 'transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.12s ease-out'
                : 'none',
              willChange: 'transform, opacity',
            }}>
            {children}
          </main>
        </div>

        {/* Footer */}
        <footer className="border-t border-[#1a1a1a] px-8 py-3.5 flex items-center justify-between">
          <span className="font-mono text-[12px] tracking-[0.12em] uppercase text-[#555]">Made on ATProto</span>
          <a
            href="https://github.com/mutho23/blug"
            className="font-mono text-[16px] text-[#444] hover:text-[#4a9eff] transition-colors">
            source
          </a>
        </footer>

        <ScrollRestoration />
        <Scripts />

        <script dangerouslySetInnerHTML={{__html: `
          window.addEventListener('scroll', function() {
            var doc = document.documentElement;
            var pct = (doc.scrollTop / (doc.scrollHeight - doc.clientHeight)) * 100;
            var bar = document.getElementById('scroll-progress');
            if (bar) bar.style.width = pct + '%';
          });
        `}} />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

type NavIconName = 'home' | 'blog' | 'gallery' | 'social'
type NavItemDef = {
  key: string
  label: string
  icon: NavIconName
  selected: boolean
  href?: string
  onClick?: () => void
}

function NavIcon({name, className}: {name: NavIconName; className?: string}) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  }
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
        </svg>
      )
    case 'blog':
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6" />
          <path d="M8.5 13h7M8.5 17h4.5" />
        </svg>
      )
    case 'gallery':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2.5" />
          <circle cx="8.5" cy="9" r="1.6" />
          <path d="M21 16.5l-5.2-5.2a1.5 1.5 0 0 0-2.1 0L5 20" />
        </svg>
      )
    case 'social':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M16 12v1.6a2.6 2.6 0 0 0 5.2 0V12a9.2 9.2 0 1 0-3.6 7.3" />
        </svg>
      )
  }
}

function PillNavItem({item}: {item: NavItemDef}) {
  const inner = (
    <div className={`flex flex-col items-center gap-0.5 px-3.5 py-1.5 rounded-full transition-colors ${
      item.selected ? 'bg-white/[0.08] text-[#f0f0f0]' : 'text-[#666] hover:text-[#aaa]'
    }`}>
      <NavIcon name={item.icon} className={`w-[19px] h-[19px] ${item.selected ? 'text-[#4a9eff]' : ''}`} />
      <span className="font-mono text-[10px] tracking-[0.04em] leading-none">{item.label}</span>
    </div>
  )
  if (item.href) {
    return <Link to={item.href} prefetch="intent" className="shrink-0">{inner}</Link>
  }
  return (
    <button type="button" onClick={item.onClick} aria-pressed={item.selected} className="shrink-0">
      {inner}
    </button>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  console.error(error)
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-[#0a0a0a] text-[#f0f0f0] antialiased font-sans">
        <div className="container mx-auto pt-10 md:pt-20 pb-20 text-center">
          <p className="font-mono text-[13px] tracking-[0.12em] uppercase text-[#555] mb-6">Error</p>
          <h1 className="font-display text-5xl md:text-7xl text-[#f0f0f0]">Something broke.</h1>
          <div className="p-10 flex justify-center">
            <img src="/monkey.jpg" alt="Monkey muppet meme" className="rounded-lg shadow-2xl shadow-black/40 max-w-sm" />
          </div>
          <a href="/blog" className="inline-block font-mono text-xs text-[#4a9eff] hover:text-[#7c6ff7] transition-colors">
            ← back to writing
          </a>
        </div>
        <Scripts />
      </body>
    </html>
  )
}
