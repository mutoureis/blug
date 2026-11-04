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
import {Comments} from '../components/comments'

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
    // Penanda dokumen standard.site (verifikasi/penemuan post oleh aplikasi ATProto lain).
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
    <article className="max-w-2xl lg:max-w-[720px] mx-auto px-6 py-7 lg:pt-14 lg:pb-24">

      <Link
        to="/blog"
        prefetch="intent"
        className="inline-flex items-center gap-2 font-mono text-[13px] text-[#6c6c74] hover:text-[#4a9eff] transition-colors mb-6 lg:mb-10">
        <span aria-hidden="true">←</span> Writing
      </Link>

      <header className="mb-8 lg:mb-12 pb-8 lg:pb-10 border-b border-[#1a1a1a]">
        <h1 className="font-display text-[35px] md:text-[38px] lg:text-[46px] text-[#f0f0f0] leading-[1.12] tracking-[-0.02em]">
          {post.title}
        </h1>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[13px] text-[#8b8b93] mt-4 lg:mt-5">
          <span className="text-[#c9c9cf]">{profile.displayName}</span>
          <span className="text-[#3a3a40]" aria-hidden="true">·</span>
          <time dateTime={publishedDate.toISOString()}>
            {publishedDate.toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'})}
          </time>
          {post.tags && post.tags.length > 0 && (
            <>
              <span className="text-[#3a3a40]" aria-hidden="true">·</span>
              <ul className="flex flex-wrap gap-1.5">
                {post.tags.map(tag => (
                  <li
                    key={tag}
                    className="text-[12px] text-[#4a9eff] border border-[#1e3a5f] bg-[rgba(74,158,255,0.06)] px-2.5 py-0.5 rounded-full">
                    {tag}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </header>

      {/* Isi tulisan: semua blok pakai satu ritme (jarak 24px) dan satu skala ukuran */}
      <div className="flex flex-col gap-5 lg:gap-6" ref={bodyRef}>
        {post.content.pages.map((page, idx) => (
          <div className="flex flex-col gap-5 lg:gap-6" key={idx}>
            {page.blocks.map((block, i) => (
              // @ts-ignore
              <Block block={block} did={did} key={i} />
            ))}
          </div>
        ))}
      </div>

      {/* Kolom komentar sendiri (Redis) — tanpa akun, dengan notifikasi email balasan */}
      <div className="mt-12 lg:mt-20 pt-8 border-t border-[#1e1e1e]">
        <Comments postId={rkey} postTitle={post.title} />
      </div>

    </article>
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

// Skala tetap: tiap level punya satu ukuran, di semua tulisan.
function Header({block}: {block: LeafletHeaderBlock}) {
  const sizes: Record<number, string> = {
    1: 'font-display text-[28px] lg:text-[32px] text-[#f0f0f0] pt-6 lg:pt-8 leading-tight tracking-[-0.015em]',
    2: 'font-display text-[24px] lg:text-[27px] text-[#f0f0f0] pt-5 lg:pt-7 leading-tight tracking-[-0.01em]',
    3: 'font-display text-[20px] lg:text-[22px] text-[#e4e4e7] pt-4 lg:pt-5 leading-snug',
    4: 'font-display text-[18px] lg:text-[19px] text-[#e4e4e7] pt-3 lg:pt-4 leading-snug',
    5: 'font-display text-[16px] text-[#d4d4d8] pt-3 leading-snug',
    6: 'font-mono uppercase tracking-[0.14em] text-[12px] text-[#6c6c74] pt-3',
  }
  const Tag = (['h1','h2','h3','h4','h5','h6'] as const)[(block.level ?? 3) - 1]
  return <Tag className={sizes[block.level ?? 3] ?? sizes[3]}>{block.plaintext}</Tag>
}

function Text({plaintext, facets, textSize = 'default'}: {
  plaintext: string
  facets?: LeafletFacet[]
  textSize?: 'default' | 'small' | 'large'
}) {
  // default 17px, small 15px, large 20px — sama di semua tulisan, bukan campur 15/16/18.
  const sizeClass = textSize === 'small' ? 'text-[15px]' : textSize === 'large' ? 'text-[19px] lg:text-[20px]' : 'text-[17px] lg:text-[18px]'
  return (
    <p className={`${sizeClass} font-sans text-[#a1a1aa] lg:text-[#b0b0b8] leading-[1.85]`}>
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
    <blockquote
      className="my-2 rounded-r-xl border-l-2 border-[#4a9eff] py-3 pl-5 pr-4 font-display italic text-[19px] lg:text-[21px] leading-relaxed text-[#d4d4d8]"
      style={{background: 'linear-gradient(90deg, rgba(74,158,255,0.07), transparent 80%)'}}>
      {block.plaintext}
    </blockquote>
  )
}

function Code({block}: {block: LeafletCodeBlock}) {
  return (
    <pre className="my-2 overflow-x-auto rounded-xl border border-[#1e1e1e] bg-[#0f0f10] px-5 py-4 font-mono text-[13.5px] lg:text-[14px] leading-[1.7] text-[#b8b8c0]">
      {block.plaintext}
    </pre>
  )
}

function HorizontalRule() {
  return (
    <div className="flex justify-center my-6 lg:my-8 text-[#3a3a40] select-none font-mono text-xs tracking-[0.4em]" role="separator">
      <span>· · ·</span>
    </div>
  )
}

// Semua gambar memakai bingkai yang sama: selebar kolom teks, latar gelap, sudut membulat, tinggi dibatasi.
// Foto potret/panel manga tidak jadi raksasa (object-contain), dan panel putih diredupkan sedikit supaya tidak menyilaukan.
function Image({block, did}: {block: LeafletImageBlock; did: string}) {
  const cdnUrl = `https://cdn.bsky.app/img/feed_fullsize/plain/${did}/${block.image.ref.$link}@jpeg`
  return (
    <figure className="my-3 lg:my-5">
      <div className="overflow-hidden rounded-xl lg:rounded-2xl border border-[#1e1e1e] bg-[#0e0e10] shadow-xl shadow-black/30">
        <img
          src={cdnUrl}
          alt={block.alt ?? ''}
          loading="lazy"
          decoding="async"
          className="block w-full h-auto max-h-[70vh] lg:max-h-[560px] object-contain mx-auto"
          style={{filter: 'brightness(0.94)'}}
        />
      </div>
      {block.alt && (
        <figcaption className="text-center font-mono text-[12px] tracking-[0.04em] text-[#6c6c74] mt-3">
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
      target="_blank"
      rel="noopener noreferrer"
      className="group my-2 flex items-center gap-4 rounded-xl border border-[#1e1e1e] bg-[#0f0f10] p-4 transition-colors hover:bg-[#141416] hover:border-[#2c2c32]">
      <div className="flex-1 min-w-0">
        <h3 className="font-display text-[17px] text-[#e4e4e7] truncate group-hover:text-[#4a9eff] transition-colors">
          {block.title || block.src}
        </h3>
        {block.description && (
          <p className="font-sans text-[14px] leading-snug text-[#8b8b93] mt-1 line-clamp-2">{block.description}</p>
        )}
        <p className="font-mono text-[11px] text-[#5a5a62] mt-2 uppercase tracking-[0.1em] truncate">
          {(() => { try { return new URL(block.src).hostname.replace(/^www\./, '') } catch { return block.src } })()}
        </p>
      </div>
      {cdnUrl && <img src={cdnUrl} alt="" loading="lazy" className="w-[88px] h-[88px] rounded-lg object-cover shrink-0" />}
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
