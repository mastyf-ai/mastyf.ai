import { NextResponse } from 'next/server';

export interface LiveIncidentItem {
  id: string;
  title: string;
  snippet: string;
  source: string;
  url: string;
  publishedAt: string;
  category: 'AGENT_EXPLOIT' | 'MCP_VULNERABILITY' | 'PROMPT_INJECTION' | 'CREDENTIAL_LEAK';
  severity: 'CRITICAL' | 'SEV-1' | 'HIGH';
}

function cleanHtml(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function categorize(title: string, snippet: string): {
  category: LiveIncidentItem['category'];
  severity: LiveIncidentItem['severity'];
} {
  const text = `${title} ${snippet}`.toLowerCase();
  if (text.includes('credential') || text.includes('secret') || text.includes('token') || text.includes('exfiltrat')) {
    return { category: 'CREDENTIAL_LEAK', severity: 'CRITICAL' };
  }
  if (text.includes('mcp') || text.includes('protocol') || text.includes('registry') || text.includes('package')) {
    return { category: 'MCP_VULNERABILITY', severity: 'CRITICAL' };
  }
  if (text.includes('prompt injection') || text.includes('jailbreak') || text.includes('bypass')) {
    return { category: 'PROMPT_INJECTION', severity: 'SEV-1' };
  }
  return { category: 'AGENT_EXPLOIT', severity: 'HIGH' };
}

// In-memory cache for 90 seconds to prevent hitting external feed rate limits
let cachedIncidents: LiveIncidentItem[] = [];
let lastFetchedAt = 0;
const CACHE_TTL_MS = 90 * 1000;

async function fetchGoogleNewsIncidents(): Promise<LiveIncidentItem[]> {
  try {
    const query = encodeURIComponent('"AI agent" OR "prompt injection" OR "Model Context Protocol" security OR vulnerability OR exploit');
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      next: { revalidate: 90 },
    });

    if (!res.ok) return [];
    const xml = await res.text();

    const items: LiveIncidentItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 15) {
      const itemXml = match[1];
      const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);
      const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const sourceMatch = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      const descMatch = itemXml.match(/<description>([\s\S]*?)<\/description>/);

      if (titleMatch && linkMatch) {
        let fullTitle = cleanHtml(titleMatch[1]);
        let sourceName = sourceMatch ? cleanHtml(sourceMatch[1]) : 'Security Wire';

        // Often Google News appends " - Source" to title
        if (fullTitle.includes(' - ') && (!sourceMatch || sourceName === 'Security Wire')) {
          const parts = fullTitle.split(' - ');
          sourceName = parts.pop() || sourceName;
          fullTitle = parts.join(' - ');
        }

        const rawSnippet = descMatch ? cleanHtml(descMatch[1]) : '';
        const snippet = rawSnippet.replace(fullTitle, '').replace(sourceName, '').trim() ||
          'Live threat alert regarding autonomous AI agents and Model Context Protocol integrations.';

        const { category, severity } = categorize(fullTitle, snippet);

        items.push({
          id: `gnews-${Buffer.from(linkMatch[1]).toString('base64').substring(0, 16)}`,
          title: fullTitle,
          snippet: snippet.length > 200 ? `${snippet.substring(0, 197)}...` : snippet,
          source: sourceName,
          url: cleanHtml(linkMatch[1]),
          publishedAt: pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString(),
          category,
          severity,
        });
      }
    }

    return items;
  } catch (err) {
    console.error('Error fetching Google News incidents:', err);
    return [];
  }
}

async function fetchHackerNewsIncidents(): Promise<LiveIncidentItem[]> {
  try {
    const url = 'https://hn.algolia.com/api/v1/search_by_date?query=prompt+injection+OR+%22AI+agent%22+security+OR+MCP+vulnerability&tags=story&hitsPerPage=10';
    const res = await fetch(url, { next: { revalidate: 90 } });
    if (!res.ok) return [];

    const data = await res.json();
    const hits = data?.hits || [];

    return hits
      .filter((h: any) => h.title && (h.url || h.objectID))
      .map((h: any) => {
        const title = h.title;
        const snippet = h.story_text ? cleanHtml(h.story_text).substring(0, 180) : `Community disclosure and analysis on Hacker News (${h.points || 1} points, ${h.num_comments || 0} comments).`;
        const { category, severity } = categorize(title, snippet);

        return {
          id: `hn-${h.objectID}`,
          title,
          snippet: snippet.length > 200 ? `${snippet.substring(0, 197)}...` : snippet,
          source: h.url ? new URL(h.url).hostname.replace('www.', '') : 'Hacker News Dispatch',
          url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
          publishedAt: h.created_at || new Date().toISOString(),
          category,
          severity,
        };
      });
  } catch (err) {
    console.error('Error fetching Hacker News incidents:', err);
    return [];
  }
}

export async function GET() {
  const now = Date.now();

  if (cachedIncidents.length > 0 && now - lastFetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      incidents: cachedIncidents,
      fetchedAt: new Date(lastFetchedAt).toISOString(),
      cached: true,
      total: cachedIncidents.length,
    });
  }

  // Fetch concurrently from live feeds with no hardcoded seed data
  const [gNews, hn] = await Promise.all([
    fetchGoogleNewsIncidents(),
    fetchHackerNewsIncidents(),
  ]);

  // Combine and sort by publication date descending (freshest first)
  const combined = [...gNews, ...hn]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  // Deduplicate by URL or normalized title
  const seen = new Set<string>();
  const uniqueIncidents: LiveIncidentItem[] = [];

  for (const item of combined) {
    const key = item.title.toLowerCase().substring(0, 40);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueIncidents.push(item);
    }
  }

  if (uniqueIncidents.length > 0) {
    cachedIncidents = uniqueIncidents;
    lastFetchedAt = now;
  }

  return NextResponse.json({
    incidents: cachedIncidents,
    fetchedAt: new Date(lastFetchedAt).toISOString(),
    cached: false,
    total: cachedIncidents.length,
  });
}
