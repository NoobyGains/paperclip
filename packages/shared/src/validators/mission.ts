import { z } from "zod";
import {
  ISSUE_STATUSES,
  MISSION_FEATURE_KINDS,
  MISSION_FEATURE_STATUSES,
  MISSION_FINDING_SEVERITIES,
  MISSION_FINDING_STATUSES,
  MISSION_REQUIRED_DOCUMENT_KEYS,
  MISSION_ROLE_TYPES,
  MISSION_STATES,
  MISSION_VALIDATION_ASSERTION_STATUSES,
  MISSION_VALIDATION_TOOLING,
} from "../constants.js";
import { isMissionDocumentKey } from "../mission.js";

const validationAssertionIdSchema = z
  .string()
  .trim()
  .regex(/^VAL-[A-Z0-9][A-Z0-9-]*-[0-9]{3,}$/, "Validation assertion IDs must look like VAL-MISSION-001");

const featureIdSchema = z
  .string()
  .trim()
  .regex(/^FEAT-[A-Z0-9][A-Z0-9-]*-[0-9]{3,}$/, "Feature IDs must look like FEAT-MISSION-001");

const milestoneIdSchema = z
  .string()
  .trim()
  .regex(/^MILESTONE-[A-Z0-9][A-Z0-9-]*-[0-9]{3,}$/, "Milestone IDs must look like MILESTONE-MISSION-001");

const findingIdSchema = z
  .string()
  .trim()
  .regex(/^FINDING-[A-Z0-9][A-Z0-9-]*-[0-9]{3,}$/, "Finding IDs must look like FINDING-MISSION-001");

const nonEmptyStringSchema = z.string().trim().min(1);
const nonEmptyStringListSchema = z.array(nonEmptyStringSchema).min(1);

export const missionStateSchema = z.enum(MISSION_STATES);
export const missionRoleTypeSchema = z.enum(MISSION_ROLE_TYPES);
export const missionRequiredDocumentKeySchema = z.enum(MISSION_REQUIRED_DOCUMENT_KEYS);
export const missionDocumentKeySchema = z
  .string()
  .trim()
  .refine(isMissionDocumentKey, "Unknown mission document key");

export const missionEvidenceRequirementSchema = z
  .object({
    kind: nonEmptyStringSchema,
    description: nonEmptyStringSchema,
    required: z.boolean().default(true),
  })
  .strict();

export const missionValidationAssertionSchema = z
  .object({
    id: validationAssertionIdSchema,
    title: nonEmptyStringSchema,
    user_value: nonEmptyStringSchema,
    scope: nonEmptyStringSchema,
    setup: nonEmptyStringSchema,
    steps: nonEmptyStringListSchema,
    oracle: nonEmptyStringSchema,
    tooling: z.array(z.enum(MISSION_VALIDATION_TOOLING)).min(1),
    evidence: z.array(missionEvidenceRequirementSchema).min(1),
    claimed_by: z.array(featureIdSchema).default([]),
    status: z.enum(MISSION_VALIDATION_ASSERTION_STATUSES).default("unclaimed"),
  })
  .strict();

