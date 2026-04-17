import {
  missionFeaturesDocumentSchema,
  missionValidationReportSchema,
  missionValidationContractSchema,
  type MissionFeaturesDocument,
  type MissionValidationReport,
  type MissionValidationContract,
} from "./validators/mission.js";

const VALIDATION_ID_RE = /\bVAL-[A-Z0-9][A-Z0-9-]*-[0-9]{3,}\b/gi;
const FEATURE_ID_RE = /\bFEAT-[A-Z0-9][A-Z0-9-]*-[0-9]{3,}\b/gi;
const MILESTONE_ID_RE = /\bMILESTONE-[A-Z0-9][A-Z0-9-]*-[0-9]{3,}\b/gi;
const FINDING_ID_RE = /\bFINDING-[A-Z0-9][A-Z0-9-]*-[0-9]{3,}\b/gi;

function normalizeId(value: string) {
  return value.trim().toUpperCase();
}

function uniqueIds(values: string[]) {
  return [...new Set(values.map(normalizeId))];
}

function extractIds(value: string, re: RegExp) {
  return uniqueIds(value.match(re) ?? []);
}

function extractJsonPayload(markdown: string): unknown | null {
  const trimmed = markdown.trim();
  if (!trimmed) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) return null;

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function parseHeading(line: string) {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line.trim());
  if (!match) return null;
  return { level: match[1]!.length, text: match[2]!.trim() };
}

function parseField(line: string): { key: string; value: string } | null {
  const match = /^[-*]\s+([A-Za-z][A-Za-z0-9 _/-]{1,48}):\s*(.*?)\s*$/.exec(line.trim());
  if (!match) return null;
  return {
    key: match[1]!.trim().toLowerCase().replace(/[\s/-]+/g, "_"),
    value: match[2]!.trim(),
  };
}

function parseKeyedHeading(text: string, re: RegExp) {
  const [rawId] = text.match(re) ?? [];
  if (!rawId) return null;
  const id = normalizeId(rawId);
  const escaped = rawId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const title = text
    .replace(new RegExp(`\\b${escaped}\\b`, "i"), "")
    .replace(/^[\s:.-]+/, "")
    .trim();
  return { id, title: title || id };
}

