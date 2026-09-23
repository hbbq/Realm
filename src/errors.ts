export class DomainError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function requireValue(condition: unknown, code: string, message: string, statusCode = 400): asserts condition {
  if (!condition) throw new DomainError(statusCode, code, message);
}
