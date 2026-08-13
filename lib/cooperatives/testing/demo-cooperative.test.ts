import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DUNGGI_COOPERATIVE_ID,
  DUNGGI_COOPERATIVE_INTERNAL_CODE,
  PREGO_COOPERATIVE_ID,
  PRIGO_COOPERATIVE_ID,
  TEST_COOPERATIVE_DEFINITIONS,
  buildDunggiSeedPlan,
  createDunggiCooperativeMaster,
  createTestCooperativeMaster,
  isCooperativeSelectableForSignup,
  isExistingSignupForCooperative,
  nextDemoSignupStatus,
  searchCooperativeCatalog,
  toDemoCooperativeSearchItem,
  toRealCooperativeSearchItem,
} from "@/lib/cooperatives/demo-cooperative";
import {
  buildSignupRootMetadata,
  buildTestAuthSubjects,
} from "@/lib/test-data/root-metadata";
import { cooperativeMasterTotal, nonghyupMaster } from "@/lib/platform";

const NOW = "2026-07-22T12:00:00.000Z";

describe("둥기농협 master identity", () => {
  it("uses a deterministic ID outside the real cooperative ID range", () => {
    assert.equal(DUNGGI_COOPERATIVE_ID, "demo-dunggi-nh");
    assert.equal(DUNGGI_COOPERATIVE_INTERNAL_CODE, "DEMO_DUNGGI_NH");
    assert.equal(
      nonghyupMaster.some(
        (cooperative) => cooperative.cooperative_id === DUNGGI_COOPERATIVE_ID,
      ),
      false,
    );
  });

  it("does not change the static real cooperative master", () => {
    assert.equal(nonghyupMaster.length, cooperativeMasterTotal);
    assert.equal(cooperativeMasterTotal, 1109);
    assert.equal(nonghyupMaster[0].cooperative_id, "coop-001");
    assert.equal(
      nonghyupMaster[nonghyupMaster.length - 1].cooperative_id,
      "coop-1109",
    );
    assert.equal(
      nonghyupMaster.some((cooperative) =>
        Object.hasOwn(cooperative, "isDemoInstitution"),
      ),
      false,
    );
  });
});

describe("internal test cooperative catalog", () => {
  it("defines the requested test cooperatives with stable IDs", () => {
    assert.deepEqual(
      TEST_COOPERATIVE_DEFINITIONS.map((definition) => [
        definition.cooperativeId,
        definition.cooperativeName,
      ]),
      [
        [DUNGGI_COOPERATIVE_ID, "둥기농협"],
        [PRIGO_COOPERATIVE_ID, "프리고농협"],
        [PREGO_COOPERATIVE_ID, "프레고농협"],
        ["demo-jaegyeong-nh", "재경농협"],
        ["demo-seongmin-nh", "성민농협"],
        ["demo-jihye-nh", "지혜농협"],
      ],
    );
  });

  it("makes every seeded test cooperative searchable and resettable", () => {
    const catalog = TEST_COOPERATIVE_DEFINITIONS.map((definition) =>
      toDemoCooperativeSearchItem(createTestCooperativeMaster(definition, NOW)),
    );
    for (const definition of TEST_COOPERATIVE_DEFINITIONS) {
      assert.deepEqual(
        searchCooperativeCatalog(catalog, definition.cooperativeName).map(
          (item) => [
            item.cooperative_id,
            item.dataClassification,
            item.resettable,
          ],
        ),
        [
          [definition.cooperativeId, "DEMO", true],
        ],
      );
    }
  });
});

