import net from "node:net";

export type SearchMode = "off" | "web" | "deep";
export type SearchRecency = "any" | "day" | "week" | "month";

export interface SearchSource {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  excerpt?: string;
  fetchedExcerpt?: boolean;
}

export interface SearchProgressEvent {
  stage: "planning" | "searching" | "reading" | "synthesizing" | "done";
  queries: string[];
  sourcesCount: number;
  pagesRead?: number;
  sources?: Array<{
    title: string;
    url: string;
    domain: string;
    snippet: string;
    fetchedExcerpt?: boolean;
  }>;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isPublicHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    !lower ||
    lower === "localhost" ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".localhost")
  ) {
    return false;
  }

  const ipVersion = net.isIP(lower);
  if (ipVersion === 4) {
    const parts = lower.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  } else if (ipVersion === 6) {
    if (
      lower === "::1" ||
      lower.startsWith("fe80:") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd")
    ) {
      return false;
    }
  }
  return true;
}

function normalizeUrl(rawHref: string): string | null {
  try {
    let href = decodeHtmlEntities(rawHref).trim();
    if (href.startsWith("//")) {
      href = `https:${href}`;
    }
    const parsed = new URL(href);
    if (
      parsed.hostname.endsWith("duckduckgo.com") &&
      parsed.searchParams.has("uddg")
    ) {
      const unwrapped = parsed.searchParams.get("uddg");
      if (unwrapped) {
        href = unwrapped;
      }
    }
    const finalUrl = new URL(href);
    if (finalUrl.protocol !== "http:" && finalUrl.protocol !== "https:") {
      return null;
    }
    if (!isPublicHostname(finalUrl.hostname)) {
      return null;
    }
    return finalUrl.toString();
  } catch {
    return null;
  }
}

function getDomain(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./i, "");
  } catch {
    return "web";
  }
}

export function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>()[\]"']+/gi) || [];
  const valid: string[] = [];
  const seen = new Set<string>();
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?]+$/, "");
    const normalized = normalizeUrl(cleaned);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      valid.push(normalized);
    }
    if (valid.length >= 3) break;
  }
  return valid;
}

export function extractUserQuestionForSearch(raw: string): string {
  // Remove attached file/media blocks prepended by buildApiMessageContent
  const cleaned = raw
    .replace(/\[Attached file:[^\]]+\]\s*```[\s\S]*?```/gi, " ")
    .replace(/\[Attached (?:image|audio|video):[^\]]+\]/gi, " ")
    .trim();
  return cleaned || raw;
}

export function sanitizeSearchQuery(raw: string): string {
  let text = extractUserQuestionForSearch(raw)
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\r\n]+/g, " ")
    .trim();

  // If the user appended follow-up formatting instructions after a question mark, keep the core question
  const qIndex = text.indexOf("?");
  if (qIndex > 8 && qIndex < text.length - 4) {
    text = text.slice(0, qIndex).trim();
  }

  // Strip common conversational instruction suffixes/prefixes
  text = text
    .replace(
      /\b(answer|reply|respond|summarize|explain)\s+(in|using|with)\s+\d*\s*(short|brief|concise)?\s*(sentences?|lines?|words?|bullets?|paragraphs?)\b.*/i,
      " ",
    )
    .replace(/\b(with\s+(a\s+)?citations?|include\s+sources?|cite\s+sources?)\b/gi, " ")
    .replace(/^(please\s+|can you\s+|could you\s+|tell me\s+|search for\s+|look up\s+)/i, "")
    .replace(/[^\p{L}\p{N}\s.'"+:/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = text.split(" ").filter(Boolean);
  if (words.length > 14) {
    text = words.slice(0, 14).join(" ");
  }

  return text.slice(0, 160).trim() || raw.slice(0, 120).trim();
}

export async function searchDuckDuckGoLite(
  query: string,
  recency: SearchRecency = "any",
  signal?: AbortSignal,
): Promise<SearchSource[]> {
  const params = new URLSearchParams({ q: query });
  if (recency === "day") params.set("df", "d");
  else if (recency === "week") params.set("df", "w");
  else if (recency === "month") params.set("df", "m");

  const res = await fetch(`https://lite.duckduckgo.com/lite/?${params.toString()}`, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(7000)])
      : AbortSignal.timeout(7000),
  });

  if (!res.ok) return [];
  const html = await res.text();
  const linkRegex =
    /<a[^>]*href=['"]([^'"]+)['"][^>]*class=['"][^'"]*result-link[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex =
    /<td[^>]*class=['"][^'"]*result-snippet[^'"]*['"][^>]*>([\s\S]*?)<\/td>/gi;

  const links: Array<{ url: string; title: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    const url = normalizeUrl(m[1]);
    const title = stripTags(m[2]);
    if (url && title) {
      links.push({ url, title: title.slice(0, 180), index: m.index });
    }
    if (links.length >= 10) break;
  }

  const snippets: Array<{ text: string; index: number }> = [];
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push({ text: stripTags(m[1]).slice(0, 480), index: m.index });
  }

  return links.slice(0, 8).map((link, idx) => {
    const matchedSnippet =
      snippets.find((s) => s.index > link.index) ?? snippets[idx];
    return {
      title: link.title,
      url: link.url,
      domain: getDomain(link.url),
      snippet: matchedSnippet?.text || "",
    };
  });
}

