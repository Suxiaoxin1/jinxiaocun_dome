import { afterEach, describe, expect, it } from "vitest";
import { databasePoolMax } from "../../src/server/db";

const originalPoolMax = process.env.PG_POOL_MAX;

afterEach(() => {
  if (originalPoolMax === undefined) {
    delete process.env.PG_POOL_MAX;
  } else {
    process.env.PG_POOL_MAX = originalPoolMax;
  }
});

describe("database configuration", () => {
  it("uses a conservative default PostgreSQL pool size", () => {
    delete process.env.PG_POOL_MAX;

    expect(databasePoolMax()).toBe(10);
  });

  it("allows PostgreSQL pool size to be configured", () => {
    process.env.PG_POOL_MAX = "20";

    expect(databasePoolMax()).toBe(20);
  });
});
