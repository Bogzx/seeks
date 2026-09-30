# The maker image for `seeks run --container` (default tag: seeks-maker:latest).
#   docker build -t seeks-maker docker/
# It needs node + git (the seeks hooks) and the Claude Code CLI. Add whatever YOUR done-conditions
# run (python + pytest, cargo, …) in a derived image:  FROM seeks-maker  /  RUN apt-get install …
# Nothing from your machine is baked in: seeks mounts the loop's worktree, the repo's .git and .seeks,
# and the plugin (read-only) at run time, and passes credentials (ANTHROPIC_API_KEY, …) by env name.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force
# seeks runs the container as your uid:gid with HOME under .seeks/run/<name>/container-home
# (so a crashed run can --resume its conversation); git must accept that owner's repo.
RUN git config --system safe.directory '*'
