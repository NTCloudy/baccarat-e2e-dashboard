export type Target = 'production' | 'with-bugs';

const TARGETS: readonly string[] = ['production', 'with-bugs'] satisfies Target[];

function isTarget(value: string | undefined): value is Target {
  return value !== undefined && TARGETS.includes(value);
}

export function currentTarget(): Target {
  const fromEnv = process.env.TARGET;
  if (isTarget(fromEnv)) return fromEnv;
  return 'production';
}
