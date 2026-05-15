'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { ScoredTransaction } from '@/types';

interface RiskDistributionChartProps {
  transactions: ScoredTransaction[];
}

export function RiskDistributionChart({ transactions }: RiskDistributionChartProps) {
  const data = useMemo(() => {
    const buckets = [
      { range: '0-20', label: 'Low', count: 0, color: '#00c895' },
      { range: '21-40', label: 'Med-Low', count: 0, color: '#22d3ee' },
      { range: '41-60', label: 'Medium', count: 0, color: '#fbbf24' },
      { range: '61-80', label: 'Med-High', count: 0, color: '#f97316' },
      { range: '81-100', label: 'High', count: 0, color: '#ef4444' },
    ];

    transactions.forEach((tx) => {
      const score = tx.risk_score;
      if (score <= 20) buckets[0].count++;
      else if (score <= 40) buckets[1].count++;
      else if (score <= 60) buckets[2].count++;
      else if (score <= 80) buckets[3].count++;
      else buckets[4].count++;
    });

    return buckets;
  }, [transactions]);

  return (
    <div className="bg-[var(--background-secondary)] rounded-2xl border border-[var(--border)] p-6 h-[300px]">
      <h3 className="font-semibold text-white mb-4">Risk Score Distribution</h3>

      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data}>
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#64748b', fontSize: 12 }}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1a2332',
              border: '1px solid #2a3441',
              borderRadius: '12px',
              color: '#fff',
            }}
            formatter={(value) => [`${value ?? 0} txns`, 'Count']}
            labelFormatter={(label) => `Risk: ${label}`}
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
