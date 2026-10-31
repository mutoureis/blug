import {useCallback, useEffect, useRef, useState} from 'react'
import type {CSSProperties} from 'react'

/**
 * Gambar untuk kartu yang tidak boleh "hilang".
 *
 * - Latar cadangan (gradasi + pola titik) selalu ada di belakang gambar, jadi kartu tidak pernah kosong.
 * - Gambar dari server (SSR) langsung terlihat. Tidak menunggu JavaScript supaya muncul.
 * - Kalau gambar gagal dimuat (wsrv.nl / CDN Bluesky lagi lambat atau menolak), dicoba lagi otomatis
 *   beberapa kali dengan jeda yang makin panjang, dan dicoba lagi saat kembali online atau tab dibuka lagi.
 * - Gagal total: latar cadangan tetap tampil dan teks kartu tetap terbaca.
 *
 * Taruh di dalam elemen yang `relative` dan `overflow-hidden`.
 */

type State = 'loading' | 'ok' | 'retry' | 'failed'

const MAX_RETRIES = 3
const BASE_DELAY_MS = 600

const FALLBACK_BG: CSSProperties = {
  background:
    'radial-gradient(circle at 70% 25%, #3a3a3e 0 2px, transparent 2.5px) 0 0 / 10px 10px, linear-gradient(160deg, #26262a, #121214 70%)',
}

export function ResilientImage({
  src,
  alt = '',
  className = '',
  style,
}: {
  src: string
  alt?: string
  className?: string
  style?: CSSProperties
}) {
  const [state, setState] = useState<State>('loading')
  const [attempt, setAttempt] = useState(0)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ganti gambar -> mulai dari awal.
  useEffect(() => {
    setState('loading')
    setAttempt(0)
  }, [src])

  const fail = useCallback(() => {
    if (attempt >= MAX_RETRIES) {
      setState('failed')
      return
    }
    setState('retry')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setAttempt(a => a + 1), BASE_DELAY_MS * 2 ** attempt)
  }, [attempt])

  // Gambar SSR bisa saja sudah gagal sebelum React sempat memasang onError.
  useEffect(() => {
    const el = imgRef.current
    if (el?.complete) {
      if (el.naturalWidth > 0) setState('ok')
      else fail()
    }
  }, [attempt, fail])

  // Coba lagi kalau sebelumnya gagal total dan koneksi/tab kembali.
  useEffect(() => {
    const retryNow = () => {
      if (state === 'failed') {
        setState('loading')
        setAttempt(a => a + 1)
      }
    }
    const onVisible = () => document.visibilityState === 'visible' && retryNow()
    window.addEventListener('online', retryNow)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', retryNow)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [state])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const shimmer = state === 'loading' || state === 'retry'

  return (
    <>
      <div
        className={`absolute inset-0 ${shimmer ? 'skeleton-line !rounded-none' : ''}`}
        style={shimmer ? undefined : FALLBACK_BG}
        aria-hidden="true"
      />
      {state !== 'failed' && (
        <img
          // key berganti tiap percobaan supaya browser benar-benar memuat ulang elemennya
          key={attempt}
          ref={imgRef}
          src={src}
          alt={alt}
          decoding="async"
          onLoad={() => setState('ok')}
          onError={fail}
          className={`${className} ${state === 'retry' ? 'opacity-0' : ''}`}
          style={style}
        />
      )}
    </>
  )
}
