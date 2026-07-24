# 테스트 데이터 정리 운영 실행 체크리스트

- 문서 상태: 운영 승인 전 필수 점검
- 기본 원칙: 모든 기능 플래그는 비활성 상태에서 시작하고, exact ID가 승인된 단일 농협만 처리한다.
- 금지: 농협명·이메일 pattern 기반 확정, 운영 자동 실행, manifest 밖 대상 추가, 실제 농협 master 삭제

## 1. 변경·백업 승인

- [ ] 운영 Firebase project ID를 콘솔과 `FIREBASE_PROJECT_ID`에서 대조했다.
- [ ] `TEST_DATA_PURGE_ALLOWED_PROJECT_ID`가 운영 project ID와 정확히 일치한다.
- [ ] 최신 Firestore 백업의 완료 시각과 복구 가능 상태를 확인했다.
- [ ] Storage 백업 또는 object versioning 필요 여부를 결정했다.
- [ ] Storage 복구 수단이 없다면 해당 위험을 변경 승인서에 기록했다.
- [ ] Auth 삭제 후 기존 password를 복구할 수 없음을 승인자가 확인했다.
- [ ] 실제 농협 master 1,109건 목록과 변경 전 snapshot을 검토했다.
- [ ] 변경 ticket, 승인자, 실행자, 관찰자를 확정했다.

## 2. 대상 확정

- [ ] 삭제 대상 exact `institutionId` 한 개를 확인했다.
- [ ] 농협명과 `institutionId`를 함께 대조했다.
- [ ] 동명 농협이 있는지 확인하고 이름을 식별키로 사용하지 않았다.
- [ ] 둥기농협이면 ID가 `demo-dunggi-nh`인지 확인했다.
- [ ] 실제 농협이면 static master의 코드·이름·유형·지역·주소·source를 기록했다.
- [ ] 대상 외 농협 문서와 UID가 manifest에 없는지 확인했다.

## 3. Legacy 검토

- [ ] 대상 농협의 운영 read-only legacy inventory를 완료했다.
- [ ] legacy review manifest의 모든 candidate를 검토했다.
- [ ] `REVIEW_REQUIRED`가 0건이다.
- [ ] `UNRESOLVED`가 0건이다.
- [ ] `CONFIRMED_TEST`는 SUPER_ADMIN이 exact resource 단위로 승인했다.
- [ ] `PRESERVE` 고객 데이터가 cleanup graph와 연결되지 않았다.
- [ ] 실제·테스트 데이터 혼재가 없다.
- [ ] cross-institution 및 broken/shared reference가 없다.
- [ ] 필요 시 legacy tagging dry-run 결과를 승인했다.

## 4. Auth·Storage 대상 검토

- [ ] Auth UID 목록을 provider별로 검토했다.
- [ ] 운영자·관리자·파트너 role 또는 custom claim을 가진 UID가 없다.
- [ ] 다른 조직과 연결된 UID가 없다.
- [ ] email/phone pattern을 Auth 삭제 근거로 사용하지 않았다.
- [ ] Storage bucket·exact path·generation·size 목록을 검토했다.
- [ ] shared Storage object가 없다.
- [ ] CMS·partner asset가 포함되지 않았다.
- [ ] Storage prefix는 검증 조회에만 사용되고 삭제에 사용되지 않는다.

## 5. Master 보존·reset 계획

- [ ] 실제 농협 master 보존 필드를 확인했다.
- [ ] 실제 농협 master에 write가 0건인 것을 확인했다.
- [ ] 둥기농협 master는 삭제 대상이 아님을 확인했다.
- [ ] reset 대상 필드는 manifest의 allowlist와 실제 존재 필드가 일치한다.
- [ ] 현재 둥기농협 reset은 `signupStatus → AVAILABLE`임을 확인했다.
- [ ] 조직·원장·고객 참조가 모두 제거되기 전에 reset하지 않는 순서를 확인했다.

## 6. Scan·Dry-run

- [ ] 운영 기능 플래그가 비활성인 상태에서 SCAN을 실행했다.
- [ ] SCAN warning과 incomplete inventory가 0건이다.
- [ ] DRY_RUN을 새로 실행했다.
- [ ] manifest가 `DRY_RUN_READY`다.
- [ ] manifest가 만료되지 않았다.
- [ ] manifest checksum을 승인 문서에 기록했다.
- [ ] 등록 후 재-scan checksum이 동일하다.
- [ ] Firestore/Auth/Storage 삭제 건수를 검토했다.
- [ ] Firestore 2,000건, Auth 20건, Storage 500개/5 GiB 한도 이내다.
- [ ] preserved item과 blocked/review item을 별도로 검토했다.
- [ ] 질문·답변 본문, raw email·전화번호, signed URL이 manifest에 없는지 확인했다.

