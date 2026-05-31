export interface CityProfile {
  priceMultiplier: number;
  requestsPerRound: number;
  label: string;
  emoji: string;
}

export const CITY_PROFILES: Record<string, CityProfile> = {
  muenchen:  { priceMultiplier: 1.15, requestsPerRound: 3, label: 'Premiummarkt',         emoji: '🏔' },
  nuernberg: { priceMultiplier: 0.85, requestsPerRound: 4, label: 'Verarbeitungszentrum', emoji: '⚙️' },
  stuttgart: { priceMultiplier: 1.18, requestsPerRound: 2, label: 'Bioregion',            emoji: '🌿' },
  frankfurt: { priceMultiplier: 1.20, requestsPerRound: 2, label: 'Finanzplatz',          emoji: '💼' },
  leipzig:   { priceMultiplier: 0.88, requestsPerRound: 4, label: 'Industriestadt',       emoji: '🏭' },
  koeln:     { priceMultiplier: 1.25, requestsPerRound: 2, label: 'Feinkostmetropole',    emoji: '🫙' },
  hamburg:   { priceMultiplier: 1.05, requestsPerRound: 4, label: 'Exporthafen',          emoji: '🚢' },
  berlin:    { priceMultiplier: 1.00, requestsPerRound: 3, label: 'Vielfalt',             emoji: '🏙' },
};
