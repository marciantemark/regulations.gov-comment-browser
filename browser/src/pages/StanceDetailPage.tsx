import React, { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useDatabase } from '../database/provider';
import { getThemeAnalysis, getThemeByCode, getPerspectivesByTheme, type ThemeAnalysisRaw, type Perspective } from '../database/queries';
import { getCommenterDisplayName } from '../utils/commenterDisplay';
import StancePivotMatrix from '../components/StancePivotMatrix';
import { measure, markStart, markEnd } from '../utils/perf';

const StanceDetailPage: React.FC = () => {
  const { code, stanceKey } = useParams<{ code: string; stanceKey: string }>();
  const { db, loading, error } = useDatabase();
  const [analysis, setAnalysis] = useState<ThemeAnalysisRaw | null>(null);
  const [stance, setStance] = useState<any | null>(null);
  const [perspectives, setPerspectives] = useState<Perspective[]>([]);
  const [mappedPerspectives, setMappedPerspectives] = useState<Perspective[]>([]);
  const [stanceCounts, setStanceCounts] = useState<Record<string, number>>({});
  const [themeTitle, setThemeTitle] = useState<string>('');
  const [searchParams] = useSearchParams();
  const selectedStakeholder = searchParams.get('stakeholder');

  useEffect(() => {
    if (db && code && stanceKey) {
      markStart('stance-detail-total');
      const a = measure('getThemeAnalysis', () => getThemeAnalysis(db, code));
      setAnalysis(a);
      if (a?.stances) {
        const s = (a.stances as any[]).find(st => st.stance_key === stanceKey);
        setStance(s || null);
      }
      const theme = measure('getThemeByCode', () => getThemeByCode(db, code));
      setThemeTitle(theme ? `${theme.code} ${theme.description}` : code);

      const allPersp = measure('getPerspectivesByTheme', () => getPerspectivesByTheme(db, code));
      setPerspectives(allPersp);

      if (a?.perspective_mapping) {
        // count per stance
        const counts: Record<string, number> = {};
        (a.perspective_mapping as any[]).forEach((m: any) => {
          counts[m.stance_key] = (counts[m.stance_key] || 0) + 1;
        });
        setStanceCounts(counts);

        const ids = (a.perspective_mapping as any[])
          .filter((m: any) => m.stance_key === stanceKey)
          .map((m: any) => m.perspective_id);
        let filtered = allPersp.filter(p => ids.includes(p.id));
        if(selectedStakeholder){
          const mainTypesSorted = Object.entries(counts)
            .sort((a,b)=>b[1]-a[1])
            .map(([k])=>k)
            .slice(0,10);

          filtered = filtered.filter(p=>{
            const grp = p.stakeholder_group? p.stakeholder_group : p.submitter_type;
            if(selectedStakeholder==='Other'){
              return !mainTypesSorted.includes(grp);
            } else {
              return grp===selectedStakeholder;
            }
          });
        }
        setMappedPerspectives(filtered);
      }
      markEnd('stance-detail-total');
    }
  }, [db, code, stanceKey, selectedStakeholder]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="spinner"/></div>;
  }
  if (error) {
    return <div className="text-center py-8 text-red-600">Error: {error}</div>;
  }
  if (!analysis || !stance) {
    return <div className="text-center py-8">Stance not found.</div>;
  }

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap">
        <Link to="/" className="hover:text-primary-600">Home</Link>
        <span>/</span>
        <Link to={`/theme/${code}`} className="hover:text-primary-600">{themeTitle}</Link>
        <span>/</span>
        <span className="text-gray-500">Stance</span>
        <span>/</span>
        <span className="text-gray-900 font-medium">{stance.stance_label || stanceKey}</span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">{stance.stance_label || stanceKey}</h1>
        {stance.stance_description && (
          <p className="text-gray-700 text-lg max-w-3xl">{stance.stance_description}</p>
        )}
      </div>

      {/* Typical Arguments & Quote examples */}
      {stance.typical_arguments?.length && (
        <div className="card">
          <h2 className="text-xl font-semibold mb-3">Typical Arguments</h2>
          <ul className="list-disc ml-5 space-y-1 text-gray-700">
            {stance.typical_arguments.map((arg: string, idx: number) => (
              <li key={idx}>{arg}</li>
            ))}
          </ul>
        </div>
      )}

      {stance.example_quotes?.length && (
        <div className="card">
          <h2 className="text-xl font-semibold mb-3">Example Quotes</h2>
          <ul className="space-y-4">
            {stance.example_quotes.map((q: string, idx: number) => (
              <li key={idx} className="italic text-gray-700">"{q}"</li>
            ))}
          </ul>
        </div>
      )}

      {/* Pivot matrix */}
      <StancePivotMatrix highlightStance={stanceKey} themeCode={code!} analysis={analysis} perspectives={perspectives} />

      {/* Perspectives list */}
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Contributing Perspectives <span className="text-lg font-normal text-gray-600">({mappedPerspectives.length})</span></h2>
        {mappedPerspectives.length === 0 ? (
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-12 text-center text-gray-600">No perspectives mapped to this stance.</div>
        ) : (
          <div className="space-y-8">
            {mappedPerspectives.map(p => (
              <Link key={p.id} to={`/comment/${p.abstraction_id}?p=${p.id}`} className="block hover:bg-gray-50 -mx-4 px-4 py-4 rounded-lg transition-colors duration-200">
                <div className="border-l-4 border-primary-400 pl-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">{p.perspective}</h3>
                  {p.excerpt && <p className="text-gray-700 italic mb-2">"{p.excerpt}"</p>}
                  <div className="text-sm text-gray-600 flex flex-wrap items-center gap-2">
                    <span className="font-medium">{getCommenterDisplayName({
                      submitter_type: p.submitter_type,
                      organization_name: p.organization_name,
                      original_metadata: {
                        organization: p.original_organization,
                        firstName: p.original_firstName,
                        lastName: p.original_lastName,
                        category: p.original_category
                      }
                    })}</span>
                    <span>• {p.submitter_type}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default StanceDetailPage; 