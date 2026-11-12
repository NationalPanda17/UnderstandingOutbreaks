// External timer for the data workflows.
//
// GitHub's own scheduler is best-effort: it can start a scheduled workflow hours late or skip it. This Worker runs on
// Cloudflare's cron triggers, which fire on time, and does one thing: it asks GitHub to start a workflow, exactly as
// a person pressing "Run workflow" would. It reads no data, writes no data and serves no pages.
//
// Settings (see scheduler/README.md):
//   GITHUB_REPOSITORY  "owner/name" of the repository, set at deploy time
//   GITHUB_TOKEN       secret: a fine-grained token for that one repository with "Actions: read and write"

/** Which workflow each cron trigger starts. The cron strings must match wrangler.toml exactly (a test checks this). */
export const PLAN = {
  // hourly notice check, skipping the hours of the full update (which reads the same feeds)
  '47 0-4,6-10,12-16,18-22 * * *': { workflow: 'check-notices.yml', inputs: {} },
  // daily full update: always rebuilds and deploys
  '17 5 * * *': { workflow: 'update-data.yml', inputs: {} },
  // the other three six-hourly updates: deploy only when something changed
  '17 11,17,23 * * *': { workflow: 'update-data.yml', inputs: { only_if_changed: 'true' } },
};

export function planFor(cron) { return PLAN[cron] ?? null; }

/** Start one workflow on the main branch. Resolves to the HTTP status; throws after two failed attempts. */
export async function dispatch(env, plan, fetchImpl = fetch) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY) throw new Error('scheduler is not configured: GITHUB_TOKEN or GITHUB_REPOSITORY is missing');
  const url = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${plan.workflow}/dispatches`;
  let last = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'workflow-timer',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: plan.inputs }),
    });
    if (res.status === 204) return res.status;
    last = `${res.status} ${(await res.text()).slice(0, 200)}`;
    // a wrong or expired token will not start working on a second try
    if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 422) break;
  }
  throw new Error(`GitHub did not start ${plan.workflow}: ${last}`);
}

export default {
  async scheduled(event, env, ctx) {
    const plan = planFor(event.cron);
    if (!plan) { console.error(`no workflow is planned for cron "${event.cron}"`); return; }
    ctx.waitUntil(dispatch(env, plan).then(() => console.log(`started ${plan.workflow} ${JSON.stringify(plan.inputs)}`)));
  },
  // The Worker has no public address (workers_dev is off and it has no route). This is only a safe default.
  async fetch() { return new Response('Not found', { status: 404 }); },
};