export const missionValidationContractSchema = z
  .object({
    assertions: z.array(missionValidationAssertionSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.assertions.forEach((assertion, index) => {
      if (ids.has(assertion.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate validation assertion id: ${assertion.id}`,
          path: ["assertions", index, "id"],
        });
      }
      ids.add(assertion.id);
    });
  });

export const missionFeatureKindSchema = z.enum(MISSION_FEATURE_KINDS);
export const missionFeatureStatusSchema = z.enum(MISSION_FEATURE_STATUSES);

export const missionFeatureSchema = z
  .object({
    id: featureIdSchema,
    title: nonEmptyStringSchema,
    kind: missionFeatureKindSchema.default("original"),
    summary: nonEmptyStringSchema,
    acceptance_criteria: nonEmptyStringListSchema,
    claimed_assertion_ids: z.array(validationAssertionIdSchema).default([]),
    status: missionFeatureStatusSchema.default("planned"),
    source_finding_id: findingIdSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "original" && value.claimed_assertion_ids.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Original mission features must claim at least one validation assertion",
        path: ["claimed_assertion_ids"],
      });
    }
    if (value.kind === "fix" && !value.source_finding_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Fix mission features must reference a source finding",
        path: ["source_finding_id"],
      });
    }
  });

export const missionMilestoneSchema = z
  .object({
    id: milestoneIdSchema,
    title: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    features: z.array(missionFeatureSchema).min(1),
  })
  .strict();

export const missionFeaturesDocumentSchema = z
  .object({
    milestones: z.array(missionMilestoneSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const milestoneIds = new Set<string>();
    const featureIds = new Set<string>();
    value.milestones.forEach((milestone, milestoneIndex) => {
      if (milestoneIds.has(milestone.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate mission milestone id: ${milestone.id}`,
          path: ["milestones", milestoneIndex, "id"],
        });
      }
      milestoneIds.add(milestone.id);
      milestone.features.forEach((feature, featureIndex) => {
        if (featureIds.has(feature.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate mission feature id: ${feature.id}`,
            path: ["milestones", milestoneIndex, "features", featureIndex, "id"],
          });
        }
        featureIds.add(feature.id);
      });
    });
  });

export const missionFindingSeveritySchema = z.enum(MISSION_FINDING_SEVERITIES);
export const missionFindingStatusSchema = z.enum(MISSION_FINDING_STATUSES);

export const missionFindingSchema = z
  .object({
    id: findingIdSchema,
    severity: missionFindingSeveritySchema,
    assertion_id: validationAssertionIdSchema.nullable().optional(),
    title: nonEmptyStringSchema,
    evidence: nonEmptyStringListSchema,
    repro_steps: nonEmptyStringListSchema,
    expected: nonEmptyStringSchema,
    actual: nonEmptyStringSchema,
    suspected_area: nonEmptyStringSchema.nullable().optional(),
    recommended_fix_scope: nonEmptyStringSchema.nullable().optional(),
    status: missionFindingStatusSchema.default("open"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.severity === "blocking" && !value.assertion_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Blocking mission findings must reference a validation assertion",
        path: ["assertion_id"],
      });
    }
    if (value.status === "fix_created" && !value.recommended_fix_scope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Findings with fix_created status must include recommended_fix_scope",
        path: ["recommended_fix_scope"],
      });
    }
  });

export const missionValidationReportSchema = z
  .object({
    round: z.number().int().positive(),
    validator_role: z.enum(["scrutiny_validator", "user_testing_validator"]),
    summary: nonEmptyStringSchema,
    findings: z.array(missionFindingSchema).default([]),
  })
  .strict();

export const missionStateDerivationInputSchema = z
  .object({
    missionIssueStatus: z.enum(ISSUE_STATUSES),
    presentDocumentKeys: z.array(missionDocumentKeySchema),
    approvalRequired: z.boolean().optional(),
    paused: z.boolean().optional(),
    hasActiveFeatureIssues: z.boolean().optional(),
    hasActiveValidationIssues: z.boolean().optional(),
    hasActiveFixIssues: z.boolean().optional(),
    hasBlockingFindings: z.boolean().optional(),
  })
  .strict();

export const decomposeMissionSchema = z
  .object({
    dryRun: z.boolean().optional().default(false),
  })
  .strict();

export const advanceMissionSchema = z
  .object({
    budgetLimitCents: z.number().int().positive().optional(),
    maxValidationRounds: z.number().int().positive().max(20).optional(),
  })
  .strict();

export type MissionValidationAssertion = z.infer<typeof missionValidationAssertionSchema>;
export type MissionValidationContract = z.infer<typeof missionValidationContractSchema>;
export type MissionFeature = z.infer<typeof missionFeatureSchema>;
export type MissionMilestone = z.infer<typeof missionMilestoneSchema>;
export type MissionFeaturesDocument = z.infer<typeof missionFeaturesDocumentSchema>;
export type MissionFinding = z.infer<typeof missionFindingSchema>;
export type MissionValidationReport = z.infer<typeof missionValidationReportSchema>;
export type MissionStateDerivationInput = z.infer<typeof missionStateDerivationInputSchema>;
export type DecomposeMission = z.infer<typeof decomposeMissionSchema>;
export type AdvanceMission = z.infer<typeof advanceMissionSchema>;
