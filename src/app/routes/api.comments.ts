import {json} from '@remix-run/node'
import type {ActionFunctionArgs, LoaderFunctionArgs} from '@remix-run/node'
import {CommentError, createComment, deleteComment, isAdminRequest, listComments} from '../lib/comments.server.js'

const noStore = {'Cache-Control': 'no-store'}

function ipOf(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown'
}

function fail(err: unknown) {
  if (err instanceof CommentError) return json({error: err.message}, {status: err.status, headers: noStore})
  console.error('[api.comments]', err)
  return json({error: 'Terjadi kesalahan, coba lagi nanti.'}, {status: 500, headers: noStore})
}

// GET /api/comments?post=<rkey>
export const loader = async ({request}: LoaderFunctionArgs) => {
  try {
    const post = new URL(request.url).searchParams.get('post') ?? ''
    return json({comments: await listComments(post), isAdmin: isAdminRequest(request)}, {headers: noStore})
  } catch (err) {
    return fail(err)
  }
}

// POST /api/comments  (intent=create | delete)
export const action = async ({request}: ActionFunctionArgs) => {
  try {
    if (request.method !== 'POST') throw new CommentError('Method tidak diizinkan', 405)
    // Tolak POST lintas-situs (CSRF): Origin harus sama dengan host kita.
    const origin = request.headers.get('origin')
    if (origin && new URL(origin).host !== new URL(request.url).host) throw new CommentError('Origin tidak valid', 403)

    const f = await request.formData()
    const str = (k: string) => (typeof f.get(k) === 'string' ? (f.get(k) as string) : '')
    const admin = isAdminRequest(request)

    if (str('intent') === 'delete') {
      if (!admin) throw new CommentError('Khusus admin', 403)
      await deleteComment(str('id'))
      return json({ok: true}, {headers: noStore})
    }

    const {comment} = await createComment(
      {
        post: str('post'),
        postTitle: str('postTitle'),
        parentId: str('parentId') || null,
        name: str('name'),
        email: str('email'),
        body: str('body'),
        website: str('website'),
      },
      ipOf(request),
      admin,
    )
    return json({ok: true, comment}, {headers: noStore})
  } catch (err) {
    return fail(err)
  }
}
