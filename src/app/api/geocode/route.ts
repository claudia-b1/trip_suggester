import { NextResponse } from "next/server";

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

/**
 * GET /api/geocode?action=autocomplete&q=...&types=address|cities&country=FR
 *   → address or city autocomplete suggestions via Google Places / Mapbox
 *
 * GET /api/geocode?action=geocode&address=...&country=FR
 *   → geocode address to lat/lng
 *
 * GET /api/geocode?action=validate&lat=...&lng=...&country=France
 *   → check if lat/lng is within the given country
 *
 * GET /api/geocode?action=reverse&lat=...&lng=...
 *   → reverse geocode lat/lng to address, city, country
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  if (action === "autocomplete") {
    return handleAutocomplete(searchParams);
  }
  if (action === "geocode") {
    return handleGeocode(searchParams);
  }
  if (action === "validate") {
    return handleValidate(searchParams);
  }
  if (action === "reverse") {
    return handleReverse(searchParams);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// ── Autocomplete ────────────────────────────────────────────────────────────

async function handleAutocomplete(params: URLSearchParams) {
  const q = params.get("q");
  const types = params.get("types") ?? "address"; // "address" | "cities"
  const country = params.get("country") ?? "";

  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  // Try Google Places Autocomplete first
  if (GOOGLE_KEY) {
    try {
      const result = await googleAutocomplete(q, types, country);
      if (result) return NextResponse.json(result);
    } catch { /* fall through */ }
  }

  // Mapbox fallback
  if (MAPBOX_TOKEN) {
    try {
      const result = await mapboxAutocomplete(q, types, country);
      if (result) return NextResponse.json(result);
    } catch { /* fall through */ }
  }

  return NextResponse.json([]);
}

async function googleAutocomplete(q: string, types: string, country: string) {
  const googleTypes = types === "cities" ? "(cities)" : "address";

  const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  url.searchParams.set("input", q);
  url.searchParams.set("types", googleTypes);
  url.searchParams.set("key", GOOGLE_KEY!);
  if (country) {
    // Convert country name to ISO code for Google
    const code = await countryNameToCode(country);
    if (code) url.searchParams.set("components", `country:${code}`);
  }

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json() as {
    predictions?: Array<{
      place_id: string;
      description: string;
      structured_formatting?: { main_text: string; secondary_text: string };
    }>;
  };

  return (data.predictions ?? []).map((p) => ({
    placeId: p.place_id,
    description: p.description,
    mainText: p.structured_formatting?.main_text ?? p.description,
    secondaryText: p.structured_formatting?.secondary_text ?? "",
  }));
}

