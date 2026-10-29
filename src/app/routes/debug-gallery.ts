import {json} from '@remix-run/node'

// Halaman diagnostik sementara: buka /debug-gallery buat lihat di mana Zeens nyimpen fotomu.
// HAPUS file ini setelah masalah gallery ketemu.
const HANDLE = 'mutho.my.id'

async function get(url: string) {
  try {
    const res = await fetch(url, {signal: AbortSignal.timeout(8000)})
    const body = await res.json().catch(() => null)
    return {ok: res.ok, status: res.status, body}
  } catch (e) {
    return {ok: false, status: 0, body: {error: String(e)}}
  }
}

export const loader = async () => {
  // 1. handle -> DID (lewat AppView publik), 2. DID -> PDS asli (lewat PLC directory)
  const resolved = await get(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${HANDLE}`)
  const did: string | undefined = resolved.body?.did
  if (!did) return json({step: 'resolveHandle', resolved})

  const doc = await get(did.startsWith('did:web:') ? `https://${did.slice(8)}/.well-known/did.json` : `https://plc.directory/${did}`)
  const pds: string | undefined = doc.body?.service?.find((s: any) => s.id === '#atproto_pds')?.serviceEndpoint
  if (!pds) return json({step: 'didDoc', did, doc})

  // 3. Semua collection yang ada di repo
  const describe = await get(`${pds}/xrpc/com.atproto.repo.describeRepo?repo=${did}`)
  const collections: string[] = describe.body?.collections ?? []

  // 4. Contoh 2 record dari tiap collection yang kemungkinan terkait foto
  const interesting = collections.filter(c => /photo|zeen|image|gallery|grain/i.test(c))
  const samples: Record<string, unknown> = {}
  for (const c of interesting) {
    samples[c] = await get(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=${c}&limit=2&reverse=true`)
  }

  // 5. Cek asumsi kode sekarang: tiap postMeta punya post app.bsky.feed.post dengan rkey sama?
  const meta = await get(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.photosky.postMeta&limit=5&reverse=true`)
  const metaVsPost = []
  for (const m of meta.body?.records ?? []) {
    const rkey = String(m.uri).split('/').pop()
    const p = await get(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=app.bsky.feed.post&rkey=${rkey}`)
    metaVsPost.push({rkey, feedPostStatus: p.status, hasImages: !!(p.body?.value?.embed?.images ?? p.body?.value?.embed?.media?.images)})
  }

  // 6. Apakah bsky.social (yang di-hardcode di gallery) bisa melihat repo ini?
  const viaBskySocial = await get(`https://bsky.social/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.photosky.postMeta&limit=1`)

  return json({
    did,
    pds,
    pdsIsBskySocial: /bsky\.network|bsky\.social/.test(pds),
    collections,
    samples,
    metaVsPost,
    viaBskySocial: {status: viaBskySocial.status, records: viaBskySocial.body?.records?.length ?? null, error: viaBskySocial.body?.error ?? null},
  }, {headers: {'Cache-Control': 'no-store'}})
}
