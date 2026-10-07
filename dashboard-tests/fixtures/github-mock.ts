import { createHash } from 'node:crypto';
import { expect, type BrowserContext, type Request, type Route } from '@playwright/test';
import { siteCatalog, type Descriptions } from './site';

/** The repository the dashboard works with (dashboard/core.js). */
export const REPO = { owner: 'NTCloudy', name: 'baccarat-e2e-dashboard', branch: 'main' } as const;
export const REPO_URL = `https://github.com/${REPO.owner}/${REPO.name}`;

const API = 'https://api.github.com';
const REPO_PATH = `/repos/${REPO.owner}/${REPO.name}`;
const DESCRIPTIONS_PATH = 'config/descriptions.json';

/**
 * The CORS headers api.github.com sends to browsers (checked with curl in
 * October 2026). JavaScript can only read the response headers listed in
 * access-control-expose-headers: GitHub-Authentication-Token-Expiration is
 * NOT one of them.
 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': [
    'ETag',
    'Link',
    'Location',
    'Retry-After',
    'X-GitHub-OTP',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Used',
    'X-RateLimit-Resource',
    'X-RateLimit-Reset',
    'X-OAuth-Scopes',
    'X-Accepted-OAuth-Scopes',
    'X-Poll-Interval',
    'X-GitHub-Media-Type',
    'X-GitHub-SSO',
    'X-GitHub-Request-Id',
    'Deprecation',
    'Sunset',
  ].join(', '),
};

/**
 * The workflow_dispatch inputs of .github/workflows/e2e.yml. Like GitHub, the
 * mock refuses any other input and values outside `options` (422). Add an
 * input here when the workflow gets one (e.g. an environment switch).
 */
export const WORKFLOW_INPUTS: Record<string, { options?: string[] }> = {
  rounds: { options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] },
  cases: {},
  params: {},
  target: { options: ['production', 'with-bugs'] },
};

export type Permission = 'none' | 'read' | 'write';

/** The account behind a token, and what the (fine-grained) token may do on the repository. */
export interface Account {
  login: string;
  id: number;
  actions: Permission;
  contents: Permission;
  /** GitHub-Authentication-Token-Expiration as GitHub sends it, e.g. "2026-12-31 08:00:00 UTC"; null: no expiry. */
  expiration: string | null;
}

/** The repository owner (synthetic id). Tokens of other accounts get a warning in the console. */
export const OWNER: Readonly<Account> = {
  login: REPO.owner,
  id: 12345678,
  actions: 'write',
  contents: 'write',
  expiration: '2026-12-31 08:00:00 UTC',
};

/** A fine-grained token of OWNER that the mock accepts (shaped like a real one, never valid on GitHub). */
export const OWNER_TOKEN = 'github_pat_11FIXTURE0_dashboardTestsOwnerTokenNotReal';

/** The GitHub endpoints the dashboard uses (dashboard/github.js). */
export type Endpoint = 'user' | 'dispatch' | 'listRuns' | 'getRun' | 'getJobs' | 'cancelRun' | 'getFile' | 'putFile';

const ENDPOINTS: { endpoint: Endpoint; method: string; path: RegExp }[] = [
  { endpoint: 'user', method: 'GET', path: /^\/user$/ },
  { endpoint: 'dispatch', method: 'POST', path: /^\/actions\/workflows\/e2e\.yml\/dispatches$/ },
  { endpoint: 'listRuns', method: 'GET', path: /^\/actions\/workflows\/e2e\.yml\/runs$/ },
  { endpoint: 'getRun', method: 'GET', path: /^\/actions\/runs\/\d+$/ },
  { endpoint: 'getJobs', method: 'GET', path: /^\/actions\/runs\/\d+\/jobs$/ },
  { endpoint: 'cancelRun', method: 'POST', path: /^\/actions\/runs\/\d+\/cancel$/ },
  { endpoint: 'getFile', method: 'GET', path: /^\/contents\/config\/descriptions\.json$/ },
  { endpoint: 'putFile', method: 'PUT', path: /^\/contents\/config\/descriptions\.json$/ },
];

