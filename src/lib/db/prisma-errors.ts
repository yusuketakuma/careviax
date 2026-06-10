function readPrismaErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = error.code;
  return typeof code === 'string' ? code : null;
}

export function isPrismaErrorCode(error: unknown, code: string) {
  return readPrismaErrorCode(error) === code;
}

export function isPrismaUniqueConstraintError(error: unknown) {
  return isPrismaErrorCode(error, 'P2002');
}
