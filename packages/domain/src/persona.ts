export const PERSONA_IDS = ["technical", "academic", "leadership", "impact"] as const;

export type PersonaId = (typeof PERSONA_IDS)[number];

export type PersonaPreset = {
  id: PersonaId;
  label: string;
  description: string;
  boostKinds: string[];
};

export const PERSONA_PRESETS: PersonaPreset[] = [
  {
    id: "technical",
    label: "Technical",
    description: "Weight projects, employment, and research when ranking evidence.",
    boostKinds: ["project", "employment", "research"],
  },
  {
    id: "academic",
    label: "Academic",
    description: "Weight research, education, and achievements for study or lab roles.",
    boostKinds: ["research", "education", "achievement"],
  },
  {
    id: "leadership",
    label: "Leadership",
    description: "Weight leadership, employment, and volunteering for people-facing roles.",
    boostKinds: ["leadership", "employment", "volunteering"],
  },
  {
    id: "impact",
    label: "Impact",
    description: "Weight outcomes, volunteering, and projects for mission-driven posts.",
    boostKinds: ["achievement", "volunteering", "project"],
  },
];

export function parsePersona(value: string | null | undefined): PersonaId | null {
  if (!value) return null;
  return PERSONA_IDS.includes(value as PersonaId) ? (value as PersonaId) : null;
}

export function personaBoostKinds(persona: PersonaId | null | undefined): string[] {
  if (!persona) return [];
  return PERSONA_PRESETS.find((item) => item.id === persona)?.boostKinds ?? [];
}
