/** The test suite never touches the dev database. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/voiceops_test";
export const TEST_REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
