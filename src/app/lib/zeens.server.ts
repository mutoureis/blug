// Ambil foto dari akun Zeens lewat PDS milik akun itu sendiri.
//
// Zeens menyimpan data di PDS pemilik akun. Nama lexicon-nya pernah berubah (app.photosky.* ->
// zeens), dan belum ada dokumentasi publik soal nama barunya. Jadi kode ini TIDAK hardcode nama
// collection: dia memakai describeRepo, memilih collection yang namanya mengandung "zeens" atau
// "photosky", lalu mencari blob gambar di dalam record-nya. Kalau record itu cuma sidecar
// (metadata) dan fotonya ada di post Bluesky dengan rkey yang sama, post itu ikut diambil.
// Kalau tidak ada collection Zeens sama sekali, jatuh ke post Bluesky biasa yang punya foto.

const HANDLE = 'mutho.my.id'
const THUMB_W = 480
const THUMB_Q = 60
const FULL_W = 1200
const FULL_Q = 80
const ZEENS_NSID = /(zeens|photosky)/i
const MAX_PAGES = 5

export type ImageItem = {thumb: string; full: string; width: number; height: number; alt: string}
export type PhotoPost = {images: ImageItem[]; createdAt: string}
export type GalleryPayload = {posts: PhotoPost[]; did: string; pds: string; collections: string[]}

function wsrv(url: string, w: number, q: number) {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=${q}&output=webp&we=1`
}

async function getJson(url: string, timeoutMs = 8000): Promise<any> {
  const res = await fetch(url, {signal: AbortSignal.timeout(timeoutMs)})
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${url} ${body.slice(0, 200)}`)
  }
  return res.json()
}

// handle -> DID -> PDS asli. Tidak lagi hardcode bsky.social.
let _identity: {did: string; pds: string; at: number} | null = null
async function resolveIdentity(): Promise<{did: string; pds: string}> {
  if (_identity && Date.now() - _identity.at < 3_600_000) return _identity
  const {did} = await getJson(
    `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${HANDLE}`,
  )
  const doc = await getJson(
    did.startsWith('did:web:') ? `https://${did.slice(8)}/.well-known/did.json` : `https://plc.directory/${did}`,
  )
  const endpoint: string | undefined = doc?.service?.find((s: any) => s.id === '#atproto_pds')?.serviceEndpoint
  if (!endpoint) throw new Error(`PDS tidak ketemu di DID document ${did}`)
  _identity = {did, pds: endpoint.replace(/\/+$/, ''), at: Date.now()}
  return _identity
}

