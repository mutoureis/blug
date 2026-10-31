import {useEffect, useState} from 'react'

export type VisitCounts = {unique: number}

// Satu promise per pemuatan halaman: banyak komponen boleh memanggil useVisits(), request-nya tetap sekali.
let inflight: Promise<VisitCounts | null> | null = null

async function load(): Promise<VisitCounts | null> {
  try {
    // Kunjungan dicatat (POST) sekali per sesi tab; setelah itu cukup membaca angkanya (GET).
    let counted = false
    try {
      counted = sessionStorage.getItem('visit-counted') === '1'
    } catch {
      /* storage diblokir: anggap belum dihitung, server tetap membatasi per 30 menit */
    }
    const res = await fetch('/api/visit', {method: counted ? 'GET' : 'POST'})
    if (!res.ok) return null
    if (!counted) {
      try {
        sessionStorage.setItem('visit-counted', '1')
      } catch {
        /* abaikan */
      }
    }
    return (await res.json()) as VisitCounts
  } catch {
    return null
  }
}

/** Mencatat pengunjung (sekali per sesi) dan mengembalikan jumlah pengunjung unik. null selama memuat/gagal. */
export function useVisits(): VisitCounts | null {
  const [counts, setCounts] = useState<VisitCounts | null>(null)

  useEffect(() => {
    let alive = true
    ;(inflight ??= load()).then(c => {
      if (alive && c) setCounts(c)
    })
    return () => {
      alive = false
    }
  }, [])

  return counts
}
