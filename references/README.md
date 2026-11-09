# Historical Phase 0 reference

`phase0/` is a source snapshot from commit
`72a10d20bb298f4fcbf823519587e8fc9590234b` on
[`feat/phase0-disposable-mcp`](https://github.com/ruairicasey/chatgpt-weight-tracker/pull/2).
It includes the later macOS launcher and direct-Node cleanup fix. PR #2 is not
merged by this work. Files in the snapshot are unchanged.

The owner verified actual Plus read/write calls, identical replay and a new-chat
read of the same record/receipt/instance. OAuth and durable storage were not tested.
The historical README predates that manual result; its pending-test language is
retained as historical documentation, not the current project status.

This directory is excluded from pnpm workspace discovery, active lint/typecheck,
builds and normal CI. The active boundary check forbids production imports from
it. Its noauth tools, process-local data, temporary tunnel and synthetic ownership
must never become a production fallback. Do not start its server or tunnel during
Phase 1A. All future tracker tools require authenticated, authorized identities.

If separately authorized to reproduce the spike, install its independent lockfile
with `pnpm install --ignore-workspace --frozen-lockfile` from `references/phase0`,
then use that snapshot's README. That reproduction is not a production deployment.
