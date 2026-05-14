'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

interface ThroughputChartProps {
  data: { time: string; txns: number; fraud: number }[];
}

export function ThroughputChart({ data }: ThroughputChartProps) {
  const chartData = useMemo(() => {
    if (data.length === 0) {
      // Generate empty placeholder data
      return Array.from({ length: 30 }, (_, i) => ({
        time: `${i}s`,
        txns: 0,
        fraud: 0,
      }));
    }
    return data.slice(-30);
  }, [data]);

  return (
    <div className="bg-[var(--background-secondary)] rounded-2xl border border-[var(--border)] p-6 h-[300px]">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-white">Transaction Throughput</h3>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[var(--solace-green)]" />
            <span className="text-[var(--foreground-secondary)]">Legit</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[var(--danger)]" />
            <span className="text-[var(--foreground-secondary)]">Fraud</span>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="gradientTxns" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00c895" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#00c895" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradientFraud" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a3441" vertical={false} />
          <XAxis
            dataKey="time"
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
          />
          <Area
            type="monotone"
            dataKey="txns"
            stroke="#00c895"
            strokeWidth={2}
            fill="url(#gradientTxns)"
            name="Transactions"
          />
          <Area
            type="monotone"
            dataKey="fraud"
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#gradientFraud)"
            name="Fraud"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
