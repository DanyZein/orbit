import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  Brush,
} from "recharts";
import {
  Plus,
  Settings,
  Download,
  Upload,
  X,
  Trash2,
  Pencil,
  ArrowUpDown,
  ChevronDown,
  Users,
  GripVertical,
  Maximize2,
} from "lucide-react";

// ---------- design tokens ----------
const C = {
  bg: "#0C0F12",
  panel: "#14181C",
  panelAlt: "#181D22",
  border: "#232A31",
  text: "#E8E6E1",
  textSoft: "#C9CED4",
  muted: "#7C8791",
  amber: "#FFB020",
  cyan: "#5EEAD4",
  coral: "#FF6B5B",
};
// slots 7-10 fill the widest gaps in the first six: blue sits between teal and violet,
// olive between amber and green, orchid between violet and pink, orange between coral and
// amber. they're closer together than the first six by design, which is the cost of ten
const PALETTE = [
  "#FFB020",
  "#5EEAD4",
  "#FF6B5B",
  "#9B8AFB",
  "#7CD992",
  "#F472B6",
  "#52c4ff",
  "#c0c737",
  "#cf81e3",
  "#ff9045",
];

// recharts' own tooltip ships no background and defaults its item text to black, which is
// invisible on a dark card, so every chart hands it these. the fill is the page color rather
// than the card color so the box reads as its own surface instead of blending into the card
const TOOLTIP_CONTENT = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  fontSize: 12,
  boxShadow: "0 6px 20px rgba(0,0,0,0.55)",
};
const TOOLTIP_LABEL = { color: C.text };
const TOOLTIP_ITEM = { color: C.textSoft };

// zoom presets for the expanded trend, in days. null means fit the whole history
const ZOOM_RANGES = [
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
  { label: "all", days: null },
];

const DEFAULT_GROUPS = [
  { id: "g1", name: "Group A", color: PALETTE[0] },
  { id: "g2", name: "Group B", color: PALETTE[1] },
];

const DEFAULT_TYPES = [
  { id: "t1", name: "Coffee / quick hang", tier: "light" },
  { id: "t2", name: "Nature walk", tier: "light" },
  { id: "t3", name: "Movie / gaming night", tier: "light" },
  { id: "t4", name: "Dinner", tier: "medium" },
  { id: "t5", name: "Beach / pool day", tier: "medium" },
  { id: "t6", name: "Event / party", tier: "medium" },
  { id: "t7", name: "Heavy trip / overnight", tier: "heavy" },
];

const TIER_COLOR = { light: C.cyan, medium: C.amber, heavy: C.coral };

// effort is the tier and nothing else, so there's one place it's decided and no per-type number to second-guess
const TIER_WEIGHT = { light: 1, medium: 2, heavy: 3 };
const tierWeight = (tier) => TIER_WEIGHT[tier] ?? 1;

// ---------- helpers ----------
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysSince = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};
// en-GB puts the day first ("12 Sept 2026"); the locale decides the order, not the options
const fmtDate = (d) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// multi-group: entries store groupIds[]; old backups with a single groupId still load
const normalizeEntry = (e) => {
  const { groupId, ...rest } = e;
  return {
    ...rest,
    groupIds: Array.isArray(e.groupIds) ? e.groupIds : groupId ? [groupId] : [],
  };
};

// weight is derived from tier now, so drop any weight still sitting on older configs and backups
const normalizeType = (t) => {
  const next = { ...t };
  delete next.weight;
  return next;
};

// <input type="color"> only accepts #rrggbb; anything else reads as black rather than throwing,
// which matters because older backups can hold colors in other shapes
const hex6 = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "#000000");

const pad2 = (n) => String(n).padStart(2, "0");
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

const splitISO = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? { y: m[1], m: m[2], d: m[3] } : { y: "", m: "", d: "" };
};

// null when the three parts don't make a real date, which is how half-typed input is held back
const toISO = ({ y, m, d }) => {
  const Y = Number(y),
    M = Number(m),
    D = Number(d);
  if (!(Y >= 1900 && Y <= 2200)) return null;
  if (!(M >= 1 && M <= 12)) return null;
  if (!(D >= 1 && D <= daysInMonth(Y, M))) return null;
  return `${Y}-${pad2(M)}-${pad2(D)}`;
};

const groupName = (groups, id) => groups.find((g) => g.id === id)?.name || "?";
const groupLabel = (groups, e) => {
  const ids = e.groupIds || [];
  if (ids.length === 0) return "no group";
  return ids.map((id) => groupName(groups, id)).join(" + ");
};

// drag reorder: pull the dragged item out, splice it back in at the target's slot
const moveItem = (list, fromId, toId) => {
  const from = list.findIndex((x) => x.id === fromId);
  const to = list.findIndex((x) => x.id === toId);
  if (from === -1 || to === -1 || from === to) return list;
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
};

// keep the notes tip on screen: flip left of the cursor near the right edge, above it near the
// bottom. anchored by whichever edge is safe, so the box grows away from the edge, not off it
const tipPlacement = (x, y) => {
  const flipX = x + 320 > window.innerWidth;
  const flipY = y + 240 > window.innerHeight;
  return {
    left: flipX ? "auto" : `${x + 14}px`,
    right: flipX ? `${window.innerWidth - x + 14}px` : "auto",
    top: flipY ? "auto" : `${y + 14}px`,
    bottom: flipY ? `${window.innerHeight - y + 14}px` : "auto",
  };
};

function lastNMonths(n) {
  const arr = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
    });
  }
  return arr;
}

function generateInsights(stats) {
  const insights = [];
  const withData = stats.filter((s) => s.count > 0);
  if (withData.length === 0) return insights;

  const staleSorted = [...withData].sort(
    (a, b) => (b.daysSinceLast ?? -1) - (a.daysSinceLast ?? -1),
  );
  const stalest = staleSorted[0];
  if (
    stalest &&
    stalest.daysSinceLast !== null &&
    stalest.daysSinceLast >= 21
  ) {
    insights.push(
      `it's been ${stalest.daysSinceLast} days since you last saw ${stalest.name}, the longest gap on the board right now.`,
    );
  }

  if (withData.length >= 2) {
    const byScore = [...withData].sort(
      (a, b) => b.weightedScore - a.weightedScore,
    );
    const top = byScore[0],
      bottom = byScore[byScore.length - 1];
    if (bottom.weightedScore > 0) {
      const ratio = top.weightedScore / bottom.weightedScore;
      if (ratio >= 2)
        insights.push(
          `${top.name} is pulling ${ratio.toFixed(1)}x the weighted time that ${bottom.name} is getting.`,
        );
    } else if (top.weightedScore > 0) {
      insights.push(
        `${bottom.name} has zero weighted time logged so far, everything's going to ${top.name} or others.`,
      );
    }
  }

  const enjoyRanked = withData
    .filter((s) => s.count >= 3 && s.avgEnjoyment !== null)
    .sort((a, b) => b.avgEnjoyment - a.avgEnjoyment);
  if (enjoyRanked.length >= 2) {
    const top = enjoyRanked[0],
      bottom = enjoyRanked[enjoyRanked.length - 1];
    if (top.avgEnjoyment - bottom.avgEnjoyment >= 1) {
      insights.push(
        `you rate hangouts with ${top.name} at ${top.avgEnjoyment.toFixed(1)}/5 on average versus ${bottom.avgEnjoyment.toFixed(1)}/5 with ${bottom.name}, that gap has nothing to do with how often you see them.`,
      );
    }
  }

  withData.forEach((s) => {
    const total =
      s.initiatorCounts.me + s.initiatorCounts.them + s.initiatorCounts.mutual;
    if (total >= 3) {
      const mePct = Math.round((s.initiatorCounts.me / total) * 100);
      const themPct = Math.round((s.initiatorCounts.them / total) * 100);
      if (mePct >= 70)
        insights.push(
          `you initiated ${mePct}% of hangouts with ${s.name}, you're the one carrying that one.`,
        );
      if (themPct >= 70)
        insights.push(
          `${s.name} initiated ${themPct}% of the time, they're chasing you more than you're chasing them.`,
        );
    }
  });

  withData.forEach((s) => {
    const total =
      s.energyCounts.drained +
      s.energyCounts.neutral +
      s.energyCounts.energized;
    if (total >= 3) {
      const drainedPct = Math.round((s.energyCounts.drained / total) * 100);
      if (drainedPct >= 30)
        insights.push(
          `${drainedPct}% of your hangouts with ${s.name} leave you drained rather than energized, worth sitting with regardless of the schedule.`,
        );
    }
  });

  return insights.slice(0, 6);
}

