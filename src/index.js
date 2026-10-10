import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const orgId = process.env.SHOPIFY_PARTNER_ORGANIZATION_ID;
const token = process.env.SHOPIFY_PARTNER_ACCESS_TOKEN;
const apiVersion = '2026-10';
const allowedIds = new Set((process.env.SHOPIFY_ALLOWED_APP_IDS || '').split(',').map(v => v.trim()).filter(Boolean));
if (!orgId || !/^\d+$/.test(orgId) || !token || !allowedIds.size || [...allowedIds].some(x => !/^\d+$/.test(x))) {
  console.error('Missing or invalid SHOPIFY_PARTNER_ORGANIZATION_ID, SHOPIFY_PARTNER_ACCESS_TOKEN, or SHOPIFY_ALLOWED_APP_IDS');
  process.exit(1);
}
const endpoint = `https://partners.shopify.com/${orgId}/api/${apiVersion}/graphql.json`;
function appGid(id) {
  if (!allowedIds.has(id)) throw new Error('App ID not allowlisted');
  return `gid://partners/App/${id}`;
}
async function queryShopify(query, variables) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal
    });
    if (!response.ok) throw new Error(`Shopify API HTTP ${response.status}`);
    const body = await response.json();
    if (body.errors?.length) throw new Error('Shopify GraphQL error: ' + body.errors.map(e => e.message).join('; ').slice(0, 500));
    return body.data;
  } finally { clearTimeout(timeout); }
}
const APP_INFO = `query AppInfo($appId: ID!) { app(id: $appId) { id name } }`;
const EVENTS = `query AppEvents($appId: ID!, $first: Int!, $min: DateTime, $max: DateTime, $types: [AppEventTypes!]) {
  app(id: $appId) {
    name
    events(first: $first, occurredAtMin: $min, occurredAtMax: $max, types: $types) {
      edges { node {
        type occurredAt
        ... on RelationshipInstalled { shop { name myshopifyDomain } }
        ... on RelationshipUninstalled { shop { name myshopifyDomain } reason description }
        ... on RelationshipReactivated { shop { name myshopifyDomain } }
      } }
      pageInfo { hasNextPage }
    }
  }
}`;
const server = new McpServer({ name: 'private-shopify-partners', version: '1.0.0' });
const appIdSchema = z.string().regex(/^\d+$/).describe('Numeric Shopify Partners app ID on the allowlist');
const dateSchema = z.string().datetime({ offset: true });
const typeSchema = z.enum(['RELATIONSHIP_INSTALLED', 'RELATIONSHIP_UNINSTALLED', 'RELATIONSHIP_REACTIVATED']);
const safeCall = fn => async args => {
  try { return { content: [{ type: 'text', text: JSON.stringify(await fn(args), null, 2) }] }; }
  catch (err) { return { isError: true, content: [{ type: 'text', text: String(err?.message || err).slice(0, 700) }] }; }
};
server.tool('get_app_info', 'Read the name and ID of an allowlisted Shopify app', { app_id: appIdSchema }, safeCall(async ({app_id}) => {
  const data = await queryShopify(APP_INFO, {appId: appGid(app_id)});
  if (!data.app) throw new Error('App not found or not accessible');
  return data.app;
}));
server.tool('get_app_events', 'Read up to 100 recent install/uninstall/reactivation events. Merchant domains may be returned.', {
  app_id: appIdSchema, limit: z.number().int().min(1).max(100).default(30),
  from: dateSchema.optional(), to: dateSchema.optional(), types: z.array(typeSchema).min(1).optional()
}, safeCall(async ({app_id, limit, from, to, types}) => {
  if (from && to && new Date(from) > new Date(to)) throw new Error('from must be <= to');
  const data = await queryShopify(EVENTS, {appId: appGid(app_id), first: limit, min: from, max: to, types: types ?? [...typeSchema.options]});
  if (!data.app) throw new Error('App not found or not accessible');
  return { app: data.app.name, events: data.app.events.edges.map(e => e.node), hasNextPage: data.app.events.pageInfo.hasNextPage };
}));
server.tool('get_installation_stats', 'Summarize up to 100 recent app relationship events. Counts are partial when hasNextPage is true.', {
  app_id: appIdSchema, from: dateSchema.optional(), to: dateSchema.optional()
}, safeCall(async ({app_id, from, to}) => {
  if (from && to && new Date(from) > new Date(to)) throw new Error('from must be <= to');
  const data = await queryShopify(EVENTS, {appId: appGid(app_id), first: 100, min: from, max: to, types: [...typeSchema.options]});
  if (!data.app) throw new Error('App not found or not accessible');
  const counts = { installs: 0, uninstalls: 0, reactivations: 0 };
  for (const {node} of data.app.events.edges) {
    if (node.type === 'RELATIONSHIP_INSTALLED') counts.installs++;
    if (node.type === 'RELATIONSHIP_UNINSTALLED') counts.uninstalls++;
    if (node.type === 'RELATIONSHIP_REACTIVATED') counts.reactivations++;
  }
  return { app: data.app.name, from: from ?? null, to: to ?? null, counts, hasNextPage: data.app.events.pageInfo.hasNextPage, complete: !data.app.events.pageInfo.hasNextPage, note: data.app.events.pageInfo.hasNextPage ? 'Partial counts: additional pages exist.' : 'All events in the returned filtered connection were counted.' };
}));
await server.connect(new StdioServerTransport());
