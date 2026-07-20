import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { CMS_PAGE_DEFAULTS } from "../../lib/cms/defaults.ts";
import { FirestoreCmsRepository } from "../../lib/cms/repository.ts";
import { CmsMemoryFirestore } from "../../lib/cms/testing/memory-firestore.ts";

const emulatorEnabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe("FY27 audit-quote CMS lifecycle (development or Firestore emulator)", () => {
  it(
    "keeps drafts private and supports publish, history, restore, and rollback publish",
    async () => {
      const db = emulatorEnabled
        ? getFirestore(
            initializeApp(
              { projectId: "demo-cms-local" },
              `audit-quote-cms-${Date.now()}`,
            ),
          )
        : new CmsMemoryFirestore();
      const repository = new FirestoreCmsRepository(db);
      const pageKey = "event.auditQuote";
      const first = structuredClone(CMS_PAGE_DEFAULTS[pageKey]);
      first.sections[0].title = "에뮬레이터 첫 게시 제목";

      await repository.saveDraftPage({
        pageKey,
        content: first,
        expectedVersion: 0,
        actorUid: "emulator-admin",
      });
      assert.equal(await repository.getPublishedPage(pageKey), null);
      assert.equal((await repository.getDraftPage(pageKey))?.version, 1);

      await repository.publishPage(pageKey, 1, "emulator-admin");
      assert.equal(
        (await repository.getPublishedPage(pageKey))?.content.sections[0]
          .title,
        "에뮬레이터 첫 게시 제목",
      );

      const second = structuredClone(first);
      second.sections[0].title = "에뮬레이터 둘째 게시 제목";
      await repository.saveDraftPage({
        pageKey,
        content: second,
        expectedVersion: 2,
        actorUid: "emulator-admin",
      });
      await repository.publishPage(pageKey, 3, "emulator-admin");

      const revisions = await repository.listPageRevisions(pageKey, 10);
      const firstRevision = revisions.find((revision) => revision.version === 1);
      assert.ok(firstRevision);
      assert.equal(revisions.length, 2);

      await repository.restorePageRevision(
        pageKey,
        firstRevision.revisionId,
        4,
        "emulator-admin",
      );
      const restoredDraft = await repository.getDraftPage(pageKey);
      assert.equal(
        restoredDraft?.content.sections[0].title,
        "에뮬레이터 첫 게시 제목",
      );
      assert.equal(
        (await repository.getPublishedPage(pageKey))?.content.sections[0]
          .title,
        "에뮬레이터 둘째 게시 제목",
      );

      await repository.publishPage(
        pageKey,
        restoredDraft?.version ?? -1,
        "emulator-admin",
        "rollback",
      );
      assert.equal(
        (await repository.getPublishedPage(pageKey))?.content.sections[0]
          .title,
        "에뮬레이터 첫 게시 제목",
      );
      const afterRollback = await repository.listPageRevisions(pageKey, 10);
      assert.ok(
        afterRollback.some(
          (revision) => revision.revisionAction === "rollback",
        ),
      );
    },
  );
});
