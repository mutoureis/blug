import type {LoaderFunctionArgs} from '@remix-run/node'
import {unsubscribe, verifyUnsubscribeToken} from '../lib/comments.server.js'

// Tautan di email: /comments/unsubscribe?id=...&t=...
export const loader = async ({request}: LoaderFunctionArgs) => {
  const u = new URL(request.url)
  const id = u.searchParams.get('id') ?? ''
  const t = u.searchParams.get('t') ?? ''
  let ok = false
  try {
    if (/^[a-f0-9]{12}$/.test(id) && verifyUnsubscribeToken(id, t)) {
      await unsubscribe(id)
      ok = true
    }
  } catch (err) {
    console.error('[comments.unsubscribe]', err)
  }
  const msg = ok ? 'Notifikasi balasan untuk komentar ini sudah dimatikan.' : 'Tautan tidak valid atau sudah kedaluwarsa.'
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notifikasi</title>
<body style="background:#0a0a0a;color:#f0f0f0;font-family:ui-monospace,monospace;padding:48px 24px;max-width:520px;margin:auto"><p>${msg}</p><p><a style="color:#4a9eff" href="/">← mutho.my.id</a></p>`,
    {status: ok ? 200 : 400, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}},
  )
}
