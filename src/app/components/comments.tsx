import {useCallback, useEffect, useMemo, useState} from 'react'
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

const inputCls =
  'w-full rounded-lg bg-[#161616] border border-[#2a2f36] px-3 py-2 font-mono text-[14px] text-[#f0f0f0] placeholder:text-[#666] outline-none focus:border-[#4a9eff] transition-colors'

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString('id-ID', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'})
  } catch {
    return iso
  }
}

const LS_NAME = 'cm_name'
const LS_EMAIL = 'cm_email'
const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? ''
  } catch {
    return ''
  }
}
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* abaikan */
  }
}

export function Comments({postId, postTitle}: {postId: string; postTitle: string}) {
  const [comments, setComments] = useState<PublicComment[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [replyTo, setReplyTo] = useState<PublicComment | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [body, setBody] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [sentNote, setSentNote] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/comments?post=${encodeURIComponent(postId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Gagal memuat komentar')
      setComments(data.comments)
      setIsAdmin(!!data.isAdmin)
      setLoadError('')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Gagal memuat komentar')
    } finally {
      setLoading(false)
    }
  }, [postId])

  useEffect(() => {
    setName(read(LS_NAME))
    setEmail(read(LS_EMAIL))
  }, [])

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
    if (busy) return
    setBusy(true)
    setFormError('')
    setSentNote('')
    try {
      const fd = new FormData()
      fd.set('post', postId)
      fd.set('postTitle', postTitle)
      fd.set('name', name)
      fd.set('email', email)
      fd.set('body', body)
      fd.set('website', website)
      if (replyTo) fd.set('parentId', replyTo.id)
      const res = await fetch('/api/comments', {method: 'POST', body: fd})
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Gagal mengirim komentar')
      write(LS_NAME, name)
      write(LS_EMAIL, email)
      setBody('')
      setReplyTo(null)
      setSentNote(isAdmin ? 'Terkirim.' : 'Terkirim. Kamu akan diberi email kalau ada yang membalas.')
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
        {isAdmin && (
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
      <h2 className="font-display text-[26px] text-[#f0f0f0] mb-6">
        {comments.length} {comments.length === 1 ? 'komentar' : 'komentar'}
      </h2>

      <form onSubmit={submit} className="flex flex-col gap-3">
        {replyTo && (
          <div className="flex items-center justify-between rounded-lg bg-[#161616] border border-[#2a2f36] px-3 py-2 text-[13px] text-[#aaa]">
            <span className="truncate">Membalas {replyTo.name}</span>
            <button type="button" onClick={() => setReplyTo(null)} className="text-[#888] hover:text-[#f0f0f0] ml-3">
              Batal
            </button>
          </div>
        )}
        {!isAdmin && (
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className={inputCls}
              placeholder="Nama"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={40}
              required
              autoComplete="name"
            />
            <input
              className={inputCls}
              type="email"
              placeholder="Email (wajib, untuk notifikasi balasan)"
              value={email}
              onChange={e => setEmail(e.target.value)}
              maxLength={120}
              required
              autoComplete="email"
            />
          </div>
        )}
        {isAdmin && <p className="text-[12px] text-[#4a9eff]">Masuk sebagai penulis · <a href="/comments-admin?logout" className="underline">keluar</a></p>}
        {/* Honeypot: disembunyikan dari manusia, bot biasanya mengisinya. */}
        <input
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          name="website"
          value={website}
          onChange={e => setWebsite(e.target.value)}
          style={{position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0}}
        />
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
            {!isAdmin && 'Email wajib diisi, tidak ditampilkan ke publik. '}
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

      <div className="mt-8">
        {loading && <p className="text-[13px] text-[#666]">Memuat komentar…</p>}
        {loadError && <p className="text-[13px] text-[#ff6b6b]">{loadError}</p>}
        {!loading && !loadError && comments.length === 0 && <p className="text-[13px] text-[#666]">Belum ada komentar. Jadilah yang pertama.</p>}
        {roots.map(c => item(c, false))}
      </div>
    </section>
  )
}
