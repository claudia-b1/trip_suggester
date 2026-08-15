/**
 * Shared types and parser for AI-generated city information.
 * Used by both the API route (server) and the CityInfoSection component (client).
 */

export const CATEGORY_DEFS = [
  { name: "General",                          icon: "🌍" },
  { name: "Geography & Layout",               icon: "🗺️" },
  { name: "History",                          icon: "📜" },
  { name: "Architecture & Urban Character",   icon: "🏛️" },
  { name: "Transport & Mobility",             icon: "🚌" },
  { name: "Local Culture & Etiquette",        icon: "🤝" },
  { name: "Tourism Patterns",                 icon: "📸" },
  { name: "Visitor Profile",                  icon: "👥" },
  { name: "Food Culture",                     icon: "🍽️" },
  { name: "Seasonal Atmosphere",              icon: "☀️" },
  { name: "Safety Overview",                  icon: "🛡️" },
  { name: "Cost / Expense Level",             icon: "💶" },
  { name: "Common Tourist Pitfalls",          icon: "⚠️" },
] as const;

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export type ParsedCategory = {
  name: string;
  icon: string;
  summary: string;
  confidence: ConfidenceLevel;
  dishes?: Array<{ name: string; description: string }>;
};

export type GeneratedCityInfo = {
  categories: ParsedCategory[];
  generatedAt: string; // ISO
};

export function parseAIResponse(text: string): ParsedCategory[] {
  const result: ParsedCategory[] = [];

  for (let i = 0; i < CATEGORY_DEFS.length; i++) {
    const def = CATEGORY_DEFS[i];
    const nextDef = CATEGORY_DEFS[i + 1];

    const escapedName = def.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const headerRe = new RegExp(
      `(?:^|\\n)#{0,3}\\s*\\*{0,2}${escapedName}\\*{0,2}\\s*\\n`,
      "i",
    );
    const match = headerRe.exec(text);
    if (!match) continue;

    const sectionStart = match.index + match[0].length;

    let sectionEnd = text.length;
    if (nextDef) {
      const nextEscaped = nextDef.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nextRe = new RegExp(
        `(?:^|\\n)#{0,3}\\s*\\*{0,2}${nextEscaped}\\*{0,2}\\s*\\n`,
        "i",
      );
      const nextMatch = nextRe.exec(text.slice(sectionStart));
      if (nextMatch) sectionEnd = sectionStart + nextMatch.index;
    }

    const section = text.slice(sectionStart, sectionEnd).trim();

    if (
      /not found\s*\(insufficient/i.test(section) &&
      !/summary:/i.test(section.slice(0, 80))
    ) {
      continue;
    }

    const summaryRe =
      /\*{0,2}Summary:\*{0,2}\s*([\s\S]*?)(?=\n\s*[*•-]\s|\n\s*\*{0,2}(?:Local dishes|Confidence)|$)/i;
    const summaryMatch = summaryRe.exec(section);
    const summary = summaryMatch?.[1]?.trim().replace(/\*+/g, "") ?? "";

    if (!summary || summary.length < 15 || /not found/i.test(summary)) continue;

    const confMatch = /\*{0,2}Confidence:\*{0,2}\s*(\w+)/i.exec(section);
    const confRaw = confMatch?.[1]?.toUpperCase() ?? "";
    const confidence: ConfidenceLevel = ["HIGH", "MEDIUM", "LOW"].includes(confRaw)
      ? (confRaw as ConfidenceLevel)
      : "UNKNOWN";

    let dishes: Array<{ name: string; description: string }> | undefined;
    if (def.name === "Food Culture") {
      const dishRe = /[-•]\s+\*{0,2}([^:*\n]+?)\*{0,2}:\s*([^\n]+)/g;
      const matches = [...section.matchAll(dishRe)].filter(
        (m) => !/(summary|confidence|give|local dish|try)/i.test(m[1]),
      );
      if (matches.length > 0) {
        dishes = matches.map((m) => ({
          name: m[1].trim().replace(/\*+/g, ""),
          description: m[2].trim().replace(/\*+/g, ""),
        }));
      }
    }

    result.push({ name: def.name, icon: def.icon, summary, confidence, dishes });
  }

  return result;
}
