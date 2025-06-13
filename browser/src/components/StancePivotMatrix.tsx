import React, { useMemo } from 'react';
import type { Perspective, ThemeAnalysisRaw } from '../database/queries';
import { Link } from 'react-router-dom';
import { measure } from '../utils/perf';

interface Props {
  analysis: ThemeAnalysisRaw;
  perspectives: Perspective[];
  themeCode: string;
  highlightStance?: string;
}

interface CellData {
  count: number;
  percent: number; // percent of stakeholder perspectives adopting the stance
}

const colors = [
  'bg-gray-100', // 0%
  'bg-blue-50',  // up to 20%
  'bg-blue-100', // up to 40%
  'bg-blue-200', // up to 60%
  'bg-blue-300', // up to 80%
  'bg-blue-400'  // up to 100%
];

function colorClass(percent: number) {
  if (percent === 0) return colors[0];
  if (percent < 20) return colors[1];
  if (percent < 40) return colors[2];
  if (percent < 60) return colors[3];
  if (percent < 80) return colors[4];
  return colors[5];
}

const StancePivotMatrix: React.FC<Props> = ({ analysis, perspectives, themeCode, highlightStance }) => {
  const labelMap: Record<string, string> = {};
  if (analysis.stances) {
    (analysis.stances as any[]).forEach((s: any) => {
      labelMap[s.stance_key] = s.stance_label || s.stance_key;
    });
  }

  const { stanceKeys, stakeholderTypes, matrix } = useMemo(() => measure('StancePivotMatrix build', () => {
    if (!analysis.perspective_mapping || !analysis.stances) return {stanceKeys:[], stakeholderTypes:[], matrix:{}};
    const stanceKeys = (analysis.stances as any[]).map((s:any)=>s.stance_key);

    // aggregate stakeholder counts
    const totalByType: Record<string, number> = {};
    perspectives.forEach(p=>{
      const t=(p.stakeholder_group? p.stakeholder_group : p.submitter_type)||'Other';
      totalByType[t]=(totalByType[t]||0)+1;
    });

    // sort types by total perspectives desc
    const sortedTypes = Object.keys(totalByType).sort((a,b)=> (totalByType[b]-totalByType[a]));
    const MAX_TYPES = 10;
    const mainTypes = sortedTypes.slice(0, MAX_TYPES);
    const stakeholderTypes = [...mainTypes];
    const hasOther = sortedTypes.length>MAX_TYPES;
    if(hasOther) stakeholderTypes.push('Other');

    // count per stakeholder & stance
    const counts: Record<string, Record<string, number>> = {};
    stakeholderTypes.forEach(t=>{counts[t]={}; stanceKeys.forEach(sk=>counts[t][sk]=0);});
    const byStakeholderTotal: Record<string, number> = {};

    (analysis.perspective_mapping as any[]).forEach((m:any)=>{
      const p = perspectives.find(pp=>pp.id===m.perspective_id);
      if(!p) return;
      let st = (p.stakeholder_group? p.stakeholder_group : p.submitter_type)||'Other';
      if(!mainTypes.includes(st)) st='Other';
      counts[st][m.stance_key] +=1;
      byStakeholderTotal[st]=(byStakeholderTotal[st]||0)+1;
    });

    // convert to percent matrix
    const matrix: Record<string, Record<string, CellData>> = {};
    stakeholderTypes.forEach(st=>{
      matrix[st]={};
      stanceKeys.forEach(sk=>{
        const count = counts[st][sk];
        const total = byStakeholderTotal[st] || 1;
        matrix[st][sk]={count, percent: Math.round((count*100)/total)};
      });
    });

    return {stanceKeys, stakeholderTypes, matrix};
  }), [analysis, perspectives]);

  if (stanceKeys.length===0) return null;

  return (
    <div className="card overflow-x-auto">
      <h2 className="text-xl font-semibold mb-4">Stakeholder × Stance Matrix</h2>
      <table className="w-full table-fixed text-sm border-collapse">
        <thead>
          <tr>
            <th className="border-b p-2 text-left">Stakeholder</th>
            {stanceKeys.map(sk=>(
              <th key={sk} className="border-b p-2 text-center align-top max-w-xs">
                <Link to={`/theme/${themeCode}/stance/${sk}`} className={`inline-block break-words whitespace-normal px-2 py-0.5 rounded text-sm hover:underline ${sk===highlightStance? 'text-primary-700 font-semibold':'text-gray-800'}`}>{labelMap[sk]}</Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stakeholderTypes.map(st=> (
            <tr key={st}>
              <td className="border-b p-2 font-medium whitespace-nowrap">
                {st}
                <div className="text-xs text-gray-500">{(matrix[st]&&Object.values(matrix[st])[0]? (Object.values(matrix[st]) as any[]).reduce((a,b)=>a+ (b as any).count,0):0)} total</div>
              </td>
              {stanceKeys.map(sk=>{
                const cell = matrix[st][sk];
                const cls = colorClass(cell.percent);
                return (
                  <td key={sk} className={`border-b p-2 text-center ${cls}`}
                      title={`${cell.count} perspectives (${cell.percent}%)`}>
                    <Link to={`/theme/${themeCode}/stance/${sk}?stakeholder=${encodeURIComponent(st)}`}
                          className="block focus:outline-none focus:ring-2 focus:ring-primary-400">
                      <span className="font-semibold underline-offset-2 hover:underline">{cell.percent}%</span><br/>
                      <span className="text-xs text-gray-600">{cell.count}</span>
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-500 mt-2">Cell shows % of that stakeholder's perspectives in each stance (count below). Shading reinforces value but text carries meaning for accessibility.</p>
    </div>
  );
};

export default StancePivotMatrix; 