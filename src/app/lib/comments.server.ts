// Sistem komentar sendiri. Semua autentikasi lewat Google ("Sign in with Google"): pengomen wajib login,
// jadi email & nama selalu asli. Komentar disimpan di Redis; notifikasi balasan dikirim lewat Resend.
//
// Redis:
//   comment:{id}   -> JSON Comment
//   comments:{post} -> sorted set (skor = waktu) berisi id komentar post itu
//   rl:c:*         -> pembatas laju
//
// Env:
//   GOOGLE_CLIENT_ID         wajib. OAuth Client ID (Web) dari Google Cloud Console.
//   COMMENTS_SECRET          wajib. String acak panjang (≥16) untuk menandatangani cookie sesi & token berhenti-langganan.
//   COMMENTS_ADMIN_EMAIL     email Google-mu: akun ini otomatis jadi "penulis" (balas & hapus komentar).
//                            Kalau kosong, dipakai COMMENTS_NOTIFY_EMAIL.
//   COMMENTS_NOTIFY_EMAIL    email pemilik, dapat notifikasi tiap komentar baru
//   COMMENTS_ADMIN_NAME      nama tampilan penulis (default "mutho")
//   RESEND_API_KEY           API key Resend (https://resend.com). Tanpa ini komentar tetap jalan,
//                            hanya email tidak terkirim.
//   MAIL_FROM                pengirim di domain yang sudah diverifikasi di Resend,
//                            mis. "mutho <comments@mutho.my.id>"
//   SITE_URL                 default https://mutho.my.id

import {createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as cryptoVerify} from 'node:crypto'
import {getRedis} from '../../redis/redis.js'

export type Comment = {
  id: string
  post: string
  parentId: string | null // komentar induk (level atas) — balasan selalu 1 level
  replyTo: string | null // komentar spesifik yang dibalas (untuk notifikasi)
  name: string
  email?: string // email Google (terverifikasi), privat, tidak pernah dikirim ke browser; kosong untuk admin
  notify: boolean
  body: string
  createdAt: string
  isOwner: boolean
}

export type PublicComment = {
  id: string
  parentId: string | null
  replyToName: string | null
  name: string
  body: string
  createdAt: string
  isOwner: boolean
}

const SITE_URL = () => (process.env.SITE_URL ?? 'https://mutho.my.id').replace(/\/+$/, '')
const ADMIN_NAME = () => process.env.COMMENTS_ADMIN_NAME ?? 'mutho'
const POST_RE = /^[A-Za-z0-9._~-]{1,64}$/
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/

export class CommentError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

/* ── Auth admin & token ── */

function secret(): string {
  const s = process.env.COMMENTS_SECRET
  if (!s || s.length < 16) throw new CommentError('COMMENTS_SECRET belum diset (minimal 16 karakter).', 500)
  return s
}
const hmac = (data: string) => createHmac('sha256', secret()).update(data).digest('hex')
const safeEqual = (a: string, b: string) => {
  const A = Buffer.from(a)
  const B = Buffer.from(b)
  return A.length === B.length && timingSafeEqual(A, B)
}

/* ── Sesi login (Google -> cookie bertanda tangan, 30 hari) ── */

export type Session = {email: string; name: string; isAdmin: boolean}

export const SESSION_COOKIE = 'cm_session'
const SESSION_DAYS = 30

const adminEmail = () => (process.env.COMMENTS_ADMIN_EMAIL || process.env.COMMENTS_NOTIFY_EMAIL || '').trim().toLowerCase()
const isAdminEmail = (email: string) => !!adminEmail() && email === adminEmail()