async function mapboxAutocomplete(q: string, types: string, country: string) {
  const mapboxTypes = types === "cities" ? "place" : "address,poi";
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`,
  );
  url.searchParams.set("types", mapboxTypes);
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("limit", "5");
  url.searchParams.set("access_token", MAPBOX_TOKEN!);
  if (country) {
    const code = await countryNameToCode(country);
    if (code) url.searchParams.set("country", code.toLowerCase());
  }

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const data = await res.json() as {
    features?: Array<{
      id: string;
      place_name: string;
      text: string;
      center: [number, number];
    }>;
  };

  return (data.features ?? []).map((f) => ({
    placeId: f.id,
    description: f.place_name,
    mainText: f.text,
    secondaryText: f.place_name.replace(f.text, "").replace(/^,\s*/, ""),
    lat: f.center[1],
    lng: f.center[0],
  }));
}

// ── Geocode (address / placeId → lat/lng) ───────────────────────────────────

async function handleGeocode(params: URLSearchParams) {
  const address = params.get("address");
  const placeId = params.get("placeId");
  const country = params.get("country") ?? "";

  if (!address && !placeId) {
    return NextResponse.json({ error: "address or placeId required" }, { status: 400 });
  }

  // Google geocode
  if (GOOGLE_KEY) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      if (placeId) {
        url.searchParams.set("place_id", placeId);
      } else {
        url.searchParams.set("address", address!);
        if (country) {
          const code = await countryNameToCode(country);
          if (code) url.searchParams.set("components", `country:${code}`);
        }
      }
      url.searchParams.set("key", GOOGLE_KEY);

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json() as {
          results?: Array<{
            geometry: { location: { lat: number; lng: number } };
            formatted_address: string;
            address_components?: Array<{
              long_name: string;
              short_name: string;
              types: string[];
            }>;
          }>;
        };
        const result = data.results?.[0];
        if (result) {
          // Extract city and country from address components
          let resolvedCity = "";
          let resolvedCountry = "";
          for (const comp of result.address_components ?? []) {
            if (comp.types.includes("locality")) resolvedCity = comp.long_name;
            if (comp.types.includes("administrative_area_level_1") && !resolvedCity) {
              resolvedCity = comp.long_name;
            }
            if (comp.types.includes("country")) resolvedCountry = comp.long_name;
          }

          return NextResponse.json({
            lat: result.geometry.location.lat,
            lng: result.geometry.location.lng,
            formattedAddress: result.formatted_address,
            city: resolvedCity,
            country: resolvedCountry,
          });
        }
      }
    } catch { /* fall through */ }
  }

  // Mapbox fallback
  if (MAPBOX_TOKEN && address) {
    try {
      const url = new URL(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`,
      );
      url.searchParams.set("limit", "1");
      url.searchParams.set("access_token", MAPBOX_TOKEN);

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json() as {
          features?: Array<{
            center: [number, number];
            place_name: string;
            context?: Array<{ id: string; text: string }>;
          }>;
        };
        const feature = data.features?.[0];
        if (feature) {
          const resolvedCity = feature.context?.find((c) => c.id.startsWith("place"))?.text ?? "";
          const resolvedCountry = feature.context?.find((c) => c.id.startsWith("country"))?.text ?? "";
          return NextResponse.json({
            lat: feature.center[1],
            lng: feature.center[0],
            formattedAddress: feature.place_name,
            city: resolvedCity,
            country: resolvedCountry,
          });
        }
      }
    } catch { /* fall through */ }
  }

  return NextResponse.json({ error: "Could not geocode address" }, { status: 404 });
}

// ── Validate lat/lng within country ─────────────────────────────────────────

