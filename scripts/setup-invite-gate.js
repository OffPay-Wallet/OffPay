#!/usr/bin/env node

/**
 * setup-invite-gate.js
 *
 * One-time setup script for the OffPay invite-gate MongoDB collections.
 * Creates `invite_codes` and `invite_access` collections with required indexes.
 *
 * Usage:
 *   MONGODB_URI='mongodb+srv://...' node scripts/setup-invite-gate.js
 *
 * Optional:
 *   MONGODB_DATABASE=offpay  (defaults to "offpay")
 */

const { MongoClient } = require('mongodb');

const DATABASE = process.env.MONGODB_DATABASE?.trim() || 'offpay';
const URI = process.env.MONGODB_URI?.trim();

if (!URI) {
  console.error('MONGODB_URI is required. Set it as an environment variable.');
  process.exit(1);
}

async function dropIndexIfExists(collection, indexName) {
  try {
    await collection.dropIndex(indexName);
    console.log(`  ✓ dropped ${indexName}`);
  } catch (error) {
    if (error?.codeName === 'IndexNotFound' || error?.code === 27) {
      return;
    }
    throw error;
  }
}

async function main() {
  const client = new MongoClient(URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB Atlas.');

    const db = client.db(DATABASE);

    // -----------------------------------------------------------------------
    // invite_codes collection
    // -----------------------------------------------------------------------
    console.log('\nSetting up invite_codes collection...');

    const inviteCodes = db.collection('invite_codes');

    await inviteCodes.createIndex({ code_hash: 1 }, { unique: true, name: 'idx_code_hash_unique' });
    console.log('  ✓ idx_code_hash_unique (unique on code_hash)');

    await inviteCodes.createIndex({ status: 1, expires_at: 1 }, { name: 'idx_status_expires' });
    console.log('  ✓ idx_status_expires (status + expires_at)');

    await inviteCodes.createIndex({ segment: 1, status: 1 }, { name: 'idx_segment_status' });
    console.log('  ✓ idx_segment_status (segment + status)');

    await inviteCodes.createIndex(
      { code_format: 1, status: 1 },
      { name: 'idx_code_format_status' },
    );
    console.log('  ✓ idx_code_format_status (code_format + status)');

    await inviteCodes.createIndex(
      { status: 1, reservation_expires_at: 1 },
      { name: 'idx_status_reservation_expires' },
    );
    console.log('  ✓ idx_status_reservation_expires (status + reservation_expires_at)');

    await inviteCodes.createIndex(
      { reserved_by_email: 1, status: 1 },
      {
        name: 'idx_reserved_email_status',
        partialFilterExpression: { reserved_by_email: { $type: 'string' } },
      },
    );
    console.log('  ✓ idx_reserved_email_status (reserved_by_email + status)');

    // -----------------------------------------------------------------------
    // invite_access collection
    // -----------------------------------------------------------------------
    console.log('\nSetting up invite_access collection...');

    const inviteAccess = db.collection('invite_access');

    await dropIndexIfExists(inviteAccess, 'idx_active_email_unique');
    await dropIndexIfExists(inviteAccess, 'idx_active_wallet_unique');
    await dropIndexIfExists(inviteAccess, 'idx_active_device_unique');

    await inviteAccess.createIndex(
      { wallet_address: 1, device_id_hash: 1 },
      { unique: true, name: 'idx_wallet_device_unique' },
    );
    console.log('  ✓ idx_wallet_device_unique (unique on wallet + device)');

    await inviteAccess.createIndex({ status: 1, wallet_address: 1 }, { name: 'idx_status_wallet' });
    console.log('  ✓ idx_status_wallet (status + wallet_address)');

    await inviteAccess.createIndex({ status: 1, device_id_hash: 1 }, { name: 'idx_status_device' });
    console.log('  ✓ idx_status_device (status + device_id_hash)');

    await inviteAccess.createIndex({ invite_code_hash: 1 }, { name: 'idx_invite_code_hash' });
    console.log('  ✓ idx_invite_code_hash (invite_code_hash)');

    await inviteAccess.createIndex(
      { email: 1, status: 1 },
      {
        name: 'idx_email_status',
        partialFilterExpression: { email: { $type: 'string' } },
      },
    );
    console.log('  ✓ idx_email_status (email + status)');

    await inviteAccess.createIndex(
      { invite_code_hash: 1, email: 1, status: 1 },
      {
        name: 'idx_invite_code_email_status',
        partialFilterExpression: { email: { $type: 'string' } },
      },
    );
    console.log('  ✓ idx_invite_code_email_status (invite_code_hash + email + status)');

    await inviteAccess.createIndex(
      { email: 1, device_id_hash: 1, status: 1 },
      {
        name: 'idx_email_device_status',
        partialFilterExpression: { email: { $type: 'string' } },
      },
    );
    console.log('  ✓ idx_email_device_status (email + device_id_hash + status)');

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n✅ Invite gate setup complete.');
    console.log(`   Database: ${DATABASE}`);
    console.log('   Collections: invite_codes, invite_access');
    console.log('\nNext steps:');
    console.log('  1. Generate invite codes:');
    console.log(
      "     OFFPAY_INVITE_CODE_PEPPER='<pepper>' npm run invite:generate -- --count 100 --segment B1 --expiry-days 30",
    );
    console.log(
      '  2. Import the generated .mongo.json file into invite_codes via Atlas or mongoimport.',
    );
    console.log('  3. Push worker secrets:');
    console.log('     npm run invite:push-worker-secrets');
  } catch (error) {
    console.error('Setup failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
