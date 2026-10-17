import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OverviewPage, summariseHours } from "./OverviewPage";

describe("summariseHours", () => {
  it("collapses consecutive identical days", () => {
    const hours = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "20:00" }));
    expect(summariseHours(hours)).toBe("Mon–Sat 09:00–20:00");
  });

  it("keeps different spans separate", () => {
    expect(
      summariseHours([
        { weekday: 1, opensAt: "09:00", closesAt: "18:00" },
        { weekday: 6, opensAt: "10:00", closesAt: "14:00" },
      ]),
    ).toBe("Mon 09:00–18:00, Sat 10:00–14:00");
  });
});

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("OverviewPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the business, health and services from the API", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/health")
        return json({ ok: true, db: "ok", redis: "ok", version: "0.1.0", time: new Date().toISOString() });
      if (url.endsWith("/services"))
        return json({
          services: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              name: "Car Wash",
              aliases: ["dhulai"],
              durationMin: 45,
              bufferMin: 15,
              pricePaise: 49900,
              resourceKind: "bay",
              active: true,
            },
          ],
        });
      return json({
        business: {
          id: "00000000-0000-4000-8000-000000000002",
          slug: "autocare",
          name: "AutoCare Service Center",
          timezone: "Asia/Kolkata",
          phone: null,
          city: "Bengaluru",
          hours: [{ weekday: 1, opensAt: "09:00", closesAt: "20:00" }],
        },
      });
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OverviewPage slug="autocare" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("AutoCare Service Center")).toBeInTheDocument();
    expect(await screen.findByText("Car Wash")).toBeInTheDocument();
    expect(screen.getByText("₹499")).toBeInTheDocument();
    expect(await screen.findByText("Database: ok")).toBeInTheDocument();
  });

  it("shows an error when services fail to load", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/services"))
        return json({ error: { code: "not_found", message: "Business not found" } }, 404);
      return json({}, 500);
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OverviewPage slug="nope" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Business not found");
  });
});