export async function searchDuckDuckGoHtml(
  query: string,
  recency: SearchRecency = "any",
  signal?: AbortSignal,
): Promise<SearchSource[]> {
  const params = new URLSearchParams({ q: query });
  if (recency === "day") params.set("df", "d");
  else if (recency === "week") params.set("df", "w");
  else if (recency === "month") params.set("df", "m");

  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?${params.toString()}`, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(7000)])
        : AbortSignal.timeout(7000),
    });

    if (res.ok) {
      const html = await res.text();
      const blocks = html.split(/class="result\s+results_links/);
      const results: SearchSource[] = [];

      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.includes("result--ad")) continue;

        const linkMatch = block.match(
          /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
        );
        if (!linkMatch) continue;

        const url = normalizeUrl(linkMatch[1]);
        if (!url) continue;

        const title = stripTags(linkMatch[2]);
        if (!title) continue;

        const snippetMatch = block.match(
          /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i,
        );
        const snippet = snippetMatch ? stripTags(snippetMatch[1]) : "";

        results.push({
          title: title.slice(0, 180),
          url,
          domain: getDomain(url),
          snippet: snippet.slice(0, 480),
        });

        if (results.length >= 8) break;
      }

      if (results.length > 0) {
        return results;
      }
    }
  } catch {
    // Fall through to DuckDuckGo Lite
  }

  return searchDuckDuckGoLite(query, recency, signal).catch(() => []);
}

export async function searchDuckDuckGoInstant(
  query: string,
  signal?: AbortSignal,
): Promise<SearchSource[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      format: "json",
      no_html: "1",
      skip_disambig: "1",
    });
    const res = await fetch(
      `https://api.duckduckgo.com/?${params.toString()}`,
      {
        headers: { "User-Agent": "AshutoshGPT/1.0" },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(4500)])
          : AbortSignal.timeout(4500),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      Heading?: string;
      AbstractText?: string;
      AbstractURL?: string;
      Results?: Array<{ FirstURL?: string; Text?: string }>;
      RelatedTopics?: Array<{ FirstURL?: string; Text?: string }>;
    };
    const out: SearchSource[] = [];
    if (data.AbstractURL && data.AbstractText) {
      const safe = normalizeUrl(data.AbstractURL);
      if (safe) {
        out.push({
          title: data.Heading || getDomain(safe),
          url: safe,
          domain: getDomain(safe),
          snippet: data.AbstractText.slice(0, 500),
        });
      }
    }
    for (const item of data.Results || []) {
      if (!item.FirstURL || !item.Text) continue;
      const safe = normalizeUrl(item.FirstURL);
      if (!safe) continue;
      out.push({
        title: item.Text.slice(0, 160),
        url: safe,
        domain: getDomain(safe),
        snippet: item.Text.slice(0, 420),
      });
    }
    for (const item of (data.RelatedTopics || []).slice(0, 3)) {
      if (!item.FirstURL || !item.Text) continue;
      const safe = normalizeUrl(item.FirstURL);
      if (!safe) continue;
      out.push({
        title: item.Text.split(" - ")[0]?.slice(0, 160) || getDomain(safe),
        url: safe,
        domain: getDomain(safe),
        snippet: item.Text.slice(0, 420),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function searchWikipedia(
  query: string,
  signal?: AbortSignal,
): Promise<SearchSource[]> {
  try {
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: query,
      gsrlimit: "4",
      prop: "extracts",
      exintro: "1",
      explaintext: "1",
      exchars: "700",
      format: "json",
    });
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?${params.toString()}`,
      {
        headers: { "User-Agent": "AshutoshGPT/1.0" },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
          : AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          { index?: number; title: string; extract?: string }
        >;
      };
    };
    const pages = Object.values(data?.query?.pages || {}).sort(
      (a, b) => (a.index ?? 99) - (b.index ?? 99),
    );
    return pages.map((item) => {
      const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(
        item.title.replace(/ /g, "_"),
      )}`;
      return {
        title: `${item.title} — Wikipedia`,
        url,
        domain: "en.wikipedia.org",
        snippet: (item.extract || "").replace(/\s+/g, " ").trim().slice(0, 560),
      };
    });
  } catch {
    return [];
  }
}