/** One request the page sent to api.github.com. */
export interface ApiCall {
  endpoint: Endpoint | 'unknown';
  method: string;
  /** Path without the query, e.g. "/repos/NTCloudy/playwright-e2e-dashboard/actions/runs/1". */
  path: string;
  query: Record<string, string>;
  /** Request headers, lower-case names. */
  headers: Record<string, string>;
  /** The token of the Authorization header; null for anonymous requests. */
  token: string | null;
  /** The JSON body, or null. */
  body: unknown;
}

/** The body the dashboard sends to start a run (POST .../dispatches). */
export interface DispatchBody {
  ref: string;
  inputs: Record<string, string>;
}

/** A PUT of config/descriptions.json, with its Base64 content decoded. */
export interface SaveRequest {
  message: string;
  sha: string;
  branch: string;
  author?: { name: string; email: string };
  committer?: { name: string; email: string };
  /** The decoded file content. */
  text: string;
}

/** A commit the mock accepted. */
export interface Commit {
  sha: string;
  htmlUrl: string;
  message: string;
  text: string;
}

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

const errorReply = (status: number, message: string): Reply => ({
  status,
  body: { message, documentation_url: 'https://docs.github.com/rest', status: String(status) },
});

/** The git blob sha of a text, as the contents API reports it. */
const blobSha = (text: string): string => {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};

/** config/descriptions.json formatted like the dashboard and the committed file (shared/descriptions.mjs). */
export const serializeDescriptions = (docs: Descriptions): string => `${JSON.stringify(docs, null, 2)}\n`;

// ---------------------------------------------------------------- workflow runs

/**
 * Where a run of e2e.yml is. The console shows the first five as phases
 * (queued, then "set up", "run tests", "collect results", "update site");
 * the last three are the ways a run ends.
 */
export type RunStage = 'queued' | 'setup' | 'tests' | 'publish' | 'deploy' | 'published' | 'cancelled' | 'broken';

type Status = 'queued' | 'in_progress' | 'completed';

interface Step {
  name: string;
  number: number;
  status: Status;
  conclusion: string | null;
}

interface Job {
  id: number;
  name: string;
  status: Status;
  conclusion: string | null;
  steps: Step[];
}

const COMPLETED: readonly RunStage[] = ['published', 'cancelled', 'broken'];
const STEPS = ['Set up job', 'Install Chromium', 'Run tests', 'Publish results'];

/** A simulated run of e2e.yml; a test moves it through its stages, the dashboard sees each change at its next poll. */
export class WorkflowRun {
  stage: RunStage = 'queued';
  startedAt: Date | null = null;
  cancelRequested = false;
  /** A failed test makes the run red ("failure"), but its results are still published. */
  testsFailed = false;

  constructor(
    readonly id: string,
    readonly runNumber: number,
    readonly rounds: number,
    readonly createdAt: Date,
    readonly event: string,
    private readonly now: () => Date,
  ) {}

  get htmlUrl(): string {
    return `${REPO_URL}/actions/runs/${this.id}`;
  }

  get completed(): boolean {
    return COMPLETED.includes(this.stage);
  }

  /** The test job's name; the console finds it by its "Run " prefix and reports it when it fails. */
  get testJobName(): string {
    return `Run ${this.rounds} round(s)`;
  }

  moveTo(stage: RunStage): void {
    if (stage !== 'queued') this.startedAt ??= this.now();
    this.stage = stage;
  }

  /** GET /repos/{owner}/{repo}/actions/runs/{id} */
  toJSON(): Record<string, unknown> {
    const conclusion = { published: this.testsFailed ? 'failure' : 'success', cancelled: 'cancelled', broken: 'failure' } as Partial<Record<RunStage, string>>;
    return {
      id: Number(this.id),
      name: 'E2E tests',
      run_number: this.runNumber,
      event: this.event,
      head_branch: REPO.branch,
      status: this.stage === 'queued' ? 'queued' : this.completed ? 'completed' : 'in_progress',
      conclusion: conclusion[this.stage] ?? null,
      html_url: this.htmlUrl,
      created_at: this.createdAt.toISOString(),
      run_started_at: (this.startedAt ?? this.createdAt).toISOString(),
      updated_at: this.now().toISOString(),
    };
  }