## 7. 실행 승인

- [ ] 활성 SUPER_ADMIN이 manifest를 승인했다.
- [ ] 실행자는 최근 10분 이내 재인증했다.
- [ ] production 2인 승인 또는 조직의 동등한 승인 절차를 완료했다.
- [ ] server가 생성한 확인 문구를 문자 단위로 대조했다.
- [ ] 실행 시간대와 담당자 연락망을 확정했다.
- [ ] 신규 가입·문의·견적 쓰기를 일시 차단할 필요가 있는지 결정했다.
- [ ] `TEST_DATA_PURGE_ENABLED=true` 활성 시간을 승인했다.
- [ ] Auth/Storage 정리가 포함되면 `TEST_DATA_PURGE_EXTERNAL_ENABLED=true`를 승인했다.
- [ ] `TEST_DATA_PURGE_PRODUCTION_ENABLED=true`를 마지막 단계에서만 활성화한다.

## 8. APPLY·모니터링

- [ ] exact manifest ID로 APPLY를 실행했다.
- [ ] Purge Job ID와 attempt count를 기록했다.
- [ ] institution lock 획득을 확인했다.
- [ ] Auth disable 및 refresh token revoke 결과를 확인했다.
- [ ] Firestore leaf-before-parent 진행률을 모니터링했다.
- [ ] Storage generation-precondition 삭제 결과를 확인했다.
- [ ] Auth 최종 삭제 결과를 확인했다.
- [ ] master reset이 마지막 단계에서만 실행됐는지 확인했다.
- [ ] `PARTIALLY_FAILED`이면 실패 item과 retryable 여부를 검토했다.
- [ ] 동일 manifest·동일 job으로만 부분 실패를 재시도했다.
- [ ] stale, generation mismatch, 신규 target은 재시도하지 않고 새 SCAN으로 전환했다.

## 9. 사후 검증

- [ ] Firestore 고아 데이터 검증을 완료했다.
- [ ] Auth 고아 사용자 검증을 완료했다.
- [ ] Storage 고아 object 검증을 완료했다.
- [ ] manifest 밖 신규 object가 없음을 확인했다.
- [ ] 선택하지 않은 농협의 state hash가 변경되지 않았다.
- [ ] 실제 농협 master 기본정보가 변경되지 않았다.
- [ ] 둥기농협 master가 보존됐다.
- [ ] 기대 가입 가능 상태가 `AVAILABLE`인지 확인했다.
- [ ] email 중복 확인과 실제 고객 재가입 테스트를 완료했다.
- [ ] 최초 조직·사용자 포인트 정책을 확인했다.
- [ ] 감사 로그에 job ID, actor UID, count, 상태만 남았는지 확인했다.

## 10. 종료

- [ ] `TEST_DATA_PURGE_PRODUCTION_ENABLED=false`로 되돌렸다.
- [ ] `TEST_DATA_PURGE_EXTERNAL_ENABLED=false`로 되돌렸다.
- [ ] `TEST_DATA_PURGE_ENABLED=false`로 되돌렸다.
- [ ] lock이 정상 해제됐는지 확인했다.
- [ ] 결과 보고서와 manifest checksum을 보관했다.
- [ ] Firestore/Storage/Auth 사후 검증 증거를 변경 ticket에 첨부했다.
- [ ] 실패·복구·수동 조치 내역을 기록했다.

## 즉시 중단 조건

다음 중 하나라도 발생하면 APPLY 또는 재시도를 중단하고 새 SCAN과 승인을 요구한다.

- project ID, environment, institution ID 또는 checksum 불일치
- `REVIEW_REQUIRED`, `UNRESOLVED`, mixed data 또는 cross-institution reference 발견
- master 또는 control-plane path가 삭제 target에 포함됨
- 운영자·다른 조직 Auth UID 포함
- Storage generation 변경 또는 shared object 발견
- 삭제 한도 초과
- manifest 만료
- 질문 본문·raw email·token·signed URL이 manifest나 감사 로그에 노출
- 예상하지 않은 신규 Firestore/Auth/Storage target 발견
