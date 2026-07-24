"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  CooperativeMasterInput,
  ProductionCooperativeMasterRecord,
  ProductionCooperativeStatus,
} from "@/lib/cooperatives/master";
import type { AdminOperationsCopy } from "@/lib/cms/admin-operations-content";
import { getFirebaseAuth } from "@/lib/firebase/client";

type EditorState = {
  record: ProductionCooperativeMasterRecord | null;
  value: CooperativeMasterInput;
};

const EMPTY_VALUE: CooperativeMasterInput = {
  cooperativeName: "",
  cooperativeType: "지역농협",
  sido: "",
  sigungu: "",
  address: "",
  status: "active",
};
const TYPE_COPY_KEYS = {
  지역농협: "cooperativeMasterTypeLocal",
  축협: "cooperativeMasterTypeLivestock",
  품목농협: "cooperativeMasterTypeCommodity",
} as const;

export function CooperativeMasterPanel({
  copy,
  canWrite,
}: {
  copy: AdminOperationsCopy;
  canWrite: boolean;
}) {
  const text = copy.section("members");
  const dialogs = copy.section("dialogs");
  const [items, setItems] = useState<ProductionCooperativeMasterRecord[]>([]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [successorResults, setSuccessorResults] = useState<
    ProductionCooperativeMasterRecord[]
  >([]);

  const apiFetch = useCallback(async <T,>(url: string, init?: RequestInit) => {
    const user = getFirebaseAuth().currentUser;
    if (!user) throw new Error("permission_denied");
    const token = await user.getIdToken();
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
        authorization: `Bearer ${token}`,
      },
    });
    const body = (await response.json().catch(() => null)) as
      | (T & { error?: string })
      | null;
    if (!response.ok || !body) {
      throw new Error(body?.error || "request_failed");
    }
    return body;
  }, []);

  const load = useCallback(
    async (options: { search?: string; cursor?: string; append?: boolean } = {}) => {
      setLoading(true);
      setError("");
      try {
        const search = options.search ?? "";
        const params = new URLSearchParams({ pageSize: "30" });
        if (search) params.set("q", search);
        if (options.cursor) params.set("cursor", options.cursor);
        const data = await apiFetch<{
          ok: true;
          items: ProductionCooperativeMasterRecord[];
          total: number;
          nextCursor: string | null;
        }>(`/api/admin/cooperatives?${params.toString()}`);
        setItems((current) =>
          options.append ? [...current, ...data.items] : data.items,
        );
        setCursor(data.nextCursor);
        setTotal(data.total);
      } catch {
        setError(text.text("cooperativeMasterLoadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [apiFetch, text],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load({ search: "" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const searchSuccessors = async (search: string) => {
    if (!search.trim()) {
      setSuccessorResults([]);
      return;
    }
    try {
      const data = await apiFetch<{
        ok: true;
        items: ProductionCooperativeMasterRecord[];
      }>(
        `/api/admin/cooperatives?q=${encodeURIComponent(search.trim())}&pageSize=10`,
      );
      setSuccessorResults(
        data.items.filter(
          (item) =>
            item.status === "active" &&
            item.cooperativeId !== editor?.record?.cooperativeId,
        ),
      );
    } catch {
      setSuccessorResults([]);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor || saving) return;
    setSaving(true);
    setError("");
    try {
      const isEdit = Boolean(editor.record);
      await apiFetch<{ ok: true; record: ProductionCooperativeMasterRecord }>(
        isEdit
          ? `/api/admin/cooperatives/${editor.record!.cooperativeId}`
          : "/api/admin/cooperatives",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify({
            ...editor.value,
            ...(isEdit
              ? { expectedRevision: editor.record!.revision }
              : {}),
          }),
        },
      );
      setEditor(null);
      setSuccessorResults([]);
      await load({ search: query.trim() });
    } catch (saveError) {
      setError(
        saveError instanceof Error && saveError.message === "stale_cooperative"
          ? text.text("cooperativeMasterStale")
          : text.text("cooperativeMasterSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof CooperativeMasterInput>(
    key: K,
    value: CooperativeMasterInput[K],
  ) => {
    setEditor((current) =>
      current
        ? { ...current, value: { ...current.value, [key]: value } }
        : current,
    );
  };

  return (
    <div className="admin-grid">
      <section className="admin-card admin-card--span-3">
        <header className="admin-card__head">
          <div>
            <h2>{text.text("cooperativeMasterTitle")}</h2>
            <p>
              {text.text("cooperativeMasterDescription")} ·{" "}
              {text.text("cooperativeMasterTotal")} {total.toLocaleString()}
            </p>
          </div>
          {canWrite ? (
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={() => setEditor({ record: null, value: EMPTY_VALUE })}
            >
              {text.text("cooperativeMasterAdd")}
            </button>
          ) : null}
        </header>
        <form
          className="admin-operator-filters"
          onSubmit={(event) => {
            event.preventDefault();
            void load({ search: query.trim() });
          }}
        >
          <label>
            <span>{text.text("cooperativeMasterSearchLabel")}</span>
            <input
              className="admin-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={text.text("cooperativeMasterSearchPlaceholder")}
            />
          </label>
          <button className="admin-btn" type="submit" disabled={loading}>
            {loading
              ? text.text("cooperativeMasterLoading")
              : text.text("cooperativeMasterSearch")}
          </button>
        </form>
        {error ? (
          <div className="admin-inline-state admin-inline-state--error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{text.text("cooperativeMasterName")}</th>
                <th>{text.text("cooperativeMasterType")}</th>
                <th>{text.text("cooperativeMasterRegion")}</th>
                <th>{text.text("cooperativeMasterStatus")}</th>
                <th>{text.text("cooperativeMasterSuccessor")}</th>
                <th>{text.text("cooperativeMasterUpdatedAt")}</th>
                <th>{text.text("manageColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.cooperativeId}>
                  <td>
                    <strong>{item.cooperativeName}</strong>
                    <span className="admin-cell-sub">{item.cooperativeId}</span>
                  </td>
                  <td>{item.cooperativeType}</td>
                  <td>{[item.sido, item.sigungu].filter(Boolean).join(" ") || "-"}</td>
                  <td>
                    <span className="admin-pill">
                      {text.text(`cooperativeMasterStatus.${item.status}`)}
                    </span>
                  </td>
                  <td>{item.successorCooperativeId || "-"}</td>
                  <td>{new Date(item.updatedAt).toLocaleDateString("ko-KR")}</td>
                  <td>
                    {canWrite ? (
                      <button
                        type="button"
                        className="admin-btn admin-btn--sm"
                        onClick={() =>
                          setEditor({
                            record: item,
                            value: {
                              cooperativeName: item.cooperativeName,
                              cooperativeType: item.cooperativeType,
                              sido: item.sido,
                              sigungu: item.sigungu,
                              address: item.address,
                              status: item.status,
                              successorCooperativeId:
                                item.successorCooperativeId,
                              effectiveFrom: item.effectiveFrom,
                              effectiveTo: item.effectiveTo,
                            },
                          })
                        }
                      >
                        {text.text("cooperativeMasterEdit")}
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="admin-empty">
                    {text.text("cooperativeMasterEmpty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {cursor ? (
          <button
            type="button"
            className="admin-btn admin-btn--block"
            disabled={loading}
            onClick={() =>
              void load({ cursor, search: "", append: true })
            }
          >
            {text.text("cooperativeMasterMore")}
          </button>
        ) : null}
      </section>

      {editor ? (
        <div
          className="admin-modal"
          role="dialog"
          aria-modal="true"
          aria-label={text.text("cooperativeMasterEditorAriaLabel")}
        >
          <button
            type="button"
            className="admin-modal__backdrop"
            aria-label={dialogs.text("close")}
            onClick={() => setEditor(null)}
            disabled={saving}
          />
          <form
            className="admin-modal__panel"
            onSubmit={(event) => void save(event)}
          >
            <header className="admin-modal__head">
              <div>
                <p className="admin-modal__eyebrow">
                  {text.text("cooperativeMasterEyebrow")}
                </p>
                <h2>
                  {text.text(
                    editor.record
                      ? "cooperativeMasterEditTitle"
                      : "cooperativeMasterCreateTitle",
                  )}
                </h2>
              </div>
            </header>
            <div className="admin-modal__body">
              <div className="admin-operator-form-grid">
                <label className="admin-modal__field">
                  <span>{text.text("cooperativeMasterName")}</span>
                  <input
                    className="admin-input"
                    value={editor.value.cooperativeName}
                    onChange={(event) =>
                      update("cooperativeName", event.target.value)
                    }
                    maxLength={120}
                    required
                  />
                </label>
                <label className="admin-modal__field">
                  <span>{text.text("cooperativeMasterType")}</span>
                  <select
                    className="admin-input"
                    value={editor.value.cooperativeType}
                    onChange={(event) =>
                      update(
                        "cooperativeType",
                        event.target
                          .value as CooperativeMasterInput["cooperativeType"],
                      )
                    }
                  >
                    {(["지역농협", "축협", "품목농협"] as const).map((type) => (
                      <option key={type} value={type}>
                        {text.text(TYPE_COPY_KEYS[type])}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-modal__field">
                  <span>{text.text("cooperativeMasterSido")}</span>
                  <input
                    className="admin-input"
                    value={editor.value.sido}
                    onChange={(event) => update("sido", event.target.value)}
                    maxLength={40}
                  />
                </label>
                <label className="admin-modal__field">
                  <span>{text.text("cooperativeMasterSigungu")}</span>
                  <input
                    className="admin-input"
                    value={editor.value.sigungu}
                    onChange={(event) => update("sigungu", event.target.value)}
                    maxLength={60}
                  />
                </label>
                <label
                  className="admin-modal__field"
                  style={{ gridColumn: "1 / -1" }}
                >
                  <span>{text.text("cooperativeMasterAddress")}</span>
                  <input
                    className="admin-input"
                    value={editor.value.address}
                    onChange={(event) => update("address", event.target.value)}
                    maxLength={300}
                  />
                </label>
                <label className="admin-modal__field">
                  <span>{text.text("cooperativeMasterStatus")}</span>
                  <select
                    className="admin-input"
                    value={editor.value.status}
                    onChange={(event) =>
                      update(
                        "status",
                        event.target.value as ProductionCooperativeStatus,
                      )
                    }
                  >
                    {(["active", "pending", "merged", "closed"] as const).map(
                      (status) => (
                        <option key={status} value={status}>
                          {text.text(`cooperativeMasterStatus.${status}`)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="admin-modal__field">
                  <span>{text.text("cooperativeMasterEffectiveFrom")}</span>
                  <input
                    className="admin-input"
                    type="date"
                    value={editor.value.effectiveFrom ?? ""}
                    onChange={(event) =>
                      update("effectiveFrom", event.target.value)
                    }
                  />
                </label>
              </div>
              {editor.value.status === "merged" ? (
                <div className="admin-member-block">
                  <label className="admin-modal__field">
                    <span>{text.text("cooperativeMasterSuccessorSearch")}</span>
                    <input
                      className="admin-input"
                      type="search"
                      placeholder={text.text(
                        "cooperativeMasterSuccessorPlaceholder",
                      )}
                      onChange={(event) =>
                        void searchSuccessors(event.target.value)
                      }
                    />
                  </label>
                  <ul className="admin-mini-feed">
                    {successorResults.map((item) => (
                      <li key={item.cooperativeId}>
                        <button
                          type="button"
                          className="admin-btn"
                          onClick={() =>
                            update(
                              "successorCooperativeId",
                              item.cooperativeId,
                            )
                          }
                        >
                          {item.cooperativeName}
                        </button>
                        <span>{item.cooperativeId}</span>
                      </li>
                    ))}
                  </ul>
                  {editor.value.successorCooperativeId ? (
                    <p className="admin-cell-sub">
                      {text.text("cooperativeMasterSelectedSuccessor")}{" "}
                      {editor.value.successorCooperativeId}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="admin-modal__warning">
                {text.text("cooperativeMasterHistoryWarning")}
              </p>
              <div className="admin-modal__actions">
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  onClick={() => setEditor(null)}
                  disabled={saving}
                >
                  {dialogs.text("cancel")}
                </button>
                <button
                  type="submit"
                  className="admin-btn admin-btn--primary"
                  disabled={
                    saving ||
                    !editor.value.cooperativeName.trim() ||
                    (editor.value.status === "merged" &&
                      !editor.value.successorCooperativeId)
                  }
                >
                  {saving
                    ? text.text("cooperativeMasterSaving")
                    : text.text("cooperativeMasterSave")}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
