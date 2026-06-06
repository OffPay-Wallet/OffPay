#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PREFIX = 'OFFPAY';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RANDOM_LENGTH = 12;
const SEGMENT_PATTERN = /^[A-Z0-9]{1,8}$/;

function getArg(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value == null || value.startsWith('--') ? fallback : value;
}

function requirePositiveInt(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function checksum(baseCode) {
  const sum = baseCode.split('').reduce((total, char) => total + char.charCodeAt(0), 0);
  return String(sum % 97).padStart(2, '0');
}

function randomInviteSegment() {
  let output = '';
  for (let index = 0; index < RANDOM_LENGTH; index += 1) {
    output += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return output;
}

function buildInviteCode(segment) {
  const random = randomInviteSegment();
  const base = `${PREFIX}-${segment}-${random}`;
  return `${base}-${checksum(base)}`;
}

function hashInviteCode(code, pepper) {
  return crypto.createHmac('sha256', pepper).update(code).digest('hex');
}

function main() {
  const args = process.argv.slice(2);
  const count = requirePositiveInt(getArg(args, '--count', '10'), '--count');
  const expiryDays = requirePositiveInt(getArg(args, '--expiry-days', '14'), '--expiry-days');
  const segment = String(getArg(args, '--segment', 'B1')).trim().toUpperCase();
  const outputDir = path.resolve(String(getArg(args, '--output-dir', 'invite-codes')));
  const pepper = String(
    getArg(args, '--pepper', process.env.OFFPAY_INVITE_CODE_PEPPER ?? ''),
  ).trim();

  if (!SEGMENT_PATTERN.test(segment)) {
    throw new Error('--segment must be 1-8 uppercase letters or digits.');
  }
  if (pepper.length < 32) {
    throw new Error('Provide OFFPAY_INVITE_CODE_PEPPER or --pepper with at least 32 characters.');
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
  const plaintextCodes = [];
  const dbRecords = [];

  for (let index = 0; index < count; index += 1) {
    const code = buildInviteCode(segment);
    plaintextCodes.push(code);
    dbRecords.push({
      code_hash: hashInviteCode(code, pepper),
      segment,
      status: 'unused',
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      used_at: null,
      used_by_wallet_address: null,
      used_by_device_id_hash: null,
      failed_attempts: 0,
      locked: false,
    });
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const suffix = `${segment}-${Date.now()}`;
  const dbFile = path.join(outputDir, `invite-codes-${suffix}.mongo.json`);
  const shareFile = path.join(outputDir, `invite-codes-${suffix}.share.txt`);
  fs.writeFileSync(dbFile, JSON.stringify(dbRecords, null, 2));
  fs.writeFileSync(
    shareFile,
    [
      `OffPay invite codes`,
      `Segment: ${segment}`,
      `Expires: ${expiresAt.toISOString()}`,
      '',
      ...plaintextCodes.map((code, index) => `${String(index + 1).padStart(3, ' ')}. ${code}`),
      '',
    ].join('\n'),
  );

  console.log(`Generated ${count} OffPay invite code${count === 1 ? '' : 's'}.`);
  console.log(`Segment: ${segment}`);
  console.log(`Expires: ${expiresAt.toISOString()}`);
  console.log('');
  plaintextCodes.forEach((code, index) => {
    console.log(`${String(index + 1).padStart(3, ' ')}. ${code}`);
  });
  console.log('');
  console.log(`Mongo import records written to ${dbFile}`);
  console.log(`Shareable plaintext codes written to ${shareFile}`);
  console.log('Do not commit or publicly share the plaintext file.');
}

main();
