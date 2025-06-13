import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDatabase } from '../database/provider';
import { getThemeByCode, getPerspectivesByTheme, getChildThemes, getThemeAncestry, getThemeAnalysis, type ThemeAnalysisRaw } from '../database/queries';
import type { Theme, Perspective } from '../database/queries';
import { getCommenterDisplayName } from '../utils/commenterDisplay';
import ThemeNarrativeComponent from '../components/ThemeNarrative';
import ThemeStanceAlignment from '../components/ThemeStanceAlignment';
import { measure, markStart, markEnd } from '../utils/perf';

const ThemeDetailPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const { db, loading, error } = useDatabase();
  const [theme, setTheme] = useState<Theme | null>(null);
  const [perspectives, setPerspectives] = useState<Perspective[]>([]);
  const [childThemes, setChildThemes] = useState<Theme[]>([]);
  const [ancestry, setAncestry] = useState<Theme[]>([]);
  const [analysis, setAnalysis] = useState<ThemeAnalysisRaw | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (db && code) {
      markStart('theme-detail-total');
      setDataLoading(true);
      try {
        // Individual query timing
        const themeData = measure('getThemeByCode', () => getThemeByCode(db, code));
        setTheme(themeData);

        const children = measure('getChildThemes', () => getChildThemes(db, code));
        setChildThemes(children);

        const themeAncestry = measure('getThemeAncestry', () => getThemeAncestry(db, code));
        setAncestry(themeAncestry);

        const analysisData = measure('getThemeAnalysis', () => getThemeAnalysis(db, code));
        setAnalysis(analysisData);

        const persp = measure('getPerspectivesByTheme', () => getPerspectivesByTheme(db, code));
        setPerspectives(persp);
      } catch (err) {
        console.error('Error fetching theme data:', err);
      }
      setDataLoading(false);
      markEnd('theme-detail-total');
    }
  }, [db, code]);

  if (dataLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-600 font-semibold">Error loading database</div>
        <div className="text-gray-600 mt-2">{error}</div>
      </div>
    );
  }

  if (!theme && !dataLoading) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-600">Theme not found</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap">
        <Link to="/" className="hover:text-primary-600">Home</Link>
        {ancestry.map((ancestorTheme, index) => (
          <React.Fragment key={ancestorTheme.code}>
            <span>/</span>
            {index === ancestry.length - 1 ? (
              <span className="text-gray-900 font-medium">
                {ancestorTheme.code} {ancestorTheme.description}
              </span>
            ) : (
              <Link 
                to={`/theme/${ancestorTheme.code}`} 
                className="hover:text-primary-600"
              >
                {ancestorTheme.code} {ancestorTheme.description}
              </Link>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Theme Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          {theme?.code} {theme?.description}
        </h1>
        <div className="flex items-center gap-6 mt-3 text-gray-600">
          <span>{theme?.perspective_count} perspectives</span>
          <span>{theme?.document_count} documents</span>
          <span>Level {theme?.level}</span>
        </div>
      </div>

      {/* Narrative Overview */}
      {analysis && (
        <ThemeNarrativeComponent narrative={analysis} perspectiveInfo={Object.fromEntries(perspectives.map(p=>[p.id,{abstractionId:p.abstraction_id,title:p.perspective}]))} />
      )}

      {/* Stances & Alignment */}
      {analysis && (
        <ThemeStanceAlignment themeCode={theme?.code ?? code!} analysis={analysis} perspectives={perspectives} />
      )}

      {/* Additional visualizations removed for clarity */}

      {/* Child Themes */}
      {childThemes.length > 0 && (
        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Sub-themes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {childThemes.map(child => (
              <Link
                key={child.code}
                to={`/theme/${child.code}`}
                className="p-4 border border-gray-200 rounded-lg hover:border-primary-300 hover:bg-primary-50 transition-all"
              >
                <div className="font-medium text-gray-900">
                  {child.code} {child.description}
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  {child.perspective_count} perspectives
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Perspectives */}
      {!dataLoading && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">
              Perspectives <span className="text-lg font-normal text-gray-600">({perspectives.length})</span>
            </h2>
          </div>
          
          {(!dataLoading && perspectives.length === 0) ? (
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-12 text-center">
              <div className="text-gray-500">
                <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-lg">No perspectives found for this theme</p>
                <p className="text-sm mt-2">Comments may not have addressed this specific topic</p>
              </div>
            </div>
          ) : (
            <div className="space-y-12">
              {perspectives.map((perspective, index) => (
                <Link 
                  key={perspective.id} 
                  to={`/comment/${perspective.abstraction_id}`}
                  className="block hover:bg-gray-50 -mx-4 px-4 py-6 rounded-lg transition-colors duration-200 group"
                >
                  <div className="border-l-4 border-blue-400 pl-4">
                    {/* Perspective Title */}
                    <h3 className="text-xl font-semibold text-gray-900 group-hover:text-blue-600 transition-colors mb-4 leading-tight">
                      {perspective.perspective}
                    </h3>
                    
                    {/* Excerpt */}
                    {perspective.excerpt && (
                      <div className="ml-2 mb-6">
                        <p className="text-gray-700 italic leading-relaxed">
                          "{perspective.excerpt}"
                        </p>
                      </div>
                    )}
                    
                    {/* Metadata */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600 mt-6">
                      {/* Commenter info */}
                      <div className="flex items-center gap-1.5">
                        <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span className="font-medium text-gray-700">
                          {getCommenterDisplayName({
                            submitter_type: perspective.submitter_type,
                            organization_name: perspective.organization_name,
                            original_metadata: {
                              organization: perspective.original_organization,
                              firstName: perspective.original_firstName,
                              lastName: perspective.original_lastName,
                              category: perspective.original_category
                            }
                          })}
                        </span>
                        <span className="text-gray-400">•</span>
                        <span className="text-gray-600">
                          {perspective.submitter_type}
                          {perspective.original_category && (
                            <span className="text-xs ml-1 text-gray-500">
                              ({perspective.original_category})
                            </span>
                          )}
                        </span>
                      </div>
                      
                      {/* Sentiment */}
                      {perspective.sentiment && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          perspective.sentiment === 'supportive' 
                            ? 'bg-green-100 text-green-700'
                            : perspective.sentiment === 'critical'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {perspective.sentiment}
                        </span>
                      )}
                      
                      {/* Word count omitted for performance */}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ThemeDetailPage;
