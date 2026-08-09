'use client';

import styles from './BarChart.module.css';

interface BarChartDatum {
  label: string;
  value: number;
}

interface BarChartProps {
  data: BarChartDatum[];
  ariaLabel: string;
}

export default function BarChart({ data, ariaLabel }: BarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <>
      {/* The bars are decorative: height alone carries no value a screen reader
          can read, and `aria-label` on the container only names the chart. The
          figures live in the table below, which is visually hidden but present
          in the accessibility tree. */}
      <div className={styles.chart} role="presentation">
        {data.map((d) => (
          <div key={d.label} className={styles.column}>
            <div
              className={styles.bar}
              style={{ height: `${Math.max(4, (d.value / max) * 100)}%` }}
              title={`${d.label}: ${d.value}`}
            />
            <div className={styles.tick}>{d.label}</div>
          </div>
        ))}
      </div>
      <div className={styles.visuallyHidden}>
        <table>
          <caption>{ariaLabel}</caption>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <th scope="row">{d.label}</th>
                <td>{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