export function makeSessionCookie(who: {email: string; name: string}, secure: boolean): string {
  const payload = Buffer.from(JSON.stringify({e: who.email, n: who.name, x: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400})).toString('base64url')
  return `${SESSION_COOKIE}=${payload}.${hmac(`s:${payload}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`
}

export const clearSessionCookie = (secure: boolean) =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`

export function readSession(request: Request): Session | null {
  try {
    const cookie = request.headers.get('cookie') ?? ''
    const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([A-Za-z0-9_-]+)\\.([a-f0-9]{64})`))
    if (!m || !safeEqual(m[2], hmac(`s:${m[1]}`))) return null
    const p = JSON.parse(Buffer.from(m[1], 'base64url').toString())
    if (typeof p.e !== 'string' || typeof p.x !== 'number' || p.x < Date.now() / 1000) return null
    return {email: p.e, name: String(p.n ?? p.e), isAdmin: isAdminEmail(p.e)}
  } catch {
    return null
  }
}

export const unsubscribeToken = (id: string) => hmac(`unsub:${id}`)
export const verifyUnsubscribeToken = (id: string, token: string) => safeEqual(token, unsubscribeToken(id))

/* ── Baca ── */

const key = (id: string) => `comment:${id}`
const listKey = (post: string) => `comments:${post}`

async function loadPost(post: string): Promise<Comment[]> {
  const redis = getRedis()
  const ids = await redis.zrange(listKey(post), 0, -1)
  if (ids.length === 0) return []
  const raw = await redis.mget(ids.map(key))
  return raw.filter((r): r is string => !!r).map(r => JSON.parse(r) as Comment)
}

export async function listComments(post: string): Promise<PublicComment[]> {
  if (!POST_RE.test(post)) throw new CommentError('post tidak valid')
  const all = await loadPost(post)
  const byId = new Map(all.map(c => [c.id, c]))
  return all.map(c => ({
    id: c.id,
    parentId: c.parentId,
    replyToName: c.replyTo ? byId.get(c.replyTo)?.name ?? null : null,
    name: c.name,
    body: c.body,
    createdAt: c.createdAt,
    isOwner: c.isOwner,
  }))
}

/* ── Login Google (Google Identity Services) ── */
// Browser mendapat ID token (JWT) dari Google; di sini tanda tangannya diperiksa ke kunci publik Google,
// lalu email (sudah diverifikasi Google) & nama dipakai. Tidak butuh pustaka tambahan.

let _jwks: {keys: any[]; at: number} | null = null
async function googleKeys(force = false): Promise<any[]> {
  if (!force && _jwks && Date.now() - _jwks.at < 3_600_000) return _jwks.keys
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/certs', {signal: AbortSignal.timeout(8000)})
    if (!res.ok) throw new Error(`certs ${res.status}`)
    const {keys} = (await res.json()) as {keys: any[]}
    _jwks = {keys, at: Date.now()}
    return keys
  } catch (err) {
    console.error('[comments] gagal mengambil kunci Google:', err)
    if (_jwks) return _jwks.keys // pakai salinan lama kalau Google sedang tidak terjangkau
    throw new CommentError('Tidak bisa memverifikasi login Google sekarang, coba lagi sebentar lagi.', 502)
  }
}

export const googleClientId = () => process.env.GOOGLE_CLIENT_ID || null

export async function verifyGoogleToken(idToken: string): Promise<{email: string; name: string}> {
  const clientId = googleClientId()
  if (!clientId) throw new CommentError('Login Google belum diaktifkan.', 400)
  const bad = () => new CommentError('Login Google tidak valid atau sudah kedaluwarsa. Silakan login ulang.', 401)

  const parts = typeof idToken === 'string' ? idToken.split('.') : []
  if (parts.length !== 3 || idToken.length > 4096) throw bad()
  let header: any, payload: any
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  } catch {
    throw bad()
  }
  if (header?.alg !== 'RS256' || !header.kid) throw bad()

  let jwk = (await googleKeys()).find(k => k.kid === header.kid)
  if (!jwk) jwk = (await googleKeys(true)).find(k => k.kid === header.kid) // kunci baru (rotasi)
  if (!jwk) throw bad()

  const signatureOk = cryptoVerify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({key: jwk, format: 'jwk'}),
    Buffer.from(parts[2], 'base64url'),
  )
  if (!signatureOk) throw bad()

  const now = Math.floor(Date.now() / 1000)
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true'
  if (
    !['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss) ||
    payload.aud !== clientId ||
    typeof payload.exp !== 'number' ||
    payload.exp < now ||
    !emailVerified ||
    typeof payload.email !== 'string'
  ) {
    throw bad()
  }
  const email = payload.email.toLowerCase()
  if (!EMAIL_RE.test(email)) throw bad()
  return {email, name: clean(payload.name, 40) || email.split('@')[0].slice(0, 40)}
}

/* ── Login ── */

// Tukar ID token Google dengan sesi. Token diperiksa penuh di server; yang masuk ke cookie hanya email & nama.
export async function loginWithGoogle(idToken: string): Promise<{who: {email: string; name: string}; session: Session}> {
  const who = await verifyGoogleToken(idToken)
  return {who, session: {email: who.email, name: who.name, isAdmin: isAdminEmail(who.email)}}
}

/* ── Tulis ── */

export type CreateInput = {
  post: string
  postTitle?: string
  parentId?: string | null
  body: string
}

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\r\n/g, '\n').trim().slice(0, max) : '')
const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]!))

// Hanya pengguna yang sudah login Google (session) yang boleh berkomentar. Tidak ada jalur anonim.
export async function createComment(input: CreateInput, session: Session | null, ip: string): Promise<PublicComment> {
  if (!session) throw new CommentError('Masuk dengan Google dulu untuk berkomentar.', 401)
  if (!POST_RE.test(input.post)) throw new CommentError('post tidak valid')

  const body = clean(input.body, 2000)
  if (body.length < 2) throw new CommentError('Komentar terlalu pendek.')
  if ((body.match(/https?:\/\//gi) ?? []).length > 2) throw new CommentError('Terlalu banyak tautan.')

  const isAdmin = session.isAdmin
  const name = isAdmin ? ADMIN_NAME() : clean(session.name, 40) || session.email.split('@')[0].slice(0, 40)
  const email = isAdmin ? undefined : session.email

  const redis = getRedis()

  // Batas laju (penulis dikecualikan): 3 komentar/menit dan 30/hari, per akun Google dan per IP.
  if (!isAdmin) {
    const counters = await Promise.all([
      bump(`rl:c:m:${session.email}`, 60),
      bump(`rl:c:d:${session.email}`, 86400),
      bump(`rl:c:m:${ip}`, 60),
      bump(`rl:c:d:${ip}`, 86400),
    ])
    if (counters[0] > 3 || counters[2] > 3 || counters[1] > 30 || counters[3] > 30) {
      throw new CommentError('Terlalu cepat, coba lagi sebentar lagi.', 429)
    }
  }

  // Tentukan induk & yang dibalas. Balasan ke balasan tetap menempel di induk level atas.
  let parentId: string | null = null
  let target: Comment | null = null
  if (input.parentId) {
    const raw = await redis.get(key(clean(input.parentId, 32)))
    target = raw ? (JSON.parse(raw) as Comment) : null
    if (!target || target.post !== input.post) throw new CommentError('Komentar yang dibalas tidak ditemukan.', 404)
    parentId = target.parentId ?? target.id
  }

  const comment: Comment = {
    id: randomBytes(6).toString('hex'),
    post: input.post,
    parentId,
    replyTo: target?.id ?? null,
    name,
    email,
    notify: !!email,
    body,
    createdAt: new Date().toISOString(),
    isOwner: isAdmin,
  }
  await redis.set(key(comment.id), JSON.stringify(comment))
  await redis.zadd(listKey(input.post), Date.now(), comment.id)

  // Notifikasi (gagal kirim email tidak boleh menggagalkan komentar).
  const postTitle = clean(input.postTitle, 120) || 'sebuah tulisan'
  await notify(comment, target, postTitle).catch(err => console.error('[comments] notifikasi gagal:', err))

  return {
    id: comment.id,
    parentId,
    replyToName: target?.name ?? null,
    name,
    body,
    createdAt: comment.createdAt,
    isOwner: isAdmin,
  }
}

async function bump(k: string, ttl: number): Promise<number> {
  const redis = getRedis()
  const n = await redis.incr(k)
  if (n === 1) await redis.expire(k, ttl)
  return n
}

export async function deleteComment(id: string): Promise<void> {
  const redis = getRedis()
  const raw = await redis.get(key(clean(id, 32)))
  if (!raw) return
  const target = JSON.parse(raw) as Comment
  const all = await loadPost(target.post)
  // Hapus juga semua balasan di bawahnya.
  const doomed = all.filter(c => c.id === target.id || c.parentId === target.id || c.replyTo === target.id).map(c => c.id)
  await redis.del(...doomed.map(key))
  await redis.zrem(listKey(target.post), ...doomed)
}

export async function unsubscribe(id: string): Promise<void> {
  const redis = getRedis()
  const raw = await redis.get(key(id))
  if (!raw) return
  const c = JSON.parse(raw) as Comment
  c.notify = false
  await redis.set(key(id), JSON.stringify(c))
}

/* ── Email ── */

// Kirim lewat Resend (HTTP API). Domain pengirim harus diverifikasi (SPF + DKIM) supaya tidak masuk spam.
async function send(to: string, subject: string, html: string, text: string, headers?: Record<string, string>): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM
  if (!key || !from) {
    console.warn('[comments] RESEND_API_KEY / MAIL_FROM belum diset — email tidak dikirim.')
    return false
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({from, to: [to], subject, html, text, ...(headers ? {headers} : {})}),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return true
}

async function notify(c: Comment, target: Comment | null, postTitle: string) {
  const link = `${SITE_URL()}/posts/${c.post}#comment-${c.id}`
  const jobs: Promise<unknown>[] = []

  // 1) Pengomen yang dibalas -> email (kalau memberi email, tidak berhenti langganan, dan bukan balasan ke diri sendiri)
  if (target?.email && target.notify && target.email !== c.email) {
    const unsub = `${SITE_URL()}/comments/unsubscribe?id=${target.id}&t=${unsubscribeToken(target.id)}`
    jobs.push(
      send(
        target.email,
        `${c.name} membalas komentarmu di "${postTitle}"`,
        `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;line-height:1.5">
          <p>Hai ${esc(target.name)}, <b>${esc(c.name)}</b> membalas komentarmu di <b>${esc(postTitle)}</b>:</p>
          <blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #4a9eff;white-space:pre-wrap">${esc(c.body)}</blockquote>
          <p><a href="${link}">Lihat & balas</a></p>
          <p style="color:#888;font-size:12px">Kamu menerima email ini karena berkomentar dengan akun Google-mu. <a href="${unsub}">Berhenti menerima notifikasi</a>.</p>
        </div>`,
        `${c.name} membalas komentarmu di "${postTitle}":\n\n${c.body}\n\nLihat: ${link}\n\nBerhenti notifikasi: ${unsub}`,
        {'List-Unsubscribe': `<${unsub}>`},
      ),
    )
  }

  // 2) Pemilik situs -> email tiap komentar baru dari orang lain
  const owner = process.env.COMMENTS_NOTIFY_EMAIL
  if (owner && !c.isOwner) {
    jobs.push(
      send(
        owner,
        `Komentar baru di "${postTitle}"`,
        `<p><b>${esc(c.name)}</b>${c.email ? ` (${esc(c.email)})` : ''} berkomentar:</p>
         <blockquote style="white-space:pre-wrap">${esc(c.body)}</blockquote><p><a href="${link}">Buka & balas</a></p>`,
        `${c.name}${c.email ? ` (${c.email})` : ''}: ${c.body}\n\n${link}`,
      ),
    )
  }

  await Promise.all(jobs)
}
