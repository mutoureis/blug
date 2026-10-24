import {useLoaderData} from '@remix-run/react'
import {json} from '@remix-run/node'
import {useState, useEffect, useCallback, useMemo, useRef} from 'react'
import type {CSSProperties} from 'react'
import {getCachedGallery, setCachedGallery} from '../../redis/redis.js'
import {formatDate} from '../lib/post-utils.js'

const HANDLE = 'mutho.my.id'
const THUMB_W = 480
const THUMB_Q = 60
const FULL_W  = 1200
const FULL_Q  = 80

function wsrv(url: string, w: number, q: number) {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=${q}&output=webp&we=1`
}

let _did: string | null = null
let _didAt = 0
async function resolveDid() {
  if (_did && Date.now() - _didAt < 3_600_000) return _did
  const res = await fetch(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${HANDLE}`)
  const {did} = await res.json()
  _did = did; _didAt = Date.now()
  return did
}

// Jalankan `fn` untuk tiap item dengan paling banyak `limit` request berbarengan,
// supaya ratusan getRecord tidak menghantam Bluesky sekaligus.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

type ImageItem = {thumb: string; full: string; width: number; height: number; alt: string}
type PhotoPost = {images: ImageItem[]; createdAt: string}

// Zeens nyimpen foto sebagai post Bluesky biasa (app.bsky.feed.post + embed app.bsky.embed.images,
// bisa lebih dari 1 foto per post), dan nempelin sidecar record app.photosky.postMeta (rkey sama
// persis) buat data tambahan (warna, EXIF). Jadi: list dulu semua postMeta buat dapetin daftar rkey,
// baru tarik post asli satu-satu buat ambil SEMUA foto di dalamnya.
async function fetchZeensPhotos(did: string): Promise<PhotoPost[]> {
  // Ambil semua record postMeta (paginated, dibatasin 5 halaman/±500 post biar aman)
  const metaRecords: any[] = []
  let cursor: string | undefined
  for (let page = 0; page < 5; page++) {
    const url = new URL('https://bsky.social/xrpc/com.atproto.repo.listRecords')
    url.searchParams.set('repo', did)
    url.searchParams.set('collection', 'app.photosky.postMeta')
    url.searchParams.set('limit', '100')
    if (cursor) url.searchParams.set('cursor', cursor)
    const res = await fetch(url.toString())
    const data = await res.json()
    metaRecords.push(...(data.records ?? []))
    if (!data.cursor || (data.records ?? []).length === 0) break
    cursor = data.cursor
  }

  // Tarik post Bluesky asli satu-satu (paralel) buat dapetin semua blob foto + aspect ratio-nya
  const results = await mapPool(metaRecords, 12, async (meta: any): Promise<PhotoPost | null> => {
    const rkey = meta.uri.split('/').pop()
    try {
      const res = await fetch(`https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.feed.post&rkey=${rkey}`)
      if (!res.ok) return null
      const {value} = await res.json()
      const embedImages = value?.embed?.images ?? value?.embed?.media?.images ?? []
      const images: ImageItem[] = embedImages
        .filter((img: any) => img?.image?.ref?.$link)
        .map((img: any) => {
          const blobUrl = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${img.image.ref.$link}`
          return {
            thumb: wsrv(blobUrl, THUMB_W, THUMB_Q),
            full:  wsrv(blobUrl, FULL_W, FULL_Q),
            width:  img.aspectRatio?.width  ?? 1,
            height: img.aspectRatio?.height ?? 1,
            alt: img.alt ?? '',
          }
        })
      if (images.length === 0) return null
      return {images, createdAt: value.createdAt ?? meta.value.createdAt}
    } catch {
      return null
    }
  })

  return results
    .filter((p): p is PhotoPost => p !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export const loader = async () => {
  const headers = {
    Link: '<https://wsrv.nl>; rel=preconnect, <https://bsky.social>; rel=preconnect',
    'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
  }

  // Dulu: tiap kunjungan = ratusan request ke Bluesky sebelum halaman tampil.
  // Sekarang: hasilnya di-cache di Redis 10 menit.
  const cached = await getCachedGallery<{posts: PhotoPost[]; did: string}>()
  if (cached) return json(cached, {headers})

  const did = await resolveDid()
  const posts = await fetchZeensPhotos(did)
  const payload = {posts, did}
  if (posts.length > 0) await setCachedGallery(payload) // jangan cache hasil kosong (mungkin gagal sementara)

  return json(payload, {headers})
}

function Lightbox({images, initialIndex, onClose, dateLabel}: {images: ImageItem[]; initialIndex: number; onClose: () => void; dateLabel?: string}) {
  // images di sini cuma foto dari 1 post yang lagi dibuka — geser cuma jalan kalau post-nya
  // punya lebih dari 1 foto, nggak lompat ke post lain.
  const [index, setIndex] = useState(initialIndex)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const prev = useCallback(() => setIndex(i => (i - 1 + images.length) % images.length), [images.length])
  const next = useCallback(() => setIndex(i => (i + 1) % images.length), [images.length])
  const goTo = useCallback((i: number) => setIndex(i % images.length), [images.length])

  const closedByPopState = useRef(false)

  useEffect(() => {
    // Buat container div dan langsung append ke <body> — bypass semua transform parent
    const div = document.createElement('div')
    div.id = 'lightbox-root'
    div.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
      'width:100%', 'height:100%', 'z-index:999999',
      'background:rgba(0,0,0,0.6)',
      'backdrop-filter:blur(28px)', '-webkit-backdrop-filter:blur(28px)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'touch-action:none', 'overscroll-behavior:none', 'overflow:hidden',
    ].join(';')
    document.body.appendChild(div)
    containerRef.current = div

    // Lock scroll & disable main transform
    document.body.style.overflow = 'hidden'
    const main = document.querySelector('main') as HTMLElement | null
    const prevTransform = main?.style.transform ?? ''
    const prevTransition = main?.style.transition ?? ''
    if (main) { main.style.transform = 'none'; main.style.transition = 'none' }

    // Tambahin 1 history entry pas lightbox dibuka. Jadi kalau user pencet tombol back
    // (browser atau hardware back di HP), yang kejadian cuma nutup foto ini — bukan
    // pindah/keluar dari halaman gallery-nya.
    window.history.pushState({lightbox: true}, '')
    const handlePopState = () => {
      closedByPopState.current = true
      onClose()
    }
    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
      document.body.removeChild(div)
      document.body.style.overflow = ''
      if (main) { main.style.transform = prevTransform; main.style.transition = prevTransition }
      // Kalau ditutupnya bukan lewat tombol back (misal klik background / tekan Escape),
      // history entry yang tadi kita tambahin masih nyangkut — bersihin biar tombol back
      // nggak perlu dipencet dua kali buat baru beneran ninggalin halaman gallery.
      if (!closedByPopState.current) window.history.back()
    }
  }, [])

  // Update gambar setiap index berubah
  useEffect(() => {
    const div = containerRef.current
    if (!div) return
    renderLightboxContent(div, images, index, prev, next, goTo, onClose,
      (e: TouchEvent) => {
        touchStartX.current = e.touches[0].clientX
        touchStartY.current = e.touches[0].clientY
      },
      (e: TouchEvent) => {
        if (touchStartX.current === null) return
        const dx = touchStartX.current - e.changedTouches[0].clientX
        const rawDy = e.changedTouches[0].clientY - (touchStartY.current ?? 0)
        // Swipe ke bawah = tutup foto
        if (rawDy > 90 && Math.abs(dx) < rawDy * 0.6) {
          touchStartX.current = null; touchStartY.current = null
          onClose()
          return
        }
        const dy = Math.abs(rawDy)
        if (Math.abs(dx) > 50 && dy < Math.abs(dx) * 0.8) dx > 0 ? next() : prev()
        touchStartX.current = null; touchStartY.current = null
      },
      dateLabel
    )
    const handleResize = () => positionArrows(div, images[index])
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [index, images, prev, next, goTo, onClose, dateLabel])

  // Keyboard
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose, prev, next])

  return null // render dilakukan via vanilla DOM
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Panah harus nempel di tepi foto ASLI, bukan tepi kotak #lb-imgwrap (yang lebar tetapnya
// 1240px). Karena foto pakai object-fit:contain, lebar foto yang kebentuk di layar tergantung
// aspect ratio-nya sendiri (potret vs lanskap) dibanding aspect ratio wrap-nya. Jadi kita hitung
// manual pakai rumus contain, lalu posisikan panah persis di tepi hasil hitungan itu, digeser
// dikit (translateX -50%) biar separuh badan panahnya "nangkring" di atas tepi foto.
function computeEdgeX(wrapW: number, wrapH: number, imgW: number, imgH: number) {
  const arImg = imgW / imgH
  const arWrap = wrapW / wrapH
  const renderedW = arImg > arWrap ? wrapW : wrapH * arImg
  const leftX = (wrapW - renderedW) / 2
  const rightX = wrapW - leftX
  return {leftX, rightX}
}

function positionArrows(div: HTMLDivElement, meta: {width: number; height: number}) {
  const wrap = div.querySelector('#lb-imgwrap') as HTMLElement | null
  const prevBtn = div.querySelector('#lb-prev') as HTMLElement | null
  const nextBtn = div.querySelector('#lb-next') as HTMLElement | null
  if (!wrap || !prevBtn || !nextBtn) return
  const rect = wrap.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  const {leftX, rightX} = computeEdgeX(rect.width, rect.height, meta.width || 1, meta.height || 1)
  prevBtn.style.left = `${leftX}px`
  nextBtn.style.left = `${rightX}px`
}

function renderLightboxContent(
  div: HTMLDivElement,
  images: ImageItem[],
  index: number,
  prev: () => void,
  next: () => void,
  goTo: (i: number) => void,
  onClose: () => void,
  onTouchStart: (e: TouchEvent) => void,
  onTouchEnd: (e: TouchEvent) => void,
  dateLabel?: string,
) {
  // Thumbnail strip cuma masuk akal buat navigasi cepat kalau jumlahnya dikit — begitu udah
  // lintas banyak post, tampilin strip buat sebagian kecil di sekitar foto yang lagi dibuka aja.
  const THUMB_WINDOW = 9
  const showAllThumbs = images.length > 1 && images.length <= 40
  const windowStart = Math.max(0, Math.min(index - Math.floor(THUMB_WINDOW / 2), images.length - THUMB_WINDOW))
  const thumbIndices = showAllThumbs
    ? images.map((_, i) => i)
    : images.length > 1
      ? Array.from({length: Math.min(THUMB_WINDOW, images.length)}, (_, k) => windowStart + k)
      : []
  const hasAlt = !!images[index].alt
  div.innerHTML = `
    <div style="position:fixed;inset:0;display:flex;flex-direction:column;">

      <div id="lb-imgwrap" style="position:relative;flex:1;min-height:0;width:100%;max-width:1240px;margin:0 auto;
        display:flex;align-items:center;justify-content:center;overflow:hidden;">

        ${images.length > 1 ? `
        <div style="position:absolute;top:18px;left:50%;transform:translateX(-50%);
          z-index:1000001;color:rgba(255,255,255,0.5);font-family:monospace;font-size:13px;
          background:rgba(0,0,0,0.5);padding:4px 10px;border-radius:99px;">
          ${index + 1} / ${images.length}
        </div>
        <div id="lb-prev" style="position:absolute;left:20px;top:50%;transform:translate(-50%,-50%);
          z-index:1000001;background:rgba(0,0,0,0.45);border:none;border-radius:999px;
          color:rgba(255,255,255,0.8);font-size:18px;line-height:1;width:36px;height:36px;
          display:flex;align-items:center;justify-content:center;cursor:pointer;
          -webkit-tap-highlight-color:transparent;">‹</div>
        <div id="lb-next" style="position:absolute;left:calc(100% - 20px);top:50%;transform:translate(-50%,-50%);
          z-index:1000001;background:rgba(0,0,0,0.45);border:none;border-radius:999px;
          color:rgba(255,255,255,0.8);font-size:18px;line-height:1;width:36px;height:36px;
          display:flex;align-items:center;justify-content:center;cursor:pointer;
          -webkit-tap-highlight-color:transparent;">›</div>
        ` : ''}

        <img src="${images[index].full}" alt="Photo ${index + 1}"
          style="max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;
          cursor:pointer;-webkit-user-select:none;user-select:none;" />
      </div>

      ${thumbIndices.length > 0 ? `
      <div id="lb-thumbstrip" style="flex-shrink:0;display:flex;justify-content:center;align-items:center;
        gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:#000;
        overflow-x:auto;-webkit-overflow-scrolling:touch;">
        ${thumbIndices.map(i => `
          <img data-thumb="${i}" src="${images[i].thumb}" alt=""
            style="flex-shrink:0;width:52px;height:52px;object-fit:cover;border-radius:6px;cursor:pointer;
              box-sizing:border-box;
              border:2px solid ${i === index ? '#fff' : 'transparent'};
              opacity:${i === index ? '1' : '0.5'};
              transition:opacity 0.15s, border-color 0.15s;" />
        `).join('')}
      </div>
      ` : ''}

      ${dateLabel ? `
      <div style="flex-shrink:0;background:#000;text-align:center;font-family:monospace;font-size:11px;
        color:rgba(255,255,255,0.4);padding:10px 20px ${hasAlt ? '2px' : 'calc(14px + env(safe-area-inset-bottom))'};">
        ${escapeHtml(dateLabel)} · swipe down to close
      </div>
      ` : ''}

      ${hasAlt ? `
      <div style="flex-shrink:0;background:#000;box-sizing:border-box;
        max-height:30dvh;overflow-y:auto;
        padding:2px 20px calc(16px + env(safe-area-inset-bottom));">
        <p style="max-width:640px;margin:0 auto;text-align:center;color:rgba(255,255,255,0.85);
          font-family:monospace;font-size:13px;line-height:1.5;">
          ${escapeHtml(images[index].alt)}
        </p>
      </div>
      ` : ''}

    </div>
  `

  // Event listeners
  div.querySelector('#lb-prev')?.addEventListener('click', e => { e.stopPropagation(); prev() })
  div.querySelector('#lb-next')?.addEventListener('click', e => { e.stopPropagation(); next() })
  div.querySelectorAll('[data-thumb]').forEach(thumb => {
    thumb.addEventListener('click', (e) => {
      e.stopPropagation()
      const i = Number((thumb as HTMLElement).dataset.thumb)
      if (!Number.isNaN(i)) goTo(i)
    })
  })

  // Background click = close
  div.addEventListener('click', onClose, {once: true})

  // Touch events
  div.addEventListener('touchstart', (e) => { e.stopPropagation(); onTouchStart(e as TouchEvent) }, {passive: true})
  div.addEventListener('touchmove', (e) => { e.stopPropagation() }, {passive: false})
  div.addEventListener('touchend', (e) => { e.stopPropagation(); onTouchEnd(e as TouchEvent) }, {passive: true})

  // Jaga thumbnail yang lagi aktif tetap keliatan di dalam strip yang bisa di-scroll
  const activeThumb = div.querySelector(`[data-thumb="${index}"]`) as HTMLElement | null
  activeThumb?.scrollIntoView({block: 'nearest', inline: 'center'})

  // Posisikan panah di tepi foto asli. Kita punya width/height dari metadata (aspect ratio),
  // jadi bisa langsung dihitung tanpa nunggu <img> selesai load (nggak ada kedipan posisi).
  if (images.length > 1) positionArrows(div, images[index])
}

function PhotoTile({post, eager, onClick}: {post: PhotoPost; eager?: boolean; onClick: () => void}) {
  const cover = post.images[0]
  const [loaded, setLoaded] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Open photo"
      className="relative mb-3 break-inside-avoid overflow-hidden rounded-xl cursor-zoom-in bg-[#111] transition-transform duration-150 active:scale-[0.97]"
      onClick={e => { e.preventDefault(); onClick() }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}>
      {/* Shimmer placeholder shown until the actual thumbnail finishes loading */}
      {!loaded && (
        <div
          className="skeleton-line absolute inset-0"
          style={{aspectRatio: `${cover.width} / ${cover.height}`}}
          aria-hidden="true"
        />
      )}
      <img
        src={cover.thumb}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        onLoad={() => setLoaded(true)}
        style={{aspectRatio: `${cover.width} / ${cover.height}`, opacity: loaded ? 1 : 0}}
        className="block w-full h-auto transition-opacity duration-300"
      />
      {post.images.length > 1 && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 rounded-full px-2 py-0.5 backdrop-blur-sm">
          <span className="font-mono text-[11px] text-white/90">1/{post.images.length}</span>
        </div>
      )}
    </div>
  )
}

const PAGE_SIZE = 24

type MonthGroup = {label: string; posts: PhotoPost[]}

export default function Gallery() {
  const {posts} = useLoaderData<typeof loader>() as unknown as {posts: PhotoPost[]; did: string}
  const [lightboxPost, setLightboxPost] = useState<PhotoPost | null>(null)
  const [year, setYear] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const totalPhotos = posts.reduce((sum, p) => sum + p.images.length, 0)
  const yearOf = (p: PhotoPost) => formatDate(p.createdAt, {year: 'numeric'})
  const years = useMemo(() => Array.from(new Set(posts.map(yearOf))).sort((a, b) => b.localeCompare(a)), [posts])
  const yearRange = years.length > 1 ? `${years[years.length - 1]}–${years[0]}` : years[0]

  const filtered = useMemo(() => (year ? posts.filter(p => yearOf(p) === year) : posts), [posts, year])
  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  // Muat 24 post dulu; sisanya otomatis saat sentinel di dasar daftar mendekati layar (infinite scroll).
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [year])
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) setVisibleCount(c => c + PAGE_SIZE) },
      {rootMargin: '600px'},
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, visibleCount])

  const groups: MonthGroup[] = useMemo(() => {
    const out: MonthGroup[] = []
    visible.forEach(p => {
      const label = formatDate(p.createdAt, {month: 'long', year: 'numeric'})
      const last = out[out.length - 1]
      if (last && last.label === label) last.posts.push(p)
      else out.push({label, posts: [p]})
    })
    return out
  }, [visible])

  let tileIndex = 0

  return (
    <div className="flex" style={{minHeight: 'calc(100vh - 52px - 48px)'}}>

      {/* ── Left Sidebar: dihapus (dulu berisi Contact), spacer dipertahankan biar konten tetap center di desktop ── */}
      <aside className="hidden lg:block w-[220px] shrink-0" />

      {/* ── Main Content ── */}
      <div className="flex-1 px-6 md:px-14 py-8 min-w-0">
        {lightboxPost && (
          <Lightbox
            images={lightboxPost.images}
            initialIndex={0}
            dateLabel={formatDate(lightboxPost.createdAt)}
            onClose={() => setLightboxPost(null)}
          />
        )}

        <header className="mb-6">
          <h1 className="font-display text-[42px] md:text-[46px] text-[#f0f0f0] tracking-[-0.02em]">Gallery<span className="text-[#4a9eff]">.</span></h1>
          <p className="font-mono text-[17px] text-[#aaaaaa] mt-2">Just dropping some memories here.</p>
          {/* Di HP jumlah foto tampil di sini (di desktop ada di sidebar kanan) */}
          {posts.length > 0 && (
            <p className="lg:hidden font-mono text-[12px] text-[#8b8b93] mt-3">
              <span className="text-[#f0f0f0]">{totalPhotos}</span> photos ·{' '}
              <span className="text-[#f0f0f0]">{posts.length}</span> posts · {yearRange}
            </p>
          )}
        </header>

        {years.length > 1 && (
          <div className="chip-scroll mb-4" style={{'--chip-bleed': '1.5rem'} as CSSProperties} data-no-swipe>
            {[null, ...years].map(y => (
              <button
                key={y ?? 'all'}
                type="button"
                aria-pressed={year === y}
                onClick={() => setYear(y)}
                className={`font-mono text-[12px] px-3 py-1.5 rounded-full border transition-colors ${
                  year === y
                    ? 'text-[#4a9eff] border-[#4a9eff] bg-[rgba(74,158,255,0.1)]'
                    : 'text-[#8b8b93] border-[#262626] bg-[#151515] hover:text-[#f0f0f0] hover:border-[#555]'
                }`}>
                {y ?? 'All'}
              </button>
            ))}
          </div>
        )}

        {posts.length === 0 ? (
          <p className="font-mono text-[19px] text-[#555]">Belum ada foto.</p>
        ) : (
          <>
            {groups.map(group => (
              <section key={group.label}>
                {/* Header bulan menempel saat scroll */}
                <div
                  className="sticky top-0 sm:top-[52px] z-10 -mx-6 md:-mx-14 px-6 md:px-14 py-2.5 mb-2 flex justify-between font-mono text-[11px] tracking-[0.16em] uppercase text-[#8b8b93]"
                  style={{background: 'rgba(10,10,10,0.88)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)'}}>
                  <span>{group.label}</span>
                  <span>{group.posts.length}</span>
                </div>
                <div className="columns-2 sm:columns-3 gap-3 mb-2">
                  {group.posts.map(post => {
                    const i = tileIndex++
                    return <PhotoTile key={post.createdAt + i} post={post} eager={i < 6} onClick={() => setLightboxPost(post)} />
                  })}
                </div>
              </section>
            ))}
            {hasMore && <div ref={sentinelRef} className="h-12" aria-hidden="true" />}
          </>
        )}
      </div>

      {/* ── Right Sidebar: Photo count (sticky) ── */}
      <aside className="hidden lg:flex flex-col w-[220px] shrink-0 border-l border-[#1e1e1e] px-5 py-6 sticky top-[52px] self-start h-[calc(100vh-52px)] overflow-y-auto">
        <p className="font-mono text-[12px] tracking-[0.14em] uppercase text-[#aaaaaa] mb-3">Gallery</p>
        <div className="mb-6">
          <div className="font-display text-[36px] text-[#f0f0f0] leading-none">{totalPhotos}</div>
          <div className="font-mono text-[12px] text-[#aaaaaa] mt-1">Photos</div>
        </div>
      </aside>

    </div>
  )
}
