import fs from 'node:fs';
import path from 'node:path';

/** Repository root (this file is dashboard-tests/fixtures/site.ts). */
export const ROOT = path.resolve(__dirname, '..', '..');

/**
 * The dashboard under test: playwright.dashboard.config.ts builds it with
 * scripts/build-site.mjs from the fixture results in `dataDir` into `dir`,
 * and serves it with scripts/serve.mjs on `port`. Paths are relative to ROOT.
 */
export const SITE = {
  port: 4178,
  dir: 'test-output/dashboard-site',
  dataDir: 'dashboard-tests/fixtures/data/results',
} as const;

export type Language = 'zh-TW' | 'en';
export type Target = 'production' | 'with-bugs';

/** One case in config/descriptions.json. */
export interface DescriptionEntry {
  title: Record<string, string>;
  description: Record<string, string>;
}

/** config/descriptions.json: an entry per case id (plus a "$comment" string the tests never touch). */
export type Descriptions = Record<string, DescriptionEntry>;

export interface ParamDef {
  type: 'text' | 'integer' | 'select';
  default: string | number;
  label: Record<string, string>;
  hint?: Record<string, string>;
  min?: number;
  max?: number;
  maxLength?: number;
  suggestions?: string;
  options?: { value: string; label: Record<string, string> }[];
}

export interface CatalogCase {
  id: string;
  title: string;
  module: string;
  file: string;
  line: number;
  targets?: Target[];
  params: Record<string, ParamDef>;
  rules: unknown[];
}

/** catalog.json, written by scripts/build-site.mjs from config/cases.json and the test code. */
export interface Catalog {
  commit: string | null;
  builtAt: string;
  lists: Record<string, string[]>;
  cases: CatalogCase[];
  /** The descriptions of the deploy (config/descriptions.json when the site was built). */
  descriptions: Descriptions;
  knownBugs?: {
    source: { total: number; listUrl: string };
    bugs: { id: number; cases: string[] }[];
    unlisted: { key: string; cases: string[] }[];
  };
}

let catalog: Catalog | null = null;

/**
 * The catalog of the built site. Tests derive counts from it (e.g. "19 / 19
 * cases") so they keep working when test cases are added.
 */
export function siteCatalog(): Catalog {
  catalog ??= JSON.parse(fs.readFileSync(path.join(ROOT, SITE.dir, 'catalog.json'), 'utf8')) as Catalog;
  return catalog;
}

export function catalogCase(id: string): CatalogCase {
  const found = siteCatalog().cases.find((c) => c.id === id);
  if (!found) throw new Error(`${id} is not in the catalog`);
  return found;
}

/** Cases that apply to `target` (cases without `targets` run on every target). */
export const applicableCases = (target: Target = 'production'): CatalogCase[] =>
  siteCatalog().cases.filter((c) => !Array.isArray(c.targets) || c.targets.includes(target));

export const applicableCaseCount = (target: Target = 'production'): number => applicableCases(target).length;

/** Ids of the cases of one module, in catalog order. */
export const moduleCases = (module: string, target?: Target): string[] =>
  (target ? applicableCases(target) : siteCatalog().cases)
    .filter((c) => c.module === module)
    .map((c) => c.id);

/**
 * The console's run time estimate, as documented in console.js: about two
 * minutes of setup and publishing plus ~3.75 s per case per round.
 */
export const estimateMinutes = (cases: number, rounds: number): number => Math.max(2, Math.ceil(2 + (rounds * cases * 3.75) / 60));

/** A case's title or description as deployed (config/descriptions.json when the site was built). */
export const deployedText = (id: string, field: keyof DescriptionEntry, lang: Language): string => siteCatalog().descriptions[id]?.[field]?.[lang] ?? '';

/**
 * A description template as the dashboard shows it: every {name} replaced by
 * the case's test data (`values`, else the default; option labels for selects).
 * Expected texts are derived from the deployed descriptions, so the tests keep
 * working when someone edits a description.
 */
export function fillTemplate(template: string, id: string, lang: Language, values: Record<string, string | number> = {}): string {
  const { params } = catalogCase(id);
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const def = params[name];
    if (!def) return match;
    const value = values[name] ?? def.default;
    const option = def.type === 'select' ? def.options?.find((o) => o.value === value) : undefined;
    return option ? (option.label[lang] ?? String(value)) : String(value);
  });
}

/** The deployed description of a case with its test data filled in. */
export const filledDescription = (id: string, lang: Language, values: Record<string, string | number> = {}): string =>
  fillTemplate(deployedText(id, 'description', lang), id, lang, values);
