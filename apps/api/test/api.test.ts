import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { HealthResponseSchema, ServiceListResponseSchema, ApiErrorSchema } from "@voiceops/shared";
import { and, count, eq } from "drizzle-orm";
import { seed } from "../src/db/seed.js";
import { businessHours, businesses, resources, services, users } from "../src/db/schema.js";
import { makeTestApp } from "./helpers.js";

const { app, db, close } = makeTestApp();
afterAll(close);

describe("GET /health", () => {
  it("reports db and redis as ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(res.body);
    expect(body).toMatchObject({ ok: true, db: "ok", redis: "ok" });
  });

  it("echoes a provided request id and mints one otherwise", async () => {
    const withId = await request(app).get("/health").set("x-request-id", "call-1234-abcd");
    expect(withId.headers["x-request-id"]).toBe("call-1234-abcd");
    const without = await request(app).get("/health");
    expect(without.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("business routes", () => {
  it("returns AutoCare with Mon–Sat hours", async () => {
    const res = await request(app).get("/api/v1/businesses/autocare");
    expect(res.status).toBe(200);
    expect(res.body.business.name).toBe("AutoCare Service Center");
    expect(res.body.business.timezone).toBe("Asia/Kolkata");
    expect(res.body.business.hours).toHaveLength(6);
    expect(res.body.business.hours.map((h: { weekday: number }) => h.weekday)).not.toContain(0);
  });

  it("lists the 5 seeded services, validated by the shared schema", async () => {
    const res = await request(app).get("/api/v1/businesses/autocare/services");
    expect(res.status).toBe(200);
    const { services } = ServiceListResponseSchema.parse(res.body);
    expect(services.map((s) => s.name)).toEqual([
      "AC Service",
      "Car Wash",
      "General Service",
      "Oil Change",
      "Premium Detailing",
    ]);
    const wash = services.find((s) => s.name === "Car Wash");
    expect(wash?.aliases).toContain("dhulai");
    expect(wash?.pricePaise).toBe(49900);
  });

  it("returns 404 with a stable error code for an unknown business", async () => {
    const res = await request(app).get("/api/v1/businesses/no-such-shop/services");
    expect(res.status).toBe(404);
    const body = ApiErrorSchema.parse(res.body);
    expect(body.error.code).toBe("not_found");
    expect(body.requestId).toBeTruthy();
  });

  it("returns 400 for an invalid slug", async () => {
    const res = await request(app).get("/api/v1/businesses/BAD_SLUG!/services");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("route_not_found");
  });
});

describe("seed", () => {
  it("is idempotent", async () => {
    await seed(db);
    await seed(db);
    const [business] = await db.select().from(businesses).where(eq(businesses.slug, "autocare"));
    expect(business).toBeDefined();
    const id = business!.id;
    const countOf = async (table: typeof services | typeof businessHours | typeof resources, where = eq(table.businessId, id)) =>
      (await db.select({ n: count() }).from(table).where(where))[0]?.n;
    expect(await countOf(services)).toBe(5);
    expect(await countOf(businessHours)).toBe(6);
    expect(await countOf(resources)).toBe(2);
    const [owners] = await db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.businessId, id), eq(users.role, "owner")));
    expect(owners?.n).toBe(1);
  });

  it("enforces data rules in the database itself", async () => {
    const [business] = await db.select().from(businesses).where(eq(businesses.slug, "autocare"));
    await expect(
      db.insert(services).values({
        businessId: business!.id,
        name: "Broken",
        durationMin: 0,
        pricePaise: 100,
        resourceKind: "bay",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(businessHours).values({ businessId: business!.id, weekday: 7, opensAt: "09:00", closesAt: "10:00" }),
    ).rejects.toThrow();
  });
});
