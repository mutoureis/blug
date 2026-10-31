import Redis from 'ioredis'
import {AppBskyActorDefs} from '@atproto/api'
import {LeafletDocument} from '../types'

// Lazy initialization - don't connect at module load time
let _client: Redis | null = null

function getClient(): Redis {
  if (!_client) {
    _client = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: false,
    })
    _client.on('error', (err) => {
      console.error('Redis error:', err.message)
    })
  }
  return _client
}

export const getCachedPosts = async (): Promise<LeafletDocument[] | null> => {
  try {
    const res = await getClient().get('posts')
    if (!res) return null
    return JSON.parse(res) as LeafletDocument[]
  } catch (err) {
    console.error('getCachedPosts error:', err)
    return null
  }
}

export const setCachedPosts = async (posts: LeafletDocument[]): Promise<void> => {
  try {
    await getClient().set('posts', JSON.stringify(posts), 'EX', 60)
  } catch (err) {
    console.error('setCachedPosts error:', err)
  }
}

export const getCachedPost = async (rkey: string): Promise<LeafletDocument | null> => {
  try {
    const res = await getClient().get(rkey)
    if (!res) return null
    return JSON.parse(res) as LeafletDocument
  } catch (err) {
    console.error('getCachedPost error:', err)
    return null
  }
}

export const setCachedPost = async (rkey: string, post: LeafletDocument): Promise<void> => {
  try {
    await getClient().set(rkey, JSON.stringify(post), 'EX', 60 * 10)
  } catch (err) {
    console.error('setCachedPost error:', err)
  }
}

export const getCachedProfile = async (): Promise<AppBskyActorDefs.ProfileViewDetailed | null> => {
  try {
    const res = await getClient().get('profile')
    if (!res) return null
    return JSON.parse(res) as AppBskyActorDefs.ProfileViewDetailed
  } catch (err) {
    console.error('getCachedProfile error:', err)
    return null
  }
}

export const setCachedProfile = async (
  profile: AppBskyActorDefs.ProfileViewDetailed,
): Promise<void> => {
  try {
    await getClient().set('profile', JSON.stringify(profile), 'EX', 60 * 10)
  } catch (err) {
    console.error('setCachedProfile error:', err)
  }
}

// Cache hasil Gallery (daftar foto dari Bluesky). Loader Gallery dulu memanggil getRecord
// satu per satu untuk tiap post di SETIAP kunjungan; dengan cache ini cukup sekali per 10 menit.
export const getCachedGallery = async <T>(): Promise<T | null> => {
  try {
    const res = await getClient().get('gallery')
    if (!res) return null
    return JSON.parse(res) as T
  } catch (err) {
    console.error('getCachedGallery error:', err)
    return null
  }
}

export const setCachedGallery = async (data: unknown): Promise<void> => {
  try {
    await getClient().set('gallery', JSON.stringify(data), 'EX', 60 * 10)
  } catch (err) {
    console.error('setCachedGallery error:', err)
  }
}

// Foto terbaru untuk kartu di beranda (dipakai kalau cache Gallery lagi kosong).
export const getCachedLatestPhoto = async <T>(): Promise<T | null> => {
  try {
    const res = await getClient().get('latest-photo')
    if (!res) return null
    return JSON.parse(res) as T
  } catch (err) {
    console.error('getCachedLatestPhoto error:', err)
    return null
  }
}

export const setCachedLatestPhoto = async (data: unknown): Promise<void> => {
  try {
    await getClient().set('latest-photo', JSON.stringify(data), 'EX', 60 * 10)
  } catch (err) {
    console.error('setCachedLatestPhoto error:', err)
  }
}

// Salinan "terakhir yang berhasil" untuk kartu beranda (tulisan terbaru, foto terbaru). Umurnya panjang
// (30 hari) dan sengaja terpisah dari cache biasa yang cepat kedaluwarsa: kalau Bluesky sedang lambat
// atau gagal, beranda tetap menampilkan data lama lengkap dengan gambarnya, bukan kartu tanpa gambar.
export const getLastGood = async <T>(key: string): Promise<T | null> => {
  try {
    const res = await getClient().get(`last-good:${key}`)
    if (!res) return null
    return JSON.parse(res) as T
  } catch (err) {
    console.error('getLastGood error:', err)
    return null
  }
}

export const setLastGood = async (key: string, data: unknown): Promise<void> => {
  try {
    await getClient().set(`last-good:${key}`, JSON.stringify(data), 'EX', 60 * 60 * 24 * 30)
  } catch (err) {
    console.error('setLastGood error:', err)
  }
}

// Lagu terakhir yang terlihat sedang diputar di Spotify (cadangan untuk kartu "Last listened").
export const getCachedLastListened = async <T>(): Promise<T | null> => {
  try {
    const res = await getClient().get('last-listened')
    if (!res) return null
    return JSON.parse(res) as T
  } catch (err) {
    console.error('getCachedLastListened error:', err)
    return null
  }
}

export const setCachedLastListened = async (data: unknown): Promise<void> => {
  try {
    await getClient().set('last-listened', JSON.stringify(data), 'EX', 60 * 60 * 24 * 30)
  } catch (err) {
    console.error('setCachedLastListened error:', err)
  }
}

// ── Penghitung pengunjung ────────────────────────────────────────────────────────────
// visits:unique = HyperLogLog pengunjung unik sepanjang waktu (yang disimpan hanya hash, galat ~0,8%).
// PFADD bersifat idempoten: hash yang sama berulang kali tidak menambah angka.
export type VisitCounts = {unique: number}

export const getVisitCounts = async (): Promise<VisitCounts> => {
  try {
    return {unique: await getClient().pfcount('visits:unique')}
  } catch (err) {
    console.error('getVisitCounts error:', err)
    return {unique: 0}
  }
}

export const recordVisit = async (visitorHash: string): Promise<VisitCounts> => {
  try {
    await getClient().pfadd('visits:unique', visitorHash)
  } catch (err) {
    console.error('recordVisit error:', err)
  }
  return getVisitCounts()
}
