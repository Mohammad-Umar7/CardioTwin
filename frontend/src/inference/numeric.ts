/**
 * Numeric primitives shared by every component. All arithmetic is float64 (JS `number`) except the
 * XGBoost split comparison, which XGBoost performs in float32 — hence `fround` (`Math.fround` rounds
 * to the nearest float32, ties to even, exactly like `portable.fround`).
 */

export const fround = Math.fround;

/** Logistic function `1 / (1 + e^{−z})` — written exactly as `portable.sigmoid`. */
export function sigmoid(z: number): number {
  return 1.0 / (1.0 + Math.exp(-z));
}

/** Log-odds of a probability — `portable.logit`. */
export function logit(p: number): number {
  return Math.log(p / (1.0 - p));
}
