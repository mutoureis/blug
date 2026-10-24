import type {LeafletDocument, LeafletBlock} from 'src/types'

// Zona waktu tetap (bukan zona pembaca) supaya tanggal di server & browser selalu sama
// -> tidak ada hydration mismatch, dan tanggal post sesuai waktu penulisnya.
export const SITE_TZ = 'Asia/Jakarta'

export function formatDate(
  input: string | Date,
  opts: Intl.DateTimeFormatOptions = {month: 'short', day: 'numeric', year: 'numeric'},
): string {
  return new Date(input).toLocaleDateString('en-US', {...opts, timeZone: SITE_TZ})
}

// Walks a Leaflet document's blocks (including nested list children) and
// sums up the plaintext so we can estimate reading time — same content the
// reader will actually see on the post page, not just the trimmed excerpt.
export function estimateReadingMinutes(doc: Pick<LeafletDocument, 'content'>): number {
  let words = 0
  const countText = (text?: string) => {
    if (!text) return
    words += text.trim().split(/\s+/).filter(Boolean).length
  }
  const walk = (blocks: LeafletBlock[]) => {
    for (const {block} of blocks) {
      switch (block.$type) {
        case 'pub.leaflet.blocks.text':
        case 'pub.leaflet.blocks.blockquote':
        case 'pub.leaflet.blocks.header':
        case 'pub.leaflet.blocks.code':
          countText(block.plaintext)
          break
        case 'pub.leaflet.blocks.list':
          for (const child of block.children.content) {
            if ('plaintext' in child) countText(child.plaintext)
          }
          break
        default:
          break
      }
    }
  }
  for (const page of doc.content?.pages ?? []) walk(page.blocks)
  return Math.max(1, Math.round(words / 200)) // ~200 wpm average reading speed
}
