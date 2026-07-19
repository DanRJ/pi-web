import { describe, expect, it } from "vitest";
import { FEDERATED_HTTP_ROUTES } from "./federatedRoutes.js";

describe("federated dashboard routes", () => {
  it("allowlists machine-scoped session routes without proxying the aggregate dashboard", () => {
    expect(FEDERATED_HTTP_ROUTES).toContainEqual({ method: "GET", path: "/session-summaries" });
    expect(FEDERATED_HTTP_ROUTES).toContainEqual({ method: "PUT", path: "/sessions/:sessionId/name" });
    expect(FEDERATED_HTTP_ROUTES.map((route) => route.path)).not.toContain("/session-dashboard");
  });
});
