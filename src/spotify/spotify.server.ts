/**
 * Server-only. Talks directly to Spotify's Web API using YOUR account's
 * refresh token — no Discord/Lanyard involved. Setup:
 *
 *   1. Create an app at https://developer.spotify.com/dashboard
 *      → note the Client ID and Client Secret.
 *      → add a Redirect URI: https://YOUR-DOMAIN/auth/spotify/callback
 *   2. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in your env
 *      (Vercel project settings, or .env locally) and deploy.
 *   3. Visit https://YOUR-DOMAIN/auth/spotify in a browser, log in, click
 *      Agree — it'll show you a refresh token on screen.
 *   4. Copy that into your env as SPOTIFY_REFRESH_TOKEN and redeploy.
 *
 * After that this module renews its own access token forever — no more
 * manual steps needed, and nothing here depends on Discord being open.
 * (routes/auth.spotify.ts and routes/auth.spotify.callback.ts implement
 * step 3; scripts/get-spotify-refresh-token.mjs is a local/terminal
 * alternative to the same thing.)
 */

import {getCachedLastListened, setCachedLastListened} from '../redis/redis.js'

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize'

const TOKEN_URL = 'https://accounts.spotify.com/api/token'
const NOW_PLAYING_URL = 'https://api.spotify.com/v1/me/player/currently-playing'
const RECENTLY_PLAYED_URL = 'https://api.spotify.com/v1/me/player/recently-played?limit=1'

export type NowPlayingTrack = {
  song: string
  artist: string
  album: string
  album_art_url: string
  track_id: string
  is_playing: boolean
  timestamps: {start: number; end: number}
  /** Posisi & durasi saat di-pause (supaya progress bar berhenti, bukan terus berjalan). */
  progress_ms?: number
  duration_ms?: number
  /** Diisi untuk "terakhir didengar" (tidak ada yang sedang diputar): kapan lagu itu diputar (ms epoch). */
  last_played_at?: number
}

/** Scopes: only enough to read what's currently playing. No write/control access. */
// user-read-recently-played: untuk menampilkan lagu terakhir yang didengar saat tidak ada yang diputar.
const SCOPES = ['user-read-currently-playing', 'user-read-playback-state', 'user-read-recently-played'].join(' ')

/** Builds the URL to send the browser to for the one-time Spotify login/consent screen. */
export function buildSpotifyAuthorizeUrl(redirectUri: string): string {
  const clientId = requireEnv('SPOTIFY_CLIENT_ID')
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', SCOPES)
  return url.toString()
}

/** Exchanges the one-time `code` Spotify redirected back with for a long-lived refresh token. */
export async function exchangeCodeForRefreshToken(code: string, redirectUri: string): Promise<string> {
  const clientId = requireEnv('SPOTIFY_CLIENT_ID')
  const clientSecret = requireEnv('SPOTIFY_CLIENT_SECRET')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({grant_type: 'authorization_code', code, redirect_uri: redirectUri}),
  })

  const data = await res.json()
  if (!res.ok || !data.refresh_token) {
    throw new Error(`Spotify code exchange failed: ${res.status} ${JSON.stringify(data)}`)
  }
  return data.refresh_token as string
}

let cachedAccessToken: {token: string; expiresAt: number} | null = null

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing ${name}. Run scripts/get-spotify-refresh-token.mjs to set up Spotify auth, then add ${name} to your .env — see src/spotify/spotify.server.ts for the full setup steps.`
    )
  }
  return value
}

async function getAccessToken(): Promise<string> {
  // Reuse the cached token until ~1 minute before it expires.
  if (cachedAccessToken && cachedAccessToken.expiresAt - Date.now() > 60_000) {
    return cachedAccessToken.token
  }

  const clientId = requireEnv('SPOTIFY_CLIENT_ID')
  const clientSecret = requireEnv('SPOTIFY_CLIENT_SECRET')
  const refreshToken = requireEnv('SPOTIFY_REFRESH_TOKEN')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    throw new Error(`Spotify token refresh failed: ${res.status} ${await res.text()}`)
  }

  const data = (await res.json()) as {access_token: string; expires_in: number}
  cachedAccessToken = {token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000}
  return cachedAccessToken.token
}

/**
 * Returns the track currently playing on the account tied to
 * SPOTIFY_REFRESH_TOKEN, or `null` if nothing's playing (including private
 * sessions / podcasts / ads, which Spotify reports without track data).
 */
async function fetchCurrentlyPlaying(): Promise<NowPlayingTrack | null> {
  const accessToken = await getAccessToken()

  const res = await fetch(NOW_PLAYING_URL, {
    headers: {Authorization: `Bearer ${accessToken}`},
  })

  // 204 = nothing playing right now.
  if (res.status === 204 || res.status === 202) return null

  if (!res.ok) {
    throw new Error(`Spotify currently-playing request failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()

  // No `item` happens for local files, some podcasts, or an empty response body.
  if (!data?.item || data.currently_playing_type !== 'track') return null

  const track = data.item as {
    id: string
    name: string
    artists: {name: string}[]
    album: {name: string; images: {url: string}[]}
  }

  const now = Date.now()
  const progressMs: number = data.progress_ms ?? 0
  const durationMs: number = data.item?.duration_ms ?? 0

  return {
    song: track.name,
    artist: track.artists.map(a => a.name).join(', '),
    album: track.album.name,
    album_art_url: track.album.images[0]?.url ?? '',
    track_id: track.id,
    is_playing: Boolean(data.is_playing),
    timestamps: {start: now - progressMs, end: now - progressMs + durationMs},
    progress_ms: progressMs,
    duration_ms: durationMs,
  }
}