export async function searchHackerNews(
  query: string,
  signal?: AbortSignal,
): Promise<SearchSource[]> {
  try {
    const params = new URLSearchParams({
      query,
      tags: "story",
      hitsPerPage: "4",
    });
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?${params.toString()}`,
      {
        headers: { "User-Agent": "AshutoshGPT/1.0" },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(4500)])
          : AbortSignal.timeout(4500),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      hits?: Array<{
        title?: string;
        url?: string;
        objectID?: string;
        points?: number;
        num_comments?: number;
      }>;
    };
    const results: SearchSource[] = [];
    for (const hit of data.hits || []) {
      const targetUrl =
        hit.url ||
        (hit.objectID
          ? `https://news.ycombinator.com/item?id=${hit.objectID}`
          : "");
      const safe = targetUrl ? normalizeUrl(targetUrl) : null;
      if (!safe || !hit.title) continue;
      results.push({
        title: hit.title.slice(0, 180),
        url: safe,
        domain: getDomain(safe),
        snippet: `Discussion on Hacker News (${hit.points ?? 0} points, ${hit.num_comments ?? 0} comments).`,
      });
    }
    return results;
  } catch {
    return [];
  }
}

export async function fetchPageExcerpt(
  url: string,
  maxChars = 3600,
  signal?: AbortSignal,
): Promise<{ title?: string; excerpt: string } | null> {
  const safeUrl = normalizeUrl(url);
  if (!safeUrl) return null;

  try {
    const res = await fetch(safeUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
      },
      redirect: "follow",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(5200)])
        : AbortSignal.timeout(5200),
    });
    if (!res.ok) return null;

    const finalSafe = normalizeUrl(res.url || safeUrl);
    if (!finalSafe) return null;

    const ctype = res.headers.get("content-type") || "";
    if (
      !ctype.includes("text/html") &&
      !ctype.includes("text/plain") &&
      !ctype.includes("application/xhtml")
    ) {
      return null;
    }

    const raw = await res.text();
    if (!raw) return null;

    if (ctype.includes("text/plain")) {
      return {
        excerpt: raw.replace(/\s+/g, " ").trim().slice(0, maxChars),
      };
    }

    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripTags(titleMatch[1]).slice(0, 180) : undefined;

    // Prefer <main> or <article> region if substantive prose is found inside it
    const mainMatch = raw.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
    const candidateHtml =
      mainMatch && stripTags(mainMatch[1]).length > 260 ? mainMatch[1] : raw;

    const cleanedHtml = candidateHtml
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ");

    const text = stripTags(cleanedHtml);
    if (text.length < 80) return null;

    return {
      title,
      excerpt: text.slice(0, maxChars),
    };
  } catch {
    return null;
  }
}

