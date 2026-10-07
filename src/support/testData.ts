import rawConfig from '../../config/cases.json';
import { describeError, parseOverrides, resolveCase, type CasesConfig, type ParamValue } from '../../shared/case-params.mjs';

const config = rawConfig as unknown as CasesConfig;
const CASE_TITLE = /^(TC\d{2})\s/;

export class TestData {
  private constructor(
    readonly caseId: string,
    private readonly values: Readonly<Record<string, ParamValue>>,
    private readonly custom: readonly string[],
  ) {}

  static forTest(title: string, overridesJson: string | undefined = process.env.CASE_PARAMS): TestData {
    const caseId = CASE_TITLE.exec(title)?.[1];
    if (!caseId) throw new Error(`Test titles must start with a case id such as "TC04 ": "${title}"`);
    const parsed = parseOverrides(overridesJson);
    const resolved = resolveCase(config, caseId, parsed.overrides[caseId] ?? {});
    const errors = [...parsed.errors, ...resolved.errors];
    if (errors.length) throw new Error(`Invalid test data:\n${errors.map(describeError).join('\n')}`);
    return new TestData(caseId, resolved.values, resolved.custom);
  }

  text(key: string): string {
    const value = this.value(key);
    if (typeof value !== 'string') throw new Error(`${this.caseId}.${key} is not a text parameter`);
    return value;
  }

  number(key: string): number {
    const value = this.value(key);
    if (typeof value !== 'number') throw new Error(`${this.caseId}.${key} is not a number parameter`);
    return value;
  }

  describe(): string {
    const defs = config.cases[this.caseId]?.params ?? {};
    return Object.entries(this.values)
      .map(([key, value]) => {
        const origin = this.custom.includes(key) ? `custom; default ${JSON.stringify(defs[key]?.default)}` : 'default';
        return `${key} = ${JSON.stringify(value)} (${origin})`;
      })
      .join('; ');
  }

  private value(key: string): ParamValue {
    if (!Object.hasOwn(this.values, key)) throw new Error(`${this.caseId} has no parameter "${key}" in config/cases.json`);
    return this.values[key];
  }
}
