export class PosError extends Error {
  constructor(
    message: string,
    readonly code = "bad_request",
  ) {
    super(message);
    this.name = "PosError";
  }
}
