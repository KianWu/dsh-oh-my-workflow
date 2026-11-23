/**
 * OPS Native integration for the `workflow` preset.
 *
 * This is the only OPS import the bundle is allowed to make: the stable
 * `dsh-ops/integration` entry, never a private `lib/*` path. Mounting this row
 * inside the preset composition scopes the binding to this exact preset id,
 * so it cannot change dsh-ops' global gates or another preset's consumer plan.
 *
 * Normal installs resolve the peer dependency from the profile. A `link:` /
 * junction install makes Node resolve imports from the real workspace path,
 * where the profile's peer dependency is not on the lookup chain. The fallback
 * below asks the profile's own resolver for the same public entry, so a linked
 * development install starts instead of reporting "never started".
 */
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Exported so verification checks the exact options that are mounted. */
export const options = {
  preset: 'workflow',
  profile: 'native',
  files: true,
  residentTools: true,
  shell: true,
  hidePwsh: false,
  // Deduplicate the official read/glob/grep whose OPS counterparts are resident.
  // dsh-ops hides only those three reviewed counterparts; official write/edit
  // remain available (see dsh-ops capabilities/replacements.js).
  replaceOfficial: true,
  discovery: true,
  promptPolicy: true,
}

/** Profile directories that may own the installed dsh-ops peer. */
function profileDirectories() {
  const directories = []
  const add = value => {
    if (typeof value === 'string' && value.trim() !== '') directories.push(value.trim())
  }
  add(process.env.DSH_PROFILE_DIR)
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  add(process.env.DSH_PROFILE === undefined ? undefined : join(home, 'profiles', process.env.DSH_PROFILE))
  try {
    for (const entry of readdirSync(join(home, 'profiles'), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        directories.push(join(home, 'profiles', entry.name))
      }
    }
  } catch {
    // No profiles directory: the primary import or another candidate decides.
  }
  return [...new Set(directories)]
}

async function loadIntegration() {
  try {
    return (await import('dsh-ops/integration')).integration
  } catch (primary) {
    for (const profileDir of profileDirectories()) {
      try {
        const require = createRequire(pathToFileURL(join(profileDir, 'package.json')))
        const entry = require.resolve('dsh-ops/integration')
        return (await import(pathToFileURL(entry).href)).integration
      } catch {
        // Try the next profile directory.
      }
    }
    throw primary
  }
}

const { integration } = { integration: await loadIntegration() }

export default integration(options)
