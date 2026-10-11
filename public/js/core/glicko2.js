// Glicko-2 rating update (Mark Glickman, "Example of the Glicko-2 system", 2013), used for the
// player's puzzle rating: each puzzle is an opponent with its own rating.
//   update({ rating, rd, vol }, [{ rating, rd, score }], tau) -> { rating, rd, vol }
// score: 1 = solved, 0 = failed. Ratings on the usual Glicko scale (1500 default).

const SCALE = 173.7178;
const EPSILON = 0.000001;

export const DEFAULT_RATING = Object.freeze({ rating: 1000, rd: 350, vol: 0.06 });
export const MIN_RD = 45; // keep ratings responsive: a puzzle rating should keep moving
export const MAX_RD = 350;

const g = (phi) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu, muJ, phiJ) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

export function update(player, results, tau = 0.5) {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;

  if (!results.length) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: Math.min(MAX_RD, phiStar * SCALE), vol: sigma };
  }

  const opp = results.map((r) => ({ mu: (r.rating - 1500) / SCALE, phi: r.rd / SCALE, s: r.score }));
  const v = 1 / opp.reduce((sum, o) => {
    const e = E(mu, o.mu, o.phi);
    return sum + g(o.phi) ** 2 * e * (1 - e);
  }, 0);
  const deltaSum = opp.reduce((sum, o) => sum + g(o.phi) * (o.s - E(mu, o.mu, o.phi)), 0);
  const delta = v * deltaSum;

  // New volatility (Illinois algorithm, step 5 of the paper).
  const a = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (tau * tau);
  };
  let A = a;
  let B;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C;
    fB = fC;
  }
  const newSigma = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;
  return { rating: newMu * SCALE + 1500, rd: newPhi * SCALE, vol: newSigma };
}

// One puzzle attempt: the player's new rating, with RD kept within [MIN_RD, MAX_RD].
export function ratePuzzle(player, puzzleRating, solved, puzzleRd = 75) {
  const next = update(player, [{ rating: puzzleRating, rd: puzzleRd, score: solved ? 1 : 0 }]);
  if (![next.rating, next.rd, next.vol].every(Number.isFinite)) return { ...player }; // never store NaN
  return {
    rating: Math.min(3200, Math.max(100, Math.round(next.rating))),
    rd: Math.min(MAX_RD, Math.max(MIN_RD, next.rd)),
    vol: next.vol,
  };
}