describe("둥기농협 seed plan", () => {
  it("creates one AVAILABLE demo master from an empty state", () => {
    const plan = buildDunggiSeedPlan(null, NOW);
    assert.equal(plan.action, "create");
    assert.equal(plan.write.cooperativeId, DUNGGI_COOPERATIVE_ID);
    assert.equal(plan.write.cooperativeName, "둥기농협");
    assert.equal(plan.write.address, "업무 테스트용 가상 농협");
    assert.equal(plan.write.signupStatus, "AVAILABLE");
    assert.equal(plan.write.isDemoInstitution, true);
    assert.equal(plan.write.dataClassification, "DEMO");
    assert.equal(plan.write.resettable, true);
  });

  it("is a no-op when the seeded master is already current", () => {
    const existing = createDunggiCooperativeMaster(NOW);
    const plan = buildDunggiSeedPlan(existing, "2026-07-23T00:00:00.000Z");
    assert.equal(plan.action, "noop");
    assert.deepEqual(plan.write, {});
  });

  it("corrects basic fields without overwriting signup usage fields", () => {
    const existing = {
      ...createDunggiCooperativeMaster(NOW),
      cooperativeName: "잘못된 표시명",
      signupStatus: "REGISTERED",
      registeredAt: "2026-07-22T13:00:00.000Z",
      registeredBy: "demo-user",
      usageMarker: "keep-me",
    };
    const plan = buildDunggiSeedPlan(
      existing,
      "2026-07-23T00:00:00.000Z",
    );
    assert.equal(plan.action, "update");
    assert.equal(plan.write.cooperativeName, "둥기농협");
    assert.equal(Object.hasOwn(plan.write, "signupStatus"), false);
    assert.equal(Object.hasOwn(plan.write, "registeredAt"), false);
    assert.deepEqual(
      { ...existing, ...plan.write },
      {
        ...existing,
        ...plan.write,
        signupStatus: "REGISTERED",
        registeredAt: "2026-07-22T13:00:00.000Z",
        registeredBy: "demo-user",
        usageMarker: "keep-me",
      },
    );
  });

  it("creates one document and does not duplicate it in a local repository", () => {
    const documents = new Map<string, Record<string, unknown>>();
    const applyPlan = (now: string) => {
      const existing = documents.get(DUNGGI_COOPERATIVE_ID) ?? null;
      const plan = buildDunggiSeedPlan(existing, now);
      if (plan.action === "create") {
        documents.set(DUNGGI_COOPERATIVE_ID, { ...plan.write });
      } else if (plan.action === "update") {
        documents.set(DUNGGI_COOPERATIVE_ID, {
          ...existing,
          ...plan.write,
        });
      }
      return plan.action;
    };

    assert.equal(applyPlan(NOW), "create");
    assert.equal(
      applyPlan("2026-07-23T00:00:00.000Z"),
      "noop",
    );
    assert.equal(documents.size, 1);
    assert.equal(
      documents.get(DUNGGI_COOPERATIVE_ID)?.cooperativeName,
      "둥기농협",
    );
  });
});

describe("둥기농협 search and signup policy", () => {
  const demo = toDemoCooperativeSearchItem(
    createDunggiCooperativeMaster(NOW),
  );
  const real = nonghyupMaster.slice(0, 3).map(toRealCooperativeSearchItem);
  const catalog = [...real, demo];

  it("finds the demo institution by 둥기 and 둥기농협", () => {
    assert.deepEqual(
      searchCooperativeCatalog(catalog, "둥기").map(
        (item) => item.cooperative_id,
      ),
      [DUNGGI_COOPERATIVE_ID],
    );
    assert.deepEqual(
      searchCooperativeCatalog(catalog, "둥기농협").map(
        (item) => item.cooperative_id,
      ),
      [DUNGGI_COOPERATIVE_ID],
    );
  });

  it("keeps the initial demo master selectable", () => {
    assert.equal(demo.signupStatus, "AVAILABLE");
    assert.equal(isCooperativeSelectableForSignup(demo), true);
  });

  it("tracks submitted and approved status without changing duplicate policy", () => {
    assert.equal(nextDemoSignupStatus("AVAILABLE", "SUBMITTED"), "PENDING");
    assert.equal(nextDemoSignupStatus("PENDING", "APPROVED"), "REGISTERED");
    assert.equal(nextDemoSignupStatus("REGISTERED", "SUBMITTED"), "REGISTERED");
    assert.equal(
      isExistingSignupForCooperative(
        { cooperativeId: DUNGGI_COOPERATIVE_ID },
        DUNGGI_COOPERATIVE_ID,
      ),
      true,
    );
  });
});

describe("둥기농협 root metadata", () => {
  const demo = toDemoCooperativeSearchItem(
    createDunggiCooperativeMaster(NOW),
  );

  it("adds minimal root metadata only for the demo institution", () => {
    const metadata = buildSignupRootMetadata({
      cooperative: demo,
      rootEntityId: "user-1",
      createdBy: "user-1",
      createdAt: NOW,
    });
    assert.equal(metadata?.dataClassification, "DEMO");
    assert.equal(metadata?.sourceInstitutionId, DUNGGI_COOPERATIVE_ID);
    assert.equal(metadata?.testScenarioId, "dunggi-signup-v1");
    assert.equal(metadata?.testMetadata.rootEntityId, "user-1");

    const real = toRealCooperativeSearchItem(nonghyupMaster[0]);
    assert.equal(
      buildSignupRootMetadata({
        cooperative: real,
        rootEntityId: "real-user",
        createdBy: "real-user",
        createdAt: NOW,
      }),
      undefined,
    );
  });

  it("records password and phone Auth subjects by UID without PII", () => {
    const subjects = buildTestAuthSubjects({
      primaryUserUid: "email-uid",
      phoneAuthUid: "phone-uid",
      cooperative: demo,
      createdAt: NOW,
    });
    assert.deepEqual(
      subjects.map((subject) => [subject.authUid, subject.providerIds]),
      [
        ["email-uid", ["password"]],
        ["phone-uid", ["phone"]],
      ],
    );
    assert.equal(
      subjects.some((subject) => "email" in subject || "phone" in subject),
      false,
    );
  });
});
