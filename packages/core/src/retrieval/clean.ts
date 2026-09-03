import * as cheerio from "cheerio";

export interface PageLink {
  url: string;
  anchor: string;
}

export interface CleanedPage {
  url: string;
  title: string;
  description: string;
  /** Readable text with scripts, nav chrome and styling removed. */
  text: string;
  links: PageLink[];
}

const STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "form",
  "header nav",
  "footer",
  "[aria-hidden='true']",
];

/** Parse fetched HTML into title, description, readable text and resolved links. */
export function cleanHtml(html: string, baseUrl: string): CleanedPage {
  const $ = cheerio.load(html);

  const title = ($("title").first().text() || $("h1").first().text() || "").trim();
  const description = ($('meta[name="description"]').attr("content") || "")
    .trim()
    .slice(0, 500);

  const links: PageLink[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const resolved = resolveLink(href, baseUrl);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    links.push({ url: resolved, anchor: collapse($(el).text()).slice(0, 120) });
  });

  for (const sel of STRIP_SELECTORS) $(sel).remove();
  const root = $("main").first().length ? $("main").first() : $("body");
  const text = collapse(root.text()).slice(0, 20_000);

  return { url: baseUrl, title: collapse(title), description, text, links };
}

function resolveLink(href: string, baseUrl: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:") || trimmed.startsWith("javascript:")) {
    return null;
  }
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
