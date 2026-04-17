import type { MissionFindingWaiver } from "@paperclipai/shared";

export const MISSION_FINDING_WAIVER_MARKER_PREFIX = "paperclip:mission-finding-waiver:";

export function validationReportRoundFromKey(key: string) {
  const match = /^validation-report-round-([1-9][0-9]*)$/.exec(key);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

export function isMissionValidationReportKey(key: string) {
  return validationReportRoundFromKey(key) !== null;
}

export function missionFixIssueOriginId(missionIssueId: string, findingId: string) {
  return `${missionIssueId}:feature:fix:${findingId}`;
}

export function missionFindingWaiverMarker(findingId: string) {
  return `${MISSION_FINDING_WAIVER_MARKER_PREFIX}${findingId}`;
}

export function parseMissionFindingWaivers(decisionLogBody: string | null | undefined): Map<string, MissionFindingWaiver> {
  const waivers = new Map<string, MissionFindingWaiver>();
  if (!decisionLogBody) return waivers;

  const markerRe = /<!--\s*paperclip:mission-finding-waiver:(FINDING-[A-Z0-9][A-Z0-9-]*-[0-9]{3,})\s*-->/g;
  const matches = [...decisionLogBody.matchAll(markerRe)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const findingId = match[1]!;
    const start = match.index! + match[0].length;
    const end = matches[index + 1]?.index ?? decisionLogBody.length;
    const block = decisionLogBody.slice(start, end);
    const rationale =
      /^\s*-\s+Rationale:\s*(.+?)\s*$/im.exec(block)?.[1]?.trim() ??
      block.trim().split(/\r?\n/).find((line) => line.trim())?.trim() ??
      "";
    waivers.set(findingId, { findingId, rationale });
  }

  return waivers;
}

export function buildMissionFindingWaiverEntry(input: {
  findingId: string;
  rationale: string;
  actorLabel: string;
  createdAt: Date;
}) {
  return [
    `<!-- ${missionFindingWaiverMarker(input.findingId)} -->`,
    `### Waived ${input.findingId}`,
    "",
    `- Rationale: ${input.rationale}`,
    `- Decision by: ${input.actorLabel}`,
    `- Recorded at: ${input.createdAt.toISOString()}`,
  ].join("\n");
}
