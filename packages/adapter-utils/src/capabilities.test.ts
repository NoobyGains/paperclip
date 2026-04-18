import { describe, expect, it } from "vitest";
import { applyCapabilitiesToHirePayload } from "./capabilities.js";

const WEB_SEARCH_SKILL = "paperclip-web-search";
const AGENT_BROWSER_SKILL = "vercel-labs/agent-browser/agent-browser";

describe("applyCapabilitiesToHirePayload", () => {
  describe("no capabilities / undefined", () => {
    it("returns adapterConfig and desiredSkills unchanged when capabilities is undefined", () => {
      const result = applyCapabilitiesToHirePayload(
        "codex_local",
        { model: "gpt-4" },
        undefined,
        ["some-skill"],
      );
      expect(result.adapterConfig).toEqual({ model: "gpt-4" });
      expect(result.desiredSkills).toEqual(["some-skill"]);
    });

    it("returns empty desiredSkills array when desiredSkills is undefined", () => {
      const result = applyCapabilitiesToHirePayload(
        "codex_local",
        {},
        undefined,
        undefined,
      );
      expect(result.desiredSkills).toEqual([]);
    });
  });

  describe("codex_local", () => {
    it("sets search=true when webSearch=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "codex_local",
        {},
        { webSearch: true },
        undefined,
      );
      expect(result.adapterConfig.search).toBe(true);
      expect(result.desiredSkills).toEqual([]);
    });

    it("sets search=true and injects agent-browser skill when browser=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "codex_local",
        {},
        { browser: true },
        undefined,
      );
      expect(result.adapterConfig.search).toBe(true);
      expect(result.desiredSkills).toContain(AGENT_BROWSER_SKILL);
    });

    it("sets search=true for both webSearch and browser together", () => {
      const result = applyCapabilitiesToHirePayload(
        "codex_local",
        {},
        { webSearch: true, browser: true },
        undefined,
      );
      expect(result.adapterConfig.search).toBe(true);
      expect(result.desiredSkills).toContain(AGENT_BROWSER_SKILL);
    });

    it("does not mutate the original adapterConfig", () => {
      const original = { model: "gpt-5.4" };
      applyCapabilitiesToHirePayload("codex_local", original, { webSearch: true }, undefined);
      expect(original).not.toHaveProperty("search");
    });
  });

  describe("claude_local", () => {
    it("injects web-search skill when webSearch=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "claude_local",
        {},
        { webSearch: true },
        undefined,
      );
      expect(result.desiredSkills).toContain(WEB_SEARCH_SKILL);
      expect(result.adapterConfig).toEqual({});
    });

    it("injects both web-search and agent-browser skills when browser=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "claude_local",
        {},
        { browser: true },
        undefined,
      );
      expect(result.desiredSkills).toContain(WEB_SEARCH_SKILL);
      expect(result.desiredSkills).toContain(AGENT_BROWSER_SKILL);
    });

    it("does not duplicate skills when same skill requested twice", () => {
      const result = applyCapabilitiesToHirePayload(
        "claude_local",
        {},
        { webSearch: true, browser: true },
        [WEB_SEARCH_SKILL],
      );
      const webSearchCount = result.desiredSkills.filter((s) => s === WEB_SEARCH_SKILL).length;
      expect(webSearchCount).toBe(1);
    });
  });

  describe("hermes_local", () => {
    it("adds 'web' token to toolsets when webSearch=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "hermes_local",
        {},
        { webSearch: true },
        undefined,
      );
      expect(result.adapterConfig.toolsets).toBe("web");
    });

    it("merges 'web' into existing toolsets", () => {
      const result = applyCapabilitiesToHirePayload(
        "hermes_local",
        { toolsets: "terminal,file" },
        { webSearch: true },
        undefined,
      );
      expect(result.adapterConfig.toolsets).toBe("terminal,file,web");
    });

    it("adds 'web' and 'browser' tokens when browser=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "hermes_local",
        {},
        { browser: true },
        undefined,
      );
      const toolsets = String(result.adapterConfig.toolsets);
      expect(toolsets).toContain("web");
      expect(toolsets).toContain("browser");
    });

    it("does not duplicate 'web' token if already present", () => {
      const result = applyCapabilitiesToHirePayload(
        "hermes_local",
        { toolsets: "web" },
        { webSearch: true },
        undefined,
      );
      expect(result.adapterConfig.toolsets).toBe("web");
    });
  });

  describe("gemini_local", () => {
    it("injects web-search skill when webSearch=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "gemini_local",
        {},
        { webSearch: true },
        undefined,
      );
      expect(result.desiredSkills).toContain(WEB_SEARCH_SKILL);
    });

    it("injects web-search and agent-browser skills when browser=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "gemini_local",
        {},
        { browser: true },
        undefined,
      );
      expect(result.desiredSkills).toContain(WEB_SEARCH_SKILL);
      expect(result.desiredSkills).toContain(AGENT_BROWSER_SKILL);
    });
  });

  describe("cursor", () => {
    it("injects web-search skill when webSearch=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "cursor",
        {},
        { webSearch: true },
        undefined,
      );
      expect(result.desiredSkills).toContain(WEB_SEARCH_SKILL);
    });
  });

  describe("pi_local", () => {
    it("injects web-search skill when webSearch=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "pi_local",
        {},
        { webSearch: true },
        undefined,
      );
      expect(result.desiredSkills).toContain(WEB_SEARCH_SKILL);
    });
  });

  describe("opencode_local", () => {
    it("injects web-search skill when webSearch=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "opencode_local",
        {},
        { webSearch: true },
        undefined,
      );
      expect(result.desiredSkills).toContain(WEB_SEARCH_SKILL);
    });
  });

  describe("openclaw_gateway", () => {
    it("passes through without modification (remote agent manages its own tools)", () => {
      const result = applyCapabilitiesToHirePayload(
        "openclaw_gateway",
        { endpoint: "https://example.com" },
        { webSearch: true, browser: true },
        ["existing-skill"],
      );
      expect(result.adapterConfig).toEqual({ endpoint: "https://example.com" });
      expect(result.desiredSkills).toEqual(["existing-skill"]);
    });
  });

  describe("unknown adapter (fallback)", () => {
    it("injects web-search skill for unknown adapter when webSearch=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "some_future_adapter",
        {},
        { webSearch: true },
        undefined,
      );
      expect(result.desiredSkills).toContain(WEB_SEARCH_SKILL);
    });

    it("injects both skills for unknown adapter when browser=true", () => {
      const result = applyCapabilitiesToHirePayload(
        "some_future_adapter",
        {},
        { browser: true },
        undefined,
      );
      expect(result.desiredSkills).toContain(WEB_SEARCH_SKILL);
      expect(result.desiredSkills).toContain(AGENT_BROWSER_SKILL);
    });
  });
});
