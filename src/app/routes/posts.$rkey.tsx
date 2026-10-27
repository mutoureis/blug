import {Link, useLoaderData} from '@remix-run/react'
import {getPost, getProfile} from '../../atproto'
import {json, LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {AppBskyActorDefs} from '@atproto/api'
import {
  LeafletBlock,
  LeafletBlockquoteBlock,
  LeafletCodeBlock,
  LeafletDocument,
  LeafletFacet,
  LeafletHeaderBlock,
  LeafletImageBlock,
  LeafletWebsiteBlock,
} from 'src/types'
import {getDid} from 'src/atproto/getDid'
import {useRef} from 'react'
import {Link as ExternalLink} from '../components/link'
import {BskyEmbed} from '../components/bsky-embed'

export const loader = async ({params}: LoaderFunctionArgs) => {
  const {rkey} = params
  const [post, profile] = await Promise.all([getPost(rkey!), getProfile()])
  return json({did: getDid(), post, profile, rkey})
}

export const meta: MetaFunction<typeof loader> = ({data}) => {
  let postText = ''
  let ogImageUrl
  if (data) {
    for (const block of data.post.content.pages[0].blocks) {
      if (block.block.$type === 'pub.leaflet.blocks.text') {
        postText += `\n${block.block.plaintext}`
      } else if (!ogImageUrl && block.block.$type === 'pub.leaflet.blocks.image') {
        ogImageUrl = `https://cdn.bsky.app/img/feed_fullsize/plain/${data.did}/${block.block.image.ref.$link}@jpeg`
      }
    }
  }
  return [
    {title: `${data?.post.title} | mutho.`},
    {name: 'description', content: data?.post.description ?? `${postText.split(' ').slice(0, 100).join(' ')}...`},
    {name: 'og:title', content: data?.post.title},
    {name: 'og:description', content: data?.post.description ?? `${postText.split(' ').slice(0, 100).join(' ')}...`},
    ...(ogImageUrl ? [{property: 'og:image', content: ogImageUrl}] : []),
    // Dipakai Juttu buat nemuin thread Bluesky yang jadi kolom komentar post ini.
    ...(data ? [{tagName: 'link', rel: 'site.standard.document', href: `at://${data.did}/site.standard.document/${data.rkey}`}] : []),
  ]
}

export default function Posts() {
  const {did, post, profile, rkey} = useLoaderData<{
    did: string
    post: LeafletDocument
    profile: AppBskyActorDefs.ProfileViewDetailed
    rkey: string
  }>()

  const bodyRef = useRef<HTMLDivElement>(null)

  if (!post) return <PostError />

  const publishedDate = new Date(post.publishedAt)

  return (
    <div
      className="max-w-2xl mx-auto px-6 py-7"
      style={{minHeight: 'calc(100vh - 52px - 48px)'}}>

      <Link to="/blog" prefetch="intent" className="inline-block font-mono text-[16px] text-[#555] hover:text-[#4a9eff] transition-colors mb-4">
        ← Writing
      </Link>

      <h1 className="font-display text-[35px] md:text-[37px] text-[#f0f0f0] leading-tight tracking-[-0.02em] mb-2">
        {post.title}
      </h1>

      <div className="flex items-center gap-2 font-mono text-[16px] text-[#555] mb-6 uppercase tracking-wider">
        <span>{profile.displayName}</span>
        <span className="text-[#333]">·</span>
        <time dateTime={publishedDate.toISOString()}>
          {publishedDate.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'})}
        </time>
      </div>

      {post.tags && post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-6">
          {post.tags.map(tag => (
            <span key={tag} className="font-mono text-[18px] text-[#4a9eff] border border-[#1e3a5f] px-2.5 py-0.5 rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-5" ref={bodyRef}>
        {post.content.pages.map((page, idx) => (
          <div className="flex flex-col gap-5" key={idx}>
            {page.blocks.map((block, i) => (
              // @ts-ignore
              <Block block={block} did={did} key={i} />
            ))}
          </div>
        ))}
      </div>

      {/* Kolom komentar (Juttu, baca thread Bluesky lewat site.standard.document) */}
      {/* suppressHydrationWarning: Juttu (script eksternal `defer`) nyuntik konten ke div ini
          sebelum React selesai hydrate, jadi wajar kalau isinya beda dari yang di-render server. */}
      <div className="mt-12 pt-8 border-t border-[#1e1e1e]">
        <div id="juttu-comments" suppressHydrationWarning />
      </div>

    </div>
  )
}

/* ── Block renderers ── */

function Block({block, did}: {block: LeafletBlock; did: string}) {
  const b = block.block
  switch (b.$type) {
    case 'pub.leaflet.blocks.header': return <Header block={b} />
    case 'pub.leaflet.blocks.text': return <Text plaintext={b.plaintext} textSize={b.textSize} facets={b.facets} />
    case 'pub.leaflet.blocks.blockquote': return <BlockQuote block={b} />
    case 'pub.leaflet.blocks.image': return <Image block={b} did={did} />
    case 'pub.leaflet.blocks.code': return <Code block={b} />
    case 'pub.leaflet.blocks.horizontalRule': return <HorizontalRule />
    case 'pub.leaflet.blocks.website': return <Website block={b} did={did} />
    case 'pub.leaflet.blocks.bskyPost': return <BskyEmbed postUri={b.postRef.uri} />
  }
}

function Header({block}: {block: LeafletHeaderBlock}) {
  const sizes: Record<number, string> = {
    1: 'font-display text-[38px] md:text-[38px] text-[#f0f0f0] pt-6 mt-2 leading-tight',
    2: 'font-display text-[23px] md:text-[38px] text-[#f0f0f0] pt-5 mt-2 leading-tight',
    3: 'font-display text-[23px] md:text-[23px] text-[#e0e0e0] pt-4 leading-tight',
    4: 'font-display text-[18px] md:text-[23px] text-[#e0e0e0] pt-4 leading-tight',
    5: 'font-display text-[16px] text-[#e0e0e0] pt-3 leading-tight',
    6: 'font-mono uppercase tracking-wider text-[16px] text-[#555] pt-3',
  }
  const Tag = (['h1','h2','h3','h4','h5','h6'] as const)[block.level - 1]
  return <Tag className={sizes[block.level] ?? sizes[3]}>{block.plaintext}</Tag>
}

function Text({plaintext, facets, textSize = 'default'}: {
  plaintext: string
  facets?: LeafletFacet[]
  textSize?: 'default' | 'small' | 'large'
}) {
  const sizeClass = textSize === 'default' ? 'text-[18px]' : textSize === 'small' ? 'text-[15px]' : 'text-[18px]'
  return (
    <p className={`${sizeClass} font-sans text-[#888] leading-[1.9]`}>
      {renderRichText(plaintext, facets)}
    </p>
  )
}

function renderRichText(text: string, facets?: LeafletFacet[]): React.ReactNode {
  if (!facets?.length) return text
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const bytes = encoder.encode(text)
  const sortedFacets = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart)
  const segments: React.ReactNode[] = []
  let lastIndex = 0
  sortedFacets.forEach((facet, i) => {
    const {byteStart, byteEnd} = facet.index
    if (byteStart > lastIndex) segments.push(decoder.decode(bytes.slice(lastIndex, byteStart)))
    const facetText = decoder.decode(bytes.slice(byteStart, byteEnd))
    let element: React.ReactNode = facetText
    for (const feature of facet.features) {
      switch (feature.$type) {
        case 'pub.leaflet.richtext.facet#bold': element = <strong key={`b-${i}`}>{element}</strong>; break
        case 'pub.leaflet.richtext.facet#italic': element = <em key={`i-${i}`}>{element}</em>; break
        case 'pub.leaflet.richtext.facet#strikethrough': element = <s key={`s-${i}`}>{element}</s>; break
        case 'pub.leaflet.richtext.facet#link':
          element = <ExternalLink key={`l-${i}`} href={feature.uri} className="text-[#4a9eff] hover:text-[#7c6ff7] underline underline-offset-2">{element}</ExternalLink>; break
        case 'pub.leaflet.richtext.facet#code':
          element = <code className="bg-[#1a1a1a] text-[#4a9eff] px-1.5 py-0.5 rounded text-[0.85em] font-mono border border-[#2a2a2a]">{element}</code>
      }
    }
    segments.push(<span key={i}>{element}</span>)
    lastIndex = byteEnd
  })
  if (lastIndex < bytes.length) segments.push(decoder.decode(bytes.slice(lastIndex)))
  return segments
}

function BlockQuote({block}: {block: LeafletBlockquoteBlock}) {
  return (
    <blockquote className="border-l-[1.5px] border-[#4a9eff] pl-4 my-2 italic font-sans text-[18px] text-[#777] leading-relaxed">
      {block.plaintext}
    </blockquote>
  )
}

function Code({block}: {block: LeafletCodeBlock}) {
  return (
    <pre className="bg-[#111] text-[#b0b0b0] py-4 px-5 rounded-md overflow-x-auto my-2 font-mono text-[18px] leading-relaxed border border-[#1e1e1e]">
      {block.plaintext}
    </pre>
  )
}

function HorizontalRule() {
  return (
    <div className="flex justify-center my-6 text-[#333] select-none font-mono text-xs tracking-widest">
      <span>· · ·</span>
    </div>
  )
}

function Image({block, did}: {block: LeafletImageBlock; did: string}) {
  const cdnUrl = `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${block.image.ref.$link}@jpeg`
  return (
    <figure className="my-4 -mx-2 md:-mx-8">
      <img src={cdnUrl} alt={block.alt} className="rounded-md shadow-2xl shadow-black/40 max-w-full mx-auto" />
      {block.alt && (
        <figcaption className="text-center font-mono text-[18px] uppercase tracking-wider text-[#555] mt-3">
          {block.alt}
        </figcaption>
      )}
    </figure>
  )
}

function Website({block, did}: {block: LeafletWebsiteBlock; did: string}) {
  const cdnUrl = block.previewImage
    ? `https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${block.previewImage.ref.$link}@jpeg`
    : null
  return (
    <a
      href={block.src}
      className="border border-[#1e1e1e] rounded-md flex gap-4 p-4 bg-[#111] hover:bg-[#161616] hover:border-[#2a2a2a] transition-colors group my-2">
      <div className="flex-1 min-w-0">
        <h3 className="font-display text-[18px] text-[#e0e0e0] truncate group-hover:text-[#4a9eff] transition-colors">
          {block.title || block.src}
        </h3>
        {block.description && (
          <p className="font-sans text-[#555] mt-1 line-clamp-2 text-[18px]">{block.description}</p>
        )}
        <p className="font-mono text-[#444] mt-2 text-[18px] uppercase tracking-wider truncate">
          {(() => { try { return new URL(block.src).hostname.replace(/^www\./, '') } catch { return block.src } })()}
        </p>
      </div>
      {cdnUrl && <img src={cdnUrl} className="rounded h-[72px] object-cover flex-shrink-0" />}
    </a>
  )
}

function PostError() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <p className="font-mono text-[13px] tracking-[0.12em] uppercase text-[#555] mb-4">404</p>
      <h1 className="font-display text-[40px] md:text-[56px] text-[#f0f0f0] leading-tight">
        That post wandered off.
      </h1>
      <div className="py-10">
        <img src="/monkey.jpg" alt="Monkey muppet meme" className="rounded-md shadow-2xl shadow-black/40 max-w-[280px]" />
      </div>
      <Link to="/blog" prefetch="intent" className="font-mono text-[23px] text-[#4a9eff] hover:text-[#7c6ff7] transition-colors">
        ← back to writing
      </Link>
    </div>
  )
}
