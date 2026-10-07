export type TargetName = 'production' | 'with-bugs';

export interface TargetInfo {
  baseURL: string;
  apiURL: string;
  injectedBugs: boolean;
}

export interface RunEntryLike {
  target?: string;
  selection?: 'all' | string[];
  caseCount?: number;
  catalogSize?: number;
  startedAt?: string;
  totals?: { total?: number };
}

export declare const DEFAULT_TARGET: 'production';
export declare const TARGETS: Record<TargetName, TargetInfo>;
export declare const TARGET_NAMES: TargetName[];
export declare function isTarget(name: unknown): name is TargetName;
export declare function resolveTarget(
  input: unknown,
): ({ name: TargetName; error?: undefined } & TargetInfo) | { name?: undefined; error: string };
export declare function targetOf(run: { target?: string } | null | undefined): TargetName;
export declare function isFullRun(run: RunEntryLike | null | undefined): boolean;
export declare function latestFullRun<T extends RunEntryLike>(runs: T[] | null | undefined, target: TargetName): T | null;
