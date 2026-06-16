import "@testing-library/jest-dom/vitest";
import { inject } from "vitest";

const testDatabaseUrl = inject("TEST_DATABASE_URL" as never) as string | undefined;
if (typeof testDatabaseUrl === "string" && testDatabaseUrl.length > 0) {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.TEST_DATABASE_URL = testDatabaseUrl;
}
