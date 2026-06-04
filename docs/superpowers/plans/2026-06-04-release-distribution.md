# Release Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Instatic as an open-source, image-first product with GitHub source releases, GHCR images, optional Docker Hub mirroring, release bundles, and a later npm package for plugin authors.

**Architecture:** Semver git tags drive one release workflow. The workflow verifies the repo with Bun, builds a multi-arch OCI image from the existing `Dockerfile`, publishes the image to GHCR, creates or updates the GitHub Release, and attaches a small operator bundle containing Compose files and install docs. The production app remains Docker-first; npm distribution is limited to the plugin SDK/CLI after extracting it from internal `@core/*` dependencies.

**Tech Stack:** Bun, TypeScript, GitHub Actions, Docker Buildx, GitHub Container Registry, Docker Hub, GitHub CLI, npm trusted publishing for the SDK package.

---

## Scope Check

This release work has two separate tracks:

1. **Release distribution:** GHCR image, release bundle, GitHub Release, Docker Hub mirror, docs. This is required before launch and can be implemented now.
2. **npm author tooling:** `@instatic/plugin-sdk` plus the `instatic-plugin` binary. This is useful for plugin authors, but it is not the main app install path. It requires a real package extraction because the SDK currently imports host internals such as `@core/page-tree`, `@core/plugins/manifest`, and `@site/store/types`.

Implement Track 1 first. Implement Track 2 only after confirming the npm scope `@instatic` is owned by the project. If the scope cannot be owned, use `@corebunch/plugin-sdk` and update every `@instatic/plugin-sdk` import in examples and docs in the same change.

## File Structure

Track 1 files:

- Modify `Dockerfile`: add OCI image labels and release build args.
- Modify `.dockerignore`: exclude `.tmp` release artifacts from Docker build context.
- Create `.github/workflows/release.yml`: verify, image publish, release bundle upload.
- Create `scripts/build-release-bundle.ts`: stage and pack the operator install bundle.
- Modify `package.json`: add `release:bundle`.
- Modify `docs/deployment/release-workflow.md`: document the new workflow and tag policy.
- Modify `docs/deployment/docker-image.md`: document GHCR tags and Docker Hub mirror.
- Modify `docs/deployment/vps.md`: document release-bundle install.
- Modify `README.md`: update production deployment to prefer image-pull installs after first public release.

Track 2 files:

