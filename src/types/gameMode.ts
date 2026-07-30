export type PlayerCount = 1 | 2;

export const ROI_SOLO = { x0: 0.18, x1: 0.82 };
export const ROI_LEFT = { x0: 0, x1: 0.48 };
export const ROI_RIGHT = { x0: 0.52, x1: 1 };

export function activePlayers(count: PlayerCount): ("player1" | "player2")[] {
  return count === 1 ? ["player1"] : ["player1", "player2"];
}
