// Minimal GitHub REST API client for the dashboard: start a workflow run and
// follow it, and read/update one file (the case descriptions). Requests go
// straight from the browser to api.github.com.
import { REPO, WORKFLOW_FILE, store } from './core.js';

const API = 'https://api.github.com';
const TOKEN_KEY = 'e2e-console-token';
const REPO_PATH = `/repos/${REPO.owner}/${REPO.name}`;

/**
 * The token never leaves this browser: it is kept in sessionStorage (until
 * the tab is closed), or in localStorage when "remember" is ticked.
 */
export const tokenStore = {
  get() {
    return store.get(TOKEN_KEY, 'session') ?? store.get(TOKEN_KEY, 'local');
  },
  save(entry, remember) {
    this.clear();
    store.set(TOKEN_KEY, entry, remember ? 'local' : 'session');
  },
  clear() {
    store.remove(TOKEN_KEY, 'session');
    store.remove(TOKEN_KEY, 'local');
  },
  remembered() {
    return store.get(TOKEN_KEY, 'local') !== null;
  },
};

export class GitHubError extends Error {
  constructor(status, message, kind) {
    super(message);
    this.status = status;
    /** unauthorized | forbidden | notFound | rateLimited | conflict | rejected | network | other */
    this.kind = kind;
  }
}

function classify(status, message) {
  if (status === 401) return 'unauthorized';
  if (status === 403 || status === 429) return /rate limit/i.test(message) ? 'rateLimited' : 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 422) return 'rejected';
  return 'other';
}

async function api(path, { token, method = 'GET', body } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new GitHubError(0, 'network error', 'network');
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!response.ok) {
    const message = data?.message ?? response.statusText ?? '';
    throw new GitHubError(response.status, message, classify(response.status, message));
  }
  return { data, headers: response.headers };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Checks that the token works; returns the account and (if GitHub tells) the expiry. */
export async function verifyToken(token) {
  const { data, headers } = await api('/user', { token });
  return { login: data?.login ?? '', id: data?.id ?? null, expires: headers.get('github-authentication-token-expiration') };
}

/** Starts the workflow with the given inputs; resolves to the new run { id, htmlUrl }. */
export async function dispatchRun(token, inputs) {
  const since = Date.now();
  const { data } = await api(`${REPO_PATH}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    token,
    method: 'POST',
    body: { ref: REPO.branch, inputs },
  });
  if (data?.workflow_run_id) return { id: data.workflow_run_id, htmlUrl: data.html_url ?? null };

  // Older API behaviour (204 without a body): look for the run that was just created.
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(3000);
    const { data: list } = await api(`${REPO_PATH}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=5`, { token });
    const run = list?.workflow_runs?.find((r) => Date.parse(r.created_at) >= since - 15_000);
    if (run) return { id: run.id, htmlUrl: run.html_url };
  }
  throw new GitHubError(0, 'The new run did not show up.', 'other');
}

export async function getRun(token, id) {
  return (await api(`${REPO_PATH}/actions/runs/${encodeURIComponent(id)}`, { token })).data;
}

export async function getJobs(token, id) {
  return (await api(`${REPO_PATH}/actions/runs/${encodeURIComponent(id)}/jobs?per_page=20`, { token })).data?.jobs ?? [];
}

export async function cancelRun(token, id) {
  await api(`${REPO_PATH}/actions/runs/${encodeURIComponent(id)}/cancel`, { token, method: 'POST' });
}

// ---------------------------------------------------------------- files

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

/** UTF-8 safe Base64 (the contents API sends and expects Base64). */
function toBase64(text) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(String(base64).replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** A file on the default branch: its text and blob sha (the sha is needed to update it). Works without a token. */
export async function getFile(token, path) {
  const { data } = await api(`${REPO_PATH}/contents/${encodePath(path)}?ref=${encodeURIComponent(REPO.branch)}`, { token });
  if (data?.type !== 'file' || typeof data.content !== 'string') throw new GitHubError(0, `${path} is not a file`, 'other');
  return { text: fromBase64(data.content), sha: data.sha };
}

/**
 * Commits a new version of a file to the default branch. `sha` is the blob
 * sha the change is based on: GitHub refuses the commit (409) when the file
 * changed in the meantime, so nobody's edit is overwritten silently.
 */
export async function putFile(token, path, { text, sha, message, author }) {
  const body = { message, content: toBase64(text), sha, branch: REPO.branch };
  if (author) Object.assign(body, { author, committer: author });
  const { data } = await api(`${REPO_PATH}/contents/${encodePath(path)}`, { token, method: 'PUT', body });
  return { sha: data?.content?.sha ?? null, commitUrl: data?.commit?.html_url ?? null };
}

/** The account's private "noreply" address, so commits made here never expose a real e-mail address. */
export const noreplyAuthor = (entry) =>
  entry?.login && entry?.id ? { name: entry.login, email: `${entry.id}+${entry.login}@users.noreply.github.com` } : undefined;
