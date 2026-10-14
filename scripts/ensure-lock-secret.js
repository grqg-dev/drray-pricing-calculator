#!/usr/bin/env node
/**
 * Set PRICE_LOCK_SECRET on price-submission-handler when it is missing.
 * Does not print the secret or the rest of the function environment.
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');

const FUNCTION_NAME = 'price-submission-handler';
const ENV_FILE = '/tmp/price-lock-env.json';

function aws(args) {
  return execFileSync('aws', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function main() {
  const raw = aws([
    'lambda', 'get-function-configuration',
    '--function-name', FUNCTION_NAME,
    '--output', 'json',
  ]);
  const cfg = JSON.parse(raw);
  const env = { ...((cfg.Environment && cfg.Environment.Variables) || {}) };
  if (env.PRICE_LOCK_SECRET) {
    console.log('PRICE_LOCK_SECRET already set');
    return;
  }
  env.PRICE_LOCK_SECRET = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(ENV_FILE, JSON.stringify({ Variables: env }), { mode: 0o600 });
  try {
    execFileSync('aws', [
      'lambda', 'update-function-configuration',
      '--function-name', FUNCTION_NAME,
      '--environment', `file://${ENV_FILE}`,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    console.log('PRICE_LOCK_SECRET set');
  } catch (err) {
    const text = (err.stderr || '').toString();
    const line = text.split('\n').find((row) => /AccessDenied|Error|error/.test(row)) || 'update failed';
    console.error(line.slice(0, 300));
    process.exit(1);
  } finally {
    fs.rmSync(ENV_FILE, { force: true });
  }
}

main();
