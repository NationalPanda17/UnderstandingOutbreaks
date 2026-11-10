# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

- Preferred: GitHub's "Report a vulnerability" button (private security advisory) on this repository.
- Alternative: the security contact configured in `config/site.json` (`identity.securityContact`). A maintainer must
  fill this in; it is empty by default so that no contact is invented.

Please include what you found, how to reproduce it, and what you think the impact is. We aim to acknowledge reports
within a week.

## What is in scope

- The static site (cross-site scripting, unsafe handling of shared URLs, model specifications, imported files).
- The model-specification parser: rate expressions must never be able to run arbitrary code.
- The data pipeline (handling of untrusted source responses) and the GitHub workflows.

## Design notes relevant to security

- The site has no server-side runtime, no accounts, no cookies and makes no third-party requests.
- A Content-Security-Policy is generated at build time (`site/scripts/postbuild.mjs`). Only `/embed/*` may be framed.
- Files a user loads into the workbench are processed in the browser and are never uploaded.
- Rate expressions in model specs are parsed by a whitelist grammar (`site/src/sim/engine/expr.ts`); there is no `eval`.
- The pipeline opens GitHub issues only. It never opens pull requests, pushes commits or merges changes.