// ---------- small UI atoms ----------
function Card({ children, style = {} }) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        ...style,
      }}
      className="p-4"
    >
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "default", style = {}, disabled }) {
  const base = {
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    fontFamily: "Inter, sans-serif",
    fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "opacity .15s",
  };
  const variants = {
    default: { background: C.panelAlt, color: C.text },
    primary: {
      background: C.amber,
      color: "#14181C",
      border: "none",
      fontWeight: 600,
    },
    danger: {
      background: "transparent",
      color: C.coral,
      border: `1px solid ${C.coral}44`,
    },
    ghost: { background: "transparent", color: C.muted, border: "none" },
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="px-3 py-1.5 inline-flex items-center gap-1.5"
      style={{ ...base, ...variants[variant], ...style }}
    >
      {children}
    </button>
  );
}

function DriftGauge({ days, size = 76 }) {
  const r = 32,
    cx = 40,
    cy = 40,
    sw = 6;
  const circumference = 2 * Math.PI * r;
  const known = days !== null;
  const pct = known ? Math.min(days / 30, 1) : 0;
  const color = !known
    ? C.muted
    : days < 14
      ? C.cyan
      : days < 28
        ? C.amber
        : C.coral;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80">
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={C.border}
        strokeWidth={sw}
      />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct)}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dashoffset .4s ease" }}
      />
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontSize={17}
        fontFamily="JetBrains Mono, monospace"
        fontWeight={700}
        fill={C.text}
      >
        {known ? days : "—"}
      </text>
      <text
        x={cx}
        y={cy + 12}
        textAnchor="middle"
        fontSize={7.5}
        fontFamily="Inter, sans-serif"
        fill={C.muted}
      >
        days since
      </text>
    </svg>
  );
}

function Stars({ value, onChange, readOnly = false, size = 16 }) {
  return (
    <div className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          onClick={() => !readOnly && onChange && onChange(n)}
          style={{
            cursor: readOnly ? "default" : "pointer",
            color: n <= value ? C.amber : C.border,
            fontSize: size,
            lineHeight: 1,
          }}
        >
          ★
        </span>
      ))}
    </div>
  );
}

