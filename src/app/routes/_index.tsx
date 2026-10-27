import {json, MetaFunction} from '@remix-run/node'
import {Link, useLoaderData} from '@remix-run/react'
import type {CSSProperties} from 'react'
import {getPosts} from '../../atproto/index.js'
import {useLanyard, DISCORD_STATUS_META, DISCORD_USER_ID} from '../hooks/use-lanyard.js'
import {NowPlayingWidget, NowPlayingCard} from '../components/now-playing-widget.js'
import {formatDate} from '../lib/post-utils.js'
import {getCachedGallery, getCachedLatestPhoto, setCachedLatestPhoto} from '../../redis/redis.js'

export const meta: MetaFunction = () => [
  {title: 'About | mutho.'},
  {name: 'description', content: 'About Mutho — hanya seorang guru dan murid abadi'},
]

type LatestPost = {rkey: string; title: string; publishedAt: string}
type LatestPhoto = {thumb: string; alt: string; createdAt: string}

// Tulisan terbaru. getPosts sudah di-cache Redis (60 dtk). Gagal -> null, kartunya jatuh ke tautan biasa.
async function getLatestPost(): Promise<LatestPost | null> {
  try {
    const posts = await getPosts(undefined)
    const [first] = posts
      .map(p => ({rkey: p.rkey, title: String(p.title), publishedAt: p.publishedAt}))
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    return first ?? null
  } catch (err) {
    console.error('Home latest post error:', err)
    return null
  }
}

// Foto terbaru dari Gallery. Urutan: cache Gallery -> cache khusus -> ambil langsung dari Bluesky
// (cuma ~2 request, timeout 4 dtk, lalu di-cache 10 menit) supaya beranda tidak ikut lambat.
const HANDLE = 'mutho.my.id'
const wsrv = (url: string, w: number, q: number) =>
  `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=${q}&output=webp&we=1`

