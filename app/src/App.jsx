import React, { useEffect, useMemo, useState } from "react";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Container from "@cloudscape-design/components/container";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import SpaceBetween from "@cloudscape-design/components/space-between";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import Multiselect from "@cloudscape-design/components/multiselect";
import Tiles from "@cloudscape-design/components/tiles";
import Button from "@cloudscape-design/components/button";
import NavigableGroup from "@cloudscape-design/components/navigable-group";
import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Badge from "@cloudscape-design/components/badge";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Popover from "@cloudscape-design/components/popover";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Checkbox from "@cloudscape-design/components/checkbox";
import Link from "@cloudscape-design/components/link";
import Alert from "@cloudscape-design/components/alert";
import bedrockIcon from "./bedrock-icon.svg";
import {
  PATH_KO, TIER_KO, STATUS_KO, BAND_KO, MODE_KO, PRESETS, SIZES, REGION_ORDER,
  regionName, regionFull, makeMatcher, rank, expandTiers, money, rate, rateRange,
  sizeBucket, asOf, asOfTime, isoTime, relativeKo, SRC_KO, rankEmbeddings, groupVideoPrices,
} from "./logic.js";

const STATUS_BADGE = { legacy: "grey", preview: "blue", internal: "severity-medium" };

/* Button-group toggle used for single-select rows (response mode, usage preset).
   Deliberately not SegmentedControl, which collapses to a Select dropdown below
   688px; these must stay as toggles at every width. NavigableGroup adds arrow-key
   roving focus and a single tab stop; role="group" + aria-label name the set.
   Cloudscape Button does not passthrough aria-pressed, so the selected option is
   exposed to assistive tech via ariaLabel ("…, 선택됨") — the one a11y gap review
   flagged versus SegmentedControl, closed with public props only. */
function ToggleGroup({ label, groupLabel, value, options, onSelect, navigationDirection = "horizontal", segmented = false }) {
  return (
    <FormField label={label}>
      <NavigableGroup navigationDirection={navigationDirection}
        getItemKey={(el) => el.dataset.key || el.textContent}>
        <div className={segmented ? "toggle-row toggle-row-segmented" : "toggle-row"} role="group" aria-label={groupLabel}>
          {options.map((o) => {
            const selected = value === o.key;
            return (
              <Button key={o.key} data-key={o.key} data-selected={selected ? "true" : undefined}
                ariaLabel={selected ? `${o.label}, 선택됨` : o.label}
                variant="normal"
                onClick={() => onSelect(o.key)}>{o.label}</Button>
            );
          })}
        </div>
      </NavigableGroup>
    </FormField>
  );
}

/* ---------------- URL hash state (same keys as the vanilla page) ---------------- */
function readHash(regions) {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  const out = {};
  if (h.get("region") && regions.includes(h.get("region"))) out.region = h.get("region");
  if (h.get("in")) out.inM = Math.max(0, +h.get("in") || 0);
  if (h.get("out")) out.outM = Math.max(0, +h.get("out") || 0);
  if (h.get("mode") === "batch") out.mode = "batch";
  if (h.get("resid") === "strict") out.resid = "strict";
  if (h.get("q")) out.q = h.get("q");
  return out;
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme")
    || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  useEffect(() => { applyMode(theme === "dark" ? Mode.Dark : Mode.Light); }, [theme]);
  const toggle = () => setTheme((t) => { const n = t === "dark" ? "light" : "dark"; localStorage.setItem("theme", n); return n; });
  return [theme, toggle];
}

/* ---------------- checkbox group helper ---------------- */
function CheckList({ items, set, onChange, label }) {
  return (
    <SpaceBetween size="xxs">
      {items.map((it) => (
        <Checkbox key={it} checked={set.has(it)}
          onChange={({ detail }) => {
            const n = new Set(set); detail.checked ? n.add(it) : n.delete(it); onChange(n);
          }}>{label ? label(it) : it}</Checkbox>
      ))}
    </SpaceBetween>
  );
}

