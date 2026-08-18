"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import type {
  CooperativeQuotePriceMasterRow,
} from "@/lib/quotes/cooperative-quote-price-master-types";

type PartnerOption = {
  id: string;
  name: string;
  contactEmail?: string;
};

type CooperativeOption = {
  cooperativeId: string;
  cooperativeName: string;
};

type ValidationSummary = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  cooperativeCount: number;
  partnerCount: number;
};

type Props = {
  canWrite: boolean;
  onMessage: (message: { tone: "success" | "error"; text: string }) => void;
};

const nextFiscalYear = new Date().getFullYear() + 1;

function digitsOnly(value: string) {
  return value.replace(/\D/gu, "");
}

function formatWon(value: string) {
  if (!value) return "";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return amount.toLocaleString("ko-KR");
}

function priorAuditorFromNotes(notes: string | undefined) {
  if (!notes?.startsWith("priorAuditor:")) return "";
  return notes.slice("priorAuditor:".length).split("\n")[0] ?? "";
}

export function CooperativeQuotePriceMasterPanel({
  canWrite,
  onMessage,
}: Props) {
  const [fiscalYear, setFiscalYear] = useState(nextFiscalYear);
  const [rows, setRows] = useState<CooperativeQuotePriceMasterRow[]>([]);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [cooperativeSearch, setCooperativeSearch] = useState("");
  const [cooperativeOptions, setCooperativeOptions] = useState<CooperativeOption[]>([]);
  const [selectedCooperative, setSelectedCooperative] =
    useState<CooperativeOption | null>(null);
  const [priorAuditorName, setPriorAuditorName] = useState("");
  const [plannedAuditFeeWon, setPlannedAuditFeeWon] = useState("");
  const [safePriceMinWon, setSafePriceMinWon] = useState("");
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [keepExistingNonSelected, setKeepExistingNonSelected] = useState(true);
  const [validation, setValidation] = useState<{
    ok: boolean;
    summary: ValidationSummary;
    errors: Array<{ rowNumber: number; code: string; message: string }>;
  } | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const adminFetch = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error("auth_required");
    const token = await user.getIdToken();
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData)
          ? { "content-type": "application/json" }
          : {}),
        ...(init?.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
    });
    const data = (await response.json().catch(() => null)) as
      | (T & { error?: string; message?: string })
      | null;
    if (!response.ok || !data) {
      throw new Error(data?.message || data?.error || "request_failed");
    }
    return data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminFetch<{
        ok: true;
        rows: CooperativeQuotePriceMasterRow[];
        partners: PartnerOption[];
      }>(`/api/admin/quote-price-master?fiscalYear=${fiscalYear}&pageSize=2000`);
      setRows(data.rows);
      setPartners(data.partners);
    } catch (error) {
      onMessage({
        tone: "error",
        text:
          error instanceof Error && error.message !== "request_failed"
            ? `견적 마스터를 불러오지 못했습니다. (${error.message})`
            : "견적 마스터를 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }, [adminFetch, fiscalYear, onMessage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const searchCooperatives = async () => {
    if (!cooperativeSearch.trim()) return;
    try {
      const data = await adminFetch<{
        ok: true;
        items: Array<{ cooperativeId: string; cooperativeName: string }>;
      }>(
        `/api/admin/cooperatives?q=${encodeURIComponent(cooperativeSearch.trim())}&pageSize=10`,
      );
      setCooperativeOptions(data.items);
    } catch {
      setCooperativeOptions([]);
    }
  };

  const selectCooperative = (cooperative: CooperativeOption) => {
    const existing = rows.find(
      (row) =>
        row.plan.fiscalYear === fiscalYear &&
        row.plan.cooperativeId === cooperative.cooperativeId,
    );
    const winner =
      existing?.prices.find((price) => price.isPlannedWinner) ??
      existing?.prices.find(
        (price) => price.partnerId === existing.plan.plannedWinnerPartnerId,
      ) ??
      null;
    setSelectedCooperative(cooperative);
    setPriorAuditorName(priorAuditorFromNotes(existing?.plan.notes));
    setPlannedAuditFeeWon(winner?.plannedAuditFeeWon ?? "");
    setSafePriceMinWon(winner?.safePriceMinWon ?? "");
    setSelectedPartnerId(winner?.partnerId ?? "");
  };

  const currentRow = useMemo(() => {
    if (!selectedCooperative) return null;
    return (
      rows.find(
        (row) =>
          row.plan.fiscalYear === fiscalYear &&
          row.plan.cooperativeId === selectedCooperative.cooperativeId,
      ) ?? null
    );
  }, [fiscalYear, rows, selectedCooperative]);

  const nonSelectedPrices = useMemo(() => {
    if (!currentRow) return [];
    return currentRow.prices.filter((price) => !price.isPlannedWinner);
  }, [currentRow]);

  const save = async () => {
    if (!selectedCooperative || !selectedPartnerId || !digitsOnly(plannedAuditFeeWon)) {
      return;
    }
    setSaving(true);
    try {
      await adminFetch("/api/admin/quote-price-master", {
        method: "PUT",
        body: JSON.stringify({
          fiscalYear,
          cooperativeId: selectedCooperative.cooperativeId,
          cooperativeName: selectedCooperative.cooperativeName,
          priorAuditorName,
          plannedAuditFeeWon: digitsOnly(plannedAuditFeeWon),
          safePriceMinWon: digitsOnly(safePriceMinWon) || undefined,
          selectedPartnerId,
          keepExistingNonSelected,
        }),
      });
      onMessage({
        tone: "success",
        text: keepExistingNonSelected
          ? "견적 마스터를 저장했습니다. (기존 비선정 유지)"
          : "견적 마스터를 저장했습니다. (활성 제휴사 전원 가격 재계산)",
      });
      await load();
    } catch {
      onMessage({ tone: "error", text: "견적 마스터 저장에 실패했습니다." });
    } finally {
      setSaving(false);
    }
  };

  const downloadExcel = async () => {
    const user = getFirebaseAuth().currentUser;
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/admin/quote-price-master/excel?fiscalYear=${fiscalYear}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("spreadsheetml")) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || "download_failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `quote-price-master-${fiscalYear}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      onMessage({
        tone: "error",
        text: "엑셀 템플릿 다운로드에 실패했습니다. 다시 로그인한 뒤 시도해 주세요.",
      });
    }
  };

  const upload = async (commit: boolean) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const data = await adminFetch<{
        ok: true;
        validation: {
          ok: boolean;
          summary: ValidationSummary;
          errors: Array<{ rowNumber: number; code: string; message: string }>;
        };
        committed?: number;
      }>(
        commit
          ? `/api/admin/quote-price-master/excel/commit?fiscalYear=${fiscalYear}`
          : `/api/admin/quote-price-master/excel/validate?fiscalYear=${fiscalYear}`,
        { method: "POST", body: form },
      );
      setValidation(data.validation);
      if (commit) {
        onMessage({
          tone: "success",
          text: `${data.committed ?? 0}개 농협 견적 마스터를 반영했습니다.`,
        });
        await load();
      } else {
        onMessage({
          tone: data.validation.ok ? "success" : "error",
          text: data.validation.ok
            ? `검증 통과: ${data.validation.summary.validRows}행`
            : `검증 오류 ${data.validation.summary.errorRows}행 · 정상 ${data.validation.summary.validRows}행`,
        });
      }
    } catch {
      onMessage({ tone: "error", text: "엑셀 처리에 실패했습니다." });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="admin-grid">
      <section className="admin-card admin-card--span-3">
        <header className="admin-card__head">
          <div>
            <h2>농협 견적 마스터</h2>
            <p>
              엑셀 기본 형식은 농협정보_마스터(시트9)와 같습니다. 운영자는{" "}
              <strong>제휴사_선정</strong>만 지정하면, 나머지 활성 제휴사 전부가
              비선정으로 저장됩니다 (110%, 115%, 120%…).
            </p>
          </div>
          <button type="button" className="admin-btn" onClick={downloadExcel}>
            엑셀 다운로드
          </button>
        </header>
        <div className="admin-toolbar">
          <label className="admin-field">
            <span>회계연도</span>
            <input
              value={fiscalYear}
              onChange={(event) => setFiscalYear(Number(event.target.value))}
              type="number"
            />
          </label>
          <label className="admin-field admin-field--grow">
            <span>농협 검색</span>
            <input
              value={cooperativeSearch}
              onChange={(event) => setCooperativeSearch(event.target.value)}
              placeholder="농협명 입력"
            />
          </label>
          <button type="button" className="admin-btn" onClick={searchCooperatives}>
            검색
          </button>
        </div>
        {cooperativeOptions.length > 0 ? (
          <div className="admin-chip-list">
            {cooperativeOptions.map((cooperative) => (
              <button
                key={cooperative.cooperativeId}
                type="button"
                className="admin-chip"
                onClick={() => selectCooperative(cooperative)}
              >
                {cooperative.cooperativeName}
              </button>
            ))}
          </div>
        ) : null}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>농협</th>
                <th>예정견적</th>
                <th>제휴사_선정</th>
                <th>제휴사_비선정</th>
                <th>수정</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const winner =
                  row.prices.find((price) => price.isPlannedWinner) ?? null;
                const nonSelected = row.prices
                  .filter((price) => !price.isPlannedWinner)
                  .map((price) => price.partnerName)
                  .join(", ");
                return (
                  <tr key={row.plan.id}>
                    <td>{row.plan.cooperativeName}</td>
                    <td>
                      {winner
                        ? formatWon(winner.plannedAuditFeeWon)
                        : "-"}
                    </td>
                    <td>{winner?.partnerName ?? "-"}</td>
                    <td>{nonSelected || "-"}</td>
                    <td>
                      <button
                        type="button"
                        className="admin-link"
                        onClick={() =>
                          selectCooperative({
                            cooperativeId: row.plan.cooperativeId,
                            cooperativeName: row.plan.cooperativeName,
                          })
                        }
                      >
                        열기
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>저장된 마스터가 없습니다.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card admin-card--span-3">
        <header className="admin-card__head">
          <div>
            <h3>{selectedCooperative?.cooperativeName ?? "농협 선택 필요"}</h3>
            <p>
              예정견적·최저안전견적·선정 제휴사만 입력합니다. 비선정은 현재 활성
              제휴사 전부에 자동 배정됩니다.
            </p>
          </div>
        </header>
        <div className="admin-toolbar">
          <label className="admin-field">
            <span>25년감사인</span>
            <input
              value={priorAuditorName}
              onChange={(event) => setPriorAuditorName(event.target.value)}
              disabled={!canWrite || !selectedCooperative}
              placeholder="전기 감사인 (선택)"
            />
          </label>
          <label className="admin-field">
            <span>예정견적</span>
            <input
              value={plannedAuditFeeWon}
              onChange={(event) =>
                setPlannedAuditFeeWon(digitsOnly(event.target.value))
              }
              disabled={!canWrite || !selectedCooperative}
              inputMode="numeric"
              placeholder="예: 10000000"
            />
          </label>
          <label className="admin-field">
            <span>최저안전견적</span>
            <input
              value={safePriceMinWon}
              onChange={(event) =>
                setSafePriceMinWon(digitsOnly(event.target.value))
              }
              disabled={!canWrite || !selectedCooperative}
              inputMode="numeric"
              placeholder="비우면 예정견적×90%"
            />
          </label>
          <label className="admin-field admin-field--grow">
            <span>제휴사_선정</span>
            <select
              value={selectedPartnerId}
              onChange={(event) => setSelectedPartnerId(event.target.value)}
              disabled={!canWrite || !selectedCooperative}
            >
              <option value="">선정 제휴사 선택</option>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="admin-field">
          <span>
            <input
              type="checkbox"
              checked={keepExistingNonSelected}
              onChange={(event) =>
                setKeepExistingNonSelected(event.target.checked)
              }
              disabled={!canWrite}
            />{" "}
            기존 비선정 가격 유지 (해제 시 활성 제휴사 전원 가격을 다시 계산)
          </span>
        </label>
        <div className="admin-note">
          <p>
            비선정 제휴사 (자동, 현재 활성 제휴사 전부)
            {nonSelectedPrices.length === 0
              ? " — 저장 시 선정 제휴사를 제외한 활성 제휴사 전원이 배정됩니다."
              : null}
          </p>
          {nonSelectedPrices.length > 0 ? (
            <ul>
              {nonSelectedPrices.map((price, index) => (
                <li key={price.partnerId}>
                  비선정{index + 1}: {price.partnerName} ·{" "}
                  {formatWon(price.plannedAuditFeeWon)}원
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          disabled={
            !canWrite ||
            saving ||
            !selectedCooperative ||
            !selectedPartnerId ||
            !digitsOnly(plannedAuditFeeWon)
          }
          onClick={save}
        >
          {saving ? "저장 중..." : "마스터 저장"}
        </button>
      </section>

      <section className="admin-card admin-card--span-3">
        <header className="admin-card__head">
          <div>
            <h3>엑셀 업로드</h3>
            <p>
              다운로드 파일의 <strong>시트9</strong>에서{" "}
              <strong>제휴사_선정</strong>만 드롭다운으로 고르세요. 금액이 아니라
              제휴사명입니다. 비선정 칸은 비워 두어도 활성 제휴사 전원이 반영됩니다.
            </p>
          </div>
        </header>
        <input
          type="file"
          accept=".xlsx"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setFile(event.target.files?.[0] ?? null)
          }
        />
        <div className="admin-actions">
          <button
            type="button"
            className="admin-btn"
            disabled={!file || uploading}
            onClick={() => upload(false)}
          >
            {uploading ? "처리 중..." : "업로드 검증"}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            disabled={!canWrite || !file || uploading}
            onClick={() => upload(true)}
          >
            {uploading ? "반영 중 (최대 1분)..." : "정상 행 반영"}
          </button>
        </div>
        {validation ? (
          <div className="admin-note">
            총 {validation.summary.totalRows}행 · 정상{" "}
            {validation.summary.validRows}행 · 오류{" "}
            {validation.summary.errorRows}행
            {validation.errors.slice(0, 8).map((error) => (
              <p key={`${error.rowNumber}-${error.code}`}>
                {error.rowNumber}행: {error.code}
              </p>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
