import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runtime names that cannot move until the post-chain migration in Job 19.
 * Every active consumer reads these values instead of spelling them locally.
 */
export const LEGACY_RUNTIME_ANCHORS = Object.freeze({
  dataDirectoryName: '.cloudcli',
  devDataDirectoryName: '.cloudcli-dev',
  desktopConfigDirectoryName: 'CloudCLI',
  launchdLabelPrefix: 'com.spoton.cloudcli',
  projectDirectoryName: 'cloudcli',
  serviceLogDirectoryName: 'cloudcli-service',
  backupLogDirectoryName: 'cloudcli-backup',
  scrubLogDirectoryName: 'cloudcli-scrub',
  nightlyBackupDirectoryName: 'cloudcli-nightly',
});

const LEGACY_ENV_PREFIX = ['CLOUD', 'CLI'].join('');
const warnedLegacyEnvironmentVariables = new Set();

/**
 * Reads a Command Center environment variable, falling back to its legacy
 * spelling for one release and logging that fallback once per process.
 */
export function readRenamedEnvironmentVariable(suffix, environment = process.env, warn = console.warn) {
  const currentName = `COMMAND_CENTER_${suffix}`;
  const legacyName = `${LEGACY_ENV_PREFIX}_${suffix}`;
  if (environment[currentName] !== undefined) return environment[currentName];
  if (environment[legacyName] === undefined) return undefined;
  if (!warnedLegacyEnvironmentVariables.has(legacyName)) {
    warnedLegacyEnvironmentVariables.add(legacyName);
    warn(`[Command Center] ${legacyName} is deprecated; use ${currentName}.`);
  }
  return environment[legacyName];
}

/** Returns the still-current per-user data directory for Job 16 consumers. */
export function getLegacyDataDirectory(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, LEGACY_RUNTIME_ANCHORS.dataDirectoryName);
}

/** Returns the still-current isolated dev data directory. */
export function getLegacyDevDataDirectory(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, LEGACY_RUNTIME_ANCHORS.devDataDirectoryName);
}

/** Returns the still-current repository location used by mini automation. */
export function getLegacyProjectDirectory(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, 'Projects', LEGACY_RUNTIME_ANCHORS.projectDirectoryName);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function printShellAnchors() {
  const values = {
    COMMAND_CENTER_RUNTIME_LEGACY_STEM: LEGACY_RUNTIME_ANCHORS.projectDirectoryName,
    COMMAND_CENTER_RUNTIME_DATA_DIR: getLegacyDataDirectory(),
    COMMAND_CENTER_RUNTIME_DEV_DATA_DIR: getLegacyDevDataDirectory(),
    COMMAND_CENTER_RUNTIME_DESKTOP_CONFIG_DIR_NAME: LEGACY_RUNTIME_ANCHORS.desktopConfigDirectoryName,
    COMMAND_CENTER_RUNTIME_LAUNCHD_PREFIX: LEGACY_RUNTIME_ANCHORS.launchdLabelPrefix,
    COMMAND_CENTER_RUNTIME_PROJECT_DIR: getLegacyProjectDirectory(),
    COMMAND_CENTER_RUNTIME_SERVICE_LOG_DIR_NAME: LEGACY_RUNTIME_ANCHORS.serviceLogDirectoryName,
    COMMAND_CENTER_RUNTIME_BACKUP_LOG_DIR_NAME: LEGACY_RUNTIME_ANCHORS.backupLogDirectoryName,
    COMMAND_CENTER_RUNTIME_SCRUB_LOG_DIR_NAME: LEGACY_RUNTIME_ANCHORS.scrubLogDirectoryName,
    COMMAND_CENTER_RUNTIME_NIGHTLY_BACKUP_DIR_NAME: LEGACY_RUNTIME_ANCHORS.nightlyBackupDirectoryName,
  };
  for (const [name, value] of Object.entries(values)) {
    process.stdout.write(`${name}=${shellQuote(value)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--shell') {
  printShellAnchors();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--data-directory') {
  process.stdout.write(getLegacyDataDirectory());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--environment') {
  process.stdout.write(readRenamedEnvironmentVariable(process.argv[3]) || '');
}
