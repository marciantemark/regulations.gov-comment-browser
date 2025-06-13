import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDatabase } from '../database/provider';
import { getDatabaseStats, getThemeHierarchy } from '../database/queries';
import type { DatabaseStats, Theme } from '../database/queries';
import StatsCard from '../components/StatsCard.js';
import ThemeBrowser from '../components/ThemeBrowser.js';

const HomePage: React.FC = () => {
  const { db, loading, error } = useDatabase();
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [expandedMentions, setExpandedMentions] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (db) {
      try {
        const dbStats = getDatabaseStats(db);
        setStats(dbStats);
        
        const themeHierarchy = getThemeHierarchy(db);
        setThemes(themeHierarchy);
      } catch (err) {
        console.error('Error fetching data:', err);
      }
    }
  }, [db]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner"></div>
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

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Public Comment Analysis</h1>
        <p className="text-gray-600 mt-2">
          Explore themes and perspectives from regulations.gov comments
        </p>
      </div>

      {/* Statistics Overview */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatsCard
            title="Total Comments"
            value={stats.totalComments.toLocaleString()}
            icon="📄"
          />
          <StatsCard
            title="Perspectives"
            value={stats.totalPerspectives.toLocaleString()}
            icon="💭"
          />
          <StatsCard
            title="Themes"
            value={stats.totalThemes.toLocaleString()}
            icon="🏷️"
          />
        </div>
      )}

      {/* All Mentions including Submitter Type */}
      {stats && Object.keys(stats.attributeBreakdowns).length > 0 && (
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Mentions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Object.entries(stats.attributeBreakdowns).map(([mentionType, values]) => {
              const isExpanded = expandedMentions.has(mentionType);
              const displayValues = isExpanded ? values : values.slice(0, 5);
              
              return (
                <div key={mentionType} className="card">
                  <h3 className="text-xl font-semibold mb-4 capitalize">
                    {mentionType.replace(/_/g, ' ')}
                  </h3>
                  <div className="space-y-3">
                    {displayValues.map((item) => (
                      <Link
                        key={item.value}
                        to={`/mention/${mentionType}/${encodeURIComponent(item.value)}`}
                        className="flex items-center justify-between hover:bg-gray-50 rounded-lg p-2 -mx-2 transition-colors"
                      >
                        <span className="text-gray-700 text-sm hover:text-primary-600">
                          {item.value}
                        </span>
                        <div className="flex items-center gap-3">
                          <div className="w-24 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-primary-500 h-2 rounded-full"
                              style={{
                                width: `${(item.count / stats.totalComments) * 100}%`
                              }}
                            />
                          </div>
                          <span className="text-sm text-gray-600 w-12 text-right">
                            {item.count}
                          </span>
                        </div>
                      </Link>
                    ))}
                    {values.length > 5 && (
                      <button
                        onClick={() => {
                          setExpandedMentions(prev => {
                            const next = new Set(prev);
                            if (next.has(mentionType)) {
                              next.delete(mentionType);
                            } else {
                              next.add(mentionType);
                            }
                            return next;
                          });
                        }}
                        className="text-sm text-primary-600 hover:text-primary-700 mt-2 font-medium"
                      >
                        {isExpanded ? 'Show less' : `+${values.length - 5} more`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Theme Browser */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Theme Hierarchy</h2>
        <ThemeBrowser themes={themes} />
      </div>
    </div>
  );
};

export default HomePage;
