import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money, moneyCompact, truncate } from "../lib/format";

export interface BarDatum {
  label: string;
  value: number;
}

/** Recharts passes the hovered payload through; only the first entry matters
 *  here because this chart has a single series. */
function ChartTooltip(
  { active, payload }: {
    active?: boolean;
    payload?: { payload: BarDatum }[];
  },
) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="t-name">{datum.label}</div>
      <div className="t-value">{money(datum.value)}</div>
    </div>
  );
}

/**
 * One measure across categories, so the bars carry a single hue — identity is
 * on the axis, and colouring each bar differently would imply an encoding that
 * is not there. Horizontal, because category names are words.
 */
export function CategoryBars({ data, height }: { data: BarDatum[]; height?: number }) {
  const rows = [...data].sort((a, b) => b.value - a.value);
  const chartHeight = height ?? Math.max(160, rows.length * 34 + 40);

  return (
    <div style={{ width: "100%", height: chartHeight }}>
      <ResponsiveContainer>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 64, bottom: 4, left: 4 }}
          barCategoryGap={6}
        >
          <CartesianGrid
            horizontal={false}
            stroke="var(--border)"
            strokeDasharray="2 4"
          />
          <XAxis
            type="number"
            tickFormatter={(v) => moneyCompact(v)}
            stroke="var(--border)"
            tick={{ fill: "var(--text-muted)", fontSize: 12 }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={140}
            stroke="var(--border)"
            tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
            tickLine={false}
            tickFormatter={(v: string) => truncate(v, 20)}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ fill: "var(--surface-2)" }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.label} fill="var(--series-1)" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