function splitList(value: string) {
  return value
    .split(/(?:\s*;\s*|\s*,\s*)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeEnumValue(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function parseMissionValidationContractDocument(markdown: string): MissionValidationContract {
  const json = extractJsonPayload(markdown);
  if (json) return missionValidationContractSchema.parse(json);

  const assertions: MissionValidationContract["assertions"] = [];
  let current: MissionValidationContract["assertions"][number] | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = parseHeading(line);
    if (heading) {
      const parsed = parseKeyedHeading(heading.text, VALIDATION_ID_RE);
      if (parsed) {
        current = {
          id: parsed.id,
          title: parsed.title,
          user_value: "",
          scope: "",
          setup: "",
          steps: [],
          oracle: "",
          tooling: ["manual_review"],
          evidence: [],
          claimed_by: [],
          status: "unclaimed",
        };
        assertions.push(current);
        continue;
      }
    }

    if (!current) continue;
    const field = parseField(line);
    if (!field) continue;

    if (field.key === "user_value") current.user_value = field.value;
    if (field.key === "scope") current.scope = field.value;
    if (field.key === "setup") current.setup = field.value;
    if (field.key === "steps") current.steps = splitList(field.value);
    if (field.key === "oracle") current.oracle = field.value;
    if (field.key === "tooling") {
      current.tooling = splitList(field.value).map((tool) => tool.toLowerCase().replace(/[\s-]+/g, "_")) as typeof current.tooling;
    }
    if (field.key === "evidence") {
      current.evidence = splitList(field.value).map((description, index) => ({
        kind: index === 0 ? "primary" : `supporting-${index}`,
        description,
        required: true,
      }));
    }
    if (["claimed_by", "claimed", "claims", "features"].includes(field.key)) {
      current.claimed_by = uniqueIds([...current.claimed_by, ...extractIds(field.value, FEATURE_ID_RE)]);
    }
    if (field.key === "status") {
      current.status = field.value.toLowerCase() as typeof current.status;
    }
  }

  return missionValidationContractSchema.parse({ assertions });
}

export function parseMissionFeaturesDocument(markdown: string): MissionFeaturesDocument {
  const json = extractJsonPayload(markdown);
  if (json) return missionFeaturesDocumentSchema.parse(json);

  const milestoneById = new Map<string, MissionFeaturesDocument["milestones"][number]>();
  let currentMilestone: MissionFeaturesDocument["milestones"][number] | null = null;
  let currentFeature: MissionFeaturesDocument["milestones"][number]["features"][number] | null = null;

  function ensureMilestone(id: string, title: string) {
    const normalizedId = normalizeId(id);
    const existing = milestoneById.get(normalizedId);
    if (existing) return existing;
    const milestone = {
      id: normalizedId,
      title: title.trim() || normalizedId,
      summary: title.trim() || normalizedId,
      features: [],
    };
    milestoneById.set(normalizedId, milestone);
    return milestone;
  }

  for (const line of markdown.split(/\r?\n/)) {
    const heading = parseHeading(line);
    if (heading) {
      const featureHeading = parseKeyedHeading(heading.text, FEATURE_ID_RE);
      if (featureHeading) {
        currentMilestone ??= ensureMilestone("MILESTONE-MISSION-001", "Mission milestone");
        currentFeature = {
          id: featureHeading.id,
          title: featureHeading.title,
          kind: "original",
          summary: "",
          acceptance_criteria: [],
          claimed_assertion_ids: [],
          status: "planned",
        };
        currentMilestone.features.push(currentFeature);
        continue;
      }

      const milestoneHeading = parseKeyedHeading(heading.text, MILESTONE_ID_RE);
      if (milestoneHeading) {
        currentMilestone = ensureMilestone(milestoneHeading.id, milestoneHeading.title);
        currentFeature = null;
        continue;
      }
    }

    const field = parseField(line);
    if (!field) continue;

    if (currentFeature) {
      if (field.key === "kind") currentFeature.kind = field.value.toLowerCase() === "fix" ? "fix" : "original";
      if (["summary", "description"].includes(field.key)) currentFeature.summary = field.value;
      if (["acceptance_criteria", "success_criteria"].includes(field.key)) {
        currentFeature.acceptance_criteria = splitList(field.value);
      }
      if (["claimed_assertion_ids", "claimed_by", "claims", "assertions", "validation"].includes(field.key)) {
        currentFeature.claimed_assertion_ids = uniqueIds([
          ...currentFeature.claimed_assertion_ids,
          ...extractIds(field.value, VALIDATION_ID_RE),
        ]);
      }
      if (field.key === "source_finding_id") currentFeature.source_finding_id = field.value || null;
      if (field.key === "status") currentFeature.status = field.value.toLowerCase() as typeof currentFeature.status;
      continue;
    }

    if (currentMilestone && ["summary", "description"].includes(field.key)) {
      currentMilestone.summary = field.value;
    }
  }

  return missionFeaturesDocumentSchema.parse({ milestones: [...milestoneById.values()] });
}

export function parseMissionValidationReportDocument(
  markdown: string,
  options: { round?: number } = {},
): MissionValidationReport {
  const json = extractJsonPayload(markdown);
  if (json) return missionValidationReportSchema.parse(json);

  const report: Partial<MissionValidationReport> = {
    round: options.round,
    summary: "",
    findings: [],
  };
  let currentFinding: MissionValidationReport["findings"][number] | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = parseHeading(line);
    if (heading) {
      const findingHeading = parseKeyedHeading(heading.text, FINDING_ID_RE);
      if (findingHeading) {
        currentFinding = {
          id: findingHeading.id,
          severity: "suggestion",
          assertion_id: null,
          title: findingHeading.title,
          evidence: [],
          repro_steps: [],
          expected: "",
          actual: "",
          suspected_area: null,
          recommended_fix_scope: null,
          status: "open",
        };
        report.findings!.push(currentFinding);
        continue;
      }
    }

    const field = parseField(line);
    if (!field) continue;

    if (!currentFinding) {
      if (field.key === "round") report.round = Number.parseInt(field.value, 10);
      if (["validator_role", "role"].includes(field.key)) {
        report.validator_role = normalizeEnumValue(field.value) as MissionValidationReport["validator_role"];
      }
      if (field.key === "summary") report.summary = field.value;
      continue;
    }

    if (field.key === "severity") {
      currentFinding.severity = normalizeEnumValue(field.value) as typeof currentFinding.severity;
    }
    if (["assertion_id", "assertion", "validation"].includes(field.key)) {
      currentFinding.assertion_id = extractIds(field.value, VALIDATION_ID_RE)[0] ?? null;
    }
    if (field.key === "title") currentFinding.title = field.value;
    if (field.key === "evidence") currentFinding.evidence = splitList(field.value);
    if (["repro_steps", "steps", "reproduction"].includes(field.key)) currentFinding.repro_steps = splitList(field.value);
    if (field.key === "expected") currentFinding.expected = field.value;
    if (field.key === "actual") currentFinding.actual = field.value;
    if (field.key === "suspected_area") currentFinding.suspected_area = field.value || null;
    if (field.key === "recommended_fix_scope") currentFinding.recommended_fix_scope = field.value || null;
    if (field.key === "status") currentFinding.status = normalizeEnumValue(field.value) as typeof currentFinding.status;
  }

  return missionValidationReportSchema.parse(report);
}
