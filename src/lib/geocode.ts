/**
 * Shared geocoding utility — Google Places → Mapbox fallback.
 * Extracted from the /api/geocode route so it can be reused server-side
 * (e.g. by the activity coordinate resolver) without HTTP round-trips.
 */

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export type GeocodeResult = {
  lat: number;
  lng: number;
  formattedAddress: string;
  city?: string;
  country?: string;
};

// ── Country code lookup (duplicated from route for independence) ──────────

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
  nederland: "NL", belgie: "BE", "belgië": "BE", duitsland: "DE", frankrijk: "FR",
  spanje: "ES", "italië": "IT", oostenrijk: "AT", zwitserland: "CH",
  denemarken: "DK", noorwegen: "NO", zweden: "SE", griekenland: "GR",
  turkije: "TR", "tsjechië": "CZ", "kroatië": "HR", "slovenië": "SI",
  "roemenië": "RO", "hongarije": "HU", polen: "PL", "verenigd koninkrijk": "GB",
  ierland: "IE", "verenigde staten": "US", "zuid-afrika": "ZA", marokko: "MA",
  egypte: "EG", "brazilië": "BR", "argentinië": "AR",
  "nieuw-zeeland": "NZ", "australië": "AU",
  deutschland: "DE", frankreich: "FR", spanien: "ES", italien: "IT",
  "österreich": "AT", schweiz: "CH", niederlande: "NL", belgien: "BE",
  "dänemark": "DK", norwegen: "NO", schweden: "SE", griechenland: "GR",
  "türkei": "TR", tschechien: "CZ", kroatien: "HR", slowenien: "SI",
  "rumänien": "RO", ungarn: "HU", "großbritannien": "GB",
  "vereinigte staaten": "US", "südafrika": "ZA", brasilien: "BR",
  argentinien: "AR", "neuseeland": "NZ", australien: "AU",
  allemagne: "DE", espagne: "ES", italie: "IT", autriche: "AT", suisse: "CH",
  "pays-bas": "NL", belgique: "BE", "norvège": "NO",
  "suède": "SE", finlande: "FI", "grèce": "GR", turquie: "TR",
  croatie: "HR", roumanie: "RO", hongrie: "HU", pologne: "PL",
  "royaume-uni": "GB", irlande: "IE", "états-unis": "US",
  "afrique du sud": "ZA", maroc: "MA", "brésil": "BR",
  argentine: "AR", "nouvelle-zélande": "NZ", australie: "AU",
  alemania: "DE", "españa": "ES", "países bajos": "NL",
  dinamarca: "DK", noruega: "NO", suecia: "SE",
  grecia: "GR", "turquía": "TR", eslovenia: "SI",
  "rumanía": "RO", "hungría": "HU", polonia: "PL",
  "reino unido": "GB", irlanda: "IE", "estados unidos": "US",
  "sudáfrica": "ZA", marruecos: "MA", egipto: "EG",
  "nueva zelanda": "NZ",
  germania: "DE", spagna: "ES", "paesi bassi": "NL", belgio: "BE",
  danimarca: "DK", norvegia: "NO", svezia: "SE",
  turchia: "TR", croazia: "HR", ungheria: "HU", "stati uniti": "US",
  "nuova zelanda": "NZ",
  alemanha: "DE", "frança": "FR", "espanha": "ES", "itália": "IT",
  "suíça": "CH", holanda: "NL", "suécia": "SE",
  turquia: "TR", hungria: "HU", "polônia": "PL",
  "nova zelândia": "NZ", "austrália": "AU",
};

function countryNameToCode(name: string): string | null {
  const lower = name.trim().toLowerCase();
  if (COUNTRY_CODES[lower]) return COUNTRY_CODES[lower];
  if (/^[A-Z]{2}$/i.test(name.trim())) return name.trim().toUpperCase();
  for (const [key, code] of Object.entries(COUNTRY_CODES)) {
    if (key.startsWith(lower) || lower.startsWith(key)) return code;
  }
  return null;
}

// ── Main geocode function ────────────────────────────────────────────────────

/**
 * Geocode an address string using Google Geocoding API with Mapbox fallback.
 * Returns null if neither service can resolve the address.
 */
export async function geocodeAddress(
  address: string,
  country?: string,
): Promise<GeocodeResult | null> {
  // Google geocode
  if (GOOGLE_KEY) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("address", address);
      if (country) {
        const code = countryNameToCode(country);
        if (code) url.searchParams.set("components", `country:${code}`);
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
          let resolvedCity = "";
          let resolvedCountry = "";
          for (const comp of result.address_components ?? []) {
            if (comp.types.includes("locality")) resolvedCity = comp.long_name;
            if (comp.types.includes("administrative_area_level_1") && !resolvedCity) {
              resolvedCity = comp.long_name;
            }
            if (comp.types.includes("country")) resolvedCountry = comp.long_name;
          }
          return {
            lat: result.geometry.location.lat,
            lng: result.geometry.location.lng,
            formattedAddress: result.formatted_address,
            city: resolvedCity,
            country: resolvedCountry,
          };
        }
      }
    } catch { /* fall through to Mapbox */ }
  }

  // Mapbox fallback
  if (MAPBOX_TOKEN) {
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
          return {
            lat: feature.center[1],
            lng: feature.center[0],
            formattedAddress: feature.place_name,
            city: resolvedCity,
            country: resolvedCountry,
          };
        }
      }
    } catch { /* fall through */ }
  }

  return null;
}