function ToggleGroup({ options, value, onChange }) {
  return (
    <div
      className="inline-flex rounded-md overflow-hidden"
      style={{ border: `1px solid ${C.border}` }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="px-3 py-1.5 text-xs"
          style={{
            background: value === opt.value ? C.amber : "transparent",
            color: value === opt.value ? "#14181C" : C.muted,
            fontWeight: value === opt.value ? 600 : 400,
            border: "none",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function GroupChips({ groups, selected, onToggle }) {
  const sel = selected || [];
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((g) => {
        const on = sel.includes(g.id);
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => onToggle(g.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: on ? g.color + "22" : C.panelAlt,
              border: `1px solid ${on ? g.color : C.border}`,
              color: on ? g.color : C.muted,
              borderRadius: 9999,
              padding: "6px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 9999,
                background: g.color,
                display: "inline-block",
              }}
            />
            {g.name}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-3">
      <div
        style={{
          color: C.muted,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
        className="mb-1.5"
      >
        {label}
      </div>
      {children}
    </div>
  );
}

// a native date field draws its text in the browser's own locale, so day-first can't be forced
// there. three number segments keep the order we want and still behave like a date field: click
// a segment and it takes the caret, type over it, or arrow up and down to step it
function DateField({ value, onChange }) {
  const [parts, setParts] = useState(() => splitISO(value));
  const [focused, setFocused] = useState(null);
  const dayRef = useRef(null);
  const monthRef = useRef(null);
  const yearRef = useRef(null);
  const nextRef = { d: monthRef, m: yearRef, y: null };

  // move on the moment no further digit could still make the segment valid, the way the native
  // field does: a 5 in the day jumps straight on, a 3 waits for a possible 30 or 31
  const isComplete = (key, raw) => {
    if (key === "y") return raw.length === 4;
    return raw.length === 2 || Number(raw) * 10 > (key === "d" ? 31 : 12);
  };

  const setSegment = (key, raw) => {
    const next = { ...parts, [key]: raw };
    // stepping into a shorter month would strand a day like 31, so pull it back into range
    const y = Number(next.y),
      m = Number(next.m);
    if (
      key !== "d" &&
      y >= 1900 &&
      m >= 1 &&
      m <= 12 &&
      Number(next.d) > daysInMonth(y, m)
    )
      next.d = pad2(daysInMonth(y, m));
    setParts(next);
    const iso = toISO(next);
    if (iso) onChange(iso); // a half-typed segment changes nothing above
    if (isComplete(key, raw)) nextRef[key]?.current?.focus();
  };

  const segment = (key, width, maxLen, label, ref) => (
    <input
      ref={ref}
      className="date-seg"
      type="number"
      inputMode="numeric"
      aria-label={label}
      value={parts[key]}
      min={key === "y" ? 1900 : 1}
      max={
        key === "d"
          ? daysInMonth(Number(parts.y), Number(parts.m)) || 31
          : key === "m"
            ? 12
            : 2200
      }
      onFocus={(e) => {
        setFocused(key);
        e.target.select();
      }}
      onBlur={(ev) => {
        setFocused(null);
        // only restore when what's left behind isn't a real date. restoring unconditionally
        // would undo the very digit that just triggered the auto-advance, because blur fires
        // before this render's commit has reached the value prop
        if (!toISO({ ...parts, [key]: ev.target.value }))
          setParts(splitISO(value));
      }}
      onChange={(e) => setSegment(key, e.target.value.slice(0, maxLen))}
      onWheel={(e) => e.currentTarget.blur()}
      style={{
        width,
        background: focused === key ? C.border : "transparent",
        border: "none",
        borderRadius: 3,
        outline: "none",
        color: C.text,
        font: "inherit",
        textAlign: "center",
        padding: "2px 0",
      }}
    />
  );

  const sep = <span style={{ color: C.muted, userSelect: "none" }}>/</span>;

  return (
    <div
      style={{
        ...inputStyle,
        display: "flex",
        alignItems: "center",
        gap: 1,
        padding: "6px 8px",
      }}
      // the field is full width but the segments only fill part of it, so a click on the
      // slack to the right would otherwise do nothing at all
      onMouseDown={(ev) => {
        if (!ev.target.closest("input")) {
          ev.preventDefault();
          dayRef.current?.focus();
        }
      }}
    >
      {segment("d", 26, 2, "day", dayRef)}
      {sep}
      {segment("m", 26, 2, "month", monthRef)}
      {sep}
      {segment("y", 46, 4, "year", yearRef)}
    </div>
  );
}

const inputStyle = {
  background: C.panelAlt,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontFamily: "Inter, sans-serif",
  fontSize: 14,
  width: "100%",
  padding: "8px 10px",
  outline: "none",
};

// modals close on escape and on a press that starts on the backdrop.
// the callback goes through a ref so the listener isn't torn down on every render
function useDismiss(open, onClose) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

// stops the page behind an overlay from scrolling under it. overflow:hidden alone is not enough
// on ios - the body has to be pinned, so it is fixed at its current offset and put back after,
// otherwise closing an overlay dumps you at the top of the page
function useScrollLock(locked) {
  useEffect(() => {
    if (!locked) return;
    const { body } = document;
    const y = window.scrollY;
    const before = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.width = "100%";
    return () => {
      Object.assign(body.style, before);
      window.scrollTo(0, y);
    };
  }, [locked]);
}

// the press has to *start* outside the panel, or releasing a text selection past the edge would close it
const dismissOnBackdrop = (onClose) => (e) => {
  if (e.target === e.currentTarget) onClose();
};

// ---------- main app ----------
// owns its own zoom state on purpose: keeping it here rather than in Orbit means a brush drag
// re-renders this chart alone instead of the whole page. with it in Orbit, every drag frame
// re-rendered five charts and the whole table, and single frames were taking over a second
function TrendFullscreen({ data, groups, onClose }) {
  const [zoom, setZoom] = useState(null);
  const dailyTrend = data; // alias, so the jsx below reads exactly as it did inline
  const lastDay = Math.max(0, data.length - 1);
  const zoomStart = zoom ? Math.min(zoom.start, lastDay) : 0;
  const zoomEnd = zoom ? Math.min(zoom.end, lastDay) : lastDay;
  const setRange = (days) =>
    setZoom(days ? { start: Math.max(0, lastDay - days + 1), end: lastDay } : null);
  const rangeOn = (days) =>
    days
      ? Boolean(zoom) &&
        zoomEnd === lastDay &&
        zoomStart === Math.max(0, lastDay - days + 1)
      : !zoom;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        zIndex: 50,
      }}
      className="flex p-2 sm:p-4"
      onMouseDown={dismissOnBackdrop(onClose)}
    >
      <div
        style={{
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          padding: 14,
        }}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            weighted score, day by day
          </div>
          <div className="flex items-center gap-1.5">
            {ZOOM_RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => setRange(r.days)}
                style={{
                  background: rangeOn(r.days) ? C.amber : "transparent",
                  color: rangeOn(r.days) ? "#14181C" : C.muted,
                  border: `1px solid ${rangeOn(r.days) ? C.amber : C.border}`,
                  borderRadius: 5,
                  padding: "3px 9px",
                  fontSize: 11.5,
                  fontWeight: rangeOn(r.days) ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={onClose}
              title="close"
              aria-label="close expanded trend"
              style={{
                background: "none",
                border: "none",
                padding: "0 2px",
                marginLeft: 4,
                cursor: "pointer",
                color: C.muted,
                display: "inline-flex",
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {dailyTrend.length === 0 ? (
          <div
            style={{
              color: C.muted,
              fontSize: 13,
              textAlign: "center",
              paddingTop: 40,
            }}
          >
            nothing logged yet
          </div>
        ) : (
          <>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={dailyTrend}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid stroke={C.border} vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke={C.muted}
                    fontSize={11}
                    minTickGap={28}
                  />
                  <YAxis stroke={C.muted} fontSize={11} />
                  <Tooltip
                    contentStyle={TOOLTIP_CONTENT}
                    labelStyle={TOOLTIP_LABEL}
                    itemStyle={TOOLTIP_ITEM}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {groups.map((g) => (
                    <Line
                      key={g.id}
                      type="linear"
                      dataKey={g.name}
                      stroke={g.color}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls
                      // recharts replays its line animation whenever props change, and a brush
                      // drag changes them every frame. that was the other half of the freeze
                      isAnimationActive={false}
                    />
                  ))}
                  <Brush
                    dataKey="total"
                    height={26}
                    travellerWidth={8}
                    stroke={C.border}
                    fill={C.bg}
                    startIndex={zoomStart}
                    endIndex={zoomEnd}
                    onChange={({ startIndex, endIndex }) =>
                      setZoom({ start: startIndex, end: endIndex })
                    }
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
              drag the handles under the chart to zoom in on a stretch of
              days, or pick a range above. each dot is a day you actually
              hung out.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Orbit() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState(DEFAULT_GROUPS);
  const [activityTypes, setActivityTypes] = useState(DEFAULT_TYPES);
  const [entries, setEntries] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filterGroup, setFilterGroup] = useState("all");
  const [sortConfig, setSortConfig] = useState({ key: "date", dir: "desc" });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [msg, setMsg] = useState("");
  const [noteTip, setNoteTip] = useState(null); // { text, x, y } while a row with notes is hovered
  const tipRef = useRef(null);
  const hoverTimer = useRef(null);
  const tipPos = useRef({ x: 0, y: 0 });
  const [dragItem, setDragItem] = useState(null); // { kind, id } while a settings row is being dragged
  const [dragOverItem, setDragOverItem] = useState(null); // { kind, id } of the row it's currently over
  const [showFullTrend, setShowFullTrend] = useState(false);

  const [loadError, setLoadError] = useState(null);
  const booted = useRef(false); // only a load that succeeded may ever write

  useEffect(() => {
    (async () => {
      try {
        // both at once - these used to be sequential, which over a network is two round
        // trips sitting behind the loading screen instead of one
        const [cfg, ent] = await Promise.all([
          window.storage.get("orbit:config", false),
          window.storage.get("orbit:entries", false),
        ]);
        if (cfg?.value) {
          const parsed = JSON.parse(cfg.value);
          if (parsed.groups) setGroups(parsed.groups);
          if (parsed.activityTypes)
            setActivityTypes(parsed.activityTypes.map(normalizeType));
        }
        if (ent?.value) setEntries(JSON.parse(ent.value).map(normalizeEntry));
        booted.current = true;
      } catch (err) {
        // a missing key comes back as null, not an error, so reaching here means the data is
        // genuinely unreachable. refuse to write rather than carry on with the defaults in
        // state: persistEntries writes the whole array, so one save from a failed boot would
        // replace every entry on the server with nothing
        setLoadError(err?.message || "couldn't reach the server");
      }
      setLoading(false);
    })();
  }, []);

  const persistConfig = async (g, t) => {
    if (!booted.current) return; // never write before a load has succeeded
    try {
      await window.storage.set(
        "orbit:config",
        JSON.stringify({ groups: g, activityTypes: t }),
        false,
      );
    } catch (e) {
      setMsg("couldn't save settings, try again");
    }
  };

  // reports whether it actually saved. it used to swallow the failure and return as if it had
  // worked, and every caller then flashed a success message over the error
  const persistEntries = async (e) => {
    if (!booted.current) {
      setMsg("server unreachable, nothing was saved");
      return false;
    }
    try {
      await window.storage.set("orbit:entries", JSON.stringify(e), false);
      return true;
    } catch (err) {
      setMsg("couldn't save entry, try again");
      return false;
    }
  };

  useEffect(() => {
    if (booted.current) persistConfig(groups, activityTypes);
  }, [groups, activityTypes]);

  useDismiss(showAdd, () => setShowAdd(false));
  useDismiss(showSettings, () => setShowSettings(false));
  useDismiss(showFullTrend, () => setShowFullTrend(false));

  // one lock for all three overlays - they are never open at once, so a single flag is right
  useScrollLock(showAdd || showSettings || showFullTrend);

  // a mouse click leaves the button focused, and the next keypress (escape) flips the browser
  // into keyboard mode, painting a focus ring on a button you only ever clicked. drop focus
  // after pointer clicks only - keyboard activation reports detail 0, so tabbing still shows it
  useEffect(() => {
    const onClick = (e) => {
      if (e.detail === 0) return;
      const btn = e.target.closest?.("button");
      if (btn) btn.blur();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // ---------- notes on hover ----------
  // the cursor position goes straight to the DOM instead of into state: this fires on every
  // mousemove, and re-rendering the table plus every chart that often would be sluggish
  const showNoteTip = (ev, notes) => {
    const text = (notes || "").trim();
    if (!text) return; // nothing to show, so don't even start the clock
    clearTimeout(hoverTimer.current);
    tipPos.current = { x: ev.clientX, y: ev.clientY };
    // read the position at fire time, not at enter time, or a slow drift across the row
    // would pop the box up wherever the cursor entered
    hoverTimer.current = setTimeout(
      () => setNoteTip({ text, ...tipPos.current }),
      400,
    );
  };

  const moveNoteTip = (ev) => {
    tipPos.current = { x: ev.clientX, y: ev.clientY };
    if (tipRef.current)
      Object.assign(tipRef.current.style, tipPlacement(ev.clientX, ev.clientY));
  };

  const hideNoteTip = () => {
    clearTimeout(hoverTimer.current);
    setNoteTip(null);
  };

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const flash = (t) => {
    setMsg(t);
    setTimeout(() => setMsg(""), 2200);
  };

  // ---------- entry CRUD ----------
  const emptyForm = {
    date: todayStr(),
    groupIds: [],
    activityTypeId: activityTypes[0]?.id || "",
    duration: 1.5,
    initiator: "mutual",
    enjoyment: 3,
    energy: "neutral",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  // a modal opening under a still cursor never fires mouseleave on the row, so the tip has
  // to be dismissed by hand or it sits on top of the panel
  const openAdd = () => {
    hideNoteTip();
    // the data never loaded, so the form would only collect something that cannot be saved
    if (loadError) {
      flash("can't reach the server, nothing would be saved");
      return;
    }
    // no group preselected: the form's own hint prompts for one, and a default would get
    // saved by accident on a hangout that involved somebody else entirely
    setForm({ ...emptyForm });
    setEditingId(null);
    setShowAdd(true);
  };
  const openEdit = (entry) => {
    hideNoteTip();
    if (loadError) {
      flash("can't reach the server, nothing would be saved");
      return;
    }
    setForm({ ...normalizeEntry(entry) });
    setEditingId(entry.id);
    setShowAdd(true);
  };
  const openSettings = () => {
    hideNoteTip();
    setShowSettings(true);
  };

  const toggleFormGroup = (id) => {
    const cur = form.groupIds || [];
    setForm({
      ...form,
      groupIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    });
  };

  const saveEntry = async () => {
    const gids = form.groupIds || [];
    if (gids.length === 0 || !form.activityTypeId || !form.date) {
      flash("pick at least one group, an activity, and a date");
      return;
    }
    const payload = { ...form, groupIds: gids };
    let next;
    if (editingId)
      next = entries.map((e) =>
        e.id === editingId ? { ...payload, id: editingId } : e,
      );
    else next = [...entries, { ...payload, id: uid() }];
    setEntries(next);
    // if it didn't save, leave the form open so the error banner is visible and the entry can
    // be retried, and above all don't claim it was logged
    if (!(await persistEntries(next))) return;
    setShowAdd(false);
    flash(editingId ? "entry updated" : "hangout logged");
  };

  // ctrl+enter saves, so logging a hangout never needs the mouse. on window rather than on the
  // panel because clicking any control in the form leaves focus on body
  const saveRef = useRef(saveEntry);
  useEffect(() => {
    saveRef.current = saveEntry;
  });
  useEffect(() => {
    if (!showAdd) return;
    const onKey = (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAdd]);

  const deleteEntry = async (id) => {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    if (!(await persistEntries(next))) return;
    setPendingDelete(null);
    flash("entry deleted");
  };

  // ---------- group / activity type management ----------
  // first color nobody is using, so deleting a group and adding one back can't hand out
  // a duplicate while a freed color is still sitting there. past 6 groups a repeat is
  // unavoidable, so it cycles from there
  const addGroup = () => {
    const used = new Set(groups.map((g) => g.color));
    const color =
      PALETTE.find((c) => !used.has(c)) ??
      PALETTE[groups.length % PALETTE.length];
    setGroups([...groups, { id: uid(), name: "New group", color }]);
  };
  const renameGroup = (id, name) =>
    setGroups(groups.map((g) => (g.id === id ? { ...g, name } : g)));
  const setGroupColor = (id, color) =>
    setGroups(groups.map((g) => (g.id === id ? { ...g, color } : g)));

  // deleting a group strips it from entries instead of blocking, so shared hangouts stay intact
  const deleteGroup = (id) => {
    const affected = entries.filter((e) => (e.groupIds || []).includes(id));
    const orphaned = affected.filter(
      (e) => (e.groupIds || []).length === 1,
    ).length;
    if (affected.length > 0) {
      const next = entries.map((e) =>
        (e.groupIds || []).includes(id)
          ? { ...e, groupIds: e.groupIds.filter((x) => x !== id) }
          : e,
      );
      setEntries(next);
      persistEntries(next);
    }
    setGroups(groups.filter((g) => g.id !== id));
    flash(
      affected.length === 0
        ? "group deleted"
        : orphaned > 0
          ? `group removed from ${affected.length} entries, ${orphaned} now have no group`
          : `group removed from ${affected.length} entries`,
    );
  };

  const addType = () =>
    setActivityTypes([
      ...activityTypes,
      { id: uid(), name: "New activity", tier: "light" },
    ]);
  const updateType = (id, patch) =>
    setActivityTypes(
      activityTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  const deleteType = (id) => {
    const count = entries.filter((e) => e.activityTypeId === id).length;
    if (count > 0) {
      flash(
        `${count} entries use this activity type, reassign or delete them first`,
      );
      return;
    }
    setActivityTypes(activityTypes.filter((t) => t.id !== id));
  };

  // ---------- reordering ----------
  // both lists are stored in display order, so moving a row here moves it in the charts,
  // the chips and the activity dropdown too
  const moveGroup = (fromId, toId) => setGroups(moveItem(groups, fromId, toId));
  const moveType = (fromId, toId) =>
    setActivityTypes(moveItem(activityTypes, fromId, toId));

  // only the grip is draggable, so dragging a text selection inside a name input still selects text
  const dragHandleProps = (kind, id) => ({
    draggable: true,
    onDragStart: (e) => {
      setDragItem({ kind, id });
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      const row = e.currentTarget.closest("[data-reorder-row]");
      if (row) e.dataTransfer.setDragImage(row, 16, 16);
    },
    onDragEnd: () => {
      setDragItem(null);
      setDragOverItem(null);
    },
  });

  const dropRowProps = (kind, id, onMove) => ({
    "data-reorder-row": "true",
    onDragOver: (e) => {
      if (!dragItem || dragItem.kind !== kind || dragItem.id === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverItem?.kind !== kind || dragOverItem.id !== id)
        setDragOverItem({ kind, id });
    },
    onDrop: (e) => {
      e.preventDefault();
      if (dragItem?.kind === kind) onMove(dragItem.id, id);
      setDragItem(null);
      setDragOverItem(null);
    },
  });

  // keeps the cursor a move cursor in the gaps between rows, where a drop just snaps back
  const dropZoneProps = () => ({
    onDragOver: (e) => {
      if (dragItem) e.preventDefault();
    },
    onDrop: () => {
      setDragItem(null);
      setDragOverItem(null);
    },
  });

  // ---------- analytics ----------
  const getType = (id) =>
    activityTypes.find((t) => t.id === id) || {
      name: "(deleted)",
      tier: "light",
    };
  const weightedOf = (e) =>
    e.duration * tierWeight(getType(e.activityTypeId).tier);

  // full credit per group: a shared hangout counts in full for every group it touches
  const perGroupStats = useMemo(() => {
    return groups.map((g) => {
      const ge = entries.filter((e) => (e.groupIds || []).includes(g.id));
      const totalHours = ge.reduce((s, e) => s + Number(e.duration || 0), 0);
      const weightedScore = ge.reduce((s, e) => s + weightedOf(e), 0);
      const enjoyVals = ge.map((e) => e.enjoyment).filter((v) => v != null);
      const avgEnjoyment = enjoyVals.length
        ? enjoyVals.reduce((a, b) => a + b, 0) / enjoyVals.length
        : null;
      const lastDate = ge.reduce(
        (max, e) => (!max || e.date > max ? e.date : max),
        null,
      );
      const initiatorCounts = { me: 0, them: 0, mutual: 0 };
      const energyCounts = { drained: 0, neutral: 0, energized: 0 };
      const tierCounts = { light: 0, medium: 0, heavy: 0 };
      ge.forEach((e) => {
        initiatorCounts[e.initiator] = (initiatorCounts[e.initiator] || 0) + 1;
        energyCounts[e.energy] = (energyCounts[e.energy] || 0) + 1;
        tierCounts[getType(e.activityTypeId).tier] =
          (tierCounts[getType(e.activityTypeId).tier] || 0) + 1;
      });
      return {
        ...g,
        count: ge.length,
        totalHours,
        weightedScore,
        avgEnjoyment,
        lastDate,
        daysSinceLast: daysSince(lastDate),
        initiatorCounts,
        energyCounts,
        tierCounts,
      };
    });
  }, [groups, entries, activityTypes]);

  // deduped reality check: each entry counted once, no matter how many groups it belongs to
  const overallStats = useMemo(
    () => ({
      count: entries.length,
      totalHours: entries.reduce((s, e) => s + Number(e.duration || 0), 0),
      weightedScore: entries.reduce((s, e) => s + weightedOf(e), 0),
    }),
    [entries, activityTypes],
  );

  const groupHoursSum = perGroupStats.reduce((s, g) => s + g.totalHours, 0);

  const insights = useMemo(
    () => generateInsights(perGroupStats),
    [perGroupStats],
  );

  const trendData = useMemo(() => {
    const months = lastNMonths(6);
    return months.map((m) => {
      const row = { month: m.label };
      groups.forEach((g) => {
        row[g.name] = entries
          .filter(
            (e) =>
              (e.groupIds || []).includes(g.id) && e.date.slice(0, 7) === m.key,
          )
          .reduce((s, e) => s + weightedOf(e), 0);
      });
      return row;
    });
  }, [groups, entries, activityTypes]);

  // the expanded view's series: one row per calendar day from the first logged entry to today.
  // a group's value is null, not 0, on days it did nothing, so connectNulls draws the days you
  // actually met instead of a comb of zeros pinned to the axis
  const dailyTrend = useMemo(() => {
    if (entries.length === 0) return [];
    const byDate = new Map();
    entries.forEach((e) => {
      const bucket = byDate.get(e.date);
      if (bucket) bucket.push(e);
      else byDate.set(e.date, [e]);
    });

    const first = [...byDate.keys()].sort()[0];
    const start = new Date(first + "T00:00:00");
    const end = new Date();
    const rows = [];
    // step a local day at a time, so DST months don't drift the dates
    for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      const key = `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`;
      const today = byDate.get(key) || [];
      const row = {
        key,
        label: day.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "2-digit",
        }),
      };
      let total = 0;
      groups.forEach((g) => {
        const hits = today.filter((e) => (e.groupIds || []).includes(g.id));
        row[g.name] = hits.length
          ? Number(hits.reduce((s, e) => s + weightedOf(e), 0).toFixed(2))
          : null;
        total += row[g.name] || 0;
      });
      // the brush previews one series, so give it a single number to draw: that day's total.
      // it needs a numeric key - a string key plots nothing, which is why the strip was flat
      row.total = Number(total.toFixed(2));
      rows.push(row);
    }
    return rows;
  }, [groups, entries, activityTypes]);


  const weightedBarData = perGroupStats.map((g) => ({
    name: g.name,
    value: Number(g.weightedScore.toFixed(1)),
    color: g.color,
  }));
  const enjoyBarData = perGroupStats.map((g) => ({
    name: g.name,
    value: g.avgEnjoyment ? Number(g.avgEnjoyment.toFixed(2)) : 0,
    color: g.color,
  }));
  const tierBarData = perGroupStats.map((g) => ({
    name: g.name,
    light: g.tierCounts.light,
    medium: g.tierCounts.medium,
    heavy: g.tierCounts.heavy,
  }));
  const initBarData = perGroupStats.map((g) => ({
    name: g.name,
    Me: g.initiatorCounts.me,
    Them: g.initiatorCounts.them,
    Mutual: g.initiatorCounts.mutual,
  }));

  // ---------- table ----------
  const filteredEntries = useMemo(() => {
    let list =
      filterGroup === "all"
        ? entries
        : entries.filter((e) => (e.groupIds || []).includes(filterGroup));
    const dir = sortConfig.dir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortConfig.key) {
        case "group":
          return (
            groupLabel(groups, a).localeCompare(groupLabel(groups, b)) * dir
          );
        case "activity":
          return (
            getType(a.activityTypeId).name.localeCompare(
              getType(b.activityTypeId).name,
            ) * dir
          );
        case "duration":
          return (a.duration - b.duration) * dir;
        case "weighted":
          return (weightedOf(a) - weightedOf(b)) * dir;
        case "enjoyment":
          return (a.enjoyment - b.enjoyment) * dir;
        default:
          return a.date.localeCompare(b.date) * dir;
      }
    });
    return list;
  }, [entries, filterGroup, sortConfig, groups, activityTypes]);

  const toggleSort = (key) =>
    setSortConfig((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );

  const exportJSON = () => {
    const blob = new Blob(
      [JSON.stringify({ groups, activityTypes, entries }, null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `orbit-backup-${todayStr()}.json`;
    a.click();
  };

  const exportCSV = () => {
    const header = [
      "date",
      "groups",
      "activity",
      "tier",
      "duration_hrs",
      "weighted_score",
      "initiator",
      "enjoyment",
      "energy",
      "notes",
    ];
    const rows = filteredEntries.map((e) => {
      const t = getType(e.activityTypeId);
      const notes = (e.notes || "").replace(/"/g, '""');
      const gnames = (e.groupIds || [])
        .map((id) => groupName(groups, id))
        .join(" | ");
      return [
        e.date,
        `"${gnames}"`,
        t.name,
        t.tier,
        e.duration,
        weightedOf(e).toFixed(2),
        e.initiator,
        e.enjoyment,
        e.energy,
        `"${notes}"`,
      ].join(",");
    });
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `orbit-data-${todayStr()}.csv`;
    a.click();
  };

  const importJSON = (file) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (parsed.groups) setGroups(parsed.groups);
        if (parsed.activityTypes)
          setActivityTypes(parsed.activityTypes.map(normalizeType));
        if (parsed.entries) {
          const norm = parsed.entries.map(normalizeEntry);
          setEntries(norm);
          // bail before the success flash if it didn't reach the server - otherwise a failed
          // restore reports "backup restored" and the user believes their data is safe
          if (!(await persistEntries(norm))) return;
        }
        flash("backup restored");
      } catch (e) {
        flash("that file didn't parse, check it's an orbit backup");
      }
    };
    reader.readAsText(file);
  };

  const earliestDate = entries.reduce(
    (min, e) => (!min || e.date < min ? e.date : min),
    null,
  );
  const latestDate = entries.reduce(
    (max, e) => (!max || e.date > max ? e.date : max),
    null,
  );

  if (loading) {
    return (
      <div
        style={{
          background: C.bg,
          minHeight: "100vh",
          color: C.muted,
          fontFamily: "Inter, sans-serif",
        }}
        className="flex items-center justify-center text-sm"
      >
        loading orbit…
      </div>
    );
  }

  return (
    <div
      style={{
        background: C.bg,
        minHeight: "100vh",
        color: C.text,
        fontFamily: "Inter, sans-serif",
      }}
      className="pb-24"
    >
      <style>{`
        * { box-sizing: border-box; }
        /* dark groove, muted handle. the standard properties cover firefox and chrome 121+,
           which ignores the ::-webkit-scrollbar rules below once these are set */
        * { scrollbar-color: ${C.muted} ${C.bg}; scrollbar-width: thin; }
        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.muted}; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: ${C.textSoft}; }
        input[type="number"]::-webkit-inner-spin-button { opacity: 0.5; }
        /* the date segments step with the arrow keys; the spinners would wreck their width */
        .date-seg::-webkit-outer-spin-button,
        .date-seg::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .date-seg { -moz-appearance: textfield; appearance: textfield; }
        /* recharts draws the zoom brush for a light theme: dark grips on a dark strip, with
           hardcoded white handles. repaint them from the theme so they read */
        .recharts-brush-traveller rect { fill: ${C.muted}; }
        .recharts-brush-traveller line { stroke: ${C.bg}; }
        .recharts-brush-slide { fill: ${C.border}; fill-opacity: 0.45; }
      `}</style>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
        {/* header */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <div
              style={{
                fontFamily: "JetBrains Mono, monospace",
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: "0.02em",
              }}
            >
              ORBIT
            </div>
            <div style={{ color: C.muted, fontSize: 12.5 }}>
              private hangout ledger, for your eyes only
            </div>
          </div>
          <div className="flex gap-2">
            <Btn onClick={openSettings}>
              <Settings size={14} /> settings
            </Btn>
          </div>
        </div>

        <div
          className="flex flex-wrap gap-x-5 gap-y-1 mt-3 mb-5"
          style={{ color: C.muted, fontSize: 12 }}
        >
          <span>
            <b style={{ color: C.text }}>{entries.length}</b> hangouts logged
          </span>
          <span>
            <b style={{ color: C.text }}>{groups.length}</b> groups tracked
          </span>
          {entries.length > 0 && groups.length > 0 && (
            <span>
              <b style={{ color: C.text }}>
                {overallStats.totalHours.toFixed(1)}h
              </b>{" "}
              actual ·{" "}
              <b style={{ color: C.text }}>{groupHoursSum.toFixed(1)}h</b>{" "}
              counted across {groups.length} groups
            </span>
          )}
          {earliestDate && (
            <span>
              tracking since{" "}
              <b style={{ color: C.text }}>{fmtDate(earliestDate)}</b>
            </span>
          )}
          {latestDate && (
            <span>
              last logged <b style={{ color: C.text }}>{fmtDate(latestDate)}</b>
            </span>
          )}
        </div>

        {/* sits above everything and never times out. the app is showing defaults it could not
            load, and the one thing that must not happen is someone logging an entry into that
            and believing it was saved */}
        {loadError && (
          <div
            style={{
              position: "fixed",
              top: 16,
              left: "50%",
              transform: "translateX(-50%)",
              maxWidth: "min(92vw, 520px)",
              background: C.panel,
              border: `1px solid ${C.coral}`,
              color: C.coral,
              fontSize: 12.5,
              textAlign: "center",
              zIndex: 70,
              boxShadow: "0 6px 20px rgba(0,0,0,0.55)",
            }}
            className="px-3 py-2 rounded-md"
            role="alert"
          >
            can't load your data: {loadError}. nothing you do here will be
            saved, so reload rather than adding anything.
          </div>
        )}

        {msg && (
          <div
            style={{
              background: C.panelAlt,
              border: `1px solid ${C.border}`,
              color: C.amber,
              fontSize: 12.5,
              // inline this sits in the page flow, which a modal covers completely. while one is
              // open, float it above them or "pick at least one group" is unreadable and a save
              // that correctly refused looks like a dead button
              ...(showAdd || showSettings || showFullTrend
                ? {
                    position: "fixed",
                    top: 16,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 60,
                    boxShadow: "0 6px 20px rgba(0,0,0,0.55)",
                  }
                : null),
            }}
            className="px-3 py-2 rounded-md mb-4"
            role="status"
          >
            {msg}
          </div>
        )}

        {groups.length === 0 ? (
          <Card style={{ textAlign: "center", padding: 32 }}>
            <Users size={28} color={C.muted} className="mx-auto mb-2" />
            <div style={{ color: C.muted, fontSize: 13 }}>
              no groups yet. add your first one in settings.
            </div>
            <Btn
              variant="primary"
              onClick={openSettings}
              style={{ marginTop: 12 }}
            >
              open settings
            </Btn>
          </Card>
        ) : (
          <>
            {/* insights */}
            {insights.length > 0 && (
              <Card style={{ marginBottom: 20 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: C.muted,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                  className="mb-2"
                >
                  what the data's saying
                </div>
                <ul className="space-y-1.5">
                  {insights.map((t, i) => (
                    <li
                      key={i}
                      style={{ fontSize: 13.5, lineHeight: 1.5 }}
                      className="flex gap-2"
                    >
                      <span style={{ color: C.amber }}>·</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* per-group summary */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
              {perGroupStats.map((g) => (
                <Card key={g.id}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 9999,
                        background: g.color,
                        display: "inline-block",
                      }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {g.name}
                    </span>
                  </div>
                  <div className="flex justify-center my-1">
                    <DriftGauge days={g.daysSinceLast} />
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: C.muted,
                      textAlign: "center",
                    }}
                  >
                    {g.count} hangouts · {g.totalHours.toFixed(1)}h
                  </div>
                  <div style={{ textAlign: "center", marginTop: 4 }}>
                    <span
                      style={{
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: 15,
                        fontWeight: 700,
                      }}
                    >
                      {g.weightedScore.toFixed(1)}
                    </span>
                    <span style={{ fontSize: 10.5, color: C.muted }}>
                      {" "}
                      weighted
                    </span>
                  </div>
                  {g.avgEnjoyment !== null && (
                    <div style={{ textAlign: "center", marginTop: 2 }}>
                      <Stars
                        value={Math.round(g.avgEnjoyment)}
                        readOnly
                        size={12}
                      />
                    </div>
                  )}
                </Card>
              ))}
            </div>

            {/* charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <Card>
                <div
                  style={{ fontSize: 12.5, fontWeight: 600 }}
                  className="mb-3"
                >
                  weighted investment by group
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={weightedBarData}>
                    <CartesianGrid stroke={C.border} vertical={false} />
                    <XAxis dataKey="name" stroke={C.muted} fontSize={11} />
                    <YAxis stroke={C.muted} fontSize={11} />
                    <Tooltip
                      contentStyle={TOOLTIP_CONTENT}
                      labelStyle={TOOLTIP_LABEL}
                      itemStyle={TOOLTIP_ITEM}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {weightedBarData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <div
                  style={{ fontSize: 12.5, fontWeight: 600 }}
                  className="mb-3"
                >
                  average enjoyment by group
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={enjoyBarData}>
                    <CartesianGrid stroke={C.border} vertical={false} />
                    <XAxis dataKey="name" stroke={C.muted} fontSize={11} />
                    <YAxis stroke={C.muted} fontSize={11} domain={[0, 5]} />
                    <Tooltip
                      contentStyle={TOOLTIP_CONTENT}
                      labelStyle={TOOLTIP_LABEL}
                      itemStyle={TOOLTIP_ITEM}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {enjoyBarData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                    monthly trend (weighted score)
                  </div>
                  <button
                    onClick={() => setShowFullTrend(true)}
                    title="expand to day by day"
                    aria-label="expand trend to full screen"
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: C.muted,
                      display: "inline-flex",
                    }}
                  >
                    <Maximize2 size={13} />
                  </button>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={trendData}>
                    <CartesianGrid stroke={C.border} vertical={false} />
                    <XAxis dataKey="month" stroke={C.muted} fontSize={11} />
                    <YAxis stroke={C.muted} fontSize={11} />
                    <Tooltip
                      wrapperStyle={{ zIndex: 1000 }}
                      contentStyle={{
                        background: C.panelAlt,
                        border: `1px solid ${C.border}`,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {groups.map((g) => (
                      <Line
                        key={g.id}
                        type="monotone"
                        dataKey={g.name}
                        stroke={g.color}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <div
                  style={{ fontSize: 12.5, fontWeight: 600 }}
                  className="mb-3"
                >
                  activity tier mix
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={tierBarData}>
                    <CartesianGrid stroke={C.border} vertical={false} />
                    <XAxis dataKey="name" stroke={C.muted} fontSize={11} />
                    <YAxis
                      stroke={C.muted}
                      fontSize={11}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: C.panelAlt,
                        border: `1px solid ${C.border}`,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      dataKey="light"
                      stackId="tier"
                      fill={TIER_COLOR.light}
                      name="light"
                    />
                    <Bar
                      dataKey="medium"
                      stackId="tier"
                      fill={TIER_COLOR.medium}
                      name="medium"
                    />
                    <Bar
                      dataKey="heavy"
                      stackId="tier"
                      fill={TIER_COLOR.heavy}
                      name="heavy"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card style={{ gridColumn: "1 / -1" }}>
                <div
                  style={{ fontSize: 12.5, fontWeight: 600 }}
                  className="mb-3"
                >
                  who initiates
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={initBarData} layout="vertical">
                    <CartesianGrid stroke={C.border} horizontal={false} />
                    <XAxis
                      type="number"
                      stroke={C.muted}
                      fontSize={11}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      stroke={C.muted}
                      fontSize={11}
                      width={90}
                    />
                    <Tooltip
                      contentStyle={{
                        background: C.panelAlt,
                        border: `1px solid ${C.border}`,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Me" stackId="init" fill={C.amber} />
                    <Bar dataKey="Them" stackId="init" fill={C.cyan} />
                    <Bar dataKey="Mutual" stackId="init" fill={C.muted} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>

            {/* raw data table */}
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>raw data</div>
                <div className="flex items-center gap-2">
                  <select
                    value={filterGroup}
                    onChange={(e) => setFilterGroup(e.target.value)}
                    style={{
                      ...inputStyle,
                      width: "auto",
                      fontSize: 12,
                      padding: "5px 8px",
                    }}
                  >
                    <option value="all">all groups</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <Btn
                    onClick={exportCSV}
                    style={{ fontSize: 12, padding: "5px 8px" }}
                  >
                    <Download size={12} /> csv
                  </Btn>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12.5,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        color: C.muted,
                        textAlign: "left",
                      }}
                    >
                      {[
                        ["date", "date"],
                        ["group", "group"],
                        ["activity", "activity"],
                        ["duration", "hrs"],
                        ["weighted", "weighted"],
                        ["enjoyment", "enjoy"],
                      ].map(([key, label]) => (
                        <th
                          key={key}
                          onClick={() => toggleSort(key)}
                          style={{
                            padding: "6px 8px",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span className="inline-flex items-center gap-1">
                            {label}
                            <ArrowUpDown size={10} />
                          </span>
                        </th>
                      ))}
                      <th style={{ padding: "6px 8px" }}>init</th>
                      <th style={{ padding: "6px 8px" }}>energy</th>
                      <th style={{ padding: "6px 8px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.map((e) => {
                      const gids = e.groupIds || [];
                      const t = getType(e.activityTypeId);
                      return (
                        <tr
                          key={e.id}
                          style={{ borderBottom: `1px solid ${C.border}` }}
                          onMouseEnter={(ev) => showNoteTip(ev, e.notes)}
                          onMouseMove={moveNoteTip}
                          onMouseLeave={hideNoteTip}
                        >
                          <td
                            style={{
                              padding: "6px 8px",
                              whiteSpace: "nowrap",
                              color: C.muted,
                            }}
                          >
                            {fmtDate(e.date)}
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-0.5">
                                {gids.length === 0 ? (
                                  <span
                                    style={{
                                      width: 6,
                                      height: 6,
                                      borderRadius: 9999,
                                      background: C.muted,
                                      display: "inline-block",
                                    }}
                                  />
                                ) : (
                                  gids.map((id) => {
                                    const g = groups.find((gr) => gr.id === id);
                                    return (
                                      <span
                                        key={id}
                                        style={{
                                          width: 6,
                                          height: 6,
                                          borderRadius: 9999,
                                          background: g?.color || C.muted,
                                          display: "inline-block",
                                        }}
                                      />
                                    );
                                  })
                                )}
                              </span>
                              {groupLabel(groups, e)}
                            </span>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            {t.name}{" "}
                            <span
                              style={{
                                color: TIER_COLOR[t.tier],
                                fontSize: 10,
                              }}
                            >
                              · {t.tier}
                            </span>
                          </td>
                          <td style={{ padding: "6px 8px" }}>{e.duration}</td>
                          <td
                            style={{
                              padding: "6px 8px",
                              fontFamily: "JetBrains Mono, monospace",
                            }}
                          >
                            {weightedOf(e).toFixed(1)}
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <Stars value={e.enjoyment} readOnly size={11} />
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              textTransform: "capitalize",
                              color: C.muted,
                            }}
                          >
                            {e.initiator}
                          </td>
                          <td
                            style={{
                              padding: "6px 8px",
                              textTransform: "capitalize",
                              color: C.muted,
                            }}
                          >
                            {e.energy}
                          </td>
                          <td
                            style={{ padding: "6px 8px", whiteSpace: "nowrap" }}
                          >
                            <button
                              onClick={() => openEdit(e)}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: C.muted,
                                marginRight: 6,
                              }}
                            >
                              <Pencil size={13} />
                            </button>
                            {pendingDelete === e.id ? (
                              <span className="inline-flex gap-1">
                                <button
                                  onClick={() => deleteEntry(e.id)}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    color: C.coral,
                                    fontSize: 11,
                                  }}
                                >
                                  confirm
                                </button>
                                <button
                                  onClick={() => setPendingDelete(null)}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    color: C.muted,
                                    fontSize: 11,
                                  }}
                                >
                                  cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setPendingDelete(e.id)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  color: C.muted,
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredEntries.length === 0 && (
                      <tr>
                        <td
                          colSpan={9}
                          style={{
                            padding: "16px 8px",
                            color: C.muted,
                            textAlign: "center",
                          }}
                        >
                          no entries yet, log your first hangout
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      {showFullTrend && (
        <TrendFullscreen
          data={dailyTrend}
          groups={groups}
          onClose={() => setShowFullTrend(false)}
        />
      )}

      {/* notes tip: follows the cursor, pointer-events off so it can't steal the hover */}
      {noteTip && (
        <div
          ref={tipRef}
          style={{
            position: "fixed",
            ...tipPlacement(noteTip.x, noteTip.y),
            maxWidth: 300,
            background: C.panelAlt,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 12,
            lineHeight: 1.45,
            color: C.textSoft,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            pointerEvents: "none",
            boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
            zIndex: 40, // below the modals at 50, so it can never float over a panel
          }}
        >
          {noteTip.text}
        </div>
      )}

      {/* floating add button */}
      <button
        onClick={openAdd}
        aria-label="log a hangout"
        title="log a hangout"
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          background: C.amber,
          color: "#14181C",
          border: "none",
          borderRadius: 9999,
          width: 52,
          height: 52,
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          cursor: "pointer",
        }}
        className="flex items-center justify-center"
      >
        <Plus size={22} />
      </button>

      {/* add/edit modal */}
      {showAdd && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 50,
          }}
          className="flex items-end sm:items-center justify-center p-0 sm:p-4"
          onMouseDown={dismissOnBackdrop(() => setShowAdd(false))}
        >
          <div
            style={{
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            className="p-5 w-full sm:max-w-4xl"
          >
            <div className="flex items-center justify-between mb-4">
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {editingId ? "edit hangout" : "log a hangout"}
              </div>
              <button
                onClick={() => setShowAdd(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: C.muted,
                }}
              >
                <X size={18} />
              </button>
            </div>

            <Field label="groups (pick any number)">
              <GroupChips
                groups={groups}
                selected={form.groupIds}
                onToggle={toggleFormGroup}
              />
              {(form.groupIds || []).length === 0 && (
                <div style={{ color: C.muted, fontSize: 11.5, marginTop: 6 }}>
                  pick at least one. if friends from different groups were there
                  together, pick both.
                </div>
              )}
            </Field>

            {/* three across on desktop: the form was one narrow column and needed scrolling
                even on a large screen. below sm it stays stacked, which is the phone layout */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-3">
              <Field label="activity">
                <select
                  value={form.activityTypeId}
                  onChange={(e) =>
                    setForm({ ...form, activityTypeId: e.target.value })
                  }
                  style={inputStyle}
                >
                  {activityTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.tier})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="date">
                <DateField
                  value={form.date}
                  onChange={(iso) => setForm((f) => ({ ...f, date: iso }))}
                />
              </Field>
              <Field label="duration (hrs)">
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={form.duration}
                  onChange={(e) =>
                    setForm({ ...form, duration: Number(e.target.value) })
                  }
                  style={inputStyle}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-3">
              <Field label="who initiated">
                <ToggleGroup
                  value={form.initiator}
                  onChange={(v) => setForm({ ...form, initiator: v })}
                  options={[
                    { value: "me", label: "me" },
                    { value: "them", label: "them" },
                    { value: "mutual", label: "mutual" },
                  ]}
                />
              </Field>

              <Field label="enjoyment">
                <Stars
                  value={form.enjoyment}
                  onChange={(v) => setForm({ ...form, enjoyment: v })}
                  size={22}
                />
              </Field>

              <Field label="how you felt after">
                <ToggleGroup
                  value={form.energy}
                  onChange={(v) => setForm({ ...form, energy: v })}
                  options={[
                    { value: "drained", label: "drained" },
                    { value: "neutral", label: "neutral" },
                    { value: "energized", label: "energized" },
                  ]}
                />
              </Field>
            </div>

            <Field label="notes (optional)">
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </Field>

            {/* on desktop the row is capped and pushed right: at 896px wide the save button
                stretched to nearly the whole panel, which is a lot of amber for one action */}
            <div className="flex gap-2 mt-4 sm:max-w-sm sm:ml-auto">
              <Btn
                variant="primary"
                onClick={saveEntry}
                style={{ flex: 1, justifyContent: "center" }}
              >
                save
              </Btn>
              <Btn onClick={() => setShowAdd(false)}>cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {/* settings modal */}
      {showSettings && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 50,
          }}
          className="flex items-end sm:items-center justify-center p-0 sm:p-4"
          onMouseDown={dismissOnBackdrop(() => setShowSettings(false))}
        >
          <div
            style={{
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            className="p-5 w-full sm:max-w-4xl"
          >
            <div className="flex items-center justify-between mb-4">
              <div style={{ fontWeight: 600, fontSize: 15 }}>settings</div>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: C.muted,
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: C.muted,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                  className="mb-2"
                >
                  groups
                </div>
                <div {...dropZoneProps()}>
                  {groups.map((g) => (
                    <div
                      key={g.id}
                      {...dropRowProps("group", g.id, moveGroup)}
                      className="flex items-center gap-2"
                      style={{
                        margin: "0 -6px 8px",
                        padding: "3px 6px",
                        borderRadius: 6,
                        opacity:
                          dragItem?.kind === "group" && dragItem.id === g.id
                            ? 0.4
                            : 1,
                        boxShadow:
                          dragOverItem?.kind === "group" && dragOverItem.id === g.id
                            ? `inset 0 2px 0 0 ${C.amber}`
                            : "none",
                      }}
                    >
                      <span
                        {...dragHandleProps("group", g.id)}
                        title="drag to reorder"
                        style={{
                          display: "inline-flex",
                          flexShrink: 0,
                          color: C.muted,
                          cursor: "grab",
                        }}
                      >
                        <GripVertical size={14} />
                      </span>
                      {/* the swatch is the button: the real color input fills it invisibly, so a
                          click opens the browser's picker and any hex at all is available. the ring
                          keeps a near-black group visible against the dark panel */}
                      <span
                        title="pick a color"
                        style={{
                          position: "relative",
                          width: 14,
                          height: 14,
                          borderRadius: 9999,
                          background: g.color,
                          border: `1px solid ${C.border}`,
                          boxSizing: "border-box",
                          flexShrink: 0,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="color"
                          value={hex6(g.color)}
                          onChange={(ev) => setGroupColor(g.id, ev.target.value)}
                          aria-label={`color for ${g.name}`}
                          style={{
                            position: "absolute",
                            inset: 0,
                            width: "100%",
                            height: "100%",
                            opacity: 0,
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                          }}
                        />
                      </span>
                      <input
                        value={g.name}
                        onChange={(e) => renameGroup(g.id, e.target.value)}
                        style={{ ...inputStyle, padding: "5px 8px" }}
                      />
                      <button
                        onClick={() => deleteGroup(g.id)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: C.muted,
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <Btn onClick={addGroup} style={{ fontSize: 12, marginBottom: 16 }}>
                  <Plus size={12} /> add group
                </Btn>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 11,
                    color: C.muted,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                  className="mb-2"
                >
                  activity types
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>
                  effort follows the tier: light counts 1x, medium 2x, heavy 3x
                </div>
                <div {...dropZoneProps()}>
                  {activityTypes.map((t) => (
                    <div
                      key={t.id}
                      {...dropRowProps("type", t.id, moveType)}
                      className="flex items-center gap-2"
                      style={{
                        margin: "0 -6px 8px",
                        padding: "3px 6px",
                        borderRadius: 6,
                        opacity:
                          dragItem?.kind === "type" && dragItem.id === t.id
                            ? 0.4
                            : 1,
                        boxShadow:
                          dragOverItem?.kind === "type" && dragOverItem.id === t.id
                            ? `inset 0 2px 0 0 ${C.amber}`
                            : "none",
                      }}
                    >
                      <span
                        {...dragHandleProps("type", t.id)}
                        title="drag to reorder"
                        style={{
                          display: "inline-flex",
                          flexShrink: 0,
                          color: C.muted,
                          cursor: "grab",
                        }}
                      >
                        <GripVertical size={14} />
                      </span>
                      <input
                        value={t.name}
                        onChange={(e) => updateType(t.id, { name: e.target.value })}
                        style={{ ...inputStyle, padding: "5px 8px", flex: 2 }}
                      />
                      <select
                        value={t.tier}
                        onChange={(e) => updateType(t.id, { tier: e.target.value })}
                        style={{
                          ...inputStyle,
                          padding: "5px 6px",
                          flex: 1,
                          fontSize: 12,
                        }}
                      >
                        <option value="light">light</option>
                        <option value="medium">medium</option>
                        <option value="heavy">heavy</option>
                      </select>
                      <button
                        onClick={() => deleteType(t.id)}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: C.muted,
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <Btn onClick={addType} style={{ fontSize: 12, marginBottom: 16 }}>
                  <Plus size={12} /> add type
                </Btn>
              </div>
            </div>

            <div
              style={{
                fontSize: 11,
                color: C.muted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
              className="mb-2"
            >
              data
            </div>
            <div className="flex flex-wrap gap-2">
              <Btn onClick={exportJSON}>
                <Download size={13} /> export backup (json)
              </Btn>
              <Btn onClick={exportCSV}>
                <Download size={13} /> export csv
              </Btn>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: "6px 12px",
                  fontSize: 13,
                  cursor: "pointer",
                  background: C.panelAlt,
                }}
              >
                <Upload size={13} /> import backup
                <input
                  type="file"
                  accept=".json"
                  style={{ display: "none" }}
                  onChange={(e) =>
                    e.target.files[0] && importJSON(e.target.files[0])
                  }
                />
              </label>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
              kept as json files on your own server rather than in this browser,
              with the previous version copied aside on every save. export a
              backup now and then to keep a copy off the machine.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
