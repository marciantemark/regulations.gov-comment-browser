import React from 'react';
import type { ThemeAnalysisRaw } from '../database/queries';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

export interface ThemeNarrativeProps {
  narrative: ThemeAnalysisRaw;
  perspectiveInfo?: Record<number, { abstractionId: number; title: string }>;
}

const Pill: React.FC<{label:string; color?:string}> = ({label, color='gray'}) => (
  <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium border',
    color==='indigo' ? 'bg-indigo-100 border-indigo-300 text-indigo-800' :
    color==='red' ? 'bg-red-100 border-red-300 text-red-800' :
    'bg-gray-100 border-gray-300 text-gray-800'
  )}>{label}</span>
);

interface RelationCardProps {type:'aligned'|'opposing'; groups:string[]}
const RelationCard: React.FC<RelationCardProps> = ({type, groups}) => {
  const isAligned = type==='aligned';
  const bg = isAligned ? 'bg-indigo-50' : 'bg-red-50';
  const border = isAligned ? 'border-indigo-400' : 'border-red-400';
  const text = isAligned ? 'text-indigo-700' : 'text-red-700';
  const label = isAligned ? 'with' : 'vs';
  return (
    <div className="relative inline-block mr-2 mb-2 max-w-full">
      <span className={clsx('absolute -top-2 left-3 px-1 text-[10px] uppercase tracking-wide rounded-sm', bg, border, text)}>
        {label}
      </span>
      <div className={clsx('border-2 rounded-lg px-3 py-2', bg, border)}>
        <ul className="list-disc list-inside space-y-1 text-sm break-words">
          {groups.map((g,i)=>(<li key={i} className={clsx(text)}>{g}</li>))}
        </ul>
      </div>
    </div>
  );
};

const ThemeNarrative: React.FC<ThemeNarrativeProps> = ({ narrative, perspectiveInfo }) => {
  if (!narrative || !narrative.narrative_summary) return null;

  return (
    <section className="card space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Overview</h2>
        {narrative.narrative_summary!.split(/\n\n+/).map((para: string, idx: number) => {
          // replace (ID: 123, 456) with links
          const parts: Array<string|JSX.Element> = [];
          const regex = /\(ID:\s*([0-9,\s]+)\)/g;
          let lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = regex.exec(para))) {
            const start = match.index;
            if (start > lastIndex) parts.push(para.slice(lastIndex, start));
            const ids = match[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
            parts.push(
              <span key={start} className="text-blue-600">
                (
                {ids.map((id, i) => {
                  const info = perspectiveInfo?.[id];
                  const absId = info?.abstractionId;
                  const link = absId ? `/comment/${absId}?p=${id}` : '#';
                  return (
                    <React.Fragment key={id}>
                      <Link to={link} className="underline hover:text-blue-800" title={info?.title ?? ''}>ID:{id}</Link>
                      {i < ids.length -1 && ', '}
                    </React.Fragment>
                  );
                })}
                )
              </span>
            );
            lastIndex = regex.lastIndex;
          }
          if (lastIndex < para.length) parts.push(para.slice(lastIndex));
          return <p key={idx} className="text-gray-800 mb-4 leading-relaxed">{parts}</p>;
        })}
      </div>

      {Array.isArray(narrative.consensus_points) && narrative.consensus_points.length > 0 && (
        <div>
          <h3 className="text-xl font-semibold mb-2">Areas of Agreement</h3>
          <ul className="space-y-2">
            {narrative.consensus_points!.map((pt: any, i: number) => (
              <li key={i} className="bg-green-50 border border-green-200 p-4 rounded">
                <div className="font-medium text-green-800">{pt.statement}</div>
                <div className="text-sm text-green-700">Strength: {pt.strength}</div>
                {pt.example_quote && (
                  <blockquote className="italic text-green-900 mt-1">"{pt.example_quote}"</blockquote>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(narrative.debate_points) && narrative.debate_points.length > 0 && (
        <div>
          <h3 className="text-xl font-semibold mt-4 mb-2">Main Debates</h3>
          <ul className="space-y-4">
            {narrative.debate_points!.map((deb: any, i: number) => (
              <li key={i} className="border-l-4 border-blue-400 pl-4">
                <div className="font-medium text-gray-900 mb-1">{deb.topic}</div>
                {deb.core_tension && <div className="text-sm text-gray-700 mb-1">Core tension: {deb.core_tension}</div>}
                <ul className="list-disc ml-5 text-gray-800">
                  {deb.positions.map((pos: any, j: number) => (
                    <li key={j} className="mb-1">
                      <span className="font-medium">{pos.stance}</span> — {pos.reasoning}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stakeholder dynamics */}
      {narrative.stakeholder_dynamics && (
        <div>
          <h3 className="text-xl font-semibold mt-4 mb-2">Stakeholder Dynamics</h3>
          <div className="grid md:grid-cols-3 gap-4 text-sm text-gray-800">
            {Array.isArray((narrative.stakeholder_dynamics as any).aligned_groups) && (
              <div className="bg-indigo-50 border border-indigo-200 p-4 rounded">
                <div className="font-medium text-indigo-800 mb-1">Aligned Groups</div>
                <ul className="list-disc ml-4">
                  {(narrative.stakeholder_dynamics as any).aligned_groups.map((grp: any, idx: number) => (
                    <RelationCard key={idx} type="aligned" groups={grp} />
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray((narrative.stakeholder_dynamics as any).opposing_groups) && (
              <div className="bg-red-50 border border-red-200 p-4 rounded">
                <div className="font-medium text-red-800 mb-1">Opposing Groups</div>
                <ul className="list-disc ml-4">
                  {(narrative.stakeholder_dynamics as any).opposing_groups.map((grp: any, idx: number) => (
                    <RelationCard key={idx} type="opposing" groups={grp} />
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray((narrative.stakeholder_dynamics as any).bridge_builders) && (
              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded">
                <div className="font-medium text-yellow-800 mb-1">Bridge Builders</div>
                <ul className="list-disc ml-4">
                  {(narrative.stakeholder_dynamics as any).bridge_builders.map((bb: string, idx: number) => (
                    <li key={idx}>{bb}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Supporting stats */}
      {narrative.supporting_stats && (
        <div>
          <h3 className="text-xl font-semibold mt-4 mb-2">Key Numbers</h3>
          <div className="flex flex-wrap gap-6 text-gray-700 text-sm">
            {typeof (narrative.supporting_stats as any).total_perspectives === 'number' && (
              <div><span className="font-semibold text-gray-900">{(narrative.supporting_stats as any).total_perspectives.toLocaleString()}</span> perspectives</div>
            )}
            {typeof (narrative.supporting_stats as any).total_stakeholders === 'number' && (
              <div><span className="font-semibold text-gray-900">{(narrative.supporting_stats as any).total_stakeholders.toLocaleString()}</span> stakeholder types</div>
            )}
            {typeof (narrative.supporting_stats as any).consensus_ratio === 'number' && (
              <div>Consensus ratio: <span className="font-semibold text-gray-900">{((narrative.supporting_stats as any).consensus_ratio * 100).toFixed(0)}%</span></div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default ThemeNarrative; 