// Sistem komentar sendiri (tanpa akun Bluesky/GitHub). Disimpan di Redis, dengan notifikasi email
// ke pengomen saat dibalas, dan ke pemilik situs saat ada komentar baru.
//
// Redis:
//   comment:{id}   -> JSON Comment
//   comments:{post} -> sorted set (skor = waktu) berisi id komentar post itu
//   rl:c:{ip}      -> pembatas laju
//
// Env:
//   COMMENTS_SECRET          wajib, string acak panjang (untuk cookie admin & token berhenti-langganan)
//   COMMENTS_ADMIN_PASSWORD  wajib kalau mau membalas/menghapus sebagai admin
//   COMMENTS_NOTIFY_EMAIL    email pemilik, dapat notifikasi tiap komentar baru (opsional)
//   COMMENTS_ADMIN_NAME      nama tampilan admin (default "mutho")
//   RESEND_API_KEY           API key Resend (https://resend.com). Tanpa ini komentar tetap jalan,
//                            hanya email tidak terkirim.
//   MAIL_FROM                pengirim di domain yang sudah diverifikasi di Resend,
//                            mis. "mutho <comments@mutho.my.id>"
//   SITE_URL                 default https://mutho.my.id

import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto'
import {getRedis} from '../../redis/redis.js'

export type Comment = {
  id: string
  post: string
  parentId: string | null // komentar induk (level atas) — balasan selalu 1 level
  replyTo: string | null // komentar spesifik yang dibalas (untuk notifikasi)
  name: string
  email?: string // privat, tidak pernah dikirim ke browser; wajib untuk pengunjung, kosong untuk admin
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

export const ADMIN_COOKIE = 'cm_admin'
export const adminCookieValue = () => hmac('admin')

export function isAdminRequest(request: Request): boolean {
  try {
    const cookie = request.headers.get('cookie') ?? ''
    const m = cookie.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=([a-f0-9]+)`))
    return !!m && safeEqual(m[1], adminCookieValue())
  } catch {
    return false
  }
}

export function checkAdminPassword(password: string): boolean {
  const expected = process.env.COMMENTS_ADMIN_PASSWORD
  return !!expected && safeEqual(password, expected)
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

/* ── Tulis ── */

export type CreateInput = {
  post: string
  postTitle?: string
  parentId?: string | null
  name?: string
  email?: string
  body: string
  website?: string // honeypot
}

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\r\n/g, '\n').trim().slice(0, max) : '')
const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]!))

export async function createComment(input: CreateInput, ip: string, isAdmin: boolean): Promise<{comment: PublicComment | null}> {
  if (!POST_RE.test(input.post)) throw new CommentError('post tidak valid')

  // Honeypot: kolom tersembunyi ini cuma diisi bot. Pura-pura sukses supaya bot tidak belajar.
  if (input.website) return {comment: null}

  const body = clean(input.body, 2000)
  if (body.length < 2) throw new CommentError('Komentar terlalu pendek.')
  if ((body.match(/https?:\/\//gi) ?? []).length > 2) throw new CommentError('Terlalu banyak tautan.')

  const name = isAdmin ? ADMIN_NAME() : clean(input.name, 40)
  if (!name) throw new CommentError('Nama wajib diisi.')

  // Email wajib untuk semua pengunjung (admin dikecualikan) — dipakai untuk notifikasi balasan.
  let email: string | undefined
  if (!isAdmin) {
    email = clean(input.email, 120).toLowerCase()
    if (!email) throw new CommentError('Email wajib diisi.')
    if (!EMAIL_RE.test(email)) throw new CommentError('Format email tidak valid.')
  }

  const redis = getRedis()

  // Batas laju per IP (admin dikecualikan): 3 komentar/menit, 30/hari.
  if (!isAdmin) {
    const [perMin, perDay] = await Promise.all([bump(`rl:c:m:${ip}`, 60), bump(`rl:c:d:${ip}`, 86400)])
    if (perMin > 3 || perDay > 30) throw new CommentError('Terlalu cepat, coba lagi sebentar lagi.', 429)
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
    comment: {
      id: comment.id,
      parentId,
      replyToName: target?.name ?? null,
      name,
      body,
      createdAt: comment.createdAt,
      isOwner: isAdmin,
    },
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
async function send(to: string, subject: string, html: string, text: string, headers?: Record<string, string>) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM
  if (!key || !from) {
    console.warn('[comments] RESEND_API_KEY / MAIL_FROM belum diset — email notifikasi tidak dikirim.')
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({from, to: [to], subject, html, text, ...(headers ? {headers} : {})}),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)
}

async function notify(c: Comment, target: Comment | null, postTitle: string) {
  const link = `${SITE_URL()}/posts/${c.post}#comment-${c.id}`
  const jobs: Promise<void>[] = []

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
          <p style="color:#888;font-size:12px">Kamu menerima email ini karena mengisi email saat berkomentar. <a href="${unsub}">Berhenti menerima notifikasi</a>.</p>
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
