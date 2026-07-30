export function multiplierForCombo(combo: number): number {
  if (combo >= 10) return 4;
  if (combo >= 7) return 3;
  if (combo >= 5) return 2;
  return 1;
}

export function comboLabel(combo: number): string {
  const m = multiplierForCombo(combo);
  return m > 1 ? `×${m}` : "";
}

export function comboTier(combo: number): number {
  return multiplierForCombo(combo);
}
