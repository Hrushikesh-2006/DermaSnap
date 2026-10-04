import React, { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Activity,
  BarChart3,
  Calendar,
  CheckCircle2,
  Flame,
  LineChart as LineChartIcon,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface SymptomTrendsProps {
  messages: ChatMessage[];
  isOpen: boolean;
  onClose: () => void;
}

interface TurnData {
  turn: string;
  label: string;
  time: string;
  itching: number;
  pain: number;
  heat: number;
  swelling: number;
  redness: number;
}

export function SymptomTrendsChart({ messages, isOpen, onClose }: SymptomTrendsProps) {
  const [chartType, setChartType] = useState<'trend' | 'frequency'>('trend');

  // Extract symptom severities across conversation turns
  const { trendData, frequencyData, totalMentions, dominantSymptom, peakSeverity } = useMemo(() => {
    // Filter relevant messages (exclude welcome message)
    const activeMessages = messages.filter((m) => m.id !== 'welcome' && m.content);

    // If no active messages, build sample baseline so user sees the capabilities
    if (activeMessages.length === 0) {
      const sampleTrends: TurnData[] = [
        { turn: 'T1', label: 'Initial Concern', time: '10:00 AM', itching: 2, pain: 1, heat: 1, swelling: 2, redness: 2 },
        { turn: 'T2', label: 'Care Applied', time: '10:15 AM', itching: 3, pain: 2, heat: 2, swelling: 2, redness: 2 },
        { turn: 'T3', label: 'Follow-up', time: '10:30 AM', itching: 1, pain: 1, heat: 1, swelling: 1, redness: 1 },
      ];

      const sampleFreq = [
        { symptom: 'Itching', count: 4, severity: 'High', fill: '#0d9488' },
        { symptom: 'Redness', count: 3, severity: 'Moderate', fill: '#f43f5e' },
        { symptom: 'Swelling', count: 3, severity: 'Moderate', fill: '#eab308' },
        { symptom: 'Heat', count: 2, severity: 'Moderate', fill: '#f97316' },
        { symptom: 'Pain', count: 1, severity: 'Mild', fill: '#8b5cf6' },
      ];

      return {
        trendData: sampleTrends,
        frequencyData: sampleFreq,
        totalMentions: 13,
        dominantSymptom: 'Itching (Pruritus)',
        peakSeverity: 'Severe (Level 3)',
      };
    }

    // Process user turns and assistant assessments
    let itchingCount = 0;
    let painCount = 0;
    let heatCount = 0;
    let swellingCount = 0;
    let rednessCount = 0;

    const data: TurnData[] = [];

    activeMessages.forEach((msg, idx) => {
      const text = msg.content.toLowerCase();
      const roleLabel = msg.role === 'user' ? 'Patient' : 'DermaSnap';

      // Evaluate itching severity (0-3)
      let itching = 0;
      if (text.includes('severe itch') || text.includes('intense itch') || text.includes('scratching')) {
        itching = 3;
        itchingCount += 2;
      } else if (text.includes('itch') || text.includes('pruritus')) {
        itching = 2;
        itchingCount += 1;
      }

      // Evaluate pain severity (0-3)
      let pain = 0;
      if (text.includes('severe pain') || text.includes('throbbing') || text.includes('sharp pain')) {
        pain = 3;
        painCount += 2;
      } else if (text.includes('pain') || text.includes('hurts') || text.includes('tender') || text.includes('sore')) {
        pain = 2;
        painCount += 1;
      }

      // Evaluate heat / warmth severity (0-3)
      let heat = 0;
      if (text.includes('burning') || text.includes('very hot') || text.includes('fever')) {
        heat = 3;
        heatCount += 2;
      } else if (text.includes('heat') || text.includes('warm') || text.includes('warmth')) {
        heat = 2;
        heatCount += 1;
      }

      // Evaluate swelling severity (0-3)
      let swelling = 0;
      if (text.includes('severe swell') || text.includes('large welt') || text.includes('puffy')) {
        swelling = 3;
        swellingCount += 2;
      } else if (text.includes('swell') || text.includes('swollen') || text.includes('bump') || text.includes('raised')) {
        swelling = 2;
        swellingCount += 1;
      }

      // Evaluate redness / erythema (0-3)
      let redness = 0;
      if (text.includes('deep red') || text.includes('purple') || text.includes('spreading red')) {
        redness = 3;
        rednessCount += 2;
      } else if (text.includes('red') || text.includes('rash') || text.includes('erythema')) {
        redness = 2;
        rednessCount += 1;
      }

      data.push({
        turn: `T${idx + 1}`,
        label: `${roleLabel} (Turn ${idx + 1})`,
        time: msg.timestamp || `Turn ${idx + 1}`,
        itching,
        pain,
        heat,
        swelling,
        redness,
      });
    });

    // Ensure at least two points for smooth curves if only 1 turn exists
    if (data.length === 1) {
      data.unshift({
        turn: 'T0',
        label: 'Baseline Prior',
        time: 'Baseline',
        itching: Math.max(0, data[0].itching - 1),
        pain: Math.max(0, data[0].pain - 1),
        heat: Math.max(0, data[0].heat - 1),
        swelling: Math.max(0, data[0].swelling - 1),
        redness: Math.max(0, data[0].redness - 1),
      });
    }

    const freq = [
      { symptom: 'Itching', count: Math.max(1, itchingCount), fill: '#0d9488' },
      { symptom: 'Redness', count: Math.max(1, rednessCount), fill: '#f43f5e' },
      { symptom: 'Pain', count: Math.max(1, painCount), fill: '#8b5cf6' },
      { symptom: 'Heat / Warmth', count: Math.max(1, heatCount), fill: '#f97316' },
      { symptom: 'Swelling', count: Math.max(1, swellingCount), fill: '#eab308' },
    ].sort((a, b) => b.count - a.count);

    const dominant = freq[0]?.symptom || 'Itching';
    const total = itchingCount + painCount + heatCount + swellingCount + rednessCount;

    return {
      trendData: data,
      frequencyData: freq,
      totalMentions: Math.max(total, 3),
      dominantSymptom: dominant,
      peakSeverity: 'Moderate (Level 2)',
    };
  }, [messages]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-sm shadow-teal-200">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Symptom Trends & Frequency</h3>
              <p className="text-xs text-slate-500">
                Visualizing clinical symptom markers across chat history
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View toggles */}
            <div className="bg-slate-100 p-0.5 rounded-lg flex items-center text-xs font-medium">
              <button
                type="button"
                onClick={() => setChartType('trend')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  chartType === 'trend'
                    ? 'bg-white text-teal-700 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Severity Progression
              </button>
              <button
                type="button"
                onClick={() => setChartType('frequency')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  chartType === 'frequency'
                    ? 'bg-white text-teal-700 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Symptom Frequency
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="py-4 flex-1 overflow-y-auto space-y-4">
          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-teal-50/70 border border-teal-100 rounded-xl p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700 block">
                Dominant Symptom
              </span>
              <span className="text-sm font-bold text-slate-900 mt-0.5 block truncate">
                {dominantSymptom}
              </span>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Total Markers Tracked
              </span>
              <span className="text-sm font-bold text-slate-900 mt-0.5 block">
                {totalMentions} observations
              </span>
            </div>

            <div className="bg-amber-50/70 border border-amber-100 rounded-xl p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block">
                Severity Score Range
              </span>
              <span className="text-sm font-bold text-slate-900 mt-0.5 block">
                0 (None) to 3 (Severe)
              </span>
            </div>
          </div>

          {/* Chart Section */}
          <div className="bg-slate-50/60 border border-slate-200/80 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                {chartType === 'trend' ? (
                  <>
                    <LineChartIcon className="w-4 h-4 text-teal-600" />
                    <span>Severity Trends (Turn by Turn)</span>
                  </>
                ) : (
                  <>
                    <BarChart3 className="w-4 h-4 text-teal-600" />
                    <span>Total Mentions & Prevalence by Symptom</span>
                  </>
                )}
              </h4>
              <span className="text-[11px] text-slate-500">
                {chartType === 'trend' ? 'Scores: 0 (None) • 1 (Mild) • 2 (Moderate) • 3 (Severe)' : 'Aggregated from consultation history'}
              </span>
            </div>

            <div className="w-full h-64">
              {chartType === 'trend' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorItching" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0d9488" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#0d9488" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="colorPain" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="colorHeat" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="colorSwelling" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#eab308" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="colorRedness" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="turn" stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <YAxis domain={[0, 3]} ticks={[0, 1, 2, 3]} stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#e2e8f0',
                        borderRadius: '0.75rem',
                        fontSize: '12px',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      }}
                      labelFormatter={(label, payload) => {
                        const item = payload?.[0]?.payload;
                        return item ? `${item.label} (${item.time})` : label;
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                    <Area
                      type="monotone"
                      dataKey="itching"
                      name="Itching"
                      stroke="#0d9488"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#colorItching)"
                    />
                    <Area
                      type="monotone"
                      dataKey="pain"
                      name="Pain"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorPain)"
                    />
                    <Area
                      type="monotone"
                      dataKey="heat"
                      name="Heat / Warmth"
                      stroke="#f97316"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorHeat)"
                    />
                    <Area
                      type="monotone"
                      dataKey="swelling"
                      name="Swelling"
                      stroke="#eab308"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorSwelling)"
                    />
                    <Area
                      type="monotone"
                      dataKey="redness"
                      name="Redness"
                      stroke="#f43f5e"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorRedness)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={frequencyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="symptom" stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <YAxis allowDecimals={false} stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#e2e8f0',
                        borderRadius: '0.75rem',
                        fontSize: '12px',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      }}
                      formatter={(val: number) => [`${val} mentions`, 'Frequency']}
                    />
                    <Bar dataKey="count" name="Frequency Mentions" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            💡 <strong>Clinical interpretation:</strong> Tracking symptom evolution over turns helps your dermatologist assess whether topical soothing measures and medication regimens are successfully reducing inflammation.
          </p>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold cursor-pointer"
          >
            Close Chart
          </button>
        </div>
      </div>
    </div>
  );
}
