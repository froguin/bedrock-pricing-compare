import React, { useEffect, useMemo, useState } from "react";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Header from "@cloudscape-design/components/header";
import Container from "@cloudscape-design/components/container";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import SpaceBetween from "@cloudscape-design/components/space-between";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import Select from "@cloudscape-design/components/select";
import Multiselect from "@cloudscape-design/components/multiselect";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import RadioGroup from "@cloudscape-design/components/radio-group";
import Button from "@cloudscape-design/components/button";
import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Badge from "@cloudscape-design/components/badge";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Popover from "@cloudscape-design/components/popover";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Checkbox from "@cloudscape-design/components/checkbox";
import Alert from "@cloudscape-design/components/alert";
import bedrockIcon from "./bedrock-icon.svg";
import {
  PATH_KO, TIER_KO, STATUS_KO, BAND_KO, MODE_KO, PRESETS, SIZES, REGION_ORDER,
  regionName, regionFull, makeMatcher, rank, expandTiers, money, rate, rateRange,
  sizeBucket, asOf, SRC_KO,
} from "./logic.js";

const STATUS_BADGE = { legacy: "grey", preview: "blue", internal: "severity-medium" };

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
  const shown = regions.slice(0, limit);
  const rest = regions.slice(limit);
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
  const srcDates = Object.entries(snap.as_of || {}).map(([k, v]) => `${SRC_KO[k] || k} ${asOf(v)}`);
  const dates = Object.values(snap.as_of || {}).map(asOf).sort();
  const newest = dates[dates.length - 1] || "?";
  const ageDays = newest !== "?" ? Math.floor((Date.now() - new Date(newest)) / 864e5) : 999;
  const nModels = useMemo(() => new Set(P.map((p) => p.provider + "/" + p.model_id)).size, [P]);

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
          if (it.isMine) return <span className="mine-chip">선택 리전</span>;
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

  const emptyMsg = f.q
    ? `'${f.q}'에 맞는 모델이 이 조건(${regionName(f.region)} · ${MODE_KO[f.mode]})에서 없습니다. 한글(소넷, 노바프로)이나 API ID로도 찾을 수 있습니다.`
    : "이 조건에서 월 비용을 계산할 수 있는 모델이 없습니다. 리전이나 고급 설정을 바꿔보세요.";

  const isPreset = (i, o) => f.inM === i && f.outM === o;

  return (
    <>
      <div id="top-nav" style={{ position: "sticky", top: 0, zIndex: 1002 }}>
        <TopNavigation
          identity={{ href: "#", title: "Bedrock 비용 비교", logo: { src: bedrockIcon, alt: "Amazon Bedrock" } }}
          utilities={[
            { type: "button", text: `${newest} 기준`, disableUtilityCollapse: true },
            { type: "button", iconName: theme === "dark" ? "star" : "star-filled",
              text: theme === "dark" ? "밝은 테마" : "어두운 테마",
              ariaLabel: theme === "dark" ? "밝은 테마로 전환" : "어두운 테마로 전환",
              onClick: toggleTheme },
          ]}
        />
      </div>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 20px 40px" }}>
        <ContentLayout disableOverlap
          header={
            <Header variant="h1"
              description={
                <span>
                  AWS 공개 가격 파일 기준 · <b>{srcDates.join(" · ")}</b>{" "}
                  <Popover header="날짜가 두 개인 이유" size="large" triggerType="custom"
                    content={<SpaceBetween size="xs">
                      <span>AWS는 Bedrock 가격을 <b>두 파일로 따로</b> 발행하고, 갱신 시점도 서로 다릅니다.</span>
                      <span>· <b>Bedrock</b>: Amazon Nova·Llama·Mistral 등 AWS가 직접 제공하는 모델</span>
                      <span>· <b>Marketplace 모델</b>: 최신 Claude·GPT·Grok 등 AWS Marketplace를 거쳐 제공하는 모델</span>
                      <span>날짜는 각 파일이 마지막으로 발행된 날입니다. 이 사이트는 두 파일을 30분마다 확인해 새 판이 나오면 자동으로 반영합니다.</span>
                    </SpaceBetween>}>
                    <Button variant="inline-icon" iconName="status-info" ariaLabel="날짜가 두 개인 이유" />
                  </Popover>
                  {" "}· 금액은 모두 <b>USD</b>
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
                  <FormField label="응답 방식">
                    <SegmentedControl selectedId={f.mode} label="응답 방식"
                      options={[{ id: "online", text: "즉시 응답" }, { id: "batch", text: "일괄 처리" }]}
                      onChange={({ detail }) => set({ mode: detail.selectedId })} />
                  </FormField>
                </ColumnLayout>

                <SpaceBetween direction="horizontal" size="xxs" alignItems="center">
                  <Box variant="small" color="text-body-secondary">사용량 프리셋</Box>
                  {Object.entries(PRESETS).map(([n, [i, o]]) => (
                    <Button key={n} variant={isPreset(i, o) ? "primary" : "normal"}
                      onClick={() => set({ inM: i, outM: o })}>{n} {i}/{o}</Button>
                  ))}
                </SpaceBetween>

                <FormField label={<>데이터가 <b>{regionName(f.region)}</b> 밖에서 처리되어도 괜찮으신가요?</>}>
                  <RadioGroup direction="horizontal" value={f.resid}
                    onChange={({ detail }) => { setExpanded([]); set({ resid: detail.value }); }}
                    items={[
                      { value: "any", label: "상관없습니다", description: "가장 싼 경로를 고릅니다" },
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
              ariaLabels={{ tableLabel: "월 비용 순위" }}
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

            <SpaceBetween size="s">
            <Box variant="small" color="text-body-secondary" padding={{ top: "s" }}>
              · 모든 금액은 <b>USD</b>입니다. 환율 정보가 원본 데이터에 없어 원화로 환산하지 않습니다.<br />
              · <b>묶음 경로(geo CRIS)</b>는 별도 단가가 없습니다. 출발 리전의 "리전 내 처리" 요금으로 과금됩니다.<br />
              · 같은 조건에 단가가 2개인 경우 <b>범위로 표시</b>하고 "N배" 기준에서 제외합니다.
            </Box>
            <Box variant="small" color="text-body-secondary" textAlign="center">
              © 2026 Bedrock 비용 비교 · <b>비공식 자료</b>이며 AWS와 무관합니다. 결제 전 AWS 공식 가격 페이지로 확인하세요.<br />
              AWS 공개 가격 파일 {srcDates.join(" · ")} · {snap.regions.length}개 리전 · {nModels}개 모델
            </Box>
            </SpaceBetween>
          </SpaceBetween>
        </ContentLayout>
      </div>
    </>
  );
}
