// Domain error hierarchy — no external imports.

/** Base class for domain-level errors. */
export abstract class DomainError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.cause = options?.cause;
  }
}

/** Thrown when entities/value objects fail validation. */
export class ValidationError extends DomainError {
  constructor(message: string, options?: { cause?: unknown; field?: string }) {
    super(
      options?.field ? `${message} (field: ${options.field})` : message,
      { cause: options?.cause },
    );
  }
}

/** Thrown for ordering/DFS resolution issues (cycles, gaps, etc.). */
export class OrderingError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
  }
}
