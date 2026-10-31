import {json} from '@remix-run/node'
import type {ActionFunctionArgs} from '@remix-run/node'
import {createHash} from 'node:crypto'
import {getVisitCounts, recordVisit} from '../../redis/redis.js'

// Penghitung pengunjung unik. GET = baca angka, POST = catat pengunjung (dipanggil browser sekali per sesi).
// Privasi: IP tidak disimpan. Yang masuk ke Redis hanya hash (IP + user agent + garam rahasia),
// ke HyperLogLog yang hanya bisa dipakai untuk menghitung, bukan untuk membaca ulang isinya.

const NO_STORE = {headers: {'Cache-Control': 'no-store'}}
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|axios|node-fetch|go-http/i

function visitorHash(request: Request): string {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  const ua = request.headers.get('user-agent') ?? ''
  const salt = process.env.VISIT_SALT ?? 'mutho-visits' // sebaiknya isi VISIT_SALT di Vercel dengan teks acak panjang
  return createHash('sha256').update(`${salt}|${ip}|${ua}`).digest('hex').slice(0, 32)
}

export const loader = async () => json(await getVisitCounts(), NO_STORE)

export const action = async ({request}: ActionFunctionArgs) => {
  if (request.method !== 'POST') return json({error: 'Method not allowed'}, {status: 405})

  const ua = request.headers.get('user-agent') ?? ''
  if (!ua || BOT.test(ua)) return json(await getVisitCounts(), NO_STORE) // bot: tampilkan angka, jangan dihitung

  // Hanya terima dari situs sendiri
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return json(await getVisitCounts(), NO_STORE)
    } catch {
      return json(await getVisitCounts(), NO_STORE)
    }
  }

  return json(await recordVisit(visitorHash(request)), NO_STORE)
}