  /** GET /repos/{owner}/{repo}/actions/runs/{id}/jobs */
  jobs(): Job[] {
    const id = Number(this.id) * 10;
    const job = (offset: number, name: string, status: Status, conclusion: string | null, steps: Step[] = []): Job => ({ id: id + offset, name, status, conclusion, steps });
    // The index of the step in progress ("Run tests" is 2); earlier steps are done, later ones queued.
    const steps = (current: number): Step[] =>
      STEPS.map((name, i) => ({
        name,
        number: i + 1,
        status: i < current ? 'completed' : i === current ? 'in_progress' : 'queued',
        conclusion: i < current ? 'success' : null,
      }));
    const done = steps(STEPS.length);
    switch (this.stage) {
      case 'queued':
        return [job(1, this.testJobName, 'queued', null)];
      case 'setup':
        return [job(1, this.testJobName, 'in_progress', null, steps(1))];
      case 'tests':
        return [job(1, this.testJobName, 'in_progress', null, steps(2))];
      case 'publish':
        return [job(1, this.testJobName, 'in_progress', null, steps(3))];
      case 'deploy':
        return [job(1, this.testJobName, 'completed', 'success', done), job(2, 'Deploy dashboard', 'in_progress', null)];
      case 'published':
        return [
          job(1, this.testJobName, 'completed', 'success', done),
          job(2, 'Deploy dashboard', 'completed', 'success'),
          job(3, 'Verdict', 'completed', this.testsFailed ? 'failure' : 'success'),
        ];
      case 'cancelled':
        return [job(1, this.testJobName, 'completed', 'cancelled', steps(2))];
      case 'broken': {
        const failed = steps(1).map((step) => (step.status === 'in_progress' ? { ...step, status: 'completed' as const, conclusion: 'failure' } : step));
        return [job(1, this.testJobName, 'completed', 'failure', failed), job(2, 'Deploy dashboard', 'completed', 'skipped')];
      }
    }
  }
}

// ---------------------------------------------------------------- the mock

/**
 * A fake api.github.com for one browser context: answers every endpoint the
 * dashboard uses with GitHub's shapes, status codes and CORS headers, keeps
 * state (tokens, workflow runs, config/descriptions.json and its blob sha) and
 * records every request so tests can assert on them.
 *
 * Defaults: OWNER_TOKEN is a valid token of the owner; the descriptions file
 * on GitHub is the one the site was built with; run #3 of the fixture history
 * is a finished earlier run. Tests change any of it before or during a test.
 */
export class GitHubMock {
  /** Every request, in order. */
  readonly requests: ApiCall[] = [];
  /** Commits made through the mock (descriptions saved by the dashboard). */
  readonly commits: Commit[] = [];
  /** Inputs the workflow accepts; see WORKFLOW_INPUTS. */
  readonly workflowInputs = structuredClone(WORKFLOW_INPUTS);
  /** Answer POST .../dispatches with the new run's id (200) instead of the classic 204 without a body. */
  dispatchReturnsRunId = false;

  private readonly tokens = new Map<string, Account>();
  private readonly runs: WorkflowRun[] = [];
  private readonly failures: { endpoint: Endpoint; reply: Reply; times: number }[] = [];
  private readonly holds = new Map<Endpoint, Promise<void>>();
  private readonly releases: (() => void)[] = [];
  private readonly beforeSave: ((docs: Descriptions) => void)[] = [];
  private readonly unknown: string[] = [];
  private file: { text: string; sha: string };
  private nextRunNumber = 4;
  private closed = false;

  constructor(private readonly now: () => Date) {
    this.addToken(OWNER_TOKEN);
    const text = serializeDescriptions(siteCatalog().descriptions);
    this.file = { text, sha: blobSha(text) };
    const previous = this.addRun({ id: '21000000003', runNumber: 3, rounds: 3, createdAt: new Date('2026-10-05T08:00:00Z') });
    previous.moveTo('published');
  }

  async install(context: BrowserContext): Promise<void> {
    await context.route(`${API}/**`, (route) => this.handle(route));
  }