async function getLatestPhoto(): Promise<LatestPhoto | null> {
  try {
    const gallery = await getCachedGallery<{posts: {images: {thumb: string; alt: string}[]; createdAt: string}[]}>()
    const first = gallery?.posts?.[0]
    if (first?.images?.[0]) return {thumb: first.images[0].thumb, alt: first.images[0].alt, createdAt: first.createdAt}

    const cached = await getCachedLatestPhoto<LatestPhoto>()
    if (cached) return cached

    const t = () => ({signal: AbortSignal.timeout(4000)})
    const {did} = await (await fetch(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${HANDLE}`, t())).json()
    const list = await (
      await fetch(
        `https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.photosky.postMeta&limit=6&reverse=true`,
        t(),
      )
    ).json()
    for (const meta of list.records ?? []) {
      const rkey = String(meta.uri).split('/').pop()
      const res = await fetch(
        `https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.feed.post&rkey=${rkey}`,
        t(),
      )
      if (!res.ok) continue
      const {value} = await res.json()
      const img = (value?.embed?.images ?? value?.embed?.media?.images ?? []).find((i: any) => i?.image?.ref?.$link)
      if (!img) continue
      const blobUrl = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${img.image.ref.$link}`
      const photo: LatestPhoto = {
        thumb: wsrv(blobUrl, 480, 60),
        alt: img.alt ?? '',
        createdAt: value.createdAt ?? meta.value?.createdAt,
      }
      await setCachedLatestPhoto(photo)
      return photo
    }
    return null
  } catch (err) {
    console.error('Home latest photo error:', err)
    return null
  }
}

export const loader = async () => {
  const [post, photo] = await Promise.all([getLatestPost(), getLatestPhoto()])
  return json({post, photo})
}

const INTERESTS = ['coffee', 'manga', 'anime', 'movies', 'books', 'JRPGs', 'philosophy', 'psychology']

export default function About() {
  const {post, photo} = useLoaderData<typeof loader>()

  return (
    <div className="flex" style={{minHeight: 'calc(100vh - 52px - 48px)'}}>

      {/* ── Left Sidebar: quick nav to the other pages (desktop) ── */}
      <aside className="hidden lg:block w-[220px] shrink-0 px-5 py-10">
        <p className="font-mono text-xs tracking-[0.14em] uppercase text-[#666] mb-4">Explore</p>
        <ul className="flex flex-col gap-2.5 font-mono text-sm">
          <li><Link to="/blog" prefetch="intent" className="text-[#666] hover:text-[#4a9eff] transition-colors">Writing →</Link></li>
          <li><Link to="/gallery" prefetch="intent" className="text-[#666] hover:text-[#4a9eff] transition-colors">Gallery →</Link></li>
        </ul>
      </aside>

      {/* ── Main Content ── */}
      <div className="flex-1 min-w-0 flex justify-center">
        <div className="w-full max-w-3xl px-6 md:px-14 py-8 sm:py-10">
          <Hero />

          <ul className="flex flex-wrap gap-1.5 mb-5" aria-label="Interests">
            {INTERESTS.map(tag => (
              <li
                key={tag}
                className="font-mono text-[12px] text-[#cfcfd6] rounded-full border border-[#1e1e1e] px-2.5 py-1"
                style={{background: 'rgba(255,255,255,0.04)'}}>
                {tag}
              </li>
            ))}
          </ul>

          <p className="font-sans text-[15px] sm:text-[16px] text-[#c9c9cf] leading-[1.75] max-w-[540px] mb-6">
            Mutho (Muthohhar) is a coffee addict who loves to ramble about the things above. This site is his
            personal space to write about whatever else is on his mind.
          </p>

          {/* Now playing — di HP tampil di sini (di desktop sudah ada di sidebar kanan) */}
          <NowPlayingCard className="lg:hidden mb-6" />

          {/* Dua kartu atas (HP): tulisan terbaru & foto terbaru. Sekaligus jadi jalan pintas ke Writing/Gallery. */}
          <HomeTiles post={post} photo={photo} />

          <Section label="Work">
            <WorkItem index={0} company="Teacher" role="I love to learn & teach" period="2013 — Present" />
          </Section>

          <Section label="Community">
            <WorkItem index={1} company="KIKEN" href="https://discord.gg/DNcNBQaqgM" role="Discord Server" period="Dec 2026 — Present" />
          </Section>
        </div>
      </div>

      {/* ── Right Sidebar: Now Playing (sticky, real Spotify data) ── */}
      <aside className="hidden lg:block w-[220px] shrink-0 border-l border-[#1e1e1e] px-5 py-10 sticky top-[52px] self-start h-[calc(100vh-52px)]">
        <NowPlayingWidget />
      </aside>

    </div>
  )
}

/* ── Hero: avatar bercincin + nama + status Discord live (Lanyard) ── */

function Hero() {
  const {data, status} = useLanyard()
  const statusMeta = data ? DISCORD_STATUS_META[data.discord_status] ?? DISCORD_STATUS_META.offline : null

  const avatarUrl = data?.discord_user.avatar
    ? `https://cdn.discordapp.com/avatars/${data.discord_user.id}/${data.discord_user.avatar}.${
        data.discord_user.avatar.startsWith('a_') ? 'gif' : 'png'
      }?size=320`
    : null
  const avatarDecorationUrl = data?.discord_user.avatar_decoration_data
    ? `https://cdn.discordapp.com/avatar-decoration-presets/${data.discord_user.avatar_decoration_data.asset}.png?size=320`
    : null

  // Custom status (type 4) dan aktivitas lain (game/app). Spotify sudah punya kartu sendiri.
  const customStatus = data?.activities.find(a => a.type === 4)
  const otherActivities = (data?.activities ?? []).filter(a => a.type !== 4 && a.name !== 'Spotify')
  const hasExtras = Boolean(customStatus?.state || customStatus?.emoji || otherActivities.length > 0)

  const sizeCls = 'w-[84px] h-[84px] sm:w-[120px] sm:h-[120px]'
  const ringCls = 'rounded-full ring-2 ring-[#4a9eff]/45 ring-offset-[3px] ring-offset-[#0a0a0a]'

  return (
    <section className="mb-5">
      <div className="flex items-center gap-4 sm:gap-6">
        {status === 'loading' ? (
          <div className={`skeleton-line ${sizeCls} rounded-full shrink-0`} aria-hidden="true" />
        ) : (
          <a
            href={`https://discord.com/users/${data?.discord_user.id ?? DISCORD_USER_ID}`}
            target="_blank"
            rel="noopener noreferrer"
            title={data?.discord_user.global_name || data?.discord_user.username || 'Mutho on Discord'}
            className={`group relative inline-block shrink-0 ${sizeCls}`}>
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Mutho's Discord avatar"
                className={`w-full h-full ${ringCls} transition-transform group-hover:scale-[1.03]`}
              />
            ) : (
              <div
                className={`w-full h-full flex items-center justify-center text-white text-3xl sm:text-4xl font-display ${ringCls}`}
                style={{background: 'linear-gradient(135deg, #4a9eff, #7c6ff7)'}}
                aria-hidden="true">
                M
              </div>
            )}
            {avatarDecorationUrl && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center transition-transform group-hover:scale-[1.03]">
                <img src={avatarDecorationUrl} alt="" className="w-[118%] h-[118%] max-w-none" />
              </div>
            )}
            {statusMeta && (
              <span
                className="absolute bottom-0.5 right-0.5 w-5 h-5 sm:w-6 sm:h-6 rounded-full border-[3px] border-[#0a0a0a]"
                style={{background: statusMeta.color}}
                title={statusMeta.label}
              />
            )}
          </a>
        )}

        <div className="min-w-0">
          <h1 className="font-display text-[34px] sm:text-[42px] leading-[1.1] text-[#f0f0f0] tracking-[-0.02em]">
            Mutho<span className="text-[#4a9eff]">.</span>
          </h1>
          <p className="font-mono text-[13px] text-[#8b8b93] mt-1.5">A Vagabond</p>
          {statusMeta && (
            <p className="font-mono text-[12px] text-[#8b8b93] mt-2 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{background: statusMeta.color}} />
              {statusMeta.label} on Discord
            </p>
          )}
        </div>
      </div>

      {hasExtras && (
        <div className="mt-4 rounded-xl border border-[#1e1e1e] bg-[#111111] p-3 flex flex-col gap-2 max-w-[420px]">
          {customStatus && (customStatus.state || customStatus.emoji) && (
            <div className="font-mono text-sm text-[#f0f0f0] flex items-center gap-1.5">
              {customStatus.emoji && !customStatus.emoji.id && <span>{customStatus.emoji.name}</span>}
              {customStatus.state && <span className="truncate">{customStatus.state}</span>}
            </div>
          )}
          {otherActivities.map(activity => (
            <div key={activity.id} className="font-mono text-sm text-[#ccc] truncate">
              <span className="text-[#666]">{activityVerb(activity.type)} </span>
              {activity.name}
              {activity.details && <span className="text-[#888]"> — {activity.details}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Discord activity `type` → the verb Discord's own client uses for it. */
function activityVerb(type: number): string {
  switch (type) {
    case 0:
      return 'Playing'
    case 1:
      return 'Streaming'
    case 2:
      return 'Listening to'
    case 3:
      return 'Watching'
    case 5:
      return 'Competing in'
    default:
      return 'Using'
  }
}

/* ── Kartu tulisan terbaru + foto terbaru (HP) ── */

function HomeTiles({post, photo}: {post: LatestPost | null; photo: LatestPhoto | null}) {
  const cardCls = 'relative block h-[168px] rounded-2xl border border-[#1e1e1e] bg-[#111111] overflow-hidden transition-transform active:scale-[0.98]'
  return (
    <div className="grid grid-cols-2 gap-2.5 mb-8 lg:hidden">
      {post ? (
        <Link to={`/posts/${post.rkey}`} prefetch="intent" className={`${cardCls} p-3.5 flex flex-col justify-between`}>
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-[#4a9eff]">Latest writing</span>
          <div>
            <h3 className="font-display text-[18px] leading-snug text-[#f0f0f0] line-clamp-4">{post.title}</h3>
            <p className="font-mono text-[11px] text-[#666] mt-2">{formatDate(post.publishedAt)}</p>
          </div>
        </Link>
      ) : (
        <NavTile to="/blog" title="Writing →" hint="latest posts" icon="blog" />
      )}

      {photo ? (
        <Link to="/gallery" prefetch="intent" className={cardCls} aria-label="Gallery — latest photo">
          <img
            src={photo.thumb}
            alt={photo.alt || 'Latest photo from the gallery'}
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <span
            className="absolute top-3 left-3.5 font-mono text-[10px] tracking-[0.16em] uppercase text-[#f0f0f0]"
            style={{textShadow: '0 1px 6px rgba(0,0,0,0.7)'}}>
            Latest photo
          </span>
          <div
            className="absolute inset-x-0 bottom-0 p-3.5 pt-10"
            style={{background: 'linear-gradient(to top, rgba(0,0,0,0.78), transparent)'}}>
            <div className="font-mono text-[14px] text-[#f0f0f0]">Gallery →</div>
            <div className="font-mono text-[11px] text-[#c9c9cf] mt-0.5">{formatDate(photo.createdAt)}</div>
          </div>
        </Link>
      ) : (
        <NavTile to="/gallery" title="Gallery →" hint="photos & moments" icon="gallery" />
      )}
    </div>
  )
}

/* ── Kartu navigasi biasa (cadangan kalau data tulisan/foto tidak tersedia) ── */

function NavTile({to, title, hint, icon}: {to: string; title: string; hint: string; icon: 'blog' | 'gallery'}) {
  return (
    <Link
      to={to}
      prefetch="intent"
      className="flex flex-col justify-between min-h-[92px] rounded-2xl border border-[#1e1e1e] bg-[#111111] p-3.5 transition-transform active:scale-[0.98]">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="#4a9eff"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-[22px] h-[22px]"
        aria-hidden="true">
        {icon === 'blog' ? (
          <>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6M8.5 13h7M8.5 17h4.5" />
          </>
        ) : (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2.5" />
            <circle cx="8.5" cy="9" r="1.6" />
            <path d="M21 16.5l-5.2-5.2a1.5 1.5 0 0 0-2.1 0L5 20" />
          </>
        )}
      </svg>
      <div>
        <div className="font-mono text-[14px] text-[#f0f0f0]">{title}</div>
        <div className="font-sans text-[11.5px] text-[#8b8b93] mt-0.5">{hint}</div>
      </div>
    </Link>
  )
}

/* ── Timeline Work / Community ── */

function Section({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <section className="mb-7">
      <p className="font-mono text-[12px] tracking-[0.16em] uppercase text-[#8b8b93] mb-3">{label}</p>
      <ul className="ml-[5px] border-l border-[#26262b] pl-[18px]">{children}</ul>
    </section>
  )
}

function WorkItem({
  company,
  href,
  role,
  period,
  index = 0,
}: {
  company: string
  href?: string
  role: string
  period: string
  index?: number
}) {
  return (
    <li
      className="fade-up-item relative pb-5 last:pb-1 sm:flex sm:items-start sm:justify-between sm:gap-4"
      style={{'--delay': `${index * 0.08}s`} as CSSProperties}>
      <span
        className="absolute -left-[23px] top-[9px] w-[9px] h-[9px] rounded-full bg-[#0a0a0a] border-2 border-[#4a9eff]"
        aria-hidden="true"
      />
      <div>
        <a
          href={href}
          target={href ? '_blank' : undefined}
          rel="noopener noreferrer"
          className={`title-underline font-mono text-[17px] sm:text-[19px] text-[#f0f0f0] ${href ? 'hover:text-[#4a9eff] transition-colors' : ''}`}>
          {company}
        </a>
        <div className="font-sans text-[13px] sm:font-mono sm:text-[14px] text-[#8b8b93] mt-1">{role}</div>
      </div>
      {/* Di HP periode pindah ke bawah judul (tidak berebut ruang); di sm+ kembali rata kanan */}
      <span className="block font-mono text-[11.5px] text-[#4a9eff] mt-1 sm:mt-0.5 sm:text-[15px] sm:text-[#aaaaaa] shrink-0">
        {period}
      </span>
    </li>
  )
}
