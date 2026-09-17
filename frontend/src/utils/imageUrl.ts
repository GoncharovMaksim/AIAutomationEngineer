/**
 * Safely routes external CDN images (e.g. Metacritic, CBSi) through backend proxy
 * to prevent regional ISP blocks / hotlinking blocks in regions like Russia.
 */
export function getProxiedImageUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('/')) return url;
  if (
    url.includes('metacritic.com') ||
    url.includes('cbsistatic.com') ||
    url.includes('fandom.com')
  ) {
    return `/api/proxy/image?url=${encodeURIComponent(url)}`;
  }
  return url;
}
