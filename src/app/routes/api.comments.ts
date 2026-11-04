import {json} from '@remix-run/node'
import type {ActionFunctionArgs, LoaderFunctionArgs} from '@remix-run/node'
import {
  clearSessionCookie,
  CommentError,
  createComment,
  deleteComment,
  googleClientId,
  listComments,
  loginWithGoogle,
  makeSessionCookie,
  readSession,
} from '../lib/comments.server.js'

const noStore = {'Cache-Control': 'no-store'}

function ipOf(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown'
}

// Cookie "Secure" di semua tempat kecuali saat dites lewat http://localhost.
function isSecure(request: Request) {
  return !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(new URL(request.url).host)
}

function fail(err: unknown) {
  if (err instanceof CommentError) return json({error: err.message}, {status: err.status, headers: noStore})
  console.error('[api.comments]', err)
  return json({error: 'Terjadi kesalahan, coba lagi nanti.'}, {status: 500, headers: noStore})
}

// GET /api/comments?post=<rkey> -> daftar komentar + siapa yang sedang login (null kalau belum)
export const loader = async ({request}: LoaderFunctionArgs) => {
  try {
    const post = new URL(request.url).searchParams.get('post') ?? ''
    const s = readSession(request)
    return json(
      {
        comments: await listComments(post),
        me: s ? {name: s.name, email: s.email, isAdmin: s.isAdmin} : null,
        googleClientId: googleClientId(),
      },
      {headers: noStore},
    )
  } catch (err) {
    return fail(err)
  }
}

// POST /api/comments  intent = login | logout | delete | (kosong = kirim komentar)
export const action = async ({request}: ActionFunctionArgs) => {
  try {
    if (request.method !== 'POST') throw new CommentError('Method tidak diizinkan', 405)
    // Tolak POST lintas-situs (CSRF): Origin harus sama dengan host kita.
    const origin = request.headers.get('origin')
    if (origin && new URL(origin).host !== new URL(request.url).host) throw new CommentError('Origin tidak valid', 403)

    const f = await request.formData()
    const str = (k: string) => (typeof f.get(k) === 'string' ? (f.get(k) as string) : '')
    const intent = str('intent')
    const secure = isSecure(request)

    if (intent === 'login') {
      const {who, session} = await loginWithGoogle(str('googleToken'))
      return json(
        {ok: true, me: {name: session.name, email: who.email, isAdmin: session.isAdmin}},
        {headers: {...noStore, 'Set-Cookie': makeSessionCookie(who, secure)}},
      )
    }

    if (intent === 'logout') {
      return json({ok: true}, {headers: {...noStore, 'Set-Cookie': clearSessionCookie(secure)}})
    }

    const session = readSession(request)

    if (intent === 'delete') {
      if (!session?.isAdmin) throw new CommentError('Khusus penulis', 403)
      await deleteComment(str('id'))
      return json({ok: true}, {headers: noStore})
    }

    const comment = await createComment(
      {post: str('post'), postTitle: str('postTitle'), parentId: str('parentId') || null, body: str('body')},
      session,
      ipOf(request),
    )
    return json({ok: true, comment}, {headers: noStore})
  } catch (err) {
    return fail(err)
  }
}
