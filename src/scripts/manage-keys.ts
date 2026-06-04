/* eslint-disable no-console */
import { existsSync } from "node:fs";

// Load .env for local CLI use. The Next.js app loads it automatically, but
// this standalone script does not; in production (Zeabur) the real env vars
// are already set, so the file is simply absent.
if (existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* ignore malformed/absent .env */
  }
}

import { prisma } from "../lib/db";
import { generateApiKey } from "../lib/auth-key";
import { isScope, type Scope } from "../lib/scope";

// Operational CLI for users and API keys. This is the stand-in for the admin
// UI (deferred to the next milestone). Run via: `npm run keys <command>`.
//
// Commands:
//   seed                                 Create admin users from ADMIN_EMAILS
//   user:add <email> [--admin]           Create or update a user
//   user:list                            List users
//   key:create --email <e> --label <l> [--scope READ|WRITE] [--months N]
//   key:list [--email <e>]               List keys (never shows secrets)
//   key:scope <keyId> READ|WRITE         Change a key's scope (admin action)
//   key:block <keyId>                    Block a key
//   key:unblock <keyId>                  Unblock a key

type Flags = Record<string, string | boolean>;

function parseArgs(argv: string[]): { positionals: string[]; flags: Flags } {
  const positionals: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

async function seed(): Promise<void> {
  const emails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) {
    console.error("ADMIN_EMAILS is empty; nothing to seed.");
    return;
  }
  for (const email of emails) {
    await prisma.user.upsert({
      where: { email },
      update: { isAdmin: true },
      create: { email, isAdmin: true },
    });
    console.log(`✓ admin: ${email}`);
  }
}

async function userAdd(email: string, admin: boolean): Promise<void> {
  if (!email) throw new Error("Usage: user:add <email> [--admin]");
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.upsert({
    where: { email: normalized },
    update: { isAdmin: admin || undefined },
    create: { email: normalized, isAdmin: admin },
  });
  console.log(`✓ user ${user.email} (admin=${user.isAdmin}) id=${user.id}`);
}

async function userList(): Promise<void> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { apiKeys: true } } },
  });
  for (const u of users) {
    console.log(`${u.id}  ${u.email}  admin=${u.isAdmin}  keys=${u._count.apiKeys}`);
  }
  if (users.length === 0) console.log("(no users)");
}

async function keyCreate(flags: Flags): Promise<void> {
  const email = String(flags.email ?? "").trim().toLowerCase();
  const label = String(flags.label ?? "").trim();
  if (!email || !label) {
    throw new Error('Usage: key:create --email <e> --label <l> [--scope READ|WRITE] [--months N]');
  }

  const scopeRaw = String(flags.scope ?? "READ").toUpperCase();
  if (!isScope(scopeRaw)) throw new Error(`Invalid scope "${scopeRaw}". Use READ or WRITE.`);
  const scope: Scope = scopeRaw;

  const months = flags.months
    ? Number(flags.months)
    : Number(process.env.DEFAULT_KEY_LIFETIME_MONTHS ?? "3");
  if (!Number.isFinite(months) || months <= 0) {
    throw new Error(`Invalid --months value: ${flags.months}`);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user with email ${email}. Create one with user:add first.`);

  const { plaintext, keyHash, keyPrefix } = generateApiKey();
  const expiresAt = addMonths(new Date(), months);

  const key = await prisma.apiKey.create({
    data: { label, keyHash, keyPrefix, scope, expiresAt, userId: user.id },
  });

  console.log("");
  console.log("  API key created. Copy it now — it will NOT be shown again:");
  console.log("");
  console.log(`    ${plaintext}`);
  console.log("");
  console.log(`  id=${key.id} scope=${scope} expires=${expiresAt.toISOString()}`);
  console.log(`  owner=${email}`);
  console.log("");
}

async function keyList(flags: Flags): Promise<void> {
  const email = flags.email ? String(flags.email).trim().toLowerCase() : undefined;
  const keys = await prisma.apiKey.findMany({
    where: email ? { user: { email } } : undefined,
    orderBy: { createdAt: "desc" },
    include: { user: true },
  });
  for (const k of keys) {
    const status = k.blocked ? "BLOCKED" : k.expiresAt && k.expiresAt < new Date() ? "EXPIRED" : "active";
    console.log(
      `${k.id}  ${k.keyPrefix}…  ${k.scope.padEnd(5)}  ${status.padEnd(7)}  ${k.user.email}  "${k.label}"  exp=${k.expiresAt?.toISOString() ?? "never"}`,
    );
  }
  if (keys.length === 0) console.log("(no keys)");
}

async function keyScope(keyId: string, scopeRaw: string): Promise<void> {
  const scope = (scopeRaw ?? "").toUpperCase();
  if (!isScope(scope)) throw new Error("Usage: key:scope <keyId> READ|WRITE");
  const key = await prisma.apiKey.update({ where: { id: keyId }, data: { scope } });
  console.log(`✓ ${key.id} scope set to ${key.scope}`);
}

async function keyBlock(keyId: string, blocked: boolean): Promise<void> {
  if (!keyId) throw new Error(`Usage: key:${blocked ? "block" : "unblock"} <keyId>`);
  const key = await prisma.apiKey.update({ where: { id: keyId }, data: { blocked } });
  console.log(`✓ ${key.id} blocked=${key.blocked}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseArgs(rest);

  switch (command) {
    case "seed":
      await seed();
      break;
    case "user:add":
      await userAdd(positionals[0], Boolean(flags.admin));
      break;
    case "user:list":
      await userList();
      break;
    case "key:create":
      await keyCreate(flags);
      break;
    case "key:list":
      await keyList(flags);
      break;
    case "key:scope":
      await keyScope(positionals[0], positionals[1]);
      break;
    case "key:block":
      await keyBlock(positionals[0], true);
      break;
    case "key:unblock":
      await keyBlock(positionals[0], false);
      break;
    default:
      console.log(
        [
          "SimOrg Middleware — key management",
          "",
          "Usage: npm run keys <command> [args]",
          "",
          "  seed",
          "  user:add <email> [--admin]",
          "  user:list",
          "  key:create --email <e> --label <l> [--scope READ|WRITE] [--months N]",
          "  key:list [--email <e>]",
          "  key:scope <keyId> READ|WRITE",
          "  key:block <keyId>",
          "  key:unblock <keyId>",
        ].join("\n"),
      );
  }
}

main()
  .catch((err) => {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
