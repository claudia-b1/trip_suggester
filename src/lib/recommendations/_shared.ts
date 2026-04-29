import Anthropic from "@anthropic-ai/sdk";
import type { Category } from "@/lib/categories";

export type GenerateInput = { cityName: string };

export type RecommendedPoi = {
  name: string;
  category: Category;
  description: string;
  latitude: number;
  longitude: number;
};

export type RawPoi = Omit<RecommendedPoi, "category">;

const POI_TOOL: Anthropic.Tool = {
  name: "suggest_pois",
  description: "Return a list of suggested points of interest.",
  input_schema: {
    type: "object",
    properties: {
      pois: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string", description: "One short sentence." },
            latitude: { type: "number" },
            longitude: { type: "number" },
          },
          required: ["name", "description", "latitude", "longitude"],
        },
      },
    },
    required: ["pois"],
  },
};

export async function callClaudeForPois(
  systemPrompt: string,
  userPrompt: string,
): Promise<RawPoi[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    tools: [POI_TOOL],
    tool_choice: { type: "tool", name: "suggest_pois" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a tool_use block");
  }

  const input = toolUse.input as { pois?: unknown };
  if (!Array.isArray(input.pois)) {
    throw new Error("Model returned malformed pois");
  }

  const out: RawPoi[] = [];
  for (const raw of input.pois) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      typeof (raw as RawPoi).name !== "string" ||
      typeof (raw as RawPoi).description !== "string" ||
      typeof (raw as RawPoi).latitude !== "number" ||
      typeof (raw as RawPoi).longitude !== "number"
    ) {
      continue;
    }
    out.push(raw as RawPoi);
  }
  return out;
}
