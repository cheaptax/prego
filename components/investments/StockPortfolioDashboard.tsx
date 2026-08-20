"use client";

import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import type { MarketDataProviderStatus, PortfolioSnapshot, StockTransactionInput, StockTransactionType } from "@/lib/investments/types";
import styles from "./StockPortfolioDashboard.module.css";

const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });
const pct = new Intl.NumberFormat("ko-KR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const blank = (): StockTransactionInput => ({ type: "BUY", tradeDate: today(), symbol: "", name: "", quantity: 0, unitPrice: 0, fee: 0, tax: 0, broker: "", destinationBroker: "", note: "" });

type ResponseBody = { ok?: boolean; error?: string; partial?: boolean; snapshot?: PortfolioSnapshot; provider?: MarketDataProviderStatus };

async function api(url: string, init?: RequestInit) {
  const auth = getFirebaseAuth();
  const user = auth.currentUser ?? await new Promise<NonNullable<typeof auth.currentUser>>((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (next) => { if (next) { unsubscribe(); resolve(next); } }, reject);
  });
  return fetch(url, { ...init, headers: { authorization: `Bearer ${await user.getIdToken()}`, ...(init?.headers ?? {}) } });
}

const money = (value: number | null) => value === null ? "-" : won.format(value);
const percent = (value: number | null) => value === null ? "-" : pct.format(value);

