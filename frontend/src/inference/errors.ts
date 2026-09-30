/** Errors raised by the edge evaluator. Both are plain `Error`s so they survive `postMessage`. */

/** A request value cannot be interpreted (unknown key, wrong type, non-finite number…). */
export class FeatureInputError extends Error {
  /** Offending feature key(s), when known. */
  readonly features: string[];
  constructor(message: string, features: string[] = []) {
    super(message);
    this.name = 'FeatureInputError';
    this.features = features;
  }
}

/** `model.json` is not a portable model this evaluator understands. */
export class ModelFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelFormatError';
  }
}
