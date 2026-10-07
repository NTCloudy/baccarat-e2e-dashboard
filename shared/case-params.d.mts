// Types for case-params.mjs (used by the TypeScript tests).

export type ParamValue = string | number;
export type Localized = Record<string, string>;

export interface ParamOption {
  value: string;
  label: Localized;
}

export interface ParamDefinition {
  type: 'text' | 'integer' | 'select';
  default: ParamValue;
  label: Localized;
  hint?: Localized;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: ParamOption[];
  /** Name of a list in `lists` offered as suggestions (free text is still allowed). */
  suggestions?: string;
}

export type CaseRule =
  | { type: 'lessThan'; param: string; than: string }
  | { type: 'different'; params: [string, string] }
  /** `product` must not be in lists.onePerCart while `quantity` is above 1. */
  | { type: 'onePerCart'; product: string; quantity: string };

export interface CaseConfig {
  params?: Record<string, ParamDefinition>;
  rules?: CaseRule[];
  /** Targets this case runs on (shared/targets.mjs); omitted = every target. */
  targets?: string[];
}

export interface CasesConfig {
  lists?: Record<string, string[]>;
  cases: Record<string, CaseConfig>;
}

export interface ParamError {
  code: string;
  caseId?: string;
  key?: string;
  other?: string;
  limit?: number;
  value?: string | null;
  detail?: string;
  inDefault?: boolean;
}

export type ParamValues = Record<string, ParamValue>;
export type Overrides = Record<string, Record<string, unknown>>;

export declare const CASE_ID: RegExp;
export declare const TEXT_PATTERN: RegExp;
export declare const LIMITS: { textLength: number; paramsJson: number };

export declare function caseIds(config: CasesConfig): string[];
export declare function appliesTo(config: CasesConfig, caseId: string, target: string | null | undefined): boolean;
export declare function applicableCases(config: CasesConfig, target: string | null | undefined): string[];
export declare function paramEntries(config: CasesConfig, caseId: string): [string, ParamDefinition][];
export declare function defaultValues(config: CasesConfig, caseId: string): ParamValues;
export declare function parseCaseList(config: CasesConfig, input: unknown): { cases: string[] | null; errors: ParamError[] };
export declare function parseOverrides(input: unknown): { overrides: Overrides; errors: ParamError[] };
export declare function checkValue(
  def: ParamDefinition,
  raw: unknown,
): { value: ParamValue; error?: undefined } | { value?: undefined; error: ParamError };
export declare function resolveCase(
  config: CasesConfig,
  caseId: string,
  overrides?: Record<string, unknown>,
): { values: ParamValues; custom: string[]; errors: ParamError[] };
export declare function resolveRun(
  config: CasesConfig,
  request: { cases?: unknown; params?: unknown; target?: string | null },
): { all: boolean; cases: string[]; params: Record<string, ParamValues>; errors: ParamError[]; warnings: ParamError[] };
export declare function checkConfig(config: CasesConfig, options?: { targets?: string[] }): ParamError[];
export declare function describeError(error: ParamError): string;
