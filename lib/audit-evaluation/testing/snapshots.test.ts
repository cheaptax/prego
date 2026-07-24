import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEvaluationConfigSnapshot } from "@/lib/audit-evaluation/snapshots";
import { createValidEvaluationConfig } from "@/lib/audit-evaluation/testing/fixtures";

describe("evaluation report snapshots", () => {
  it("deep-clones and freezes the complete evaluation configuration", () => {
    const config = createValidEvaluationConfig();
    const snapshot = createEvaluationConfigSnapshot(config);

    config.name = "변경된 설정";
    config.criteria[0].name = "변경된 기준";
    config.reportPhrases[0].text = "변경된 문구";

    assert.equal(snapshot.name, "FY27 감사인 견적 평가");
    assert.equal(snapshot.criteria[0].name, "회계법인 규모");
    assert.match(snapshot.reportPhrases[0].text, /확정된 입력 데이터/);
    assert.notEqual(snapshot.criteria, config.criteria);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.criteria), true);
    assert.equal(Object.isFrozen(snapshot.criteria[0]), true);
    assert.equal(Object.isFrozen(snapshot.criteria[0].rule), true);
  });
});