async function handleValidate(params: URLSearchParams) {
  const lat = parseFloat(params.get("lat") ?? "");
  const lng = parseFloat(params.get("lng") ?? "");
  const country = params.get("country") ?? "";

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
  }

  // Basic lat/lng range check
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({
      valid: false,
      reason: "Coordinates out of range (lat: -90 to 90, lng: -180 to 180)",
    });
  }

  if (!country.trim()) {
    return NextResponse.json({ valid: true });
  }

  // Reverse geocode to check if the point is in the given country
  if (GOOGLE_KEY) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("latlng", `${lat},${lng}`);
      url.searchParams.set("result_type", "country");
      url.searchParams.set("key", GOOGLE_KEY);

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json() as {
          results?: Array<{
            address_components?: Array<{
              long_name: string;
              short_name: string;
              types: string[];
            }>;
          }>;
        };
        const result = data.results?.[0];
        if (result) {
          const countryComp = result.address_components?.find((c) =>
            c.types.includes("country"),
          );
          if (countryComp) {
            // Compare by ISO code to handle translations (e.g. "Nederland" vs "Netherlands" → both "NL")
            const userCode = await countryNameToCode(country.trim());
            const detectedCode = countryComp.short_name.toUpperCase();
            const matches =
              (userCode != null && userCode === detectedCode) ||
              countryComp.long_name.toLowerCase() === country.trim().toLowerCase() ||
              countryComp.short_name.toLowerCase() === country.trim().toLowerCase();
            return NextResponse.json({
              valid: matches,
              detectedCountry: countryComp.long_name,
              reason: matches
                ? undefined
                : `Coordinates are in ${countryComp.long_name}, not ${country.trim()}`,
            });
          }
        }
      }
    } catch { /* fall through */ }
  }

  // Mapbox fallback — reverse geocode
  if (MAPBOX_TOKEN) {
    try {
      const url = new URL(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`,
      );
      url.searchParams.set("types", "country");
      url.searchParams.set("limit", "1");
      url.searchParams.set("access_token", MAPBOX_TOKEN);

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json() as {
          features?: Array<{ text: string; properties?: { short_code?: string } }>;
        };
        const feature = data.features?.[0];
        if (feature) {
          // Compare by ISO code to handle translations
          const userCode = await countryNameToCode(country.trim());
          const detectedCode = feature.properties?.short_code?.toUpperCase() ?? "";
          const matches =
            (userCode != null && userCode === detectedCode) ||
            feature.text.toLowerCase() === country.trim().toLowerCase() ||
            feature.properties?.short_code?.toLowerCase() === country.trim().toLowerCase();
          return NextResponse.json({
            valid: matches,
            detectedCountry: feature.text,
            reason: matches
              ? undefined
              : `Coordinates are in ${feature.text}, not ${country.trim()}`,
          });
        }
      }
    } catch { /* fall through */ }
  }

  // If we can't validate, assume valid
  return NextResponse.json({ valid: true });
}

// ── Reverse geocode (lat/lng → address) ───────────────────────────────────────

async function handleReverse(params: URLSearchParams) {
  const lat = parseFloat(params.get("lat") ?? "");
  const lng = parseFloat(params.get("lng") ?? "");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
  }

  // Google reverse geocode
  if (GOOGLE_KEY) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("latlng", `${lat},${lng}`);
      url.searchParams.set("key", GOOGLE_KEY);

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json() as {
          results?: Array<{
            formatted_address: string;
            address_components?: Array<{
              long_name: string;
              short_name: string;
              types: string[];
            }>;
          }>;
        };
        const result = data.results?.[0];
        if (result) {
          let resolvedCity = "";
          let resolvedCountry = "";
          for (const comp of result.address_components ?? []) {
            if (comp.types.includes("locality")) resolvedCity = comp.long_name;
            if (comp.types.includes("administrative_area_level_1") && !resolvedCity) {
              resolvedCity = comp.long_name;
            }
            if (comp.types.includes("country")) resolvedCountry = comp.long_name;
          }
          return NextResponse.json({
            address: result.formatted_address,
            city: resolvedCity,
            country: resolvedCountry,
          });
        }
      }
    } catch { /* fall through */ }
  }

  // Mapbox fallback
  if (MAPBOX_TOKEN) {
    try {
      const url = new URL(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`,
      );
      url.searchParams.set("limit", "1");
      url.searchParams.set("access_token", MAPBOX_TOKEN);

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json() as {
          features?: Array<{
            place_name: string;
            text: string;
            context?: Array<{ id: string; text: string }>;
          }>;
        };
        const feature = data.features?.[0];
        if (feature) {
          const resolvedCity = feature.context?.find((c) => c.id.startsWith("place"))?.text ?? "";
          const resolvedCountry = feature.context?.find((c) => c.id.startsWith("country"))?.text ?? "";
          return NextResponse.json({
            address: feature.place_name,
            city: resolvedCity,
            country: resolvedCountry,
          });
        }
      }
    } catch { /* fall through */ }
  }

  return NextResponse.json({ error: "Could not reverse geocode" }, { status: 404 });
}

// ── Country name → ISO 3166-1 alpha-2 code ─────────────────────────────────

