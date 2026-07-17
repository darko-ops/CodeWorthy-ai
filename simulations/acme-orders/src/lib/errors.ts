export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = "AppError";
  }
}

export const badRequest = (code: string, message?: string) =>
  new AppError(400, code, message);
export const notFound = (code: string, message?: string) =>
  new AppError(404, code, message);
export const conflict = (code: string, message?: string) =>
  new AppError(409, code, message);
