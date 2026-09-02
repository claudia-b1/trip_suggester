/**
 * Wikidata enrichment layer — free, no API key required.
 *
 * Flow:
 *  1. Search for the place by name via the Wikidata Entity Search API.
 *  2. Run a SPARQL query on the best-matching Q-item to fetch:
 *     - English description
 *     - Inception / founding year
 *     - Heritage designation (UNESCO World Heritage Site flag)
 *     - Cultural / historical tags
 */

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const ENTITY_SEARCH   = "https://www.wikidata.org/w/api.php";
const USER_AGENT      = "TripPlanner/1.0 (educational project)";

/** Small delay to avoid Wikidata API rate limits during batch enrichment. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Lightweight Wikidata result for pre-scan scoring — only entity identity and
 * UNESCO status. Fetched for all candidates before scoring and cached as
 * source "wikidata-mini" (30 days) in PoiEnrichCache.
 */
export type WikidataMini = {
  wikidataId: string;
  isUnescoSite: boolean;
};

const MINI_SPARQL = (qId: string) => `
SELECT DISTINCT ?heritageSite WHERE {
  BIND(wd:${qId} AS ?item)
  OPTIONAL { ?item wdt:P1435 ?heritageSite }
}
LIMIT 5
`.trim();

/**
 * Lightweight pre-scan: entity search + UNESCO-only SPARQL.
 * Returns null when no Wikidata entry can be found.
 */
export async function fetchWikidataMini(
  name: string,
  cityName?: string,
): Promise<WikidataMini | null> {
  try {
    const nameLC = name.toLowerCase();
    const cityLC = cityName?.toLowerCase() ?? "";
    const needsCityQualifier = cityName && !nameLC.includes(cityLC);
    const searchQuery = needsCityQualifier ? `${name} ${cityName}` : name;
    const qId = needsCityQualifier
      ? (await findQId(searchQuery) ?? await findQId(name))
      : await findQId(name);
    if (!qId) return null;

    type MiniSparqlResponse = { results: { bindings: Array<{ heritageSite?: { value: string } }> } };
    const res = await fetch(
      `${SPARQL_ENDPOINT}?query=${encodeURIComponent(MINI_SPARQL(qId))}&format=json`,
      { headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" } },
    );
    if (!res.ok) return { wikidataId: qId, isUnescoSite: false };

    const data = (await res.json()) as MiniSparqlResponse;
    const heritageUris = data.results.bindings.map((r) => r.heritageSite?.value ?? "");
    const unescoSite = heritageUris.some(isUnesco);

    return { wikidataId: qId, isUnescoSite: unescoSite };
  } catch {
    return null;
  }
}

export type WikidataEnrichment = {
  wikidataId: string;
  description?: string;
  inceptionYear?: number;
  isUnescoSite: boolean;
  culturalTags: string[];
  imageUrl?: string;
};

// ─── Entity search ────────────────────────────────────────────────────────────

type EntitySearchResult = {
  search: Array<{
    id: string;
    label?: string;
    description?: string;
    match?: { language?: string };
  }>;
};

async function findQIdInLang(name: string, language: string): Promise<string | null> {
  const url = new URL(ENTITY_SEARCH);
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("search", name);
  url.searchParams.set("language", language);
  url.searchParams.set("type", "item");
  url.searchParams.set("limit", "5");
  url.searchParams.set("format", "json");

  // Retry with exponential backoff on rate-limit (429)
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });

    if (res.status === 429) {
      // Rate limited — wait and retry
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) return null;

    // Handle rate-limit text responses (Wikidata sometimes returns plaintext)
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) return null;

    const data = (await res.json()) as EntitySearchResult;
    return data.search?.[0]?.id ?? null;
  }
  return null; // All retries exhausted
}

/**
 * Search for a Wikidata QID across multiple languages.
 * Many POIs (especially in Croatia, Italy, etc.) have local-language names
 * that won't match in English. We try en first, then common European languages.
 */
async function findQId(name: string): Promise<string | null> {
  // Try English first (most common)
  const en = await findQIdInLang(name, "en");
  if (en) return en;
  // Try other common languages for European travel destinations
  for (const lang of ["de", "hr", "it", "fr", "es", "nl", "pt"]) {
    await sleep(250); // Rate-limit protection for Wikidata API
    const qid = await findQIdInLang(name, lang);
    if (qid) return qid;
  }
  return null;
}

// ─── SPARQL detail query ──────────────────────────────────────────────────────