  /** Releases held requests; requests that arrive afterwards are answered normally. */
  close(): void {
    this.closed = true;
    this.releases.forEach((release) => release());
  }

  /** Throws when the page called an endpoint the mock does not know (a test would otherwise pass by accident). */
  verifyNoUnknownCalls(): void {
    if (this.unknown.length) throw new Error(`The page called GitHub endpoints the mock does not implement:\n${this.unknown.join('\n')}`);
  }

  // ---------------------------------------------------------------- configuration

  /** Makes `token` valid for an account (by default the owner with full access). Returns the account to adjust. */
  addToken(token: string, account: Partial<Account> = {}): Account {
    const entry = { ...OWNER, ...account };
    this.tokens.set(token, entry);
    return entry;
  }

  /** The account of a token, e.g. `github.account(OWNER_TOKEN).contents = 'read'`. */
  account(token: string): Account {
    const entry = this.tokens.get(token);
    if (!entry) throw new Error(`Unknown token ${token}`);
    return entry;
  }

  /** Answers the next `times` requests to `endpoint` with a GitHub error. */
  failNext(endpoint: Endpoint, status: number, message: string, times = 1): void {
    this.failures.push({ endpoint, reply: errorReply(status, message), times });
  }

  /** Holds the next request to `endpoint` until the returned function is called (to see "in progress" states). */
  hold(endpoint: Endpoint): () => void {
    let release = (): void => {};
    this.holds.set(
      endpoint,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    this.releases.push(release);
    return release;
  }

  // ---------------------------------------------------------------- config/descriptions.json

  /** The file on GitHub. */
  get descriptionsText(): string {
    return this.file.text;
  }

  get descriptionsSha(): string {
    return this.file.sha;
  }

  /** The file on GitHub, parsed. */
  descriptions(): Descriptions {
    return JSON.parse(this.file.text) as Descriptions;
  }

  /** Commits a change to the file as someone else would, e.g. an edit the deployed site does not have yet. */
  editDescriptions(edit: (docs: Descriptions) => void): void {
    const docs = this.descriptions();
    edit(docs);
    const text = serializeDescriptions(docs);
    this.file = { text, sha: blobSha(text) };
  }

  /** Commits `edit` just before the next save from the dashboard arrives, so that save conflicts (409). */
  editBeforeNextSave(edit: (docs: Descriptions) => void): void {
    this.beforeSave.push(edit);
  }

  // ---------------------------------------------------------------- workflow runs

  /** Adds a run (by default a run of the dashboard created now, still queued). */
  addRun({
    id = String(21_000_000_000 + this.nextRunNumber),
    runNumber = this.nextRunNumber,
    rounds = 3,
    createdAt = this.now(),
    event = 'workflow_dispatch',
  }: Partial<{ id: string; runNumber: number; rounds: number; createdAt: Date; event: string }> = {}): WorkflowRun {
    const run = new WorkflowRun(id, runNumber, rounds, createdAt, event, this.now);
    this.runs.push(run);
    this.nextRunNumber = Math.max(this.nextRunNumber, runNumber + 1);
    return run;
  }

  run(id: string): WorkflowRun {
    const run = this.runs.find((r) => r.id === id);
    if (!run) throw new Error(`Unknown run ${id}`);
    return run;
  }

  /** The run started by the last dispatch (waits for the dispatch request). */
  async dispatchedRun(): Promise<WorkflowRun> {
    await expect.poll(() => this.calls('dispatch').length, { message: 'the dashboard should start a run' }).toBeGreaterThan(0);
    const run = this.runs.at(-1);
    if (!run) throw new Error('No run was created');
    return run;
  }

  // ---------------------------------------------------------------- recorded requests

  calls(endpoint: Endpoint): ApiCall[] {
    return this.requests.filter((call) => call.endpoint === endpoint);
  }

  lastCall(endpoint: Endpoint): ApiCall {
    const call = this.calls(endpoint).at(-1);
    if (!call) throw new Error(`GitHub got no "${endpoint}" request`);
    return call;
  }

  /** Waits until GitHub got exactly `count` requests to `endpoint`. */
  async expectCalls(endpoint: Endpoint, count: number): Promise<void> {
    await expect.poll(() => this.calls(endpoint).length, { message: `"${endpoint}" requests` }).toBe(count);
  }

  /** The bodies of the dispatch requests. */
  dispatches(): DispatchBody[] {
    return this.calls('dispatch').map((call) => call.body as DispatchBody);
  }

  /** The saves of config/descriptions.json the dashboard sent (also refused ones), content decoded. */
  saves(): SaveRequest[] {
    return this.calls('putFile').map((call) => {
      const { content, ...rest } = call.body as Omit<SaveRequest, 'text'> & { content: string };
      return { ...rest, text: Buffer.from(content, 'base64').toString('utf8') };
    });
  }

  // ---------------------------------------------------------------- request handling

  private async handle(route: Route): Promise<void> {
    const call = this.record(route.request());
    const hold = call.endpoint === 'unknown' ? undefined : this.holds.get(call.endpoint);
    if (hold && call.endpoint !== 'unknown') {
      this.holds.delete(call.endpoint);
      await hold;
    }
    const reply = this.takeFailure(call) ?? this.reply(call);
    const json = reply.body !== undefined;
    try {
      await route.fulfill({
        status: reply.status,
        headers: { ...CORS_HEADERS, ...(json ? { 'content-type': 'application/json; charset=utf-8' } : {}), ...reply.headers },
        body: json ? JSON.stringify(reply.body) : '',
      });
    } catch (error) {
      // The page may be gone once a held request is released at the end of a test.
      if (!this.closed) throw error;
    }
  }

  private record(request: Request): ApiCall {
    const url = new URL(request.url());
    const repoPath = url.pathname.startsWith(`${REPO_PATH}/`) ? url.pathname.slice(REPO_PATH.length) : url.pathname;
    const method = request.method();
    const match = ENDPOINTS.find((e) => e.method === method && e.path.test(repoPath) && (e.endpoint === 'user' || repoPath !== url.pathname));
    const headers = request.headers();
    const raw = request.postData();
    const call: ApiCall = {
      endpoint: match?.endpoint ?? 'unknown',
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      token: /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1] ?? null,
      body: raw ? (JSON.parse(raw) as unknown) : null,
    };
    this.requests.push(call);
    if (!match) this.unknown.push(`${method} ${url.pathname}${url.search}`);
    return call;
  }