async function listAll(pds: string, did: string, collection: string, maxPages: number, pageSize = 100) {
  const out: any[] = []
  let cursor: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`)
    url.searchParams.set('repo', did)
    url.searchParams.set('collection', collection)
    url.searchParams.set('limit', String(pageSize))
    url.searchParams.set('reverse', 'true') // terbaru dulu
    if (cursor) url.searchParams.set('cursor', cursor)
    const data = await getJson(url.toString())
    out.push(...(data.records ?? []))
    if (!data.cursor || (data.records ?? []).length === 0) break
    cursor = data.cursor
  }
  return out
}

type RawImage = {cid: string; alt: string; width: number; height: number}

// Cari blob gambar di mana saja di dalam record (tidak peduli skema lexicon-nya).
function findImages(node: any, parent: any = null, out: RawImage[] = []): RawImage[] {
  if (!node || typeof node !== 'object') return out
  if (node.$type === 'blob' && typeof node.mimeType === 'string' && node.mimeType.startsWith('image/')) {
    const cid = node.ref?.$link ?? (typeof node.cid === 'string' ? node.cid : undefined)
    if (cid && !out.some(o => o.cid === cid)) {
      const ar = parent?.aspectRatio
      out.push({
        cid,
        alt: typeof parent?.alt === 'string' ? parent.alt : '',
        width: ar?.width ?? parent?.width ?? 1,
        height: ar?.height ?? parent?.height ?? 1,
      })
    }
    return out
  }
  for (const v of Array.isArray(node) ? node : Object.values(node)) findImages(v, node, out)
  return out
}

function findCreatedAt(value: any): string | undefined {
  return typeof value?.createdAt === 'string' ? value.createdAt : undefined
}

function toPost(pds: string, did: string, raw: RawImage[], createdAt: string): PhotoPost | null {
  if (raw.length === 0) return null
  return {
    createdAt,
    images: raw.map(r => {
      const blobUrl = `${pds}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${r.cid}`
      return {
        thumb: wsrv(blobUrl, THUMB_W, THUMB_Q),
        full: wsrv(blobUrl, FULL_W, FULL_Q),
        width: r.width,
        height: r.height,
        alt: r.alt,
      }
    }),
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({length: Math.min(limit, items.length)}, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

const byNewest = (a: PhotoPost, b: PhotoPost) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()

// maxPosts: batasi jumlah record yang diproses (dipakai kartu beranda yang cuma butuh foto terbaru).
export async function fetchZeensPhotos(opts: {maxPosts?: number} = {}): Promise<GalleryPayload> {
  const {did, pds} = await resolveIdentity()
  const pages = opts.maxPosts ? 1 : MAX_PAGES
  const pageSize = opts.maxPosts ? Math.min(opts.maxPosts, 100) : 100

  const describe = await getJson(`${pds}/xrpc/com.atproto.repo.describeRepo?repo=${did}`)
  const collections: string[] = describe.collections ?? []
  const zeensCollections = collections.filter(c => ZEENS_NSID.test(c))

  // Kumpulkan record Zeens, dikelompokkan per rkey (record pendamping punya rkey yang sama dengan post-nya).
  const byRkey = new Map<string, {values: any[]; order: number}>()
  let order = 0
  for (const collection of zeensCollections) {
    let records: any[] = []
    try {
      records = await listAll(pds, did, collection, pages, pageSize)
    } catch (err) {
      console.error(`[zeens] listRecords gagal untuk ${collection}:`, err)
      continue
    }
    for (const r of records) {
      const rkey = String(r.uri).split('/').pop()!
      const entry = byRkey.get(rkey) ?? {values: [], order: order++}
      entry.values.push(r.value)
      byRkey.set(rkey, entry)
    }
  }

  const rkeys = [...byRkey.keys()].slice(0, opts.maxPosts ?? Infinity)
  const results = await mapPool(rkeys, 12, async (rkey): Promise<PhotoPost | null> => {
    const {values} = byRkey.get(rkey)!
    // 1) foto langsung di record Zeens
    let raw = values.flatMap(v => findImages(v))
    let createdAt = values.map(findCreatedAt).find(Boolean)
    // 2) kalau tidak ada, cari di post Bluesky dengan rkey yang sama (kasus "Post to Bluesky" aktif)
    if (raw.length === 0) {
      try {
        const post = await getJson(
          `${pds}/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.feed.post&rkey=${rkey}`,
        )
        raw = findImages(post.value)
        createdAt = findCreatedAt(post.value) ?? createdAt
      } catch {
        return null // post-nya memang tidak ada (cross-post mati)
      }
    }
    return toPost(pds, did, raw, createdAt ?? new Date(0).toISOString())
  })

  let posts = results.filter((p): p is PhotoPost => p !== null)

  // Cadangan: tidak ada collection Zeens yang menghasilkan foto -> pakai post Bluesky biasa yang punya foto.
  if (posts.length === 0) {
    console.warn('[zeens] tidak ada foto dari collection Zeens', {zeensCollections}, '- pakai post Bluesky biasa')
    const feed = await listAll(pds, did, 'app.bsky.feed.post', pages, pageSize)
    posts = feed
      .map(r => toPost(pds, did, findImages(r.value), findCreatedAt(r.value) ?? new Date(0).toISOString()))
      .filter((p): p is PhotoPost => p !== null)
  }

  posts.sort(byNewest)
  return {posts, did, pds, collections: zeensCollections}
}
