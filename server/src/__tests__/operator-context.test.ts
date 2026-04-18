import { describe, expect, it } from "vitest";
import {
  buildHiringPlaybook,
  buildOperatorContext,
  resetOperatorContextCacheForTests,
} from "../services/operator-context.js";

describe("operator context stitcher", () => {
  it("includes the narrative header and the dynamic enum sections", async () => {
    resetOperatorContextCacheForTests();
    const body = await buildOperatorContext();

    expect(body).toContain("# Paperclip Operator Context Pack");
    expect(body).toContain("## Live enums (stitched at request time)");
    expect(body).toContain("### Agent status values");
    expect(body).toContain("### Adapters registered on this server instance");
    expect(body).toContain("### Approval types");
  });

  it("includes the current shared-constants enum values", async () => {
    resetOperatorContextCacheForTests();
    const body = await buildOperatorContext();

    // These are defined in @paperclipai/shared/constants.ts and must always
    // appear in the dynamic section so the operator guide is never stale.
    expect(body).toContain("`pending_approval`");
    expect(body).toContain("`succeeded`");
    expect(body).toContain("`coalesce_if_active`");
    expect(body).toContain("`skip_missed`");
  });
});

describe("hiring playbook loader", () => {
  it("exposes the seven agent profiles so the CEO can pick one", async () => {
    resetOperatorContextCacheForTests();
    const body = await buildHiringPlaybook();

    expect(body).toContain("# Paperclip Hiring Playbook");
    // Each profile must be present.
    expect(body).toContain("### coding-heavy");
    expect(body).toContain("### coding-standard");
    expect(body).toContain("### coding-light");
    expect(body).toContain("### reasoning-heavy");
    expect(body).toContain("### reasoning-standard");
    expect(body).toContain("### reviewer");
    expect(body).toContain("### research");
    // Model references are current generation.
    expect(body).toContain("gpt-5.4");
    expect(body).toContain("claude-opus-4-7");
  });
});