- Modify `package.json`: add Bun workspaces and keep the root package `private: true`.
- Create `packages/plugin-sdk/package.json`: npm package metadata, exports, and `instatic-plugin` binary.
- Move `src/core/plugin-sdk/**` to `packages/plugin-sdk/src/**`: make the npm package the SDK source of truth.
- Modify `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, and `vite.config.ts`: map `@instatic/plugin-sdk` to the workspace source for host builds.
- Modify internal imports in `src/`, `server/`, and tests: replace host imports from `@core/plugin-sdk` with `@instatic/plugin-sdk` where the public SDK is correct.
- Modify examples under `examples/plugins/**`: remove local tsconfig shims that point `@instatic/plugin-sdk` back to `src/core/plugin-sdk`.
- Create `src/__tests__/architecture/plugin-sdk-package-boundary.test.ts`: ensure the npm package has no `@core/*`, `@site/*`, `@admin/*`, or `server/*` imports.
- Create `.github/workflows/npm-plugin-sdk.yml`: publish `@instatic/plugin-sdk` from tags using npm trusted publishing.
- Modify `docs/features/plugin-system.md`: document `bunx @instatic/plugin-sdk` / `instatic-plugin` author flow.

## Task 1: Add OCI Metadata To The Runtime Image

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Add release build args and OCI labels to the runtime stage**

Add this immediately after `WORKDIR /app` in the final `FROM oven/bun:1.3 AS runtime` stage:

```dockerfile
ARG INSTATIC_VERSION=dev
ARG INSTATIC_REVISION=unknown
ARG INSTATIC_CREATED=unknown

LABEL org.opencontainers.image.title="Instatic"
LABEL org.opencontainers.image.description="Self-hosted CMS with an integrated visual editor."
LABEL org.opencontainers.image.source="https://github.com/corebunch/instatic"
LABEL org.opencontainers.image.url="https://github.com/corebunch/instatic"
LABEL org.opencontainers.image.documentation="https://github.com/corebunch/instatic/tree/main/docs/deployment"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.version="${INSTATIC_VERSION}"
LABEL org.opencontainers.image.revision="${INSTATIC_REVISION}"
LABEL org.opencontainers.image.created="${INSTATIC_CREATED}"
```

- [ ] **Step 2: Build locally to verify labels do not break the Dockerfile**

Run:

```sh
docker build \
  --build-arg INSTATIC_VERSION=0.0.0-test \
  --build-arg INSTATIC_REVISION="$(git rev-parse HEAD)" \
  --build-arg INSTATIC_CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t instatic:release-label-test .
```

Expected: Docker build completes and produces `instatic:release-label-test`.

- [ ] **Step 3: Inspect labels**

Run:

```sh
docker image inspect instatic:release-label-test \
  --format '{{ index .Config.Labels "org.opencontainers.image.source" }} {{ index .Config.Labels "org.opencontainers.image.version" }}'
```

Expected:

```txt
https://github.com/corebunch/instatic 0.0.0-test
```

## Task 2: Build The Release Bundle Script

**Files:**
- Create: `scripts/build-release-bundle.ts`
- Modify: `package.json`
- Modify: `.dockerignore`

- [ ] **Step 1: Add the bundle script**

Create `scripts/build-release-bundle.ts`:

```ts
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(import.meta.dir, '..')
const OUT_DIR = join(ROOT, '.tmp', 'release')

const version = Bun.argv[2] ?? process.env.INSTATIC_VERSION
if (!version) {
  throw new Error('Usage: bun run release:bundle -- <semver>')
}

const bundleName = `instatic-${version}`
const stagingDir = join(OUT_DIR, bundleName)
const archivePath = join(OUT_DIR, `${bundleName}-release-bundle.tar.gz`)

const bundleFiles = [
  'compose.prod.yml',
  'compose.sqlite.yml',
  'compose.tls.yml',
  '.env.production.example',
  'docs/deployment/README.md',
  'docs/deployment/vps.md',
  'docs/deployment/docker-image.md',
  'docs/deployment/tls-caddy.md',
  'docs/deployment/backup-restore.md',
]

async function copyIntoBundle(path: string): Promise<void> {
  const source = join(ROOT, path)
  if (!existsSync(source)) {
    throw new Error(`Release bundle source is missing: ${path}`)
  }
  const destination = join(stagingDir, path)
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, { recursive: true })
}

await rm(stagingDir, { recursive: true, force: true })
await rm(archivePath, { force: true })
await mkdir(stagingDir, { recursive: true })

for (const file of bundleFiles) {
  await copyIntoBundle(file)
}

await writeFile(
  join(stagingDir, 'INSTALL.md'),
  `# Instatic ${version} Install Bundle

This bundle contains the production Compose files and deployment docs for Instatic ${version}.

## SQLite, single-container install

\`\`\`sh
INSTATIC_IMAGE=ghcr.io/corebunch/instatic:${version} docker compose -f compose.prod.yml -f compose.sqlite.yml up -d
\`\`\`

## Postgres install

\`\`\`sh
cp .env.production.example .env
# Edit .env and set POSTGRES_PASSWORD.
INSTATIC_IMAGE=ghcr.io/corebunch/instatic:${version} docker compose -f compose.prod.yml up -d
\`\`\`

## HTTPS

Add \`compose.tls.yml\` and set \`DOMAIN\` in \`.env\`.

Read \`docs/deployment/vps.md\` and \`docs/deployment/backup-restore.md\` before running a public site.
`,
  'utf-8',
)

const tar = spawnSync('tar', ['-czf', archivePath, '-C', OUT_DIR, bundleName], {
  stdio: 'inherit',
})

if (tar.status !== 0) {
  throw new Error(`tar failed with exit code ${tar.status ?? 'unknown'}`)
}

console.log(archivePath)
```

- [ ] **Step 2: Add the package script**

In `package.json`, add this script near the existing build/test scripts:

```json
"release:bundle": "bun run scripts/build-release-bundle.ts"
```

- [ ] **Step 3: Keep local release artifacts out of Docker contexts**

Add this line to `.dockerignore`:

```txt
.tmp
```

- [ ] **Step 4: Verify the release bundle locally**

Run:

```sh
bun run release:bundle -- 0.0.0-test
tar -tzf .tmp/release/instatic-0.0.0-test-release-bundle.tar.gz | sort
```

Expected output includes:

```txt
instatic-0.0.0-test/.env.production.example
instatic-0.0.0-test/INSTALL.md
instatic-0.0.0-test/compose.prod.yml
instatic-0.0.0-test/compose.sqlite.yml
instatic-0.0.0-test/compose.tls.yml
instatic-0.0.0-test/docs/deployment/README.md
instatic-0.0.0-test/docs/deployment/backup-restore.md
instatic-0.0.0-test/docs/deployment/docker-image.md
instatic-0.0.0-test/docs/deployment/tls-caddy.md
instatic-0.0.0-test/docs/deployment/vps.md
```

## Task 3: Add The GitHub Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write
  packages: write

jobs:
  verify:
    name: Verify
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.0

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build
        run: bun run build

      - name: Test
        run: bun test

      - name: Lint
        run: bun run lint

  image:
    name: Publish GHCR Image
    runs-on: ubuntu-latest
    needs: verify
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Resolve release version
        id: version
        shell: bash
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          echo "version=${VERSION}" >> "$GITHUB_OUTPUT"
          echo "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$GITHUB_OUTPUT"

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ github.token }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/corebunch/instatic
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: |
            INSTATIC_VERSION=${{ steps.version.outputs.version }}
            INSTATIC_REVISION=${{ github.sha }}
            INSTATIC_CREATED=${{ steps.version.outputs.created }}

  bundle:
    name: Publish Release Bundle
    runs-on: ubuntu-latest
    needs:
      - verify
      - image
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Resolve release version
        id: version
        shell: bash
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.0

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build release bundle
        run: bun run release:bundle -- "${{ steps.version.outputs.version }}"

      - name: Create release if missing
        env:
          GH_TOKEN: ${{ github.token }}
        shell: bash
        run: |
          if gh release view "$GITHUB_REF_NAME" >/dev/null 2>&1; then
            exit 0
          fi
          gh release create "$GITHUB_REF_NAME" \
            --title "Instatic ${{ steps.version.outputs.version }}" \
            --generate-notes

      - name: Upload release bundle
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release upload "$GITHUB_REF_NAME" \
            ".tmp/release/instatic-${{ steps.version.outputs.version }}-release-bundle.tar.gz" \
            --clobber
```

- [ ] **Step 2: Verify workflow syntax locally**

Run:

```sh
bunx --bun prettier --check .github/workflows/release.yml
```

Expected: the YAML parses. If `prettier` is not installed or adding `bunx` network work is undesirable, run this instead:

```sh
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/release.yml"); puts "ok"'
```

Expected:

```txt
ok
```

- [ ] **Step 3: Verify normal repo gates**

Run:

```sh
bun run build
bun test
bun run lint
```

Expected: failures, if any, are unrelated to the release files. Triage against the local diff before fixing anything.

- [ ] **Step 4: Make the first GHCR package public**

After the first successful tagged release, open the package page for `ghcr.io/corebunch/instatic` in GitHub Packages and set visibility to public.

Verify anonymous pulls work:

```sh
docker logout ghcr.io
docker pull ghcr.io/corebunch/instatic:latest
```

Expected: the image pulls without a GitHub login.

## Task 4: Add Docker Hub Mirroring

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `docs/deployment/docker-image.md`
- Modify: `docs/deployment/release-workflow.md`

- [ ] **Step 1: Add the mirror job**

Append this job to `.github/workflows/release.yml` after the `image` job:

```yaml
  dockerhub:
    name: Mirror To Docker Hub
    runs-on: ubuntu-latest
    needs: image
    steps:
      - name: Resolve release version
        id: version
        shell: bash
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"

      - name: Check Docker Hub credentials
        id: credentials
        env:
          DOCKERHUB_USERNAME: ${{ secrets.DOCKERHUB_USERNAME }}
          DOCKERHUB_TOKEN: ${{ secrets.DOCKERHUB_TOKEN }}
        shell: bash
        run: |
          if [ -n "$DOCKERHUB_USERNAME" ] && [ -n "$DOCKERHUB_TOKEN" ]; then
            echo "enabled=true" >> "$GITHUB_OUTPUT"
          else
            echo "enabled=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Login to GHCR
        if: steps.credentials.outputs.enabled == 'true'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ github.token }}

      - name: Login to Docker Hub
        if: steps.credentials.outputs.enabled == 'true'
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Mirror image
        if: steps.credentials.outputs.enabled == 'true'
        run: |
          docker buildx imagetools create \
            --tag docker.io/corebunch/instatic:${{ steps.version.outputs.version }} \
            --tag docker.io/corebunch/instatic:latest \
            ghcr.io/corebunch/instatic:${{ steps.version.outputs.version }}

      - name: Report skipped mirror
        if: steps.credentials.outputs.enabled != 'true'
        run: echo "Docker Hub mirror skipped because DOCKERHUB_USERNAME or DOCKERHUB_TOKEN is not configured."
```

Then add `dockerhub` to the `bundle.needs` list:

```yaml
    needs:
      - verify
      - image
      - dockerhub
```

- [ ] **Step 2: Document Docker Hub as a mirror**

In `docs/deployment/docker-image.md`, add a short section under "Published Image":

````md
GHCR is the canonical image registry:

```sh
docker pull ghcr.io/corebunch/instatic:latest
docker pull ghcr.io/corebunch/instatic:1.0.0
```

Docker Hub is a discoverability mirror:

```sh
docker pull corebunch/instatic:latest
docker pull corebunch/instatic:1.0.0
```

When both registries are available, prefer GHCR in Compose files because it is produced directly by the release workflow.
````

- [ ] **Step 3: Document required secrets**

In `docs/deployment/release-workflow.md`, add:

```md
## Docker Hub Mirror

The release workflow always publishes GHCR. It mirrors to Docker Hub only when these repository secrets exist:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

The mirror target is `docker.io/corebunch/instatic:<tag>`. If the secrets are absent, the workflow prints a skip message and the GHCR release still completes.
```

## Task 5: Update Deployment Documentation For Image-Pull Releases

**Files:**
- Modify: `README.md`
- Modify: `docs/deployment/README.md`
- Modify: `docs/deployment/vps.md`
- Modify: `docs/deployment/release-workflow.md`

- [ ] **Step 1: Promote image-pull installs in `README.md`**

Change the production section so the first release install path uses the published image:

````md
## Production Deployment

The default self-host install is **SQLite + one container**. Download the release bundle from the latest GitHub Release, unpack it on the server, then run:

```sh
INSTATIC_IMAGE=ghcr.io/corebunch/instatic:latest docker compose -f compose.prod.yml -f compose.sqlite.yml up -d
```

Pin a semver tag for predictable upgrades:

```sh
INSTATIC_IMAGE=ghcr.io/corebunch/instatic:1.0.0 docker compose -f compose.prod.yml -f compose.sqlite.yml up -d
```

Source checkouts can still build locally:

```sh
docker compose -f compose.prod.yml -f compose.sqlite.yml -f compose.build.yml up -d --build
```
````

- [ ] **Step 2: Add release bundle install flow to `docs/deployment/vps.md`**

Add this near the top of the VPS guide:

````md
## Install From A Release Bundle

1. Download `instatic-<version>-release-bundle.tar.gz` from the GitHub Release.
2. Unpack it on the server.
3. Choose SQLite or Postgres.

SQLite:

```sh
INSTATIC_IMAGE=ghcr.io/corebunch/instatic:<version> docker compose -f compose.prod.yml -f compose.sqlite.yml up -d
```

Postgres:

```sh
cp .env.production.example .env
# Set POSTGRES_PASSWORD in .env.
INSTATIC_IMAGE=ghcr.io/corebunch/instatic:<version> docker compose -f compose.prod.yml up -d
```
````

- [ ] **Step 3: Update the deployment overview**

In `docs/deployment/README.md`, replace "Source builds are the current portable install path" with:

```md
Release bundles plus the published GHCR image are the default portable install path. Source builds remain supported for contributors and release-candidate testing.
```

- [ ] **Step 4: Update maintainer release workflow docs**

In `docs/deployment/release-workflow.md`, replace the "Tag A Release" section with:

````md
## Tag A Release

Run:

```sh
git tag v1.0.0
git push origin v1.0.0
```

The release workflow:

1. Runs `bun install --frozen-lockfile`, `bun run build`, `bun test`, and `bun run lint`.
2. Builds and pushes `ghcr.io/corebunch/instatic:1.0.0`, `ghcr.io/corebunch/instatic:1.0`, and `ghcr.io/corebunch/instatic:latest`.
3. Mirrors `corebunch/instatic:1.0.0` and `corebunch/instatic:latest` to Docker Hub when Docker Hub secrets exist.
4. Creates the GitHub Release if missing.
5. Uploads `instatic-1.0.0-release-bundle.tar.gz`.
````

## Task 6: Extract The Plugin SDK For npm

**Files:**
- Modify: `package.json`
- Create: `packages/plugin-sdk/package.json`
- Create: `packages/plugin-sdk/tsconfig.json`
- Move: `src/core/plugin-sdk/**` -> `packages/plugin-sdk/src/**`
- Modify: `tsconfig.json`
- Modify: `tsconfig.app.json`
- Modify: `tsconfig.node.json`
- Modify: `vite.config.ts`
- Modify: imports in `src/**`, `server/**`, `examples/plugins/**`, and `docs/**`
- Create: `src/__tests__/architecture/plugin-sdk-package-boundary.test.ts`

- [ ] **Step 1: Add a workspace root while keeping the app private**

In root `package.json`, keep `"private": true` and add:

```json
"workspaces": [
  "packages/*"
]
```

- [ ] **Step 2: Create the SDK package manifest**

Create `packages/plugin-sdk/package.json`:

```json
{
  "name": "@instatic/plugin-sdk",
  "version": "0.0.0",
  "description": "Instatic plugin SDK and plugin authoring CLI.",
  "license": "MIT",
  "type": "module",
  "repository": {
    "type": "git",
    "url": "https://github.com/corebunch/instatic.git",
    "directory": "packages/plugin-sdk"
  },
  "bin": {
    "instatic-plugin": "./src/cli/index.ts"
  },
  "exports": {
    ".": "./src/index.ts",
    "./contentSchemas": "./src/contentSchemas.ts",
    "./storageSchemas": "./src/storageSchemas.ts"
  },
  "files": [
    "src",
    "README.md"
  ],
  "dependencies": {
    "@sinclair/typebox": "^0.34.49",
    "esbuild": "^0.28.0",
    "fflate": "^0.8.2",
    "semver": "^7.7.4"
  },
  "peerDependencies": {
    "react": "^19"
  }
}
```

- [ ] **Step 3: Move SDK source**

Run:

```sh
mkdir -p packages/plugin-sdk/src
git mv src/core/plugin-sdk/* packages/plugin-sdk/src/
```

- [ ] **Step 4: Replace package-internal host aliases**

In `packages/plugin-sdk/src/**`, remove all imports from `@core/*`, `@site/*`, `@admin/*`, and `server/*`.

Concrete replacements required by current source:

- `packages/plugin-sdk/src/storageSchemas.ts`: import `Type` and `Static` from `@sinclair/typebox` instead of `@core/utils/typeboxHelpers`.
- `packages/plugin-sdk/src/types/content.ts`: import `Type` and `Static` from `@sinclair/typebox`.
- `packages/plugin-sdk/src/contentSchemas.ts`: move plugin-facing table kind/status schemas into the SDK package instead of importing from `@core/data/schemas`.
- `packages/plugin-sdk/src/modules.ts`: import `TSchema` from `@sinclair/typebox`.
- `packages/plugin-sdk/src/builders/definePack.ts` and `packages/plugin-sdk/src/builders/tree.ts`: move the plugin-facing page-tree and Visual Component structural types into SDK-owned types, then update the host to accept those structures through validation.
- `packages/plugin-sdk/src/types/editorApi.ts`: replace the direct `EditorStore` import with an SDK-owned minimal editor API type that exposes only plugin-approved methods.
- `packages/plugin-sdk/src/cli/build.ts` and `packages/plugin-sdk/src/cli/lint.ts`: stop importing `@core/plugins/sandboxScan` and `@core/plugins/manifest`; move sandbox scanning and manifest parsing helpers that are genuinely shared into the SDK package, then import them from the SDK package in the host.

- [ ] **Step 5: Update host aliases**

In `tsconfig.json`, `tsconfig.app.json`, and `tsconfig.node.json`, add:

```json
"@instatic/plugin-sdk": ["./packages/plugin-sdk/src/index.ts"],
"@instatic/plugin-sdk/*": ["./packages/plugin-sdk/src/*"]
```

In `vite.config.ts`, add:

```ts
'@instatic/plugin-sdk': path.resolve(__dirname, 'packages/plugin-sdk/src'),
```

- [ ] **Step 6: Update host imports**

Replace imports like:

```ts
import type { PluginManifest } from '@core/plugin-sdk'
import { pluginSettingsDefaults } from '@core/plugin-sdk'
import type { StorageListOptions } from '@core/plugin-sdk/storageSchemas'
```

with:

```ts
import type { PluginManifest } from '@instatic/plugin-sdk'
import { pluginSettingsDefaults } from '@instatic/plugin-sdk'
import type { StorageListOptions } from '@instatic/plugin-sdk/storageSchemas'
```

Run:

```sh
rg -n "@core/plugin-sdk" src server examples docs
```

Expected after this step: no matches except historical plan files under `docs/plans/`.

- [ ] **Step 7: Add the package boundary test**

Create `src/__tests__/architecture/plugin-sdk-package-boundary.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

const PROJECT_ROOT = join(import.meta.dir, '..', '..', '..')

async function collectPackageFiles(): Promise<string[]> {
  const glob = new Bun.Glob('packages/plugin-sdk/src/**/*.ts')
  const files: string[] = []
  for await (const file of glob.scan({ cwd: PROJECT_ROOT })) {
    files.push(file)
  }
  return files
}

