#!/usr/bin/env node
/**
 * Mint a patient payment-calculator link with a signed, locked total and deposit.
 *
 *   PRICE_LOCK_SECRET=... node scripts/generate-locked-price-link.js --total 6000 --deposit 3000
 *   node scripts/generate-locked-price-link.js --total 6000 --open-deposit
 *   node scripts/generate-locked-price-link.js --total 6000 --deposit 3000 --due-date 2026-08-01 --extended 12 --days 30
 *
 * The secret is PRICE_LOCK_SECRET, or the price-submission-handler Lambda env var of the same name.
 * dueDate and extended are added to the link and are not part of the signature.
 */

import { createRequire } from 'module';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);
const { buildLockedUrl, ALLOWED_EXTENDED } = require('../api/lock-link.js');

const DEFAULT_APP_URL = 'https://payment-calculator.drjuliaray.com';

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function secretFromLambda() {
  try {
    const raw = execSync(
      'aws lambda get-function-configuration --function-name price-submission-handler --query Environment.Variables.PRICE_LOCK_SECRET --output text',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const value = raw.trim();
    if (value && value !== 'None') return value;
  } catch {
    // Lambda env is optional when PRICE_LOCK_SECRET is already set.
  }
  return null;
}

function usage() {
  console.log(`Usage:
  node scripts/generate-locked-price-link.js --total 6000 --deposit 3000
  node scripts/generate-locked-price-link.js --total 6000 --open-deposit
  node scripts/generate-locked-price-link.js --total 6000 --deposit 3000 --due-date 2026-08-01 --extended 12
  node scripts/generate-locked-price-link.js --total 6000 --deposit 3000 --days 30

Requires PRICE_LOCK_SECRET (env, or price-submission-handler Lambda).
Optional: --open-deposit, --app-url, --due-date YYYY-MM-DD, --extended 3|6|12|true, --days N`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const total = Number(readFlag(args, '--total'));
  const depositOpen = args.includes('--open-deposit');
  const deposit = Number(readFlag(args, '--deposit'));
  const dueDate = readFlag(args, '--due-date');
  const extended = readFlag(args, '--extended');
  const daysRaw = readFlag(args, '--days');
  const appUrl = readFlag(args, '--app-url') || process.env.APP_URL || DEFAULT_APP_URL;

  if (!Number.isInteger(total) || total <= 0) {
    console.error('Error: --total must be a whole dollar amount greater than 0');
    process.exit(1);
  }
  if (!depositOpen && (!Number.isInteger(deposit) || deposit <= 0 || deposit > total)) {
    console.error('Error: --deposit must be a whole dollar amount from 1 through the total');
    process.exit(1);
  }
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    console.error('Error: --due-date must be YYYY-MM-DD');
    process.exit(1);
  }
  if (extended && !ALLOWED_EXTENDED.has(extended)) {
    console.error('Error: --extended must be 3, 6, 12, or true');
    process.exit(1);
  }

  let exp = null;
  if (daysRaw != null) {
    const days = Number(daysRaw);
    if (!Number.isInteger(days) || days < 1) {
      console.error('Error: --days must be a positive integer');
      process.exit(1);
    }
    exp = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
  }

  const secret = process.env.PRICE_LOCK_SECRET || secretFromLambda();
  if (!secret) {
    console.error('Error: PRICE_LOCK_SECRET is required (env, or price-submission-handler Lambda)');
    process.exit(1);
  }

  const url = buildLockedUrl({
    appUrl,
    maxPrice: total,
    deposit: depositOpen ? null : deposit,
    depositOpen,
    exp,
    dueDate: dueDate || undefined,
    extended: extended || undefined,
    secret,
  });

  console.log(`Total: $${total.toLocaleString('en-US')}`);
  console.log(depositOpen ? 'Deposit: patient chooses' : `Deposit: $${deposit.toLocaleString('en-US')}`);
  console.log(exp ? `Expires: ${new Date(exp * 1000).toISOString()}` : 'Expires: never');
  console.log(url);
}

main();
