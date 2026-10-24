import {json, MetaFunction} from '@remix-run/node'
import {getPosts} from '../../atproto/index.js'
import {getDid} from '../../atproto/getDid.js'
import {Link, useLoaderData, useNavigation} from '@remix-run/react'
import {useMemo, useState, useEffect} from 'react'
import type {CSSProperties} from 'react'
import {LeafletDocument} from 'src/types'
import {NowPlayingWidget} from '../components/now-playing-widget.js'
import {estimateReadingMinutes, formatDate} from '../lib/post-utils.js'

export const loader = async () => {
  try {
    const rawPosts = await getPosts(undefined)
    const posts = rawPosts.map(p => ({
      ...p,
      description: p.description?.slice(0, 180),
    }))
    return json({posts, did: getDid()})
  } catch (err) {
    console.error('Blog loader error:', err)
    return json({posts: [], did: getDid()})
  }
}

export const meta: MetaFunction = () => [
  {title: 'Blog | mutho.'},
  {name: 'description', content: 'thoughts and vibes from mutho'},
]

type FeedEntry = {
  key: string
  href: string
  title: string
  date: Date
  tags: string[]
  excerpt?: string
  readingMinutes?: number
}

type MonthGroup = {label: string; items: {entry: FeedEntry; index: number}[]}

