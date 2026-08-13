"use client";

import { useEffect, useMemo, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { PartnerNhAuditQuoteForm } from "@/components/PartnerNhAuditQuoteForm";
import type { AdminOperationsCopy } from "@/lib/cms/admin-operations-content";
import type { PartnerRecord } from "@/lib/firebase/schema";
import {
  applyNhAuditEvaluationDefaults,
  extractNhAuditEvaluationDefaults,
} from "@/lib/quotes/nh-audit-evaluation-defaults";
import { partnerQuoteProfileGaps } from "@/lib/quotes/admin-proxy-quote-readiness";
import {
  validateNhAuditPartnerForm,
  type NhAuditPartnerFormField,
  type NhAuditPartnerFormValues,
} from "@/lib/quotes/nh-audit-quote-form";

type Props = {
  copy: AdminOperationsCopy;
  partner: PartnerRecord;
  canUpdate: boolean;
  previewMode?: boolean;
  onMessage: (message: { tone: "success" | "error"; text: string }) => void;
  onPartnerUpdated: (partner: PartnerRecord) => void;
};

async function adminFormFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("auth_required");
  const token = await user.getIdToken();
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  });
}

function usePartnerAssetPreview(
  partnerId: string,
  kind: "logo" | "seal",
  version: string | undefined,
  enabled: boolean,
) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (!enabled) {
      setUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      return;
    }
    void (async () => {
      try {
        const response = await adminFormFetch(
          `/api/admin/partners/${encodeURIComponent(partnerId)}/${kind}?v=${encodeURIComponent(version ?? kind)}`,
        );
        if (!response.ok || cancelled) return;
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return objectUrl;
        });
      } catch {
        if (!cancelled) {
          setUrl((previous) => {
            if (previous) URL.revokeObjectURL(previous);
            return null;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, kind, partnerId, version]);
  return url;
}

export function PartnerQuoteProfileSection({
  copy,
  partner,
  canUpdate,
  previewMode = false,
  onMessage,
  onPartnerUpdated,
}: Props) {
  const partnersCopy = copy.section("partners");
  const terminated = partner.status === "terminated";
  const disabled = previewMode || !canUpdate || terminated;
  const [consent, setConsent] = useState(
    partner.opsProxyQuoteSendConsent === true,
  );
  const [values, setValues] = useState<NhAuditPartnerFormValues>(() =>
    applyNhAuditEvaluationDefaults(partner.nhAuditEvaluationDefaults),
  );
  const [errors, setErrors] = useState<
    Partial<Record<NhAuditPartnerFormField, string>>
  >({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"logo" | "seal" | null>(null);

  useEffect(() => {
    setConsent(partner.opsProxyQuoteSendConsent === true);
    setValues(applyNhAuditEvaluationDefaults(partner.nhAuditEvaluationDefaults));
    setErrors({});
  }, [partner.id, partner.opsProxyQuoteSendConsent, partner.nhAuditEvaluationDefaults]);

  const logoPreviewUrl = usePartnerAssetPreview(
    partner.id,
    "logo",
    partner.logoUpdatedAt ?? partner.logoPath,
    Boolean(partner.logoPath),
  );
  const sealPreviewUrl = usePartnerAssetPreview(
    partner.id,
    "seal",
    partner.sealUpdatedAt ?? partner.sealPath,
    Boolean(partner.sealPath),
  );

  const gaps = useMemo(() => partnerQuoteProfileGaps(partner), [partner]);
  const checklist = [
    ...gaps.missingLabels,
    ...(partner.opsProxyQuoteSendConsent !== true &&
    !gaps.missing.includes("proxy_consent_missing")
      ? [partnersCopy.text("quoteProfileConsentRecommended")]
      : []),
    ...(gaps.logoMissing
      ? [partnersCopy.text("quoteProfileLogoRecommended")]
      : []),
  ].filter((label, index, list) => list.indexOf(label) === index);

  const uploadAsset = async (kind: "logo" | "seal", file: File | null) => {
    if (!file || disabled) return;
    setUploading(kind);
    try {
      const formData = new FormData();
      formData.set(kind, file);
      const response = await adminFormFetch(
        `/api/admin/partners/${encodeURIComponent(partner.id)}/${kind}`,
        { method: "POST", body: formData },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        logoPath?: string;
        logoContentType?: string;
        logoUpdatedAt?: string;
        sealPath?: string;
        sealContentType?: string;
        sealUpdatedAt?: string;
      } | null;
      if (!response.ok || !data?.ok) {
        throw new Error("upload_failed");
      }
      onPartnerUpdated({
        ...partner,
        ...(kind === "logo"
          ? {
              logoPath: data.logoPath,
              logoContentType: data.logoContentType,
              logoUpdatedAt: data.logoUpdatedAt,
            }
          : {
              sealPath: data.sealPath,
              sealContentType: data.sealContentType,
              sealUpdatedAt: data.sealUpdatedAt,
            }),
      });
      onMessage({
        tone: "success",
        text: partnersCopy.text(
          kind === "logo" ? "logoUploadSuccess" : "sealUploadSuccess",
        ),
      });
    } catch {
      onMessage({
        tone: "error",
        text: partnersCopy.text(
          kind === "logo" ? "logoUploadFailed" : "sealUploadFailed",
        ),
      });
    } finally {
      setUploading(null);
    }
  };

  const saveProfile = async () => {
    if (disabled) return;
    const validation = validateNhAuditPartnerForm({
      ...values,
      auditFeeWon: "1",
      expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
      expectedExpenseWon: "0",
      factsConfirmed: true,
    });
    const defaults = extractNhAuditEvaluationDefaults(values);
    if (!validation.valid || !defaults) {
      setErrors(validation.fieldErrors);
      onMessage({
        tone: "error",
        text: partnersCopy.text("evaluationDefaultsInvalid"),
      });
      return;
    }
    setSaving(true);
    try {
      const response = await adminFormFetch(
        `/api/admin/partners/${encodeURIComponent(partner.id)}/quote-profile`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            opsProxyQuoteSendConsent: consent,
            nhAuditEvaluationDefaults: defaults,
          }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        partner?: PartnerRecord;
      } | null;
      if (!response.ok || !data?.ok || !data.partner) {
        throw new Error("save_failed");
      }
      onPartnerUpdated(data.partner);
      onMessage({
        tone: "success",
        text: partnersCopy.text("evaluationDefaultsSaved"),
      });
    } catch {
      onMessage({
        tone: "error",
        text: partnersCopy.text("evaluationDefaultsSaveFailed"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-partner-quote-profile">
      <h3>{partnersCopy.text("quoteProfileTitle")}</h3>
      <p className="admin-form__hint">
        {partnersCopy.text("quoteProfileDescription")}
      </p>
      {terminated ? (
        <p className="admin-form__hint">
          {partnersCopy.text("quoteProfileTerminated")}
        </p>
      ) : null}
      {checklist.length === 0 ? (
        <p className="admin-inline-state admin-inline-state--success" role="status">
          {partnersCopy.text("quoteProfileReady")}
        </p>
      ) : (
        <p className="admin-form__hint" role="status">
          {partnersCopy.text("quoteProfileMissingPrefix")}: {checklist.join(", ")}
        </p>
      )}

      <dl className="admin-detail-list">
        <div>
          <dt>{partnersCopy.text("businessRegistrationNumberLabel")}</dt>
          <dd>{partner.businessRegistrationNumber || "-"}</dd>
        </div>
        <div>
          <dt>{partnersCopy.text("businessAddressLabel")}</dt>
          <dd>{partner.businessAddress || "-"}</dd>
        </div>
        <div>
          <dt>{partnersCopy.text("managerLabel")}</dt>
          <dd>{partner.managerName || "-"}</dd>
        </div>
        <div>
          <dt>{partnersCopy.text("emailLabel")}</dt>
          <dd>{partner.contactEmail || "-"}</dd>
        </div>
        <div>
          <dt>{partnersCopy.text("phoneLabel")}</dt>
          <dd>{partner.contactPhone || "-"}</dd>
        </div>
      </dl>

      <div className="admin-partner-form-grid">
        <label className="admin-form__field">
          <span>{partnersCopy.text("logoLabel")}</span>
          <input
            className="admin-input"
            type="file"
            accept="image/png,image/jpeg"
            disabled={disabled || uploading !== null}
            onChange={(event) => {
              void uploadAsset("logo", event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
          {logoPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated blob preview
            <img
              className="partner-quote-logo-preview"
              src={logoPreviewUrl}
              alt=""
            />
          ) : null}
          <small>
            {partner.logoPath
              ? partnersCopy.text("assetRegistered")
              : partnersCopy.text("assetMissing")}
            {" · "}
            {partnersCopy.text("logoHelp")}
          </small>
        </label>
        <label className="admin-form__field">
          <span>{partnersCopy.text("sealLabel")}</span>
          <input
            className="admin-input"
            type="file"
            accept="image/png,image/jpeg"
            disabled={disabled || uploading !== null}
            onChange={(event) => {
              void uploadAsset("seal", event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
          {sealPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated blob preview
            <img
              className="partner-quote-seal-preview"
              src={sealPreviewUrl}
              alt=""
            />
          ) : null}
          <small>
            {partner.sealPath
              ? partnersCopy.text("assetRegistered")
              : partnersCopy.text("assetMissing")}
            {" · "}
            {partnersCopy.text("sealHelp")}
          </small>
        </label>
      </div>

      <label className="admin-check-row">
        <input
          type="checkbox"
          checked={consent}
          disabled={disabled || saving}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>
          {partnersCopy.text("proxyConsentLabel")}
          <small className="admin-form__hint">
            {consent
              ? partnersCopy.text("proxyConsentOn")
              : partnersCopy.text("proxyConsentOff")}
            {" · "}
            {partnersCopy.text("proxyConsentHelp")}
          </small>
        </span>
      </label>

      <PartnerNhAuditQuoteForm
        idPrefix={`admin-partner-${partner.id}-defaults`}
        accountingFirmName={partner.name || partner.displayName}
        values={values}
        errors={errors}
        disabled={disabled || saving}
        heading={partnersCopy.text("evaluationDefaultsTitle")}
        description={partnersCopy.text("evaluationDefaultsDescription")}
        showFactsConfirmation={false}
        showCostFields={false}
        showRequestContext={false}
        onChange={setValues}
        onClearError={(field) =>
          setErrors((current) => {
            const next = { ...current };
            delete next[field];
            return next;
          })
        }
      />

      {canUpdate && !terminated && !previewMode ? (
        <div className="admin-partner-quote-profile__actions">
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            disabled={saving || uploading !== null}
            onClick={() => void saveProfile()}
          >
            {saving
              ? copy.section("dialogs").text("saving")
              : partnersCopy.text("evaluationDefaultsSave")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
