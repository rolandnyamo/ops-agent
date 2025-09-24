#!/usr/bin/env node
// Utility script to publish a synonyms version for an agent.
// Usage: node src/tools/publishSynonyms.js --agent AGENT_ID --version 1 --file synonyms.json [--activate]

const fs = require('fs');
const path = require('path');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

function arg(name, def = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

async function main() {
  const agentId = arg('agent');
  const version = arg('version');
  const file = arg('file');
  const activate = !!arg('activate', false);
  const table = process.env.SETTINGS_TABLE;
  if (!agentId || !version || !file || !table) {
    console.error('Missing required args or SETTINGS_TABLE env.');
    process.exit(1);
  }
  const abs = path.resolve(file);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(data)) {
    console.error('Input file must be a JSON array of {canonical, variants[], weight?}');
    process.exit(1);
  }
  const ddb = new DynamoDBClient({});
  const now = new Date().toISOString();

  // Write group and variant items
  for (let i = 0; i < data.length; i++) {
    const g = data[i];
    const groupId = g.groupId || String(i + 1).padStart(4, '0');
    const groupItem = {
      PK: `AGENT#${agentId}`,
      SK: `SYNONYMS#v${version}#GROUP#${groupId}`,
      canonical: g.canonical,
      variants: g.variants || [],
      weight: g.weight || 1,
      updatedAt: now
    };
    await ddb.send(new PutItemCommand({ TableName: table, Item: marshall(groupItem) }));

    for (const v of (g.variants || [])) {
      const norm = String(v || '').toLowerCase().trim().replace(/\s+/g, ' ');
      if (!norm) continue;
      const varItem = {
        PK: `AGENT#${agentId}`,
        SK: `SYNVAR#v${version}#${norm}`,
        canonical: g.canonical,
        groupId,
        weight: g.weight || 1,
        updatedAt: now
      };
      await ddb.send(new PutItemCommand({ TableName: table, Item: marshall(varItem) }));
    }
  }

  if (activate) {
    const active = {
      PK: `AGENT#${agentId}`,
      SK: 'SYNONYMS#ACTIVE',
      version: String(version),
      createdAt: now
    };
    await ddb.send(new PutItemCommand({ TableName: table, Item: marshall(active) }));
  }

  console.log(`Published synonyms v${version} for agent ${agentId}. Activated: ${activate}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