  private takeFailure(call: ApiCall): Reply | undefined {
    const failure = this.failures.find((f) => f.endpoint === call.endpoint);
    if (!failure) return undefined;
    if (--failure.times === 0) this.failures.splice(this.failures.indexOf(failure), 1);
    return failure.reply;
  }

  /** The account of the call's token; an error reply when the token is unknown or lacks `scope` at `level`. */
  private authorize(call: ApiCall, scope: 'actions' | 'contents' | null, level: 'read' | 'write'): Account | null | Reply {
    if (!call.token) return level === 'write' || !scope ? errorReply(401, 'Requires authentication') : null;
    const account = this.tokens.get(call.token);
    if (!account) return errorReply(401, 'Bad credentials');
    const granted = scope ? account[scope] : 'write';
    if (granted === 'none' || (level === 'write' && granted !== 'write')) return errorReply(403, 'Resource not accessible by personal access token');
    return account;
  }

  private reply(call: ApiCall): Reply {
    const runId = /\/actions\/runs\/(\d+)/.exec(call.path)?.[1] ?? '';
    switch (call.endpoint) {
      case 'user': {
        const account = this.authorize(call, null, 'read');
        if (!account || 'status' in account) return account ?? errorReply(401, 'Requires authentication');
        return {
          status: 200,
          body: { login: account.login, id: account.id, type: 'User', html_url: `https://github.com/${account.login}` },
          headers: account.expiration ? { 'github-authentication-token-expiration': account.expiration } : {},
        };
      }
      case 'dispatch':
        return this.dispatch(call);
      case 'listRuns': {
        const denied = this.authorize(call, 'actions', 'read');
        if (denied && 'status' in denied) return denied;
        const perPage = Number(call.query.per_page ?? 30);
        const runs = this.runs
          .filter((run) => !call.query.event || run.event === call.query.event)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return { status: 200, body: { total_count: runs.length, workflow_runs: runs.slice(0, perPage).map((run) => run.toJSON()) } };
      }
      case 'getRun':
      case 'getJobs': {
        const denied = this.authorize(call, 'actions', 'read');
        if (denied && 'status' in denied) return denied;
        const run = this.runs.find((r) => r.id === runId);
        if (!run) return errorReply(404, 'Not Found');
        if (call.endpoint === 'getRun') return { status: 200, body: run.toJSON() };
        const jobs = run.jobs();
        return { status: 200, body: { total_count: jobs.length, jobs } };
      }
      case 'cancelRun': {
        const denied = this.authorize(call, 'actions', 'write');
        if (denied && 'status' in denied) return denied;
        const run = this.runs.find((r) => r.id === runId);
        if (!run) return errorReply(404, 'Not Found');
        if (run.completed) return errorReply(409, 'Cannot cancel a workflow run that is completed.');
        run.cancelRequested = true;
        return { status: 202, body: {} };
      }
      case 'getFile': {
        const denied = this.authorize(call, 'contents', 'read');
        if (denied && 'status' in denied) return denied;
        const base64 = Buffer.from(this.file.text, 'utf8').toString('base64');
        return {
          status: 200,
          body: {
            type: 'file',
            encoding: 'base64',
            name: 'descriptions.json',
            path: DESCRIPTIONS_PATH,
            sha: this.file.sha,
            size: Buffer.byteLength(this.file.text),
            // GitHub wraps the Base64 content every 60 characters.
            content: `${base64.replace(/.{60}/g, '$&\n')}\n`,
          },
        };
      }
      case 'putFile':
        return this.save(call);
      case 'unknown':
        return errorReply(404, 'Not Found');
    }
  }