describe('plugin SDK npm package boundary', () => {
  it('does not import host-internal aliases', async () => {
    const files = await collectPackageFiles()
    expect(files.length).toBeGreaterThan(0)

    const forbidden = [
      /from ['"]@core\//,
      /from ['"]@site\//,
      /from ['"]@admin\//,
      /from ['"]server\//,
    ]

    for (const file of files) {
      const source = await Bun.file(join(PROJECT_ROOT, file)).text()
      for (const pattern of forbidden) {
        expect(source, `${file} imports a host-internal module`).not.toMatch(pattern)
      }
    }
  })
})
```

- [ ] **Step 8: Verify the SDK extraction**

Run:

```sh
bun install
bun test src/__tests__/architecture/plugin-sdk-package-boundary.test.ts
bun run build
bun test
bun run lint
```

Expected: package boundary test passes and any remaining failures are unrelated to the SDK extraction.

## Task 7: Publish The Plugin SDK To npm

**Files:**
- Create: `.github/workflows/npm-plugin-sdk.yml`
- Modify: `docs/features/plugin-system.md`
- Modify: `examples/plugins/*/README.md`

- [ ] **Step 1: Create the npm publish workflow**

Create `.github/workflows/npm-plugin-sdk.yml`:

```yaml
name: Publish Plugin SDK

on:
  push:
    tags:
      - 'plugin-sdk-v*.*.*'

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    name: Publish @instatic/plugin-sdk
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/plugin-sdk
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.0

      - name: Set up Node for npm trusted publishing
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: bun install --frozen-lockfile
        working-directory: .

      - name: Verify package boundary
        run: bun test ../../src/__tests__/architecture/plugin-sdk-package-boundary.test.ts

      - name: Publish
        run: npm publish --access public
```

This workflow intentionally uses `npm publish` only for the registry publish operation because npm trusted publishing is implemented by the npm CLI. Installs, tests, and scripts remain Bun-based.

- [ ] **Step 2: Configure npm trusted publishing**

On npmjs.com, configure trusted publishing for `@instatic/plugin-sdk`:

```txt
Publisher: GitHub Actions
Organization/user: corebunch
Repository: instatic
Workflow filename: npm-plugin-sdk.yml
Allowed action: npm publish
```

Then require 2FA and disallow token publishing for the package.

- [ ] **Step 3: Update plugin author docs**

In `docs/features/plugin-system.md`, replace local-only CLI language with:

````md
Install or run the plugin CLI from npm:

```sh
bunx @instatic/plugin-sdk init my-plugin
bunx @instatic/plugin-sdk lint
bunx @instatic/plugin-sdk build
bunx @instatic/plugin-sdk dev
```

Inside this repository, the same CLI is available through:

```sh
bun run instatic-plugin
```
````

- [ ] **Step 4: Update example plugin READMEs**

For each `examples/plugins/*/README.md`, update build commands from:

```sh
bun run instatic-plugin build examples/plugins/search
```

to:

```sh
bunx @instatic/plugin-sdk build examples/plugins/search
```

Keep a contributor note that repository-local development may still use:

```sh
bun run instatic-plugin build examples/plugins/search
```

- [ ] **Step 5: Publish a package dry run**

Run:

```sh
cd packages/plugin-sdk
bun pm pack
tar -tzf *.tgz | sort | sed -n '1,120p'
```

Expected: the tarball contains `package/src/**`, `package/package.json`, and no `src/core/**`, `server/**`, or repo root files.

## Final Verification

Run Track 1 verification after Tasks 1-5:

```sh
bun run release:bundle -- 0.0.0-test
docker build -t instatic:release-test .
bun run build
bun test
bun run lint
```

Run Track 2 verification after Tasks 6-7:

```sh
bun install
bun test src/__tests__/architecture/plugin-sdk-package-boundary.test.ts
bun run build
bun test
bun run lint
```

For the first public release candidate, create a temporary tag on a fork or private test repo and verify:

```sh
git tag v0.0.0-release-test
git push origin v0.0.0-release-test
```

Expected:

- GHCR image exists at `ghcr.io/corebunch/instatic:0.0.0-release-test`.
- GitHub Release exists for `v0.0.0-release-test`.
- Release asset `instatic-0.0.0-release-test-release-bundle.tar.gz` exists.
- The release bundle can start SQLite mode with the published image.
- Docker Hub mirror runs when Docker Hub secrets are configured and skips cleanly when they are absent.

Delete the temporary release and tag after testing:

```sh
gh release delete v0.0.0-release-test --yes
git push origin :refs/tags/v0.0.0-release-test
git tag -d v0.0.0-release-test
```

## Self-Review

- Spec coverage: GitHub source, GHCR image, Docker Hub mirror, release bundle, VPS/managed-host docs, and npm SDK/CLI are covered.
- Placeholder scan: no task relies on hidden implementation details. The one explicit decision is npm scope ownership, and the plan gives a concrete fallback package name.
- Type consistency: image tags use semver without the leading `v`; release tags keep the leading `v`; release bundle names use the semver value without `v`; npm SDK tags use `plugin-sdk-v*`.