function rankAndDeduplicateSources(
  sources: SearchSource[],
  baseQuery: string,
  limit: number,
): SearchSource[] {
  const queryTerms = baseQuery
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  const scored = sources.map((s, idx) => {
    const hay = `${s.title} ${s.snippet} ${s.domain}`.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      if (hay.includes(term)) score += 2;
      if (s.title.toLowerCase().includes(term)) score += 1;
    }
    if (s.snippet.length > 80) score += 1.5;
    // Slight preference for preserving earlier primary hits on tie
    score += Math.max(0, 1 - idx * 0.03);
    return { source: s, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const seenUrls = new Set<string>();
  const domainCounts = new Map<string, number>();
  const result: SearchSource[] = [];

  for (const { source: s } of scored) {
    const key = s.url.replace(/\/$/, "");
    if (seenUrls.has(key)) continue;
    const count = domainCounts.get(s.domain) ?? 0;
    if (count >= 2 && result.length >= 4) continue;
    seenUrls.add(key);
    domainCounts.set(s.domain, count + 1);
    result.push(s);
    if (result.length >= limit) break;
  }
  return result;
}

export async function runWebSearchPipeline(options: {
  userQuery: string;
  mode: "web" | "deep";
  recency: SearchRecency;
  planQueriesFn?: (prompt: string) => Promise<string[]>;
  onProgress?: (event: SearchProgressEvent) => void;
  signal?: AbortSignal;
}): Promise<{
  queries: string[];
  sources: SearchSource[];
}> {
  const { userQuery, mode, recency, planQueriesFn, onProgress, signal } =
    options;
  const cleanQuestion = extractUserQuestionForSearch(userQuery);
  const baseQuery = sanitizeSearchQuery(cleanQuestion);
  const directUrls = extractUrlsFromText(cleanQuestion);

  let queries: string[] = [baseQuery];

  if (mode === "deep" && planQueriesFn) {
    onProgress?.({
      stage: "planning",
      queries: [baseQuery],
      sourcesCount: 0,
    });
    try {
      const planned = await planQueriesFn(baseQuery);
      const unique = Array.from(
        new Set(
          [baseQuery, ...planned]
            .map((q) => q.trim())
            .filter((q) => q.length >= 2),
        ),
      ).slice(0, 4);
      if (unique.length > 0) {
        queries = unique;
      }
    } catch {
      queries = [baseQuery];
    }
  }

  onProgress?.({
    stage: "searching",
    queries,
    sourcesCount: 0,
  });

  const searchTasks: Array<Promise<SearchSource[]>> = [];
  for (const q of queries) {
    searchTasks.push(searchDuckDuckGoHtml(q, recency, signal).catch(() => []));
  }
  searchTasks.push(searchDuckDuckGoInstant(baseQuery, signal).catch(() => []));
  if (mode === "deep" || directUrls.length === 0) {
    searchTasks.push(searchWikipedia(baseQuery, signal).catch(() => []));
  }
  if (
    mode === "deep" ||
    /\b(react|node|typescript|javascript|python|rust|sql|sqlite|postgres|ai|llm|api|code|bug|framework|library|github|open[- ]source)\b/i.test(
      baseQuery,
    )
  ) {
    searchTasks.push(searchHackerNews(baseQuery, signal).catch(() => []));
  }

  const searchBatches = await Promise.all(searchTasks);
  const rawSources: SearchSource[] = [];

  for (const url of directUrls) {
    rawSources.push({
      title: getDomain(url),
      url,
      domain: getDomain(url),
      snippet: "Directly referenced URL from your prompt.",
    });
  }
  for (const batch of searchBatches) {
    rawSources.push(...batch);
  }

  const maxSources = mode === "deep" ? 10 : 6;
  const sources = rankAndDeduplicateSources(rawSources, baseQuery, maxSources);

  // Read full page excerpts for top sources (more in Deep Search)
  const readCount =
    mode === "deep" ? Math.min(6, sources.length) : Math.min(3, sources.length);
  if (readCount > 0) {
    onProgress?.({
      stage: "reading",
      queries,
      sourcesCount: sources.length,
      pagesRead: 0,
      sources: sources.map((s) => ({
        title: s.title,
        url: s.url,
        domain: s.domain,
        snippet: s.snippet,
        fetchedExcerpt: s.fetchedExcerpt,
      })),
    });

    const pagesToRead = sources.slice(0, readCount);
    const excerpts = await Promise.all(
      pagesToRead.map((s) =>
        fetchPageExcerpt(s.url, mode === "deep" ? 3600 : 2200, signal),
      ),
    );

    let pagesRead = 0;
    for (let i = 0; i < pagesToRead.length; i++) {
      const data = excerpts[i];
      if (data?.excerpt) {
        pagesRead++;
        pagesToRead[i].excerpt = data.excerpt;
        pagesToRead[i].fetchedExcerpt = true;
        if (
          data.title &&
          (pagesToRead[i].title === pagesToRead[i].domain ||
            pagesToRead[i].title.length < 4)
        ) {
          pagesToRead[i].title = data.title;
        }
      }
    }

    onProgress?.({
      stage: "synthesizing",
      queries,
      sourcesCount: sources.length,
      pagesRead,
      sources: sources.map((s) => ({
        title: s.title,
        url: s.url,
        domain: s.domain,
        snippet: s.snippet,
        fetchedExcerpt: s.fetchedExcerpt,
      })),
    });
  } else {
    onProgress?.({
      stage: "synthesizing",
      queries,
      sourcesCount: sources.length,
      pagesRead: 0,
      sources: [],
    });
  }

  return { queries, sources };
}

export function formatSourcesForSystemPrompt(
  sources: SearchSource[],
  mode: "web" | "deep",
  queries: string[],
): string {
  const today = new Date().toISOString().slice(0, 10);
  if (sources.length === 0) {
    return [
      `Today's date (UTC): ${today}.`,
      `Live ${mode === "deep" ? "Deep Search" : "Web Search"} ran for queries: ${queries.join(" | ")}.`,
      `No live web results were retrieved. Be transparent about that and answer carefully from your verified knowledge without fabricating URLs.`,
    ].join("\n");
  }

  const formattedSources = sources
    .map((s, idx) => {
      const n = idx + 1;
      const body = s.excerpt
        ? `Snippet: ${s.snippet}\nExtracted Page Content: ${s.excerpt}`
        : `Snippet: ${s.snippet}`;
      return `[${n}] ${s.title} (${s.domain})\nURL: ${s.url}\n${body}`;
    })
    .join("\n\n---\n\n");

  const instructions =
    mode === "deep"
      ? `You are Ashutosh GPT in Deep Search mode. Today's date (UTC) is ${today}.
Synthesize an authoritative, clear, multi-angle research response grounded in the live web sources below.
Rules:
- Open with a crisp 2-3 sentence direct summary answering the core question.
- Organize supporting analysis with clean headings, concrete numbers/facts, markdown comparison tables when weighing options, and caveats where sources differ.
- Cite supporting claims inline using standalone bracketed source numbers like [1] or [2] matching the numbered sources below (never invent source numbers or URLs).`
      : `You are Ashutosh GPT with live Web Search enabled. Today's date (UTC) is ${today}.
Answer clearly and accurately using the live web sources below.
Rules:
- Lead with the direct answer, followed by scannable supporting points.
- Cite supporting claims inline using standalone bracketed numbers like [1] or [2] matching the sources below.
- Never fabricate URLs or facts not supported by the sources or verified knowledge.`;

  return `${instructions}\n\nSearch queries executed: ${queries.join(" | ")}\n\nLIVE WEB SOURCES:\n\n${formattedSources}`;
}
