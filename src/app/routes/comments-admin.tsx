import {redirect} from '@remix-run/node'
import type {ActionFunctionArgs, LoaderFunctionArgs} from '@remix-run/node'
import {Form, useActionData} from '@remix-run/react'
import {ADMIN_COOKIE, adminCookieValue, checkAdminPassword, isAdminRequest} from '../lib/comments.server.js'

const cookie = (value: string, maxAge: number) =>
  `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`

// /comments-admin        -> form login admin (balas & hapus komentar langsung di halaman post)
// /comments-admin?logout -> keluar
export const loader = async ({request}: LoaderFunctionArgs) => {
  if (new URL(request.url).searchParams.has('logout')) {
    return redirect('/', {headers: {'Set-Cookie': cookie('', 0)}})
  }
  if (isAdminRequest(request)) return redirect('/blog')
  return null
}

export const action = async ({request}: ActionFunctionArgs) => {
  const f = await request.formData()
  const password = typeof f.get('password') === 'string' ? (f.get('password') as string) : ''
  if (!checkAdminPassword(password)) {
    await new Promise(r => setTimeout(r, 800)) // perlambat tebak-tebakan
    return {error: 'Password salah.'}
  }
  return redirect('/blog', {headers: {'Set-Cookie': cookie(adminCookieValue(), 60 * 60 * 24 * 30)}})
}

export const meta = () => [{title: 'Admin komentar'}, {name: 'robots', content: 'noindex'}]

export default function CommentsAdmin() {
  const data = useActionData<typeof action>()
  return (
    <div className="max-w-sm mx-auto px-6 py-24">
      <h1 className="font-display text-[32px] text-[#f0f0f0] mb-6">Admin.</h1>
      <Form method="post" className="flex flex-col gap-3">
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          className="rounded-lg bg-[#161616] border border-[#2a2f36] px-3 py-2 font-mono text-[#f0f0f0] outline-none focus:border-[#4a9eff]"
        />
        {data?.error && <p className="font-mono text-[13px] text-[#ff6b6b]">{data.error}</p>}
        <button className="rounded-lg bg-[#4a9eff] text-[#0a0a0a] font-mono py-2">Masuk</button>
      </Form>
    </div>
  )
}
