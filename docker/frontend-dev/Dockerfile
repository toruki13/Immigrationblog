# Build a development image with all node_modules pre-installed
# This avoids re-downloading npm packages every time the container starts

ARG NODE_VERSION=22.18.0

FROM node:$NODE_VERSION-bullseye-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y \
    build-essential \
    curl \
    python3 \
    git && \
    rm -rf /var/lib/apt/lists/* && \
    apt clean

WORKDIR /home/ghost

# Copy all package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches patches
COPY ghost/core/package.json ghost/core/package.json
COPY ghost/i18n/package.json ghost/i18n/package.json
COPY ghost/parse-email-address/package.json ghost/parse-email-address/package.json
COPY ghost/admin/package.json ghost/admin/package.json
COPY apps/activitypub/package.json apps/activitypub/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/admin-x-design-system/package.json apps/admin-x-design-system/package.json
COPY apps/admin-x-framework/package.json apps/admin-x-framework/package.json
COPY apps/admin-x-settings/package.json apps/admin-x-settings/package.json
COPY apps/announcement-bar/package.json apps/announcement-bar/package.json
COPY apps/comments-ui/package.json apps/comments-ui/package.json
COPY apps/portal/package.json apps/portal/package.json
COPY apps/posts/package.json apps/posts/package.json
COPY apps/shade/package.json apps/shade/package.json
COPY apps/signup-form/package.json apps/signup-form/package.json
COPY apps/sodo-search/package.json apps/sodo-search/package.json
COPY apps/stats/package.json apps/stats/package.json
COPY ghost/admin/ember-cli-build.js ghost/admin/ember-cli-build.js
COPY .github/hooks .github/hooks
COPY .github/scripts/enforce-package-manager.js .github/scripts/enforce-package-manager.js
COPY .github/scripts/install-deps.sh .github/scripts/install-deps.sh

# Enable corepack so it can read packageManager from package.json and provide pnpm
RUN corepack enable
RUN bash .github/scripts/install-deps.sh

# Copy the frontend dev runner script
COPY docker/dev-gateway/run-frontend-dev.js /home/ghost/docker/dev-gateway/run-frontend-dev.js

# Expose all dev server ports
EXPOSE 4200 4201 5173 5174 5175 5176 5177 5178

WORKDIR /home/ghost

CMD ["node", "docker/dev-gateway/run-frontend-dev.js"]
