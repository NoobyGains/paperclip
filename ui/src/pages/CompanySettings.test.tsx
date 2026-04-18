// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyProvider } from "../context/CompanyContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CompanySettings } from "./CompanySettings";

const companiesApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
}));

const adaptersApiMock = vi.hoisted(() => ({
  list: vi.fn(),
}));

const agentsApiMock = vi.hoisted(() => ({
  list: vi.fn(),
}));

const accessApiMock = vi.hoisted(() => ({
  createOpenClawInvitePrompt: vi.fn(),
  getInviteOnboarding: vi.fn(),
}));

const assetsApiMock = vi.hoisted(() => ({
  uploadCompanyLogo: vi.fn(),
}));

const pushToastMock = vi.hoisted(() => vi.fn());
const setBreadcrumbsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("../api/companies", () => ({
  companiesApi: companiesApiMock,
}));

vi.mock("../api/adapters", () => ({
  adaptersApi: adaptersApiMock,
}));

vi.mock("../api/agents", () => ({
  agentsApi: agentsApiMock,
}));

vi.mock("../api/access", () => ({
  accessApi: accessApiMock,
}));

vi.mock("../api/assets", () => ({
  assetsApi: assetsApiMock,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: setBreadcrumbsMock,
  }),
}));

vi.mock("../context/ToastContext", () => ({
  useToastActions: () => ({
    pushToast: pushToastMock,
  }),
}));

vi.mock("../components/CompanyPatternIcon", () => ({
  CompanyPatternIcon: () => <div data-testid="company-pattern-icon" />,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function makeCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: "company-1",
    name: "Paperclip",
    description: "Automation company",
    status: "active",
    pauseReason: null,
    pausedAt: null,
    issuePrefix: "PAP",
    issueCounter: 1,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    requireBoardApprovalForNewAgents: false,
    codexSandboxLoopbackEnabled: true,
    autoHireEnabled: false,
    defaultHireAdapter: null,
    defaultReviewerAgentId: null,
    autoReviewEnabled: false,
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    brandColor: null,
    logoAssetId: null,
    logoUrl: null,
    createdAt: new Date("2026-04-18T10:00:00.000Z"),
    updatedAt: new Date("2026-04-18T10:00:00.000Z"),
    ...overrides,
  };
}

async function flushTimers(ms = 400) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function renderPage(container: HTMLDivElement) {
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <CompanyProvider>
            <CompanySettings />
          </CompanyProvider>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });

  await flushReact();
  await flushReact();
  await flushReact();

  return { root, queryClient };
}

