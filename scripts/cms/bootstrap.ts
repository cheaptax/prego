import { FieldValue } from "firebase-admin/firestore";
import {
  CMS_COLLECTIONS,
  CMS_GLOBAL_KEYS,
  CMS_PAGE_KEYS,
  CMS_PAGE_ROUTES,
  CMS_SCHEMA_VERSION,
} from "@/lib/cms/constants";
import {
  CMS_GLOBAL_DEFAULTS,
  CMS_PAGE_DEFAULTS,
} from "@/lib/cms/defaults";
import {
  parseDraftGlobal,
  parseDraftPage,
  parsePublishedGlobal,
  parsePublishedPage,
} from "@/lib/cms/migrations";
import { adminDb } from "@/lib/firebase/admin";

type Options = {
  apply: boolean;
  inspect: boolean;
  includePublished: boolean;
  migrateExisting: boolean;
  allowProduction: boolean;
  project?: string;
  environment?: "local" | "staging" | "production";
  actor?: string;
  confirm?: string;
};

function readValue(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptions(args: string[]): Options {
  const environmentValue = readValue(args, "--environment");
  if (
    environmentValue &&
    environmentValue !== "local" &&
    environmentValue !== "staging" &&
    environmentValue !== "production"
  ) {
    throw new Error("--environment must be local, staging, or production");
  }
  const environment = environmentValue as Options["environment"];
  return {
    apply: args.includes("--apply"),
    inspect: args.includes("--inspect"),
    includePublished: args.includes("--include-published"),
    migrateExisting: args.includes("--migrate-existing"),
    allowProduction: args.includes("--allow-production"),
    project: readValue(args, "--project"),
    environment,
    actor: readValue(args, "--actor"),
    confirm: readValue(args, "--confirm"),
  };
}

function printHelp() {
  console.log(`CMS bootstrap and migration

Default behavior is an offline dry-run that prints document keys only.

Options:
  --inspect                 Read target CMS collections without writing
  --apply                   Create missing documents; never overwrite content
  --include-published       Also create missing published defaults
  --migrate-existing       Apply known schema migrations to valid CMS documents
  --project <projectId>     Required for inspect/apply
  --environment <name>      local, staging, or production
  --actor <uid>              Required for apply
  --confirm <phrase>         Required for apply: CMS_BOOTSTRAP:<projectId>
  --allow-production         Additional production write acknowledgement
  --help                     Show this help
`);
}

function assertRemoteOptions(options: Options) {
  if (!options.project || !options.environment) {
    throw new Error("--project and --environment are required for inspect/apply");
  }
  const configuredProject = process.env.FIREBASE_PROJECT_ID?.trim();
  if (configuredProject && configuredProject !== options.project) {
    throw new Error("FIREBASE_PROJECT_ID does not match --project");
  }
  if (options.apply) {
    if (!options.actor?.trim()) throw new Error("--actor is required for apply");
    if (options.confirm !== `CMS_BOOTSTRAP:${options.project}`) {
      throw new Error("confirmation phrase does not match the target project");
    }
    if (options.environment === "production" && !options.allowProduction) {
      throw new Error("production writes require --allow-production");
    }
  }
}

const plans = [
  ...CMS_PAGE_KEYS.map((pageKey) => ({
    kind: "draft-page" as const,
    key: pageKey,
    collection: CMS_COLLECTIONS.draftPages,
  })),
  ...CMS_GLOBAL_KEYS.map((documentKey) => ({
    kind: "draft-global" as const,
    key: documentKey,
    collection: CMS_COLLECTIONS.draftGlobals,
  })),
];

function draftPageData(pageKey: (typeof CMS_PAGE_KEYS)[number], actorUid: string) {
  return {
    schemaVersion: CMS_SCHEMA_VERSION,
    pageKey,
    route: CMS_PAGE_ROUTES[pageKey],
    content: CMS_PAGE_DEFAULTS[pageKey],
    version: 1,
    basePublishedVersion: 0,
    status: "draft",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  };
}

function draftGlobalData(
  documentKey: (typeof CMS_GLOBAL_KEYS)[number],
  actorUid: string,
) {
  return {
    schemaVersion: CMS_SCHEMA_VERSION,
    documentKey,
    content: CMS_GLOBAL_DEFAULTS[documentKey],
    version: 1,
    basePublishedVersion: 0,
    status: "draft",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid,
  };
}

function publishedPageData(pageKey: (typeof CMS_PAGE_KEYS)[number]) {
  return {
    schemaVersion: CMS_SCHEMA_VERSION,
    pageKey,
    route: CMS_PAGE_ROUTES[pageKey],
    content: CMS_PAGE_DEFAULTS[pageKey],
    version: 1,
    status: "published",
    publishedAt: FieldValue.serverTimestamp(),
  };
}

function publishedGlobalData(documentKey: (typeof CMS_GLOBAL_KEYS)[number]) {
  return {
    schemaVersion: CMS_SCHEMA_VERSION,
    documentKey,
    content: CMS_GLOBAL_DEFAULTS[documentKey],
    version: 1,
    status: "published",
    publishedAt: FieldValue.serverTimestamp(),
  };
}

async function inspectOrApply(options: Options) {
  assertRemoteOptions(options);
  const db = adminDb();
  const actorUid = options.actor?.trim() ?? "dry-run";
  const targetPlans = [
    ...plans,
    ...(options.includePublished
      ? [
          ...CMS_PAGE_KEYS.map((pageKey) => ({
            kind: "published-page" as const,
            key: pageKey,
            collection: CMS_COLLECTIONS.publishedPages,
          })),
          ...CMS_GLOBAL_KEYS.map((documentKey) => ({
            kind: "published-global" as const,
            key: documentKey,
            collection: CMS_COLLECTIONS.publishedGlobals,
          })),
        ]
      : []),
  ];

  let createCount = 0;
  let skipCount = 0;
  let migrateCount = 0;
  let invalidCount = 0;

  for (const plan of targetPlans) {
    const ref = db.collection(plan.collection).doc(plan.key);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      console.log(`${options.apply ? "CREATE" : "WOULD_CREATE"} ${plan.collection}/${plan.key}`);
      createCount += 1;
      if (!options.apply) continue;
      const data =
        plan.kind === "draft-page"
          ? draftPageData(plan.key, actorUid)
          : plan.kind === "draft-global"
            ? draftGlobalData(plan.key, actorUid)
            : plan.kind === "published-page"
              ? publishedPageData(plan.key)
              : publishedGlobalData(plan.key);
      await ref.create(data);
      continue;
    }

    const parsed =
      plan.kind === "draft-page"
        ? parseDraftPage(snapshot.data(), plan.key)
        : plan.kind === "draft-global"
          ? parseDraftGlobal(snapshot.data(), plan.key)
          : plan.kind === "published-page"
            ? parsePublishedPage(snapshot.data(), plan.key)
            : parsePublishedGlobal(snapshot.data(), plan.key);
    if (!parsed.success) {
      console.log(`INVALID ${plan.collection}/${plan.key} ${parsed.error}`);
      invalidCount += 1;
      continue;
    }
    if (parsed.migratedFrom !== null) {
      console.log(
        `${options.apply && options.migrateExisting ? "MIGRATE" : "WOULD_MIGRATE"} ${plan.collection}/${plan.key} v${parsed.migratedFrom}->v${CMS_SCHEMA_VERSION}`,
      );
      migrateCount += 1;
      if (options.apply && options.migrateExisting) {
        await db.runTransaction(async (transaction) => {
          const current = await transaction.get(ref);
          const currentVersion = current.data()?.schemaVersion ?? 0;
          if (currentVersion !== parsed.migratedFrom) {
            throw new Error(`concurrent schema change: ${plan.collection}/${plan.key}`);
          }
          transaction.set(ref, parsed.data, { merge: false });
        });
      }
      continue;
    }
    console.log(`SKIP ${plan.collection}/${plan.key} exists`);
    skipCount += 1;
  }

  console.log(
    `SUMMARY create=${createCount} migrate=${migrateCount} skip=${skipCount} invalid=${invalidCount} write=${options.apply}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    printHelp();
    return;
  }
  const options = parseOptions(args);
  if (!options.inspect && !options.apply) {
    for (const plan of plans) {
      console.log(`WOULD_CREATE_IF_MISSING ${plan.collection}/${plan.key}`);
    }
    console.log(
      `SUMMARY planned=${plans.length} published=false write=false (offline dry-run)`,
    );
    return;
  }
  await inspectOrApply(options);
}

await main();