  private dispatch(call: ApiCall): Reply {
    const denied = this.authorize(call, 'actions', 'write');
    if (denied && 'status' in denied) return denied;
    const { ref, inputs = {} } = (call.body ?? {}) as Partial<DispatchBody>;
    if (ref !== REPO.branch) return errorReply(422, `No ref found for: ${String(ref)}`);
    const unexpected = Object.keys(inputs).filter((name) => !(name in this.workflowInputs));
    if (unexpected.length) return errorReply(422, `Unexpected inputs provided: ${JSON.stringify(unexpected)}`);
    for (const [name, value] of Object.entries(inputs)) {
      const options = this.workflowInputs[name]?.options;
      if (options && !options.includes(value)) return errorReply(422, `Provided value '${value}' for input '${name}' not in the list of allowed values`);
    }
    const run = this.addRun({ rounds: Number(inputs.rounds ?? 3) });
    if (!this.dispatchReturnsRunId) return { status: 204 };
    return { status: 200, body: { workflow_run_id: Number(run.id), run_url: `${API}${REPO_PATH}/actions/runs/${run.id}`, html_url: run.htmlUrl } };
  }

  private save(call: ApiCall): Reply {
    const denied = this.authorize(call, 'contents', 'write');
    if (denied && 'status' in denied) return denied;
    for (const edit of this.beforeSave.splice(0, 1)) this.editDescriptions(edit);
    const [request] = this.saves().slice(-1);
    if (request.branch !== REPO.branch) return errorReply(422, `Branch ${request.branch} not found`);
    if (request.sha !== this.file.sha) return errorReply(409, `${DESCRIPTIONS_PATH} does not match ${request.sha}`);
    this.file = { text: request.text, sha: blobSha(request.text) };
    const sha = createHash('sha1').update(`commit ${this.commits.length + 1}\n${request.text}`).digest('hex');
    const commit = { sha, htmlUrl: `${REPO_URL}/commit/${sha}`, message: request.message, text: request.text };
    this.commits.push(commit);
    return {
      status: 200,
      body: { content: { name: 'descriptions.json', path: DESCRIPTIONS_PATH, sha: this.file.sha }, commit: { sha, html_url: commit.htmlUrl, message: commit.message } },
    };
  }
}
