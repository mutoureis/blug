import {useSpotifyNowPlaying} from '../hooks/use-spotify-now-playing.js'
import {SpotifyCard, SpotifyCompactCard} from './spotify-card.js'

/**
 * Sidebar variant: blok berlabel "Now playing" saat ada lagu diputar, "Paused" saat di-pause, dan
 * "Last listened" (lagu terakhir) saat tidak ada yang diputar. Baru hilang kalau belum ada data sama sekali.
 */
/** Judul blok sesuai keadaan: sedang diputar / di-pause / terakhir didengar. */
function nowPlayingHeading(track: {is_playing: boolean; progress_ms?: number} | null): string {
  if (!track || track.is_playing) return 'Now playing'
  return track.progress_ms != null ? 'Paused' : 'Last listened'
}

export function NowPlayingWidget({className = ''}: {className?: string}) {
  const {track, status} = useSpotifyNowPlaying()

  if (status === 'error') return null
  if (status === 'ready' && !track) return null

  return (
    <div className={className}>
      <p className="font-mono text-xs tracking-[0.14em] uppercase text-[#666] mb-3">{nowPlayingHeading(track)}</p>
      {status === 'loading' ? (
        <div className="skeleton-line h-[68px] rounded-xl" aria-hidden="true" />
      ) : (
        track && <SpotifyCompactCard spotify={track} />
      )}
    </div>
  )
}

/**
 * Mobile variant: a slim, fixed bar pinned to the bottom of the screen so
 * whatever's currently playing on Spotify is visible on the phone even
 * though the desktop sidebar is hidden below the `lg` breakpoint. Renders
 * nothing when there's no track playing, so it doesn't eat screen space.
 */
export function NowPlayingMobileBar() {
  const {track} = useSpotifyNowPlaying()

  if (!track) return null

  return (
    <div className="lg:hidden fixed bottom-3 left-3 right-3 z-40">
      <SpotifyCompactCard spotify={track} className="shadow-lg shadow-black/40 backdrop-blur" />
    </div>
  )
}

/** Full card version (with progress bar) for pages that want a bigger widget, e.g. the About page. */
export function NowPlayingCard({className = ''}: {className?: string}) {
  const {track, status} = useSpotifyNowPlaying()

  if (status === 'error' || !track) return null

  return <SpotifyCard spotify={track} className={className} />
}