export default function Blog() {
  const {posts} = useLoaderData<{posts: LeafletDocument[]; did: string}>()
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const navigation = useNavigation()
  const isLoadingRoute = navigation.state === 'loading'

  const entries: FeedEntry[] = useMemo(() => {
    return posts
      .map(p => ({
        key: `post-${p.rkey}`,
        href: `/posts/${p.rkey}`,
        title: String(p.title),
        date: new Date(p.publishedAt),
        tags: p.tags ?? [],
        excerpt: p.description,
        readingMinutes: estimateReadingMinutes(p),
      }))
      .sort((a, b) => b.date.getTime() - a.date.getTime())
  }, [posts])

  const allTags = useMemo(() => {
    const seen = new Map<string, string>() // lowercase -> display label
    entries.forEach(e => e.tags.forEach(t => {
      const key = t.toLowerCase()
      if (!seen.has(key)) seen.set(key, t)
    }))
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
  }, [entries])

  // Kalau tag yang lagi aktif nggak relevan lagi (mis. daftar entri berubah), lepas filternya.
  useEffect(() => {
    if (activeTag && !allTags.some(t => t.toLowerCase() === activeTag.toLowerCase())) {
      setActiveTag(null)
    }
  }, [allTags, activeTag])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (activeTag && !e.tags.some(t => t.toLowerCase() === activeTag.toLowerCase())) return false
      if (!q) return true
      return (
        e.title.toLowerCase().includes(q) ||
        (e.excerpt ?? '').toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
      )
    })
  }, [entries, activeTag, q])

  // Kartu unggulan cuma muncul kalau lagi tidak menyaring/mencari.
  const isFiltering = Boolean(activeTag) || q.length > 0
  const featured = !isFiltering && filtered.length > 0 ? filtered[0] : null
  const rest = featured ? filtered.slice(1) : filtered

  // Kelompokkan per bulan (urutan tetap: terbaru dulu). `index` dipakai untuk delay animasi.
  const groups: MonthGroup[] = useMemo(() => {
    const out: MonthGroup[] = []
    rest.forEach((entry, index) => {
      const label = formatDate(entry.date, {month: 'long', year: 'numeric'})
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push({entry, index})
      else out.push({label, items: [{entry, index}]})
    })
    return out
  }, [rest])

  const clearFilters = () => {
    setActiveTag(null)
    setQuery('')
  }

  return (
    <div className="flex" style={{minHeight: 'calc(100vh - 52px - 48px)'}}>

      {/* ── Main Content ── */}
      <div className="flex-1 min-w-0 flex justify-center">
        <div className="w-full max-w-3xl px-8 md:px-14 py-10">

          {/* Hero */}
          <section className="mb-6">
            <h1 className="font-display text-[42px] md:text-[46px] text-[#f0f0f0] leading-tight tracking-[-0.02em]">
              Writing<span className="text-[#4a9eff]">.</span>
            </h1>
            <p className="font-mono text-[17px] text-[#aaaaaa] mt-2">Just writing random stuff here.</p>
            {entries.length > 0 && (
              <p className="font-mono text-[12px] text-[#8b8b93] mt-2">
                {entries.length} {entries.length === 1 ? 'post' : 'posts'} · latest {formatDate(entries[0].date)}
              </p>
            )}
          </section>

          {entries.length > 0 && (
            <>
              {/* Search */}
              <label className="flex items-center gap-2 rounded-xl border border-[#1e1e1e] bg-[#111111] px-3 py-2.5 mb-3 focus-within:border-[#4a9eff]/60 transition-colors">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#666"
                  strokeWidth={2}
                  strokeLinecap="round"
                  className="w-4 h-4 shrink-0"
                  aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search writing…"
                  aria-label="Search writing"
                  className="flex-1 min-w-0 bg-transparent outline-none font-mono text-[13px] text-[#f0f0f0] placeholder:text-[#555]"
                />
              </label>

              {/* Tag filter — satu baris yang bisa digeser di HP (data-no-swipe: jangan ikut memicu swipe antar halaman) */}
              {allTags.length > 0 && (
                <div className="chip-scroll mb-6" data-no-swipe>
                  <TagChip active={activeTag === null} onClick={() => setActiveTag(null)}>All</TagChip>
                  {allTags.map(tag => (
                    <TagChip
                      key={tag}
                      active={activeTag?.toLowerCase() === tag.toLowerCase()}
                      onClick={() => setActiveTag(activeTag?.toLowerCase() === tag.toLowerCase() ? null : tag)}>
                      {tag}
                    </TagChip>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Feed */}
          {isLoadingRoute ? (
            <FeedSkeleton />
          ) : filtered.length === 0 ? (
            <div className="py-4">
              <p className="font-mono text-[17px] text-[#444]">Nothing here yet.</p>
              {isFiltering && (
                <button
                  onClick={clearFilters}
                  className="font-mono text-[13px] text-[#4a9eff] hover:text-[#7c6ff7] transition-colors mt-2">
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              {featured && <FeaturedCard entry={featured} />}

              {groups.map(group => (
                <section key={group.label} className="mb-3">
                  <p className="label mt-2 mb-1">{group.label}</p>
                  <ul className="border-t border-[#1a1a1a] divide-y divide-[#1a1a1a]">
                    {group.items.map(({entry, index}) => <FeedItem entry={entry} index={index} key={entry.key} />)}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Right Sidebar: Now Playing (real Spotify data) ── */}
      <aside className="hidden lg:block w-[220px] shrink-0 border-l border-[#1e1e1e] px-5 py-10 sticky top-[52px] self-start h-[calc(100vh-52px)] overflow-y-auto">
        <NowPlayingWidget className="mb-8" />
      </aside>

    </div>
  )
}

/* ── Sub-components ── */

function TagChip({active, onClick, children}: {active: boolean; onClick: () => void; children: React.ReactNode}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`font-mono text-[12px] px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? 'text-[#4a9eff] border-[#4a9eff] bg-[rgba(74,158,255,0.1)]'
          : 'text-[#8b8b93] border-[#262626] bg-[#151515] hover:text-[#f0f0f0] hover:border-[#555]'
      }`}>
      {children}
    </button>
  )
}

function FeaturedCard({entry}: {entry: FeedEntry}) {
  return (
    <Link
      to={entry.href}
      prefetch="intent"
      className="group block rounded-[18px] p-px mb-7 fade-up-item"
      style={{background: 'linear-gradient(135deg, rgba(74,158,255,0.6), rgba(124,111,247,0.5), transparent 70%)'}}>
      <div className="rounded-[17px] bg-[#101012] p-5">
        <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-[#4a9eff]">Latest</span>
        <h2 className="title-underline font-display text-[22px] md:text-[26px] leading-snug text-[#f0f0f0] group-hover:text-[#4a9eff] transition-colors mt-2">
          {entry.title}
        </h2>
        {entry.excerpt && (
          <p className="font-sans text-[14px] md:text-[15px] text-[#9a9aa2] leading-relaxed line-clamp-2 mt-2">
            {entry.excerpt}
          </p>
        )}
        <p className="font-mono text-[11.5px] text-[#666] mt-3">
          {entry.tags.length > 0 && <span className="uppercase tracking-[0.06em]">{entry.tags.join(' · ')} · </span>}
          {entry.readingMinutes != null && <>{entry.readingMinutes} min read · </>}
          {formatDate(entry.date)}
        </p>
      </div>
    </Link>
  )
}

function FeedItem({entry, index}: {entry: FeedEntry; index: number}) {
  return (
    <li className="fade-up-item" style={{'--delay': `${Math.min(index, 8) * 0.06}s`} as CSSProperties}>
      <Link to={entry.href} prefetch="intent" className="group block py-5">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="title-underline font-display text-[20px] md:text-[24px] text-[#f0f0f0] group-hover:text-[#4a9eff] transition-colors leading-snug">
            {entry.title}
          </h3>
          <time
            className="font-mono text-[13px] text-[#666] shrink-0"
            dateTime={entry.date.toISOString()}>
            {formatDate(entry.date, {month: 'short', day: 'numeric'})}
          </time>
        </div>
        <div className="flex items-center gap-2 font-mono text-[13px] text-[#666] mt-1.5">
          <span className="uppercase tracking-[0.06em] text-[11px] text-[#555]">
            {entry.tags.length > 0 ? entry.tags.join(' · ') : 'Blog'}
          </span>
          {entry.readingMinutes != null && (
            <>
              <span className="text-[#333]">·</span>
              <span className="text-[11px] text-[#555]">{entry.readingMinutes} min read</span>
            </>
          )}
        </div>
        {entry.excerpt && (
          <p className="font-sans text-[15px] text-[#888] leading-relaxed line-clamp-2 mt-2">
            {entry.excerpt}
          </p>
        )}
      </Link>
    </li>
  )
}

function FeedSkeleton() {
  return (
    <ul className="divide-y divide-[#1a1a1a]" aria-hidden="true">
      {[0, 1, 2, 3].map(i => (
        <li key={i} className="py-6">
          <div className="flex items-baseline justify-between gap-4 mb-3">
            <div className="skeleton-line h-[22px] w-2/3" />
            <div className="skeleton-line h-[13px] w-12 shrink-0" />
          </div>
          <div className="skeleton-line h-[13px] w-1/4 mb-3" />
          <div className="skeleton-line h-[15px] w-4/5" />
        </li>
      ))}
    </ul>
  )
}
