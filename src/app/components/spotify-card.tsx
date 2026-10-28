import {useEffect, useState} from 'react'
import type {NowPlayingTrack} from '../../spotify/spotify.server.js'

/** playing = sedang diputar · paused = di-pause (progress berhenti) · last = tidak ada sesi, ini lagu terakhir didengar */
type Mode = 'playing' | 'paused' | 'last'

const modeOf = (t: NowPlayingTrack): Mode => (t.is_playing ? 'playing' : t.progress_ms != null ? 'paused' : 'last')

function timeAgo(ts: number, now: number): string {
  const m = Math.max(0, Math.round((now - ts) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Full card with album art, progress bar, and elapsed/total time — used in sidebars. */
export function SpotifyCard({spotify, className = ''}: {spotify: NowPlayingTrack; className?: string}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const mode = modeOf(spotify)
  const {start, end} = spotify.timestamps
  // Saat di-pause, pakai posisi yang dikirim server (bukan jam lokal) supaya bar tidak terus berjalan.
  const total = mode === 'paused' ? Math.max(spotify.duration_ms ?? 1, 1) : Math.max(end - start, 1)
  const elapsed =
    mode === 'paused' ? Math.min(spotify.progress_ms ?? 0, total) : Math.min(Math.max(now - start, 0), total)
  const progress = (elapsed / total) * 100
  const format = (ms: number) => {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  const label =
    mode === 'paused'
      ? 'Paused'
      : mode === 'last'
        ? `Last listened${spotify.last_played_at ? ` · ${timeAgo(spotify.last_played_at, now)}` : ''}`
        : null

  return (
    <a
      href={`https://open.spotify.com/track/${spotify.track_id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-3 rounded-xl border border-[#1c1c1c] bg-[#111] p-3 transition-colors hover:bg-[#161616] ${className}`}>
      <img
        src={spotify.album_art_url}
        alt=""
        className={`w-14 h-14 rounded-lg shrink-0 object-cover ${mode === 'playing' ? '' : 'opacity-80'}`}
      />
      <div className="min-w-0 flex-1">
        {label && <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-[#666] mb-0.5">{label}</div>}
        <div className={`font-mono text-sm truncate ${mode === 'playing' ? 'text-[#1ed760]' : 'text-[#d4d4da]'}`}>
          {spotify.song}
        </div>
        <div className="font-mono text-xs text-[#999] truncate">by {spotify.artist}</div>
        <div className={`font-mono text-xs text-[#666] truncate ${mode === 'last' ? '' : 'mb-1.5'}`}>on {spotify.album}</div>
        {mode !== 'last' && (
          <>
            <div className="h-1 rounded-full bg-[#242424] overflow-hidden">
              <div
                className={`h-full transition-[width] ${mode === 'playing' ? 'bg-[#1ed760]' : 'bg-[#6b6b73]'}`}
                style={{width: `${progress}%`}}
              />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-[#666] mt-1">
              <span>{format(elapsed)}</span>
              <span>{format(total)}</span>
            </div>
          </>
        )}
      </div>
    </a>
  )
}

/** Compact single-row variant with an equalizer animation — fits a mobile bar or a tight sidebar slot. */
export function SpotifyCompactCard({spotify, className = ''}: {spotify: NowPlayingTrack; className?: string}) {
  const mode = modeOf(spotify)
  return (
    <a
      href={`https://open.spotify.com/track/${spotify.track_id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-3 rounded-xl border border-[#1e1e1e] bg-[#111111] p-3 transition-colors hover:bg-[#161616] ${className}`}>
      <img
        src={spotify.album_art_url}
        alt=""
        className={`w-11 h-11 rounded-lg shrink-0 object-cover ${mode === 'playing' ? '' : 'opacity-80'}`}
      />
      <div className="min-w-0 flex-1">
        <div className={`font-mono text-sm truncate ${mode === 'playing' ? 'text-[#1ed760]' : 'text-[#d4d4da]'}`}>
          {spotify.song}
        </div>
        <div className="font-mono text-xs text-[#666] mt-0.5 truncate">{spotify.artist}</div>
      </div>
      {mode === 'playing' ? (
        <div className="flex items-end gap-[2px] h-3.5 shrink-0" aria-hidden="true">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="w-[2px] bg-[#1ed760] rounded-full"
              style={{animation: `eq 1s ease-in-out infinite`, animationDelay: `${-0.4 + i * 0.2}s`}}
            />
          ))}
        </div>
      ) : (
        <span className="font-mono text-[10px] text-[#666] shrink-0">
          {mode === 'paused' ? 'Paused' : spotify.last_played_at ? timeAgo(spotify.last_played_at, Date.now()) : ''}
        </span>
      )}
      <style>{`@keyframes eq { 0%, 100% { height: 3px; } 50% { height: 14px; } }`}</style>
    </a>
  )
}

/** Static "nothing playing" placeholder, so the sidebar slot doesn't just vanish. */
export function SpotifyIdleCard({className = ''}: {className?: string}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border border-[#1e1e1e] bg-[#111111] p-3 ${className}`}>
      <div
        className="w-11 h-11 rounded-lg flex items-center justify-center text-base shrink-0 opacity-50"
        style={{background: 'linear-gradient(135deg, #7c6ff7, #4a9eff)'}}>
        🎵
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-sm text-[#666]">Not listening right now</div>
      </div>
    </div>
  )
}