function RegionChips({ regions, selected, limit = 6 }) {
  // Selected region first, so its highlighted chip is never hidden behind "+N".
  const ordered = selected && regions.includes(selected)
    ? [selected, ...regions.filter((rg) => rg !== selected)] : regions;
  const shown = ordered.slice(0, limit);
  const rest = ordered.slice(limit);
  return (
    <SpaceBetween direction="horizontal" size="xxs">
      <Box variant="small" color="text-body-secondary">{regions.length}개 리전</Box>
      {shown.map((rg) => (
        rg === selected ? <span key={rg} className="mine-chip">{regionName(rg)}</span>
          : <Badge key={rg} color="grey">{regionName(rg)}</Badge>
      ))}
      {rest.length > 0 && (
        <Popover size="medium" triggerType="text" dismissButton={false}
          content={rest.map(regionName).join(", ")}>+{rest.length}</Popover>
      )}
    </SpaceBetween>
  );
}

export default function App({ snap }) {
  const P = snap.price_points;
  const [theme, toggleTheme] = useTheme();
  const matches = useMemo(() => makeMatcher(P), [P]);
  const vendors = useMemo(() => [...new Set(P.map((p) => p.provider))].sort(), [P]);
  const has = (fn) => (v) => P.some((p) => fn(p) === v);
  const haveStatuses = useMemo(() => ["ga", "legacy", "preview", "internal"].filter(has((p) => p.status || "ga")), [P]);
  const haveTiers = useMemo(() => ["standard", "priority", "flex", "latency-optimized"].filter(has((p) => p.service_tier)), [P]);
  const haveBands = useMemo(() => ["standard", "long-ctx"].filter(has((p) => p.context_band || "standard")), [P]);

  const [f, setF] = useState(() => ({
    q: "",
    region: snap.regions.includes("ap-northeast-2") ? "ap-northeast-2" : snap.regions[0],
    inM: 10, outM: 2, mode: "online", resid: "any",
    statuses: new Set(["ga", "legacy"]), tiers: new Set(["standard"]), bands: new Set(["standard"]),
    vendors: new Set(vendors), sizes: new Set(SIZES),
    ...readHash(snap.regions),
  }));
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const [sortKey, setSortKey] = useState("cost");
  const [videoSeconds, setVideoSeconds] = useState(60);
  const [expanded, setExpanded] = useState([]);

  useEffect(() => {
    const h = new URLSearchParams();
    h.set("region", f.region); h.set("in", f.inM); h.set("out", f.outM);
    if (f.mode !== "online") h.set("mode", f.mode);
    if (f.resid !== "any") h.set("resid", f.resid);
    if (f.q) h.set("q", f.q);
    history.replaceState(null, "", "#" + h.toString());
  }, [f.region, f.inM, f.outM, f.mode, f.resid, f.q]);

  const regionCount = useMemo(() => {
    const m = {};
    for (const r of snap.regions) m[r] = new Set(P.filter((p) => p.source_region === r).map((p) => p.provider + "/" + p.model_id)).size;
    return m;
  }, [P, snap.regions]);
  const regionOptions = useMemo(() => REGION_ORDER.map(([label, test]) => ({
    label,
    options: snap.regions.filter(test).sort((a, b) => regionCount[b] - regionCount[a])
      .map((r) => ({ value: r, label: regionFull(r), tags: [`${regionCount[r]}개 모델`] })),
  })).filter((g) => g.options.length), [snap.regions, regionCount]);
  const embeddingResult = useMemo(() => rankEmbeddings(P, f, matches), [P, f, matches]);
  const embeddingItems = embeddingResult.ranked;
  const videoResult = useMemo(() => groupVideoPrices(snap.special_prices, f.region), [snap.special_prices, f.region]);
  const videoItems = videoResult.ranked;
  const regionSelected = { value: f.region, label: regionFull(f.region), tags: [`${regionCount[f.region]}개 모델`] };

  const result = useMemo(() => rank(P, f, matches), [P, f, matches]);
  const items = useMemo(() => {
    const rows = result.ranked.map((r, i) => ({ ...r, kind: "model", id: r.key, n: i + 1 }));
    if (sortKey === "mult") rows.sort((a, b) => (a.mult ?? Infinity) - (b.mult ?? Infinity));
    return rows;
  }, [result, sortKey]);
  const children = (item) => {
    if (item.kind !== "model") return [];
    const x = expandTiers(item, f);
    return x.tiers.map((t, i) => ({ ...t, kind: "tier", id: `${item.id}#${i}`, parent: item }));
  };

  /* ---------------- provenance ---------------- */
  // Heartbeat written by the hourly refresh Lambda.
  //   undefined = still loading  -> invisible same-width placeholder (no flicker)
  //   null      = unavailable    -> fall back to the data timestamp
  //   string    = ISO time of the last successful check
  const [lastChecked, setLastChecked] = useState(() =>
    /^https?:$/.test(window.location.protocol) ? undefined : null);
  useEffect(() => {
    if (!/^https?:$/.test(window.location.protocol)) return undefined;
    let alive = true;
    fetch("/status.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setLastChecked(j?.last_checked_at || null); })
      .catch(() => { if (alive) setLastChecked(null); });
    return () => { alive = false; };
  }, []);
  // Re-render once a minute so the relative "N분 전" label stays current.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  const srcDatesTime = Object.entries(snap.as_of || {}).map(([k, v]) => ({ label: SRC_KO[k] || k, time: asOfTime(v) }));
  const dates = Object.values(snap.as_of || {}).map(asOf).sort();
  const englishChecked = String(snap.english_pricing_checked_at || "").slice(0, 10) || "?";
  const englishCheckedTime = isoTime(snap.english_pricing_checked_at);
  const newest = englishChecked !== "?" ? englishChecked : (dates[dates.length - 1] || "?");
  const ageDays = newest !== "?" ? Math.floor((Date.now() - new Date(newest))/864e5) : 999;
  const sourceConflicts = snap.source_conflicts?.length || 0;

  /* ---------------- columns ---------------- */
  const columns = [
    { id: "rank", header: "#", width: 56, cell: (it) => (it.kind === "model" ? it.n : "") },
    {
      id: "model", header: "모델", isRowHeader: true,
      cell: (it) => it.kind === "tier" ? (
        <SpaceBetween direction="horizontal" size="xs">
          <StatusIndicator type={PATH_KO[it.path].type}>{PATH_KO[it.path].label}</StatusIndicator>
          <RegionChips regions={it.regions} selected={f.region} />
        </SpaceBetween>
      ) : (
        <SpaceBetween size="xxxs">
          <Box fontWeight="bold">{it.model} <Box variant="span" color="text-body-secondary" fontSize="body-s">{it.provider}</Box></Box>
          <SpaceBetween direction="horizontal" size="xs">
            <StatusIndicator type={PATH_KO[it.path].type}>{PATH_KO[it.path].label}</StatusIndicator>
            {it.status && it.status !== "ga" && <Badge color={STATUS_BADGE[it.status] || "grey"}>{STATUS_KO[it.status] || it.status}</Badge>}
            {it.cost.ambiguous && <StatusIndicator type="warning">단가 2개</StatusIndicator>}
            {it.cheaperPathIsNonInRegion && <Badge color="green">
              리전 내 {it.inRegionCost.lo===it.inRegionCost.hi?money(it.inRegionCost.lo):`${money(it.inRegionCost.lo)}–${money(it.inRegionCost.hi)}`}도 가능
            </Badge>}
            {it.noInRegionHere && <Badge color="grey">이 리전엔 리전 내 단가 없음</Badge>}
          </SpaceBetween>
        </SpaceBetween>
      ),
    },
    {
      id: "cost", header: "월 비용 (USD/월)", sortingField: "cost",
      cell: (it) => {
        const c = it.c || it.cost;
        const v = c.ambiguous ? `${money(c.lo)}–${money(c.hi)}` : money(c.lo);
        return it.kind === "model" ? <Box fontWeight="bold" fontSize="heading-s">{v}</Box> : v;
      },
    },
    {
      id: "calc", header: "단가 /1M (입력 · 출력)",
      cell: (it) => {
        const c = it.c || it.cost;
        return <Box variant="small" color="text-body-secondary">
          입력 {it.kind === "tier" ? rateRange(c.inRates) : `${rate(c.inRates[0])}×${f.inM}`}<br />
          출력 {it.kind === "tier" ? rateRange(c.outRates) : `${rate(c.outRates[0])}×${f.outM}`}
        </Box>;
      },
    },
    {
      id: "mult", header: "배수 · 리전 대비", sortingField: "mult",
      cell: (it) => {
        if (it.kind === "tier") {
          if (it.isChosen) return <span className="mine-chip">현재 선택 경로</span>;
          if (it.isMine && it.path === "in-region") return <StatusIndicator type="info">
            리전 내 {it.delta>0?"+":""}{it.delta||0}%
          </StatusIndicator>;
          if (it.isMine) return <StatusIndicator type="info">대안 {it.delta>0?"+":""}{it.delta||0}%</StatusIndicator>;
          if (it.delta == null) return "—";
          if (it.delta === 0) return <Box color="text-body-secondary">동일</Box>;
          return <StatusIndicator type={it.delta < 0 ? "success" : "warning"}>{it.delta > 0 ? "+" : ""}{it.delta}%</StatusIndicator>;
        }
        if (it.isBase) return <Badge color="grey">기준</Badge>;
        if (it.mult == null) return "—";
        return `${it.mult.toFixed(it.mult < 10 ? 1 : 0)}배`;
      },
    },
  ];


  // The English AWS pricing page can announce models before the machine-readable
  // billing offers carry rates. Surface them honestly, but never rank/estimate.
  const pricePending = (snap.announced_models || []).filter((m) => !m.pricing_available);
  const emptyMsg = f.q
    ? `'${f.q}'에 맞는 모델이 이 조건(${regionName(f.region)} · ${MODE_KO[f.mode]})에서 없습니다. 한글(소넷, 노바프로)이나 API ID로도 찾을 수 있습니다.`
    : "이 조건에서 월 비용을 계산할 수 있는 모델이 없습니다. 리전이나 고급 설정을 바꿔보세요.";

  const presetKey = (i, o) => Object.entries(PRESETS).find(([, [pi, po]]) => pi === i && po === o)?.[0] || null;

  return (
    <>
      <header id="top-nav">
        <a className="top-nav-brand" href="#" aria-label="Bedrock 비용 비교 홈">
          <img src={bedrockIcon} alt="Amazon Bedrock" className="top-nav-logo" />
          <span className="top-nav-product">Bedrock 비용 비교</span>
        </a>
        <div className="top-nav-aside">
          <span className="top-nav-date"
            title={lastChecked ? `최종 확인 ${isoTime(lastChecked)}` : lastChecked === null ? `데이터 기준 ${englishCheckedTime}` : undefined}>
            {lastChecked === undefined
              ? <>
                  <span className="tnd-part tnd-ghost" aria-hidden="true">최종 확인 59분 전</span>
                </>
              : (() => {
                  if (lastChecked) {
                    const rel = relativeKo(lastChecked, nowMs);
                    if (rel === "?") return null;
                    return <span className="tnd-part">최종 확인 <b>{rel}</b></span>;
                  }
                  // status.json unavailable (e.g. opened from a local file): absolute data timestamp.
                  const full = isoTime(snap.english_pricing_checked_at);
                  if (full === "?") return null;
                  const [d, t, z] = full.split(" ");
                  return <><span className="tnd-part">데이터 기준 <b>{d}</b></span>{" "}<span className="tnd-part"><b>{t} {z}</b></span></>;
                })()}
          </span>
          <Button variant="icon"
            iconSvg={theme === "dark"
              ? (/* same SVGs as release.awskr.net; icon = current mode (moon in dark) */
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" /></svg>)
              : (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="4" /><path d="M10 1v2m0 14v2m-7-9H1m18 0h-2m-1.3-5.3l-1.4 1.4M5.7 14.3l-1.4 1.4m0-11.4l1.4 1.4m8.6 8.6l1.4 1.4" /></svg>)}
            ariaLabel={theme === "dark" ? "밝은 테마로 전환" : "어두운 테마로 전환"}
            onClick={toggleTheme} />
        </div>
      </header>
      <main className="page-main" style={{ maxWidth: 1120, margin: "0 auto" }}>
        <ContentLayout disableOverlap
          header={
            <Header variant="h1"
              description={
                <span className="header-meta">
                  <span className="hm-item"><Link href="https://aws.amazon.com/bedrock/pricing/" external variant="secondary">AWS 영문 Pricing</Link> 기준 ·</span>{" "}
                  <span className="hm-item">Documentation·Price List API로 보강 ·</span>{" "}
                  <span className="hm-item">금액은 <b>USD</b></span>
                </span>
              }>
              Bedrock 모델 비용, <span className="title-grad">한 달에 얼마인가요?</span>
            </Header>
          }>
          <SpaceBetween size="m">
            {ageDays > 7 && <Alert type="warning">데이터가 {ageDays}일 지났습니다. 최신이 아닐 수 있습니다.</Alert>}

            <Container>
              <SpaceBetween size="m">
                <ColumnLayout columns={4} variant="text-grid" borders="vertical">
                  <FormField label="모델 찾기">
                    <Input type="search" value={f.q} placeholder="소넷, 노바 프로, llama…"
                      ariaLabel="모델 찾기" onChange={({ detail }) => set({ q: detail.value.trim() ? detail.value : "" })} />
                  </FormField>
                  <FormField label="리전">
                    <Select selectedOption={regionSelected} options={regionOptions} filteringType="auto"
                      filteringPlaceholder="리전 검색" ariaLabel="리전"
                      onChange={({ detail }) => { setExpanded([]); set({ region: detail.selectedOption.value }); }} />
                  </FormField>
                  <FormField label="월 사용량 (백만 토큰)" description="입력 · 출력">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <Input type="number" inputMode="numeric" value={String(f.inM)} ariaLabel="월 입력 토큰(백만)"
                        onChange={({ detail }) => set({ inM: Math.max(0, +detail.value || 0) })} />
                      <Input type="number" inputMode="numeric" value={String(f.outM)} ariaLabel="월 출력 토큰(백만)"
                        onChange={({ detail }) => set({ outM: Math.max(0, +detail.value || 0) })} />
                    </div>
                  </FormField>
                  <ToggleGroup label="응답 방식" groupLabel="응답 방식"
                    value={f.mode}
                    options={[{ key: "online", label: "즉시 응답" }, { key: "batch", label: "일괄 처리" }]}
                    onSelect={(mode) => set({ mode })} segmented />
                </ColumnLayout>

                <ToggleGroup label="사용량 프리셋" groupLabel="사용량 프리셋" navigationDirection="both"
                  value={presetKey(f.inM, f.outM)}
                  options={Object.entries(PRESETS).map(([n, [i, o]]) => ({ key: n, label: `${n} ${i}/${o}` }))}
                  onSelect={(n) => { const [i, o] = PRESETS[n]; set({ inM: i, outM: o }); }} />

                <FormField label={<>데이터가 <b>{regionName(f.region)}</b> 밖에서 처리되어도 괜찮으신가요?</>}>
                  <Tiles value={f.resid}
                    onChange={({ detail }) => { setExpanded([]); set({ resid: detail.value }); }}
                    columns={2}
                    items={[
                      { value: "any", label: "상관없습니다", description: "가장 싼 경로를 고릅니다 (리전 밖에서 처리될 수 있음)" },
                      { value: "strict", label: "안 됩니다", description: "이 리전 안에서 처리되는 요금만" },
                    ]} />
                </FormField>
              </SpaceBetween>
            </Container>

            <Table
              variant="stacked"
              contentDensity="compact"
              trackBy="id"
              items={items}
              columnDefinitions={columns}
              sortingColumn={columns.find((c) => c.id === (sortKey === "mult" ? "mult" : "cost"))}
              sortingDescending={false}
              onSortingChange={({ detail }) => setSortKey(detail.sortingColumn.sortingField === "mult" ? "mult" : "cost")}
              expandableRows={{
                getItemChildren: children,
                isItemExpandable: (it) => it.kind === "model",
                expandedItems: expanded,
                onExpandableItemToggle: ({ detail }) => setExpanded((cur) => detail.expanded
                  ? [...cur, detail.item] : cur.filter((x) => x.id !== detail.item.id)),
              }}
              ariaLabels={{
                tableLabel: "월 비용 순위",
                expandButtonLabel: (item) => `${item.model} 리전별 단가 펼치기`,
                collapseButtonLabel: (item) => `${item.model} 리전별 단가 접기`,
              }}
              empty={<Box textAlign="center" color="inherit" padding="m">{emptyMsg}</Box>}
              header={
                <Header counter={`(${items.length})`}
                  description={<>
                    <b>{regionName(f.region)}</b> · 입력 <b>{f.inM.toLocaleString()}</b>백만 + 출력 <b>{f.outM.toLocaleString()}</b>백만 · {MODE_KO[f.mode]}
                    {f.resid === "strict" && <> · <b>리전 내 처리만</b></>}
                    {" "}· 행을 펼치면 리전별 단가 구간이 나옵니다
                  </>}>
                  월 비용 순위
                </Header>
              }
            />

            {embeddingItems.length > 0 && (
              <ExpandableSection variant="stacked" headerText="임베딩 모델 비용"
                headerCounter={`(${embeddingItems.length})`}
                headerDescription={`출력 토큰이 없는 입력 전용 모델입니다. 월 입력 ${f.inM.toLocaleString()}백만 토큰으로 계산합니다.`}>
                <Table variant="embedded" contentDensity="compact" trackBy="key" items={embeddingItems}
                  ariaLabels={{ tableLabel: "임베딩 모델 비용" }}
                  columnDefinitions={[
                    { id:"embedding-rank", header:"#", width:56, cell:(x)=>embeddingItems.indexOf(x)+1 },
                    { id:"embedding-model", header:"모델", isRowHeader:true, cell:(x)=>(
                      <SpaceBetween size="xxxs">
                        <Box fontWeight="bold">{x.model} <Box variant="span" color="text-body-secondary" fontSize="body-s">{x.provider}</Box></Box>
                        <SpaceBetween direction="horizontal" size="xs">
                          <StatusIndicator type={PATH_KO[x.path].type}>{PATH_KO[x.path].label}</StatusIndicator>
                          {x.status && x.status !== "ga" && <Badge color={STATUS_BADGE[x.status] || "grey"}>{STATUS_KO[x.status] || x.status}</Badge>}
                          {x.rates.length > 1 && <StatusIndicator type="warning">단가 2개</StatusIndicator>}
                        </SpaceBetween>
                      </SpaceBetween>) },
                    { id:"embedding-cost", header:"월 비용 (USD/월)", cell:(x)=><Box fontWeight="bold" fontSize="heading-s">{x.costLo===x.costHi?money(x.costLo):`${money(x.costLo)}–${money(x.costHi)}`}</Box> },
                    { id:"embedding-rate", header:"단가 /1M (입력)", cell:(x)=><Box variant="small" color="text-body-secondary">입력 {rateRange(x.rates)}×{f.inM}</Box> },
                    { id:"embedding-regions", header:"제공 리전", cell:(x)=><RegionChips regions={Object.keys(x.regions).sort()} selected={f.region} limit={3} /> },
                  ]} />
              </ExpandableSection>
            )}

            {embeddingResult.missing.length > 0 && (
              <ExpandableSection variant="stacked" headerText={`${regionName(f.region)}에서 제공되지 않는 임베딩 모델`}
                headerCounter={`(${embeddingResult.missing.length})`}>
                <ColumnLayout columns={2}>
                  {embeddingResult.missing.map((x) => (
                    <Box key={x.key}>{x.model} <Box variant="span" color="text-body-secondary">{x.provider} · 다른 리전 {x.where}곳</Box></Box>
                  ))}
                </ColumnLayout>
              </ExpandableSection>
            )}

            {videoItems.length > 0 && (
              <ExpandableSection variant="stacked" headerText="영상 생성 모델 비용"
                headerCounter={`(${videoItems.length})`}
                headerDescription="출력 토큰이 아니라 생성된 영상 길이(초)로 과금됩니다.">
                <SpaceBetween size="m">
                  <FormField label="월 생성 영상 길이" description="초">
                    <div style={{maxWidth:180}}><Input type="number" inputMode="numeric" value={String(videoSeconds)}
                      ariaLabel="월 생성 영상 길이(초)" onChange={({detail})=>setVideoSeconds(Math.max(0,+detail.value||0))} /></div>
                  </FormField>
                  <Table variant="embedded" contentDensity="compact" trackBy="key" items={videoItems}
                    ariaLabels={{ tableLabel:"영상 생성 모델 비용" }}
                    columnDefinitions={[
                      { id:"video-rank", header:"#", width:56, cell:(x)=>videoItems.indexOf(x)+1 },
                      { id:"video-model", header:"모델", isRowHeader:true, cell:(x)=>(
                        <SpaceBetween size="xxxs">
                          <Box fontWeight="bold">{x.model} <Box variant="span" color="text-body-secondary" fontSize="body-s">{x.provider}</Box></Box>
                          <SpaceBetween direction="horizontal" size="xs">
                            <StatusIndicator type={PATH_KO["in-region"].type}>{PATH_KO["in-region"].label}</StatusIndicator>
                          </SpaceBetween>
                        </SpaceBetween>) },
                      { id:"video-cost", header:"월 비용 (USD/월)", cell:(x)=><Box fontWeight="bold" fontSize="heading-s">{money(x.rate*videoSeconds)}</Box> },
                      { id:"video-rate", header:"단가 (생성 1초)", cell:(x)=><Box variant="small" color="text-body-secondary">생성 1초 {money(x.rate)}×{videoSeconds.toLocaleString()}</Box> },
                      { id:"video-variant", header:"출력 유형", cell:(x)=>x.variant },
                      { id:"video-regions", header:"제공 리전", cell:(x)=><RegionChips regions={x.regions} selected={f.region} limit={3} /> },
                    ]} />
                </SpaceBetween>
              </ExpandableSection>
            )}

            {videoResult.missing.length > 0 && (
              <ExpandableSection variant="stacked" headerText={`${regionName(f.region)}에서 제공되지 않는 영상 생성 모델`}
                headerCounter={`(${videoResult.missing.length})`}>
                <SpaceBetween size="xxs">
                  {videoResult.missing.map((x) => (
                    <Box key={x.key}><b>{x.model}</b> <Box variant="span" color="text-body-secondary">{x.provider} · {x.variant}</Box>{" "}<RegionChips regions={x.regions} selected={f.region} /></Box>
                  ))}
                </SpaceBetween>
              </ExpandableSection>
            )}

            {pricePending.length > 0 && (
              <ExpandableSection variant="stacked"
                headerText="출시 확인 · 공개 단가 없음"
                headerCounter={`(${pricePending.length})`}
                headerDescription="AWS 영문 Pricing과 Documentation에는 모델이 게시됐지만, 영문 페이지에 숫자 단가가 없고 현재 Price List에도 입력·출력 SKU가 없습니다.">
                <ColumnLayout columns={2}>
                  {pricePending.map((x) => (
                    <Box key={`${x.provider}/${x.name}`}>
                      <b>{x.name}</b>{" "}
                      <Box variant="span" color="text-body-secondary">{x.provider}</Box>{" "}
                      <Badge color="blue">가격 미공개</Badge>
                    </Box>
                  ))}
                </ColumnLayout>
              </ExpandableSection>
            )}

            {result.partial.length > 0 && (
              <ExpandableSection variant="stacked" headerText="월 비용 계산 불가" headerCounter={`(${result.partial.length})`}
                headerDescription="단가 일부만 있거나, 리전 내 처리 조건에 맞는 요금이 없는 모델">
                <SpaceBetween size="xxs">
                  {result.partial.map((x) => (
                    <Box key={x.key}>{x.model} <Box variant="span" color="text-body-secondary">{x.provider} — {x.reason}</Box></Box>
                  ))}
                </SpaceBetween>
              </ExpandableSection>
            )}
            {result.missing.length > 0 && (
              <ExpandableSection variant="stacked" headerText={`${regionName(f.region)}에서 제공되지 않는 모델`}
                headerCounter={`(${result.missing.length})`}>
                <ColumnLayout columns={2}>
                  {result.missing.map((x) => (
                    <Box key={x.key}>{x.model} <Box variant="span" color="text-body-secondary">{x.provider} · 다른 리전 {x.where}곳</Box></Box>
                  ))}
                </ColumnLayout>
              </ExpandableSection>
            )}

            <ExpandableSection variant="stacked" headerText="고급 설정">
              <ColumnLayout columns={3} variant="text-grid">
                <FormField label="포함할 모델" description="미리보기·내부 코드명 모델은 기본적으로 숨깁니다.">
                  <CheckList items={haveStatuses} set={f.statuses} label={(s) => STATUS_KO[s] || s}
                    onChange={(statuses) => set({ statuses })} />
                </FormField>
                <FormField label="처리 우선순위">
                  <CheckList items={haveTiers} set={f.tiers} label={(t) => TIER_KO[t] || t}
                    onChange={(tiers) => set({ tiers })} />
                </FormField>
                <FormField label="입력 길이 요금 구간" description="일부 모델은 긴 입력에 다른 단가를 씁니다.">
                  <CheckList items={haveBands} set={f.bands} label={(b) => BAND_KO[b] || b}
                    onChange={(bands) => set({ bands })} />
                </FormField>
                <FormField label="공급사">
                  <Multiselect
                    selectedOptions={vendors.filter((v) => f.vendors.has(v)).map((v) => ({ value: v, label: v }))}
                    options={vendors.map((v) => ({ value: v, label: v }))}
                    filteringType="auto" tokenLimit={3} placeholder="공급사 선택"
                    i18nStrings={{ tokenLimitShowMore: "더 보기", tokenLimitShowFewer: "접기" }}
                    onChange={({ detail }) => set({ vendors: new Set(detail.selectedOptions.map((o) => o.value)) })} />
                </FormField>
                <FormField label="파라미터 크기" description="이름에 크기가 적힌 모델만 분류됩니다. 가격으로 크기를 추정하지 않습니다.">
                  <CheckList items={SIZES} set={f.sizes} onChange={(sizes) => set({ sizes })} />
                </FormField>
              </ColumnLayout>
            </ExpandableSection>

            <div className="page-foot">
              <Box variant="small" color="text-body-secondary" padding={{ top: "s" }}>
                <ul className="foot-notes">
                  <li>모든 금액은 <b>USD</b>입니다. 환율 정보가 원본 데이터에 없어 원화로 환산하지 않습니다.</li>
                  <li><b>지역 묶음(Geo CRIS)</b>과 <b>Global CRIS</b>는 영문 Pricing/Documentation에 별도 경로가 확인된 경우에만 표시합니다.</li>
                  <li>같은 조건에 단가가 2개인 경우 <b>범위로 표시</b>하고 "N배" 기준에서 제외합니다.</li>
                  <li>
                    <span className="fm-item">출처별 데이터 기준:</span>{" "}
                    <span className="fm-item">영문 Pricing <b>{englishCheckedTime}</b> ·</span>{" "}
                    {srcDatesTime.map((s, i) => (
                      <span className="fm-item" key={i}>{s.label} <b>{s.time}</b>{i < srcDatesTime.length - 1 ? " ·" : ""}</span>
                    ))}
                  </li>
                  <li><b><Link href="https://aws.amazon.com/bedrock/pricing/" external variant="secondary" fontSize="body-s">영문 Pricing 페이지</Link></b>의 명시 가격이 같은 조건의 API 가격보다 우선합니다.</li>
                  <li><b><Link href="https://docs.aws.amazon.com/bedrock/latest/userguide/models-regions.html" external variant="secondary" fontSize="body-s">영문 Documentation</Link></b>으로 모델 출시와 in-region·Geo·Global 지원 리전을 확인합니다.</li>
                  <li><b>Price List API</b>는 페이지에 없는 리전·실행 모드·서비스 티어·컨텍스트 밴드를 보강합니다.</li>
                  {sourceConflicts > 0 && <li>영문 페이지와 API 값이 다른 키 <b>{sourceConflicts}개</b>는 영문 페이지 값을 표시합니다.</li>}
                </ul>
              </Box>
              <Box variant="small" color="text-body-secondary" textAlign="center" padding={{ top: "m" }}>
                <div className="foot-line">
                  <span className="fm-item">© 2026 Bedrock 비용 비교 ·</span>{" "}
                  <span className="fm-item"><b>비공식 자료</b>이며 AWS와 무관합니다.</span>{" "}
                  <span className="fm-item">결제 전 <Link href="https://aws.amazon.com/bedrock/pricing/" external variant="secondary" fontSize="body-s">AWS 공식 가격 페이지</Link>로 확인하세요.</span>
                </div>
              </Box>
            </div>
          </SpaceBetween>
        </ContentLayout>
      </main>
    </>
  );
}
