/**
 * Package entry for `dsh-oh-my-workflow`.
 *
 * The DSH host never imports this file: the bundle is composed through
 * `dsh.bundle.patch` → `cordis.patch.yml`, whose rows resolve to files inside
 * `preset/` and `bin/`. This entry exists so the package is also a well-formed
 * npm module — `import 'dsh-oh-my-workflow'` resolves and reports what this
 * package is, instead of throwing against the missing default `index.js`.
 *
 * Nothing here mounts anything, on purpose. This package is a bundle of
 * preset rows and a CLI, not a single Cordis plugin, so there is no `apply()`
 * to export and no service to start.
 *
 * @module dsh-oh-my-workflow
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

/** Published package name, for consumers that introspect the entry. */
export const name = pkg.name

/** Published version. */
export const version = pkg.version

/** One-line description from package.json. */
export const description = pkg.description

/** Where the DSH bundle composition starts, relative to the package root. */
export const bundlePatch = pkg.dsh?.bundle?.patch ?? './cordis.patch.yml'

/** Declared peer ranges this bundle composes with. */
export const peerDependencies = { ...pkg.peerDependencies }

/** Metadata-only default export. */
export default { name, version, description, bundlePatch, peerDependencies }
