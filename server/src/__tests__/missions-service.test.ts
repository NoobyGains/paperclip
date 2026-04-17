import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  createDb,
  activityLog,
  documentRevisions,
  documents,
  executionWorkspaces,
  instanceSettings,
  issueDocuments,
  issueRelations,
  issues,
  projectWorkspaces,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { documentService } from "../services/documents.ts";
import { instanceSettingsService } from "../services/instance-settings.ts";
import { missionService } from "../services/missions.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres mission service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("missionService.decompose", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-missions-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueRelations);
    await db.delete(activityLog);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(instanceSettings);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedMission() {
    const companyId = randomUUID();
    const projectId = randomUUID();
    const projectWorkspaceId = randomUUID();
    const executionWorkspaceId = randomUUID();
    const missionIssueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await instanceSettingsService(db).updateExperimental({ enableIsolatedWorkspaces: true });

    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Mission project",
      status: "in_progress",
    });
    await db.insert(projectWorkspaces).values({
      id: projectWorkspaceId,
      companyId,
      projectId,
      name: "Primary workspace",
      isPrimary: true,
      sharedWorkspaceKey: "primary",
    });
    await db.insert(executionWorkspaces).values({
      id: executionWorkspaceId,
      companyId,
      projectId,
      projectWorkspaceId,
      mode: "isolated_workspace",
      strategyType: "git_worktree",
      name: "Mission worktree",
      status: "active",
      providerType: "git_worktree",
      providerRef: `/tmp/${executionWorkspaceId}`,
    });
    await db.insert(issues).values({
      id: missionIssueId,
      companyId,
      projectId,
      projectWorkspaceId,
      title: "Mission issue",
      status: "in_progress",
      priority: "medium",
      billingCode: "mission:test",
      originKind: "mission",
      executionWorkspaceId,
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceSettings: {
        mode: "isolated_workspace",
        workspaceRuntime: { profile: "agent" },
      },
    });

    const docs = documentService(db);
    await docs.upsertIssueDocument({
      issueId: missionIssueId,
      key: "validation-contract",
      title: "Validation Contract",
      format: "markdown",
      body: JSON.stringify({
        assertions: [
          {
            id: "VAL-MISSION-001",
            title: "Feature one works",
            user_value: "User can rely on feature one.",
            scope: "mission",
            setup: "Seeded company.",
            steps: ["Run feature one check"],
            oracle: "The check passes.",
            tooling: ["unit_test"],
            evidence: [{ kind: "test_output", description: "Unit test output", required: true }],
            claimed_by: ["FEAT-MISSION-001"],
            status: "claimed",
          },
          {
            id: "VAL-MISSION-002",
            title: "Feature two works",
            user_value: "User can rely on feature two.",
            scope: "mission",
            setup: "Seeded company.",
            steps: ["Run feature two check"],
            oracle: "The check passes.",
            tooling: ["api_call"],
            evidence: [{ kind: "api_response", description: "API response", required: true }],
            claimed_by: ["FEAT-MISSION-002"],
            status: "claimed",
          },
        ],
      }),
    });
    await docs.upsertIssueDocument({
      issueId: missionIssueId,
      key: "features",
      title: "Features",
      format: "markdown",
      body: JSON.stringify({
        milestones: [
          {
            id: "MILESTONE-MISSION-001",
            title: "Foundation",
            summary: "Create the first mission feature set.",
            features: [
              {
                id: "FEAT-MISSION-001",
                title: "Feature one",
                kind: "original",
                summary: "Implement feature one.",
                acceptance_criteria: ["Feature one is implemented."],
                claimed_assertion_ids: ["VAL-MISSION-001"],
                status: "planned",
              },
              {
                id: "FEAT-MISSION-002",
                title: "Feature two",
                kind: "original",
                summary: "Implement feature two.",
                acceptance_criteria: ["Feature two is implemented."],
                claimed_assertion_ids: ["VAL-MISSION-002"],
                status: "planned",
              },
            ],
          },
        ],
      }),
    });

    return { companyId, projectId, projectWorkspaceId, executionWorkspaceId, missionIssueId };
  }

  it("creates ordered child issues with blockers and inherited workspace", async () => {
    const seeded = await seedMission();
    const result = await missionService(db).decompose(seeded.missionIssueId, { actor: {} });

    expect(result.milestoneCount).toBe(1);
    expect(result.featureCount).toBe(2);
    expect(result.validationCount).toBe(1);
    expect(result.fixLoopCount).toBe(1);
    expect(result.createdIssueIds).toHaveLength(5);

    const generated = await db
      .select()
      .from(issues)
      .where(eq(issues.companyId, seeded.companyId));
    const childIssues = generated.filter((issue) => issue.id !== seeded.missionIssueId);
    expect(childIssues).toHaveLength(5);
    expect(childIssues.every((issue) => issue.projectId === seeded.projectId)).toBe(true);
    expect(childIssues.every((issue) => issue.projectWorkspaceId === seeded.projectWorkspaceId)).toBe(true);
    expect(childIssues.every((issue) => issue.executionWorkspaceId === seeded.executionWorkspaceId)).toBe(true);
    expect(childIssues.every((issue) => issue.executionWorkspacePreference === "reuse_existing")).toBe(true);
    expect(childIssues.every((issue) => issue.billingCode === "mission:test")).toBe(true);

    const featureIds = childIssues
      .filter((issue) => issue.originKind === "mission_feature")
      .map((issue) => issue.id)
      .sort();
    const validationIssue = childIssues.find((issue) => issue.originKind === "mission_validation");
    const fixLoopIssue = childIssues.find((issue) => issue.originKind === "mission_fix_loop");
    expect(validationIssue).toBeTruthy();
    expect(fixLoopIssue).toBeTruthy();

    const validationBlockers = await db
      .select({ blockerId: issueRelations.issueId })
      .from(issueRelations)
      .where(and(eq(issueRelations.companyId, seeded.companyId), eq(issueRelations.relatedIssueId, validationIssue!.id)));
    expect(validationBlockers.map((row) => row.blockerId).sort()).toEqual(featureIds);

    const fixLoopBlockers = await db
      .select({ blockerId: issueRelations.issueId })
      .from(issueRelations)
      .where(and(eq(issueRelations.companyId, seeded.companyId), eq(issueRelations.relatedIssueId, fixLoopIssue!.id)));
    expect(fixLoopBlockers.map((row) => row.blockerId)).toEqual([validationIssue!.id]);
  });

  it("is idempotent across repeated decomposition runs", async () => {
    const seeded = await seedMission();
    await missionService(db).decompose(seeded.missionIssueId, { actor: {} });
    const second = await missionService(db).decompose(seeded.missionIssueId, { actor: {} });

    expect(second.createdIssueIds).toHaveLength(0);
    const generated = await db
      .select()
      .from(issues)
      .where(eq(issues.companyId, seeded.companyId));
    expect(generated.filter((issue) => issue.id !== seeded.missionIssueId)).toHaveLength(5);

    const relations = await db
      .select()
      .from(issueRelations)
      .where(eq(issueRelations.companyId, seeded.companyId));
    expect(relations).toHaveLength(5);
    expect(new Set(relations.map((relation) => `${relation.issueId}:${relation.relatedIssueId}`)).size).toBe(5);
  });

  it("creates bounded fix issues from blocking validation findings during advance", async () => {
    const seeded = await seedMission();
    await missionService(db).decompose(seeded.missionIssueId, { actor: {} });
    const generated = await db.select().from(issues).where(eq(issues.companyId, seeded.companyId));
    const validationIssue = generated.find((issue) => issue.originKind === "mission_validation");
    expect(validationIssue).toBeTruthy();
    await db.update(issues).set({ status: "done", completedAt: new Date() }).where(eq(issues.id, validationIssue!.id));

    await documentService(db).upsertIssueDocument({
      issueId: seeded.missionIssueId,
      key: "validation-report-round-1",
      title: "Validation Report Round 1",
      format: "markdown",
      body: JSON.stringify({
        round: 1,
        validator_role: "scrutiny_validator",
        summary: "One blocking finding found.",
        findings: [
          {
            id: "FINDING-MISSION-001",
            severity: "blocking",
            assertion_id: "VAL-MISSION-001",
            title: "Feature one does not satisfy the contract",
            evidence: ["Unit test output linked in validation issue comment."],
            repro_steps: ["Run feature one check."],
            expected: "Feature one check passes.",
            actual: "Feature one check fails.",
            recommended_fix_scope: "Fix feature one behavior only.",
            status: "open",
          },
        ],
      }),
    });

    const result = await missionService(db).advance(seeded.missionIssueId, {
      actor: { actorType: "system", actorId: "test" },
      heartbeat: { wakeup: async () => null },
    });

    expect(result.details.fixCreation).toMatchObject({ createdIssueIds: expect.any(Array) });
    const afterAdvance = await db.select().from(issues).where(eq(issues.companyId, seeded.companyId));
    const fixIssue = afterAdvance.find((issue) => issue.originId === `${seeded.missionIssueId}:feature:fix:FINDING-MISSION-001`);
    expect(fixIssue).toBeTruthy();
    expect(fixIssue?.title).toBe("Mission fix: Feature one does not satisfy the contract");
    expect(fixIssue?.description).toContain("Acceptance criteria:");
    expect(fixIssue?.description).toContain("Fix feature one behavior only.");

    const fixLoopIssue = afterAdvance.find((issue) => issue.originKind === "mission_fix_loop");
    const fixLoopBlockers = await db
      .select({ blockerId: issueRelations.issueId })
      .from(issueRelations)
      .where(and(eq(issueRelations.companyId, seeded.companyId), eq(issueRelations.relatedIssueId, fixLoopIssue!.id)));
    expect(fixLoopBlockers.map((row) => row.blockerId)).toContain(fixIssue!.id);

    const second = await missionService(db).advance(seeded.missionIssueId, {
      actor: { actorType: "system", actorId: "test" },
      heartbeat: { wakeup: async () => null },
    });
    expect((second.details.fixCreation as { createdIssueIds: string[] }).createdIssueIds).toHaveLength(0);
  });

  it("records non-blocking finding waivers in the decision log", async () => {
    const seeded = await seedMission();
    await documentService(db).upsertIssueDocument({
      issueId: seeded.missionIssueId,
      key: "validation-report-round-1",
      title: "Validation Report Round 1",
      format: "markdown",
      body: JSON.stringify({
        round: 1,
        validator_role: "user_testing_validator",
        summary: "One non-blocking finding found.",
        findings: [
          {
            id: "FINDING-MISSION-002",
            severity: "non_blocking",
            assertion_id: "VAL-MISSION-001",
            title: "Copy could be clearer",
            evidence: ["Screenshot attached in validation comment."],
            repro_steps: ["Open the mission summary."],
            expected: "Copy is clear.",
            actual: "Copy is understandable but terse.",
            status: "open",
          },
        ],
      }),
    });

    const result = await missionService(db).waiveFinding(seeded.missionIssueId, {
      findingId: "FINDING-MISSION-002",
      rationale: "Acceptable for MVP because the workflow is still clear.",
      actor: { runId: "run-1" },
    });
    expect(result.waived).toBe(true);

    const decisionLog = await documentService(db).getIssueDocumentByKey(seeded.missionIssueId, "decision-log");
    expect(decisionLog?.body).toContain("paperclip:mission-finding-waiver:FINDING-MISSION-002");
    expect(decisionLog?.body).toContain("Acceptable for MVP");

    const second = await missionService(db).waiveFinding(seeded.missionIssueId, {
      findingId: "FINDING-MISSION-002",
      rationale: "Duplicate waiver should not create another entry.",
      actor: { runId: "run-1" },
    });
    expect(second.waived).toBe(false);
  });
});