describe("CompanySettings", () => {
  let container: HTMLDivElement;
  let companyState = makeCompany();

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);

    companyState = makeCompany();

    companiesApiMock.list.mockImplementation(async () => [companyState]);
    companiesApiMock.update.mockImplementation(
      async (_companyId: string, patch: Record<string, unknown>) => {
        companyState = makeCompany({
          ...companyState,
          ...patch,
          updatedAt: new Date("2026-04-18T12:00:00.000Z"),
        });
        return companyState;
      },
    );
    companiesApiMock.archive.mockResolvedValue(companyState);

    adaptersApiMock.list.mockResolvedValue([
      {
        type: "claude_local",
        label: "Claude Code",
        source: "builtin",
        modelsCount: 0,
        loaded: true,
        disabled: false,
        capabilities: {
          supportsInstructionsBundle: false,
          supportsSkills: false,
          supportsLocalAgentJwt: false,
          requiresMaterializedRuntimeSkills: false,
        },
      },
      {
        type: "codex_local",
        label: "Codex",
        source: "builtin",
        modelsCount: 0,
        loaded: true,
        disabled: true,
        capabilities: {
          supportsInstructionsBundle: false,
          supportsSkills: false,
          supportsLocalAgentJwt: false,
          requiresMaterializedRuntimeSkills: false,
        },
      },
      {
        type: "cursor",
        label: "Cursor",
        source: "external",
        modelsCount: 0,
        loaded: false,
        disabled: false,
        capabilities: {
          supportsInstructionsBundle: false,
          supportsSkills: false,
          supportsLocalAgentJwt: false,
          requiresMaterializedRuntimeSkills: false,
        },
      },
    ]);

    agentsApiMock.list.mockResolvedValue([
      {
        id: "agent-active",
        companyId: "company-1",
        name: "Alice Reviewer",
        urlKey: "alice-reviewer",
        role: "qa",
        title: "QA Lead",
        icon: null,
        status: "active",
        reportsTo: null,
        capabilities: null,
        adapterType: "claude_local",
        adapterConfig: {},
        runtimeConfig: {},
        budgetMonthlyCents: 0,
        spentMonthlyCents: 0,
        pauseReason: null,
        pausedAt: null,
        permissions: { canCreateAgents: false },
        lastHeartbeatAt: null,
        metadata: null,
        createdAt: new Date("2026-04-18T10:00:00.000Z"),
        updatedAt: new Date("2026-04-18T10:00:00.000Z"),
      },
      {
        id: "agent-paused",
        companyId: "company-1",
        name: "Pat Paused",
        urlKey: "pat-paused",
        role: "qa",
        title: "QA Engineer",
        icon: null,
        status: "paused",
        reportsTo: null,
        capabilities: null,
        adapterType: "claude_local",
        adapterConfig: {},
        runtimeConfig: {},
        budgetMonthlyCents: 0,
        spentMonthlyCents: 0,
        pauseReason: null,
        pausedAt: null,
        permissions: { canCreateAgents: false },
        lastHeartbeatAt: null,
        metadata: null,
        createdAt: new Date("2026-04-18T10:00:00.000Z"),
        updatedAt: new Date("2026-04-18T10:00:00.000Z"),
      },
    ]);

    accessApiMock.createOpenClawInvitePrompt.mockResolvedValue({});
    accessApiMock.getInviteOnboarding.mockResolvedValue({});
    assetsApiMock.uploadCompanyLogo.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    container.remove();
    document.body.innerHTML = "";
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("saves automation settings and reloads them from company state", async () => {
    let rendered = await renderPage(container);

    const adapterSelect = container.querySelector(
      '[data-testid="company-settings-default-hire-adapter"]',
    ) as HTMLSelectElement | null;
    const autoReviewToggle = container.querySelector(
      '[data-testid="company-settings-auto-review-toggle"]',
    ) as HTMLButtonElement | null;

    expect(adapterSelect).not.toBeNull();
    expect(autoReviewToggle).not.toBeNull();

    const adapterOptionValues = Array.from(adapterSelect!.options).map((option) => option.value);
    expect(adapterOptionValues).toContain("");
    expect(adapterOptionValues).toContain("claude_local");
    expect(adapterOptionValues).not.toContain("codex_local");
    expect(adapterOptionValues).not.toContain("cursor");

    await act(async () => {
      adapterSelect!.value = "claude_local";
      adapterSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      autoReviewToggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    const reviewerSelect = container.querySelector(
      '[data-testid="company-settings-default-reviewer-agent"]',
    ) as HTMLSelectElement | null;
    expect(reviewerSelect).not.toBeNull();

    const reviewerOptionValues = Array.from(reviewerSelect!.options).map((option) => option.value);
    expect(reviewerOptionValues).toContain("");
    expect(reviewerOptionValues).toContain("agent-active");
    expect(reviewerOptionValues).toContain("agent-paused");

    await act(async () => {
      reviewerSelect!.value = "agent-active";
      reviewerSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushReact();
    await flushTimers();
    await flushReact();
    await flushReact();
    await flushReact();

    expect(companiesApiMock.update).toHaveBeenCalledWith("company-1", {
      defaultHireAdapter: "claude_local",
      autoReviewEnabled: true,
      defaultReviewerAgentId: "agent-active",
    });
    expect(pushToastMock).toHaveBeenCalledWith({
      title: "Automation settings updated",
      tone: "success",
    });

    expect(
      (container.querySelector('[data-testid="company-settings-default-hire-adapter"]') as HTMLSelectElement).value,
    ).toBe("claude_local");
    expect(
      (container.querySelector('[data-testid="company-settings-default-reviewer-agent"]') as HTMLSelectElement).value,
    ).toBe("agent-active");
    expect(
      (container.querySelector('[data-testid="company-settings-auto-review-toggle"]') as HTMLButtonElement).className,
    ).toContain("bg-green-600");

    await act(async () => {
      rendered.root.unmount();
    });
    rendered.queryClient.clear();

    container.innerHTML = "";
    rendered = await renderPage(container);

    expect(
      (container.querySelector('[data-testid="company-settings-default-hire-adapter"]') as HTMLSelectElement).value,
    ).toBe("claude_local");
    expect(
      (container.querySelector('[data-testid="company-settings-default-reviewer-agent"]') as HTMLSelectElement).value,
    ).toBe("agent-active");
    expect(
      (container.querySelector('[data-testid="company-settings-auto-review-toggle"]') as HTMLButtonElement).className,
    ).toContain("bg-green-600");

    await act(async () => {
      rendered.root.unmount();
    });
  });
});
