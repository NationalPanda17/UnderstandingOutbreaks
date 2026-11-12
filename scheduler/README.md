# Scheduler

A small Cloudflare Worker that starts the data workflows on time.

GitHub runs scheduled workflows on a best-effort basis: a run can start hours late or not at all. This Worker uses
Cloudflare cron triggers, which fire on schedule, and asks GitHub to start the workflow. It does nothing else: it
reads no data, writes no data and has no public address.

| When (UTC) | Starts |
| --- | --- |
| Minute 47 of every hour except 05, 11, 17, 23 | `check-notices.yml` |
| 05:17 | `update-data.yml` (always rebuilds and deploys) |
| 11:17, 17:17, 23:17 | `update-data.yml` with `only_if_changed` (deploys only when something changed) |

The same schedules stay in the workflow files as a fallback. A full update started by GitHub's own timer is skipped
when another full update ran in the previous three hours, so a late fallback run does not repeat the work.

## Setting it up

1. Create a fine-grained personal access token on GitHub: *Settings → Developer settings → Fine-grained tokens*.
   Repository access: only this repository. Repository permissions: **Actions: Read and write**. Nothing else.
2. Add it to this repository as an Actions secret named `SCHEDULER_GITHUB_TOKEN`
   (*Settings → Secrets and variables → Actions*).
3. The Cloudflare API token already stored as `CLOUDFLARE_API_TOKEN` needs the **Workers Scripts: Edit** permission
   in addition to what it has for Pages and R2.
4. Run the **Deploy scheduler** workflow (it also runs when a file in this folder changes). It deploys the Worker
   and passes the token to it as an encrypted Worker secret.

When the token expires, create a new one, update the `SCHEDULER_GITHUB_TOKEN` secret and run **Deploy scheduler**
again. Until then the Worker's log shows the refused request, and GitHub's own timer keeps the site updating, late.

## Checking it

The Worker's runs and errors are in the Cloudflare dashboard under *Workers & Pages → uo-scheduler → Logs*. Runs it
starts appear in the repository's Actions tab with the event `workflow_dispatch`.
