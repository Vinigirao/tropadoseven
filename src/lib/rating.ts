/**
 * Compute expected score for player A against player B using Elo formula.
 */
export function expectedScore(ra: number, rb: number) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

function tanh(x: number) {
  const e1 = Math.exp(x);
  const e2 = Math.exp(-x);
  return (e1 - e2) / (e1 + e2);
}

/**
 * Compute Elo deltas for a match with multiple players and adjust
 * by performance relative to the average points scored in the match.
 *
 * @param playerIds Ordered array of player IDs participating in the match
 * @param pointsById Map of player ID to points scored
 * @param ratingById Map of player ID to current rating
 * @param cfg Elo parameters (kFactor, kPerf, scale)
 */
export function computeMatchDeltas(
  playerIds: string[],
  pointsById: Record<string, number>,
  ratingById: Record<string, number>,
  cfg: { kFactor: number; kPerf: number; scale: number },
) {
  // Average points across all players
  const avg = playerIds.reduce((sum, id) => sum + pointsById[id], 0) / playerIds.length;
  // Initialise deltas
  const deltas: Record<string, number> = {};
  playerIds.forEach(id => (deltas[id] = 0));
  // Pairwise Elo calculation
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const a = playerIds[i];
      const b = playerIds[j];
      const sa = pointsById[a] > pointsById[b] ? 1 : pointsById[a] < pointsById[b] ? 0 : 0.5;
      const ea = expectedScore(ratingById[a], ratingById[b]);
      const d = cfg.kFactor * (sa - ea);
      deltas[a] += d;
      deltas[b] -= d;
    }
  }
  // Adjust by performance vs average
  playerIds.forEach(id => {
    deltas[id] += cfg.kPerf * tanh((pointsById[id] - avg) / cfg.scale);
  });
  return deltas;
}