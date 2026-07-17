import { describe, expect, it } from "vitest";
import { FEDERATED_HTTP_ROUTES } from "./federatedRoutes.js";

describe("federated dashboard routes", () => {
  it("allowlists only a machine-scoped session summary, never the aggregate dashboard", () => {
    expect(FEDERATED_HTTP_ROUTES).toContainEqual({ method: "GET", path: "/session-summaries" });
    expect(FEDERATED_HTTP_ROUTES.map((route) => route.path)).not.toContain("/session-dashboard");
  });
});
