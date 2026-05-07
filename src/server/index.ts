import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { ProjectStore } from "./storage/projectStore.js";
import { ProjectService } from "./projects/projectService.js";
import { WorkspaceService } from "./workspaces/workspaceService.js";
import { SessionEventHub } from "./realtime/sessionEventHub.js";
import { PiSessionService } from "./sessions/piSessionService.js";
import { listFileSuggestions } from "./workspaces/fileSuggestions.js";

const app = Fastify({ logger: true });
await app.register(fastifyWebsocket);

const projects = new ProjectService(new ProjectStore());
const workspaces = new WorkspaceService();
const eventHub = new SessionEventHub();
const sessions = new PiSessionService(eventHub);

app.get("/api/projects", async () => projects.list());

app.post<{ Body: { name?: string; path: string } }>("/api/projects", async (request, reply) => {
  try {
    return await projects.add(request.body);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/workspaces", async (request, reply) => {
  try {
    const project = await projects.requireProject(request.params.projectId);
    return await workspaces.list(project);
  } catch (error) {
    return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get<{ Querystring: { cwd?: string } }>("/api/sessions", async (request, reply) => {
  if (!request.query.cwd) return reply.code(400).send({ error: "cwd query parameter is required" });
  return sessions.list(request.query.cwd);
});

app.post<{ Body: { cwd: string } }>("/api/sessions", async (request, reply) => {
  try {
    return await sessions.start(request.body.cwd);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/messages", async (request, reply) => {
  try {
    return await sessions.messages(request.params.sessionId);
  } catch (error) {
    return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/status", async (request, reply) => {
  try {
    return await sessions.status(request.params.sessionId);
  } catch (error) {
    return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/commands", async (request, reply) => {
  try {
    return await sessions.commands(request.params.sessionId);
  } catch (error) {
    return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post<{ Params: { sessionId: string }; Body: { text: string } }>("/api/sessions/:sessionId/prompt", async (request, reply) => {
  try {
    await sessions.prompt(request.params.sessionId, request.body.text);
    return { accepted: true };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post<{ Params: { sessionId: string }; Body: { text: string } }>("/api/sessions/:sessionId/commands/run", async (request, reply) => {
  try {
    return await sessions.runCommand(request.params.sessionId, request.body.text);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post<{ Params: { sessionId: string }; Body: { requestId: string; value: string } }>("/api/sessions/:sessionId/commands/respond", async (request, reply) => {
  try {
    return await sessions.respondToCommand(request.params.sessionId, request.body.requestId, request.body.value);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/abort", async (request) => {
  await sessions.abort(request.params.sessionId);
  return { aborted: true };
});

app.post<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/close", async (request) => {
  sessions.close(request.params.sessionId);
  return { closed: true };
});

app.get<{ Params: { sessionId: string } }>("/api/sessions/:sessionId/events", { websocket: true }, (socket, request) => {
  eventHub.add(request.params.sessionId, socket);
});

app.get<{ Querystring: { cwd?: string; q?: string; kind?: "tracked" | "untracked" | "other" } }>("/api/files", async (request, reply) => {
  if (!request.query.cwd) return reply.code(400).send({ error: "cwd query parameter is required" });
  try {
    return await listFileSuggestions(request.query.cwd, request.query.q ?? "", request.query.kind);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

const clientDist = join(process.cwd(), "dist", "client");
if (existsSync(clientDist)) {
  await app.register(fastifyStatic, { root: clientDist });
  app.setNotFoundHandler((_request, reply) => reply.sendFile("index.html"));
}

const port = Number(process.env.PI_WEB_PORT ?? process.env.PORT ?? 3000);
const host = process.env.PI_WEB_HOST ?? "127.0.0.1";
await app.listen({ port, host });