export function StockPortfolioDashboard() {
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [provider, setProvider] = useState<MarketDataProviderStatus | null>(null);
  const [form, setForm] = useState<StockTransactionInput>(blank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await api("/api/investments/portfolio");
    const data = await response.json() as ResponseBody;
    if (!response.ok || !data.snapshot) throw new Error(data.error ?? "portfolio_load_failed");
    setSnapshot(data.snapshot); setProvider(data.provider ?? null);
  }, []);

  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : "불러오기 실패")); }, [load]);

  const brokers = useMemo(() => [...new Set(snapshot?.transactions.flatMap((item) => [item.broker, item.destinationBroker ?? ""]).filter(Boolean) ?? [])], [snapshot]);

  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const payload = form.type === "TRANSFER" ? { ...form, unitPrice: 0, fee: 0, tax: 0 } : form;
      const response = await api("/api/investments/portfolio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as ResponseBody;
      if (!response.ok || !data.snapshot) throw new Error(data.error ?? "save_failed");
      setSnapshot(data.snapshot); setForm((previous) => ({ ...blank(), broker: previous.broker })); setMessage("거래를 반영했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "저장 실패"); }
    finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setMessage("");
    try {
      const response = await api("/api/investments/quotes/refresh", { method: "POST" });
      const data = await response.json() as ResponseBody;
      if ((!response.ok && !data.partial) || !data.snapshot) throw new Error(data.error ?? "quote_refresh_failed");
      setSnapshot(data.snapshot); setMessage(data.partial ? "일부 종목은 기존 시세를 사용했습니다." : "현재가와 전고점을 갱신했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "시세 갱신 실패"); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("이 거래를 삭제하고 이후 손익을 다시 계산할까요?")) return;
    const response = await api(`/api/investments/transactions/${id}`, { method: "DELETE" });
    const data = await response.json() as ResponseBody;
    if (response.ok && data.snapshot) setSnapshot(data.snapshot); else setMessage(data.error ?? "삭제 실패");
  }

  return <div className={styles.page}>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>PREGO AI · INVESTMENT REVIEW</p><h1>주식평가</h1><p>평균법 손익, 증권사간 이체, 시가 비중, 수정주가 기준 역사적 고점을 함께 관리합니다.</p></div>
      <div className={styles.actions}><Link href="/mypage">마이페이지</Link><button disabled={busy || !snapshot?.positions.length} onClick={refresh}>실제 주가 갱신</button></div>
    </header>
    {message && <div className={styles.notice}>{message}</div>}
    {!provider?.configured && <div className={styles.notice}>Vercel에 KIS_APP_KEY와 KIS_APP_SECRET을 설정하면 실제 주가 연동이 활성화됩니다.</div>}

    <section className={styles.cards}>
      <article><span>취득원가</span><strong>{money(snapshot?.summary.totalCostBasis ?? 0)}</strong></article>
      <article><span>평가금액</span><strong>{money(snapshot?.summary.totalMarketValue ?? null)}</strong></article>
      <article><span>평가손익</span><strong>{money(snapshot?.summary.totalUnrealizedPnl ?? null)}</strong><small>{percent(snapshot?.summary.totalReturnRate ?? null)}</small></article>
      <article><span>실현손익</span><strong>{money(snapshot?.summary.totalRealizedPnl ?? 0)}</strong></article>
    </section>

    <section className={styles.panel}><h2>보유 종목</h2><div className={styles.scroll}><table><thead><tr><th>종목</th><th>수량</th><th>평균단가</th><th>현재가</th><th>평가금액</th><th>비중</th><th>평가손익</th><th>전고점</th><th>고점기준 손익</th><th>고점대비</th></tr></thead><tbody>
      {snapshot?.positions.map((item) => <tr key={item.symbol}><td><b>{item.name}</b><small>{item.symbol}<br />{item.brokers.map((broker) => `${broker.broker} ${number.format(broker.quantity)}주`).join(" · ")}</small></td><td>{number.format(item.quantity)}</td><td>{money(item.averageCost)}</td><td>{money(item.currentPrice)}</td><td>{money(item.marketValue)}</td><td>{percent(item.weight)}</td><td>{money(item.unrealizedPnl)}<small>{percent(item.returnRate)}</small></td><td>{money(item.peakPrice)}<small>{item.peakDate ?? ""}</small></td><td>{money(item.peakPnl)}</td><td>{percent(item.drawdownFromPeak)}</td></tr>)}
      {!snapshot?.positions.length && <tr><td colSpan={10}>거래를 입력하면 평가가 시작됩니다.</td></tr>}
    </tbody></table></div></section>

    <div className={styles.grid}>
      <section className={styles.panel}><h2>거래 입력</h2><form onSubmit={save} className={styles.form}>
        <label>구분<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as StockTransactionType })}><option value="OPENING">기초잔고</option><option value="BUY">매수</option><option value="SELL">매도</option><option value="TRANSFER">증권사간 이체</option></select></label>
        <label>거래일<input type="date" value={form.tradeDate} onChange={(event) => setForm({ ...form, tradeDate: event.target.value })} required /></label>
        <label>종목코드<input pattern="[0-9]{6}" value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value.replace(/\D/g, "").slice(0, 6) })} required /></label>
        <label>종목명<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
        <label>수량<input type="number" step="any" min="0.00000001" value={form.quantity || ""} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} required /></label>
        <label>단가<input type="number" min="0" value={form.unitPrice || ""} disabled={form.type === "TRANSFER"} onChange={(event) => setForm({ ...form, unitPrice: Number(event.target.value) })} required /></label>
        <label>출고·거래 증권사<input list="brokers" value={form.broker} onChange={(event) => setForm({ ...form, broker: event.target.value })} required /></label>
        {form.type === "TRANSFER" ? <label>입고 증권사<input list="brokers" value={form.destinationBroker} onChange={(event) => setForm({ ...form, destinationBroker: event.target.value })} required /></label> : <><label>수수료<input type="number" min="0" value={form.fee || ""} onChange={(event) => setForm({ ...form, fee: Number(event.target.value) })} /></label><label>세금<input type="number" min="0" value={form.tax || ""} onChange={(event) => setForm({ ...form, tax: Number(event.target.value) })} /></label></>}
        <label className={styles.full}>메모<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label><datalist id="brokers">{brokers.map((broker) => <option key={broker} value={broker} />)}</datalist><button disabled={busy}>거래 반영</button>
      </form></section>
      <section className={styles.panel}><h2>Prego AI 점검</h2>{snapshot?.insights.map((item) => <article className={styles.insight} key={item.id}><b>{item.title}</b><p>{item.message}</p></article>)}{snapshot?.issues.map((item) => <article className={styles.insight} key={item.transactionId}><b>거래 검증 오류</b><p>{item.message}</p></article>)}</section>
    </div>

    <section className={styles.panel}><h2>거래 내역</h2><div className={styles.scroll}><table><thead><tr><th>일자</th><th>구분</th><th>종목</th><th>수량</th><th>단가</th><th>증권사</th><th></th></tr></thead><tbody>{snapshot?.transactions.map((item) => <tr key={item.id}><td>{item.tradeDate}</td><td>{item.type}</td><td>{item.name}</td><td>{number.format(item.quantity)}</td><td>{item.type === "TRANSFER" ? "-" : money(item.unitPrice)}</td><td>{item.broker}{item.destinationBroker ? ` → ${item.destinationBroker}` : ""}</td><td><button onClick={() => remove(item.id)}>삭제</button></td></tr>)}</tbody></table></div></section>
  </div>;
}