// ── "Terakhir didengar" ──────────────────────────────────────────────────────────────
// Urutan: lagu yang sedang diputar/di-pause -> riwayat Spotify (recently-played, butuh scope baru)
// -> lagu terakhir yang pernah terlihat sedang diputar (disimpan di Redis) sebagai cadangan.

let lastListenedMem: {at: number; track: NowPlayingTrack | null} | null = null
let lastRemembered: {id: string; at: number} | null = null

async function fetchRecentlyPlayed(): Promise<NowPlayingTrack | null> {
  const accessToken = await getAccessToken()
  const res = await fetch(RECENTLY_PLAYED_URL, {headers: {Authorization: `Bearer ${accessToken}`}})
  if (!res.ok) throw new Error(`recently-played ${res.status}`) // mis. 403 = scope belum diberikan
  const data = await res.json()
  const item = data?.items?.[0]
  const t = item?.track as
    | {id: string; name: string; artists: {name: string}[]; album: {name: string; images: {url: string}[]}}
    | undefined
  if (!t) return null
  return {
    song: t.name,
    artist: t.artists.map(a => a.name).join(', '),
    album: t.album.name,
    album_art_url: t.album.images[0]?.url ?? '',
    track_id: t.id,
    is_playing: false,
    timestamps: {start: 0, end: 0},
    last_played_at: item.played_at ? Date.parse(item.played_at) : undefined,
  }
}

async function getLastListened(): Promise<NowPlayingTrack | null> {
  // Cache memori 60 dtk: pengunjung polling tiap 7 dtk, jangan sampai tiap polling memanggil Spotify lagi.
  if (lastListenedMem && Date.now() - lastListenedMem.at < 60_000) return lastListenedMem.track
  let track: NowPlayingTrack | null = null
  try {
    track = await fetchRecentlyPlayed()
  } catch {
    // scope belum diberikan / Spotify error -> pakai cadangan dari Redis
  }
  if (!track) track = await getCachedLastListened<NowPlayingTrack>()
  lastListenedMem = {at: Date.now(), track}
  return track
}

async function rememberTrack(t: NowPlayingTrack): Promise<void> {
  const now = Date.now()
  // Tulis ke Redis hanya kalau lagunya ganti atau sudah >5 menit sejak tulis terakhir.
  if (lastRemembered && lastRemembered.id === t.track_id && now - lastRemembered.at < 5 * 60_000) return
  lastRemembered = {id: t.track_id, at: now}
  await setCachedLastListened({
    song: t.song,
    artist: t.artist,
    album: t.album,
    album_art_url: t.album_art_url,
    track_id: t.track_id,
    is_playing: false,
    timestamps: {start: 0, end: 0},
    last_played_at: now,
  } satisfies NowPlayingTrack)
}

/**
 * Lagu yang sedang diputar (is_playing: true), sedang di-pause (is_playing: false + progress_ms),
 * atau — kalau tidak ada sesi sama sekali — lagu terakhir yang didengar (is_playing: false + last_played_at).
 * `null` hanya kalau belum ada data apa pun.
 */
export async function getNowPlaying(): Promise<NowPlayingTrack | null> {
  const current = await fetchCurrentlyPlaying()
  if (current) {
    if (current.is_playing) await rememberTrack(current)
    return current
  }
  return getLastListened()
}
