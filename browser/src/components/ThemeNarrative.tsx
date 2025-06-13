import React from 'react';
import type { ThemeAnalysisRaw } from '../database/queries';
import { Link } from 'react-router-dom';

export interface ThemeNarrativeProps {
  narrative: ThemeAnalysisRaw;
  perspectiveInfo?: Record<number, { abstractionId: number; title: string }>;
}

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
    </section>
  );
};

export default ThemeNarrative; 