type SparqlRow = {
  desc?: { value: string };
  inception?: { value: string };     // ISO date string
  heritageSite?: { value: string };  // entity URI
  instanceOf?: { value: string };
  partOf?: { value: string };
  image?: { value: string };
};

type SparqlResponse = {
  results: { bindings: SparqlRow[] };
};

/**
 * P1435 = "heritage designation"
 * Q9259  = "UNESCO World Heritage Site"
 * Q18537310 = "UNESCO World Heritage List"
 */
const SPARQL_QUERY = (qId: string) => `
SELECT DISTINCT ?desc ?inception ?heritageSite ?instanceOf ?partOf ?image WHERE {
  BIND(wd:${qId} AS ?item)
  OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item wdt:P1435 ?heritageSite }
  OPTIONAL { ?item wdt:P31 ?instanceOf }
  OPTIONAL { ?item wdt:P361 ?partOf }
  OPTIONAL { ?item wdt:P18 ?image }
}
LIMIT 10
`.trim();

function extractYear(isoDate: string): number | undefined {
  const m = isoDate.match(/^(-?\d{4})/);
  return m ? parseInt(m[1], 10) : undefined;
}

function isUnesco(heritageSite?: string): boolean {
  if (!heritageSite) return false;
  return (
    heritageSite.includes("Q9259") ||          // UNESCO WH Site
    heritageSite.includes("Q18537310")         // UNESCO WH List
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function enrichWithWikidata(
  name: string,
  cityName?: string,
): Promise<WikidataEnrichment | null> {
  try {
    // Append city name to improve entity search accuracy, but skip if
    // the name already contains the city name (e.g. "Arena Pula" + "Pula").
    const nameLC = name.toLowerCase();
    const cityLC = cityName?.toLowerCase() ?? "";
    const needsCityQualifier = cityName && !nameLC.includes(cityLC);
    const searchQuery = needsCityQualifier ? `${name} ${cityName}` : name;
    const qId = needsCityQualifier
      ? (await findQId(searchQuery) ?? await findQId(name))
      : await findQId(name);
    if (!qId) return null;

    const sparql = SPARQL_QUERY(qId);
    let data: SparqlResponse | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(
        `${SPARQL_ENDPOINT}?query=${encodeURIComponent(sparql)}&format=json`,
        { headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" } },
      );
      if (res.status === 429) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      data = (await res.json()) as SparqlResponse;
      break;
    }
    if (!data) return null;
    const rows = data.results.bindings;
    if (rows.length === 0) return null;

    const first = rows[0];
    const description = first.desc?.value;
    const inceptionYear = first.inception
      ? extractYear(first.inception.value)
      : undefined;

    // Collect all heritage designations across rows
    const heritageUris = rows.map((r) => r.heritageSite?.value ?? "");
    const unescoSite = heritageUris.some(isUnesco);

    // Build cultural tag list from instanceOf / partOf URIs
    const tagUris = new Set([
      ...rows.map((r) => r.instanceOf?.value ?? ""),
      ...rows.map((r) => r.partOf?.value ?? ""),
    ]);
    // Translate known Q-ids to human-readable tags
    const knownTags: Record<string, string> = {
      Q33506:  "museum",
      Q23413:  "castle",
      Q839954: "archaeological site",
      Q44613:  "monastery",
      Q16560:  "palace",
      Q23442:  "island",
      Q182065: "mausoleum",
      Q16970:  "church",
      Q16748:  "synagogue",
      Q32815:  "mosque",
      Q38723:  "university",
      Q1081138:"cultural landscape",
    };
    const culturalTags = Array.from(tagUris)
      .map((uri) => {
        const qMatch = uri.match(/Q(\d+)$/);
        return qMatch ? knownTags[`Q${qMatch[1]}`] : undefined;
      })
      .filter((t): t is string => !!t);

    // Extract Wikipedia image URL (P18 → Commons file URL)
    const imageRow = rows.find((r) => r.image?.value);
    const imageUrl = imageRow?.image?.value ?? undefined;
    // Convert Commons file URL to a usable thumbnail URL
    // Wikidata returns: http://commons.wikimedia.org/wiki/Special:FilePath/Filename.jpg
    // We can append ?width=800 to get a reasonable size
    const wikiPhotoUrl = imageUrl ? `${imageUrl}?width=800` : undefined;

    return { wikidataId: qId, description, inceptionYear, isUnescoSite: unescoSite, culturalTags, imageUrl: wikiPhotoUrl };
  } catch {
    return null;
  }
}
