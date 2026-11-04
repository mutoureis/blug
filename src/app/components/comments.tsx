import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {FormEvent} from 'react'

type PublicComment = {
  id: string
  parentId: string | null
  replyToName: string | null
  name: string
  body: string
  createdAt: string
  isOwner: boolean
}

type Me = {name: string; email: string; isAdmin: boolean}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: {client_id: string; callback: (r: {credential: string}) => void; ux_mode?: string}) => void
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void
        }
      }
    }
  }
}

const inputCls =
  'w-full rounded-lg bg-[#161616] border border-[#2a2f36] px-3 py-2 font-mono text-[14px] text-[#f0f0f0] placeholder:text-[#666] outline-none focus:border-[#4a9eff] transition-colors'

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString('id-ID', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'})
  } catch {
    return iso
  }
}

// Semua komentar wajib lewat login Google. Browser hanya mengirim token Google sekali ke server;
// server memverifikasinya lalu memberi cookie sesi (30 hari), jadi tidak perlu login ulang tiap komentar.
export function Comments({postId, postTitle}: {postId: string; postTitle: string}) {
  const [comments, setComments] = useState<PublicComment[]>([])
  const [me, setMe] = useState<Me | null>(null)
  const [googleClientId, setGoogleClientId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [replyTo, setReplyTo] = useState<PublicComment | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [sentNote, setSentNote] = useState('')
  const googleBtn = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/comments?post=${encodeURIComponent(postId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Gagal memuat komentar')
      setComments(data.comments)
      setMe(data.me ?? null)
      setGoogleClientId(data.googleClientId ?? null)
      setLoadError('')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Gagal memuat komentar')
    } finally {
      setLoading(false)
    }
  }, [postId])

  useEffect(() => {
    setLoading(true)
    setReplyTo(null)
    load()
  }, [load])

  // Buka komentar tertentu dari tautan email (#comment-xxxx) setelah daftar termuat.
  useEffect(() => {
    if (loading || !location.hash.startsWith('#comment-')) return
    document.getElementById(location.hash.slice(1))?.scrollIntoView({block: 'center'})
  }, [loading])

  const login = useCallback(async (credential: string) => {
    setFormError('')
    try {
      const fd = new FormData()
      fd.set('intent', 'login')
      fd.set('googleToken', credential)
      const res = await fetch('/api/comments', {method: 'POST', body: fd})
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Login Google gagal')
      setMe(data.me)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Login Google gagal')
    }
  }, [])

  async function logout() {
    const fd = new FormData()
    fd.set('intent', 'logout')
    await fetch('/api/comments', {method: 'POST', body: fd}).catch(() => {})
    setMe(null)
    setReplyTo(null)
    setSentNote('')
  }

  // Tombol "Sign in with Google" (Google Identity Services), hanya tampil saat belum login.
  useEffect(() => {
    if (!googleClientId || me) return
    let cancelled = false
    const init = () => {
      const gid = window.google?.accounts?.id
      if (cancelled || !gid || !googleBtn.current) return
      gid.initialize({client_id: googleClientId, callback: r => login(r.credential), ux_mode: 'popup'})
      gid.renderButton(googleBtn.current, {theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left'})
    }
    if (window.google?.accounts?.id) {
      init()
      return () => {
        cancelled = true
      }
    }
    let script = document.querySelector<HTMLScriptElement>('script[data-gsi]')
    if (!script) {
      script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.dataset.gsi = '1'
      document.head.appendChild(script)
    }
    script.addEventListener('load', init)
    return () => {
      cancelled = true
      script?.removeEventListener('load', init)
    }
  }, [googleClientId, me, login])

  const {roots, repliesOf} = useMemo(() => {
    const roots = comments.filter(c => !c.parentId).reverse() // terbaru di atas
    const repliesOf = new Map<string, PublicComment[]>()
    for (const c of comments) {
      if (c.parentId) repliesOf.set(c.parentId, [...(repliesOf.get(c.parentId) ?? []), c]) // balasan: lama -> baru
    }
    return {roots, repliesOf}
  }, [comments])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !me) return
    setBusy(true)
    setFormError('')
    setSentNote('')
    try {
      const fd = new FormData()
      fd.set('post', postId)
      fd.set('postTitle', postTitle)
      fd.set('body', body)
      if (replyTo) fd.set('parentId', replyTo.id)
      const res = await fetch('/api/comments', {method: 'POST', body: fd})
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 401) setMe(null) // sesi habis -> minta login lagi
        throw new Error(data.error ?? 'Gagal mengirim komentar')
      }
      setBody('')
      setReplyTo(null)
      setSentNote(me.isAdmin ? 'Terkirim.' : 'Terkirim. Kamu akan diberi email kalau ada yang membalas.')
      await load()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal mengirim komentar')
    } finally {
      setBusy(false)
    }
  }

  async function remove(c: PublicComment) {
    if (!confirm(`Hapus komentar dari ${c.name}? Balasannya ikut terhapus.`)) return
    const fd = new FormData()
    fd.set('intent', 'delete')
    fd.set('id', c.id)
    const res = await fetch('/api/comments', {method: 'POST', body: fd})
    if (res.ok) load()
    else alert('Gagal menghapus')
  }

  const item = (c: PublicComment, nested: boolean) => (
    <div
      key={c.id}
      id={`comment-${c.id}`}
      className={nested ? 'pl-4 border-l border-[#2a2f36] mt-4' : 'py-5 border-b border-[#1e1e1e]'}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-[14px] text-[#f0f0f0]">{c.name}</span>
        {c.isOwner && (
          <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-[#4a9eff] border border-[#4a9eff]/40 rounded px-1.5 py-px">
            penulis
          </span>
        )}
        <span className="font-mono text-[12px] text-[#666]">{fmt(c.createdAt)}</span>
      </div>
      {nested && c.replyToName && <p className="font-mono text-[12px] text-[#666] mt-1">↳ membalas {c.replyToName}</p>}
      <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[#d8d8d8]">{c.body}</p>
      <div className="mt-2 flex gap-4 font-mono text-[12px]">
        <button type="button" onClick={() => setReplyTo(c)} className="text-[#888] hover:text-[#4a9eff] transition-colors">
          Balas
        </button>
        {me?.isAdmin && (
          <button type="button" onClick={() => remove(c)} className="text-[#888] hover:text-[#ff6b6b] transition-colors">
            Hapus
          </button>
        )}
      </div>
      {!nested && (repliesOf.get(c.id) ?? []).map(r => item(r, true))}
    </div>
  )

  return (
    <section aria-label="Komentar" className="font-mono">
      <h2 className="font-display text-[26px] text-[#f0f0f0] mb-6">{comments.length} komentar</h2>

      {me ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-[#161616] border border-[#2a2f36] px-3 py-2 text-[13px]">
            <span className="min-w-0 truncate text-[#d8d8d8]">
              Masuk sebagai <b className="text-[#f0f0f0]">{me.isAdmin ? `${me.name} (penulis)` : me.name}</b>
              {!me.isAdmin && <span className="text-[#666]"> · {me.email}</span>}
            </span>
            <button type="button" onClick={logout} className="shrink-0 text-[#888] hover:text-[#f0f0f0]">
              Keluar
            </button>
          </div>
          {replyTo && (
            <div className="flex items-center justify-between rounded-lg bg-[#161616] border border-[#2a2f36] px-3 py-2 text-[13px] text-[#aaa]">
              <span className="truncate">Membalas {replyTo.name}</span>
              <button type="button" onClick={() => setReplyTo(null)} className="text-[#888] hover:text-[#f0f0f0] ml-3">
                Batal
              </button>
            </div>
          )}
          <textarea
            className={`${inputCls} min-h-[110px] resize-y`}
            placeholder={replyTo ? `Balas ${replyTo.name}…` : 'Tulis komentar…'}
            value={body}
            onChange={e => setBody(e.target.value)}
            maxLength={2000}
            required
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] text-[#666]">
              {!me.isAdmin && 'Email-mu tidak ditampilkan ke publik. '}
              {body.length}/2000
            </p>
            <button
              disabled={busy || body.trim().length < 2}
              className="rounded-lg bg-[#4a9eff] text-[#0a0a0a] px-5 py-2 text-[14px] disabled:opacity-40 transition-opacity"
            >
              {busy ? 'Mengirim…' : 'Kirim'}
            </button>
          </div>
          {formError && <p className="text-[13px] text-[#ff6b6b]">{formError}</p>}
          {sentNote && <p className="text-[13px] text-[#6bd68a]">{sentNote}</p>}
        </form>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg bg-[#161616] border border-[#2a2f36] p-4">
          {googleClientId ? (
            <>
              <p className="text-[13px] text-[#d8d8d8]">Masuk dengan Google untuk berkomentar{replyTo ? ` (membalas ${replyTo.name})` : ''}.</p>
              <div ref={googleBtn} className="min-h-[44px]" />
              <p className="text-[12px] text-[#666]">
                Email-mu dipakai hanya untuk memberi notifikasi saat komentarmu dibalas, dan tidak ditampilkan ke publik.
              </p>
            </>
          ) : (
            <p className="text-[13px] text-[#888]">Kolom komentar belum aktif.</p>
          )}
          {formError && <p className="text-[13px] text-[#ff6b6b]">{formError}</p>}
        </div>
      )}

      <div className="mt-8">
        {loading && <p className="text-[13px] text-[#666]">Memuat komentar…</p>}
        {loadError && <p className="text-[13px] text-[#ff6b6b]">{loadError}</p>}
        {!loading && !loadError && comments.length === 0 && <p className="text-[13px] text-[#666]">Belum ada komentar. Jadilah yang pertama.</p>}
        {roots.map(c => item(c, false))}
      </div>
    </section>
  )
}
