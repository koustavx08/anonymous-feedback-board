/** Small helpers shared by the API and CLI. */

/** Cryptographically secure random bytes. */
export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

/** Clamp and validate a star rating coming from user input. */
export const assertValidRating = (rating: number): number => {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error(`Rating must be a whole number between 1 and 5, got ${rating}`);
  }
  return rating;
};

/** The contract stores free-form text; keep it to something a ledger should hold. */
export const MAX_MESSAGE_LENGTH = 280;

export const assertValidMessage = (message: string): string => {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    throw new Error('Feedback message cannot be empty');
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Feedback message must be at most ${MAX_MESSAGE_LENGTH} characters, got ${trimmed.length}`);
  }
  return trimmed;
};
