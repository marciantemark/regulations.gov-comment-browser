import React, { useMemo } from 'react';
import type { ThemeAnalysisRaw } from '../database/queries';
import type { Perspective } from '../database/queries';
import { Link } from 'react-router-dom';

interface Props {
  analysis: ThemeAnalysisRaw;
  perspectives: Perspective[];
  themeCode: string;
}

interface StanceCount {
  stance_key: string;
  stance_label: string;
  stance_description?: string;
  total: number;
  byStakeholder: Record<string, number>;
}

const ThemeStanceAlignment: React.FC<Props> = ({ analysis, perspectives, themeCode }) => {
  const stanceSummary = useMemo<StanceCount[]>(() => {
    if (!analysis.stances || !Array.isArray(analysis.stances) || !analysis.perspective_mapping) {
      return [];
    }

    // Map perspective id -> submitter type
    const perspectiveType: Record<number, string> = {};
    for (const p of perspectives) {
      perspectiveType[p.id] = p.submitter_type || 'Other';
    }

    // Initialize summary structure
    const summary: Record<string, StanceCount> = {};
    for (const stance of analysis.stances) {
      summary[stance.stance_key] = {
        stance_key: stance.stance_key,
        stance_label: stance.stance_label ?? stance.stance_key,
        stance_description: stance.stance_description,
        total: 0,
        byStakeholder: {}
      };
    }

    // Count mappings
    for (const map of analysis.perspective_mapping as any[]) {
      const stanceKey = map.stance_key;
      const pId = map.perspective_id;
      const type = perspectiveType[pId] || 'Other';
      if (!summary[stanceKey]) continue;
      summary[stanceKey].total += 1;
      summary[stanceKey].byStakeholder[type] = (summary[stanceKey].byStakeholder[type] || 0) + 1;
    }

    return Object.values(summary).sort((a, b) => b.total - a.total);
  }, [analysis, perspectives]);

  // Total perspectives per stakeholder across all stances (for % calc)
  const stakeholderTotals = useMemo<Record<string, number>>(()=>{
    const totals: Record<string, number> = {};
    if(!analysis.perspective_mapping) return totals;
    for(const map of analysis.perspective_mapping as any[]){
      const p = perspectives.find(pp=>pp.id===map.perspective_id);
      if(!p) continue;
      const stake = p.stakeholder_group? p.stakeholder_group : p.submitter_type;
      totals[stake] = (totals[stake]||0)+1;
    }
    return totals;
  }, [analysis, perspectives]);

  if (!stanceSummary.length) {
    return null;
  }

  return (
    <div className="card">
      <h2 className="text-xl font-semibold mb-6">Stances & Alignment</h2>
      <div className="space-y-8">
        {stanceSummary.map((s) => (
          <Link
            key={s.stance_key}
            to={`/theme/${themeCode}/stance/${s.stance_key}`}
            className="block border-l-4 border-primary-200 pl-4 hover:bg-gray-50 rounded-lg -mx-2 px-2 py-4 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-900">
                {s.stance_label}
                <span className="text-sm text-gray-500"> ({s.total} perspectives)</span>
              </h3>
              <span className="inline-flex items-center gap-1 text-primary-600">
                View stance
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
            {s.stance_description && (
              <p className="text-gray-700 mb-3">{s.stance_description}</p>
            )}
            {/* Stakeholder summary line */}
            {(()=>{
              const percents = Object.entries(s.byStakeholder).map(([stake,count])=>{
                const pct = stakeholderTotals[stake]? (count*100/stakeholderTotals[stake]) : 0;
                return {stake, pct};
              }).filter(v=>v.pct>0);
              if(percents.length===0) return null;
              percents.sort((a,b)=>b.pct-a.pct);
              const top = percents.slice(0,2);
              const bottom = percents.slice(-2).reverse();
              return (
                <p className="text-sm text-gray-700 mt-2">
                  <span className="font-medium">Highest share:</span> {top.map(t=>`${t.stake} (${t.pct.toFixed(0)}%)`).join(', ')}
                  {bottom.length>0 && (
                    <>
                      {' • '}<span className="font-medium">Lowest:</span> {bottom.map(t=>`${t.stake} (${t.pct.toFixed(0)}%)`).join(', ')}
                    </>
                  )}
                </p>
              );
            })()}
            {/* Typical arguments if provided */}
            {analysis.stances && Array.isArray(analysis.stances) && (
              analysis.stances.find((st: any) => st.stance_key === s.stance_key)?.typical_arguments?.length ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-primary-600">Typical arguments</summary>
                  <ul className="list-disc ml-5 mt-1 text-gray-700 space-y-1">
                    {analysis.stances.find((st: any) => st.stance_key === s.stance_key).typical_arguments.map((arg: string, idx: number) => (
                      <li key={idx}>{arg}</li>
                    ))}
                  </ul>
                </details>
              ) : null
            )}
          </Link>
        ))}
      </div>
    </div>
  );
};

export default ThemeStanceAlignment; 