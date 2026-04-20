import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  accessService: () => ({}),
}));

async function createApp(actor: Record<string, unknown> = { type: "none", source: "none" }) {
  const [{ errorHandler }, { meRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/me.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", meRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("GET /api/me", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 401 when no token is provided", async () => {
    const app = await createApp({ type: "none", source: "none" });
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Authentication required" });
  });

  it("returns board payload with kind=board for a board-key actor", async () => {
    const actor = {
      type: "board",
      userId: "user-abc",
      userName: "Alice",
      userEmail: "alice@example.com",
      isInstanceAdmin: false,
      companyIds: ["company-1", "company-2"],
      source: "board_key",
    };
    const app = await createApp(actor);
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      kind: "board",
      userId: "user-abc",
      userName: "Alice",
      userEmail: "alice@example.com",
      isInstanceAdmin: false,
      companyIds: ["company-1", "company-2"],
      source: "board_key",
    });
  });

  it("returns agent payload with kind=agent for an agent-key actor", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-uuid",
      name: "My Agent",
      companyId: "company-1",
      role: "worker",
      status: "active",
    });

    const actor = {
      type: "agent",
      agentId: "agent-uuid",
      companyId: "company-1",
      source: "agent_key",
    };
    const app = await createApp(actor);
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("agent");
    expect(res.body.id).toBe("agent-uuid");
    expect(res.body.name).toBe("My Agent");
    expect(mockAgentService.getById).toHaveBeenCalledWith("agent-uuid");
  });

  it("returns 404 when agent record is not found", async () => {
    mockAgentService.getById.mockResolvedValue(null);

    const actor = {
      type: "agent",
      agentId: "missing-uuid",
      companyId: "company-1",
      source: "agent_key",
    };
    const app = await createApp(actor);
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Agent not found" });
  });

  it("works for a local_implicit board actor (instance admin)", async () => {
    const actor = {
      type: "board",
      userId: "local-board",
      userName: "Local Board",
      userEmail: null,
      isInstanceAdmin: true,
      companyIds: [],
      source: "local_implicit",
    };
    const app = await createApp(actor);
    const res = await request(app).get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("board");
    expect(res.body.isInstanceAdmin).toBe(true);
  });
});