const COUNTRY_CODES: Record<string, string> = {
  afghanistan: "AF", albania: "AL", algeria: "DZ", andorra: "AD", angola: "AO",
  argentina: "AR", armenia: "AM", australia: "AU", austria: "AT", azerbaijan: "AZ",
  bahamas: "BS", bahrain: "BH", bangladesh: "BD", barbados: "BB", belarus: "BY",
  belgium: "BE", belize: "BZ", benin: "BJ", bhutan: "BT", bolivia: "BO",
  "bosnia and herzegovina": "BA", botswana: "BW", brazil: "BR", brunei: "BN",
  bulgaria: "BG", "burkina faso": "BF", burundi: "BI", cambodia: "KH", cameroon: "CM",
  canada: "CA", "cape verde": "CV", chad: "TD", chile: "CL", china: "CN",
  colombia: "CO", comoros: "KM", congo: "CG", "costa rica": "CR", croatia: "HR",
  cuba: "CU", cyprus: "CY", "czech republic": "CZ", czechia: "CZ", denmark: "DK",
  djibouti: "DJ", "dominican republic": "DO", ecuador: "EC", egypt: "EG",
  "el salvador": "SV", "equatorial guinea": "GQ", eritrea: "ER", estonia: "EE",
  eswatini: "SZ", ethiopia: "ET", fiji: "FJ", finland: "FI", france: "FR",
  gabon: "GA", gambia: "GM", georgia: "GE", germany: "DE", ghana: "GH",
  greece: "GR", grenada: "GD", guatemala: "GT", guinea: "GN", guyana: "GY",
  haiti: "HT", honduras: "HN", hungary: "HU", iceland: "IS", india: "IN",
  indonesia: "ID", iran: "IR", iraq: "IQ", ireland: "IE", israel: "IL",
  italy: "IT", "ivory coast": "CI", jamaica: "JM", japan: "JP", jordan: "JO",
  kazakhstan: "KZ", kenya: "KE", kuwait: "KW", kyrgyzstan: "KG", laos: "LA",
  latvia: "LV", lebanon: "LB", lesotho: "LS", liberia: "LR", libya: "LY",
  liechtenstein: "LI", lithuania: "LT", luxembourg: "LU", madagascar: "MG",
  malawi: "MW", malaysia: "MY", maldives: "MV", mali: "ML", malta: "MT",
  mauritania: "MR", mauritius: "MU", mexico: "MX", moldova: "MD", monaco: "MC",
  mongolia: "MN", montenegro: "ME", morocco: "MA", mozambique: "MZ", myanmar: "MM",
  namibia: "NA", nepal: "NP", netherlands: "NL", "new zealand": "NZ", nicaragua: "NI",
  niger: "NE", nigeria: "NG", "north korea": "KP", "north macedonia": "MK",
  norway: "NO", oman: "OM", pakistan: "PK", palestine: "PS", panama: "PA",
  "papua new guinea": "PG", paraguay: "PY", peru: "PE", philippines: "PH",
  poland: "PL", portugal: "PT", qatar: "QA", romania: "RO", russia: "RU",
  rwanda: "RW", "saudi arabia": "SA", senegal: "SN", serbia: "RS",
  "sierra leone": "SL", singapore: "SG", slovakia: "SK", slovenia: "SI",
  somalia: "SO", "south africa": "ZA", "south korea": "KR", "south sudan": "SS",
  spain: "ES", "sri lanka": "LK", sudan: "SD", suriname: "SR", sweden: "SE",
  switzerland: "CH", syria: "SY", taiwan: "TW", tajikistan: "TJ", tanzania: "TZ",
  thailand: "TH", togo: "TG", "trinidad and tobago": "TT", tunisia: "TN",
  turkey: "TR", turkmenistan: "TM", uganda: "UG", ukraine: "UA",
  "united arab emirates": "AE", uae: "AE", "united kingdom": "GB", uk: "GB",
  "united states": "US", usa: "US", "united states of america": "US",
  uruguay: "UY", uzbekistan: "UZ", venezuela: "VE", vietnam: "VN", yemen: "YE",
  zambia: "ZM", zimbabwe: "ZW",
  // ── Common non-English names (Dutch, German, French, Spanish, Italian, Portuguese) ──
  // Dutch
  nederland: "NL", belgie: "BE", "belgië": "BE", duitsland: "DE", frankrijk: "FR",
  spanje: "ES", "italië": "IT", oostenrijk: "AT", zwitserland: "CH",
  denemarken: "DK", noorwegen: "NO", zweden: "SE", griekenland: "GR",
  turkije: "TR", "tsjechië": "CZ", "kroatië": "HR", "slovenië": "SI",
  "roemenië": "RO", "hongarije": "HU", polen: "PL", "verenigd koninkrijk": "GB",
  ierland: "IE", "verenigde staten": "US", "zuid-afrika": "ZA", marokko: "MA",
  egypte: "EG", "brazilië": "BR", "argentinië": "AR",
  "nieuw-zeeland": "NZ", "australië": "AU", "tsjechische republiek": "CZ",
  luxemburg: "LU", letland: "LV", litouwen: "LT", estland: "EE",
  // German
  deutschland: "DE", frankreich: "FR", spanien: "ES", italien: "IT",
  "österreich": "AT", schweiz: "CH", niederlande: "NL", belgien: "BE",
  "dänemark": "DK", norwegen: "NO", schweden: "SE", griechenland: "GR",
  "türkei": "TR", tschechien: "CZ", kroatien: "HR", slowenien: "SI",
  "rumänien": "RO", ungarn: "HU", "großbritannien": "GB",
  "vereinigte staaten": "US", "südafrika": "ZA", brasilien: "BR",
  argentinien: "AR", "neuseeland": "NZ", australien: "AU",
  // French
  allemagne: "DE", espagne: "ES", italie: "IT", autriche: "AT", suisse: "CH",
  "pays-bas": "NL", belgique: "BE", "norvège": "NO",
  "suède": "SE", finlande: "FI", "grèce": "GR", turquie: "TR",
  "tchéquie": "CZ", croatie: "HR", "slovénie": "SI", roumanie: "RO",
  hongrie: "HU", pologne: "PL", "royaume-uni": "GB", irlande: "IE",
  "états-unis": "US", "afrique du sud": "ZA", maroc: "MA", "égypte": "EG",
  "brésil": "BR", argentine: "AR", "nouvelle-zélande": "NZ", australie: "AU",
  // Spanish
  alemania: "DE", "españa": "ES", "países bajos": "NL",
  dinamarca: "DK", noruega: "NO", suecia: "SE",
  finlandia: "FI", grecia: "GR", "turquía": "TR",
  eslovenia: "SI", "rumanía": "RO", "hungría": "HU", polonia: "PL",
  "reino unido": "GB", irlanda: "IE", "estados unidos": "US",
  "sudáfrica": "ZA", marruecos: "MA", egipto: "EG",
  "nueva zelanda": "NZ",
  // Italian
  germania: "DE", spagna: "ES", "paesi bassi": "NL", belgio: "BE",
  danimarca: "DK", norvegia: "NO", svezia: "SE",
  turchia: "TR", "repubblica ceca": "CZ", croazia: "HR",
  ungheria: "HU", "stati uniti": "US",
  "sudafrica": "ZA", "nuova zelanda": "NZ",
  // Portuguese
  alemanha: "DE", "frança": "FR", "espanha": "ES", "itália": "IT",
  "suíça": "CH", holanda: "NL",
  "suécia": "SE", "finlândia": "FI",
  turquia: "TR", hungria: "HU", "polônia": "PL",
  "nova zelândia": "NZ", "austrália": "AU",
};

async function countryNameToCode(name: string): Promise<string | null> {
  const lower = name.trim().toLowerCase();
  // Direct lookup
  if (COUNTRY_CODES[lower]) return COUNTRY_CODES[lower];
  // Check if it's already a 2-letter code
  if (/^[A-Z]{2}$/i.test(name.trim())) return name.trim().toUpperCase();
  // Partial match
  for (const [key, code] of Object.entries(COUNTRY_CODES)) {
    if (key.startsWith(lower) || lower.startsWith(key)) return code;
  }
  return null;
}
