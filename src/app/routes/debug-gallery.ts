import {json} from '@remix-run/node'

// SEMENTARA: buka /debug-gallery untuk melihat di langkah mana pengambilan foto Gallery gagal.
// Isinya hanya data publik (tanpa rahasia). HAPUS file ini setelah masalah selesai.

const HANDLE = 'mutho.my.id'

async function probe(url: string) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {signal: AbortSignal.timeout(8000)})
    const text = await res.text()
    let body: any = null
    try {
      body = JSON.parse(text)
    } catch {
      /* bukan JSON */
    }
    return {status: res.status, ms: Date.now() - t0, body, raw: body ? undefined : text.slice(0, 200)}
  } catch (err) {
    return {error: String(err), ms: Date.now() - t0, body: null as any, status: 0, raw: undefined}
  }
}

export const loader = async () => {
  const out: Record<string, unknown> = {
    env: {
      ATP_SERVICE: process.env.ATP_SERVICE,
      ATP_IDENTIFIER: process.env.ATP_IDENTIFIER,
      ATP_DID: process.env.ATP_DID,
      REDIS_URL_set: Boolean(process.env.REDIS_URL),
    },
  }

  const r1 = await probe(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${HANDLE}`)
  out.resolveHandle = {status: r1.status, ms: r1.ms, did: r1.body?.did, error: (r1 as any).error ?? r1.body?.error}
  const did: string | undefined = r1.body?.did
  if (!did) return json(out)

  const hosts = Array.from(new Set(['https://bsky.social', (process.env.ATP_SERVICE ?? '').replace(/\/$/, '')].filter(Boolean)))
  let rkeys: string[] = []
  const lists: Record<string, unknown> = {}
  for (const host of hosts) {
    const r = await probe(
      `${host}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.photosky.postMeta&limit=5&reverse=true`,
    )
    const records: any[] = r.body?.records ?? []
    lists[host] = {
      status: r.status,
      ms: r.ms,
      count: records.length,
      first: records.slice(0, 2).map(x => x.uri),
      error: (r as any).error ?? r.body?.error,
      message: r.body?.message,
    }
    if (rkeys.length === 0) rkeys = records.map(x => String(x.uri).split('/').pop() as string)
  }
  out.listRecords_postMeta = lists
  if (rkeys.length === 0) return json(out)

  const qs = rkeys.slice(0, 3).map(k => `uris=${encodeURIComponent(`at://${did}/app.bsky.feed.post/${k}`)}`).join('&')
  const gp = await probe(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${qs}`)
  out.getPosts = {
    status: gp.status,
    ms: gp.ms,
    posts: (gp.body?.posts ?? []).map((p: any) => ({
      uri: p.uri,
      embed: p.embed?.$type,
      images: (p.embed?.images ?? p.embed?.media?.images ?? []).length,
    })),
    error: (gp as any).error ?? gp.body?.error,
  }

  const gr = await probe(
    `https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.feed.post&rkey=${rkeys[0]}`,
  )
  out.getRecord_first = {
    status: gr.status,
    ms: gr.ms,
    embed: gr.body?.value?.embed?.$type,
    images: (gr.body?.value?.embed?.images ?? gr.body?.value?.embed?.media?.images ?? []).length,
    error: (gr as any).error ?? gr.body?.error,
  }
  return json(out)
}

export default function DebugGallery() {
  return null
}
