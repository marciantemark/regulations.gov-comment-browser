import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Theme } from '../database/queries';
import clsx from 'clsx';

interface ThemeBrowserProps {
  themes: Theme[];
}

const ThemeBrowser: React.FC<ThemeBrowserProps> = ({ themes }) => {
  // Start with all themes expanded
  const getAllThemeCodes = (themes: Theme[]): Set<string> => {
    return new Set(themes.map(t => t.code));
  };
  
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set());

  // Update expanded themes when themes prop changes
  useEffect(() => {
    setExpandedThemes(getAllThemeCodes(themes));
  }, [themes]);

  // Build theme tree structure
  const rootThemes = themes.filter(t => t.level === 1);
  const themesByParent = themes.reduce((acc, theme) => {
    if (theme.parent_code) {
      if (!acc[theme.parent_code]) {
        acc[theme.parent_code] = [];
      }
      acc[theme.parent_code].push(theme);
    }
    return acc;
  }, {} as Record<string, Theme[]>);

  const toggleExpanded = (code: string) => {
    setExpandedThemes(prev => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const renderTheme = (theme: Theme, depth: number = 0) => {
    const hasChildren = themesByParent[theme.code]?.length > 0;
    const isExpanded = expandedThemes.has(theme.code);

    return (
      <div key={theme.code} className={clsx('animate-fade-in', depth > 0 && 'ml-6')}>
        <div className="flex items-center py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2 group">
          {hasChildren && (
            <button
              onClick={() => toggleExpanded(theme.code)}
              className="mr-2 p-1 hover:bg-gray-200 rounded transition-colors"
            >
              <svg
                className={clsx(
                  'w-4 h-4 text-gray-600 transition-transform',
                  isExpanded && 'rotate-90'
                )}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          {!hasChildren && <div className="w-7" />}
          
          <Link
            to={`/theme/${theme.code}`}
            className="flex-1 flex items-center justify-between group"
          >
            <div className="flex-1">
              <span className="font-medium text-gray-900 group-hover:text-primary-600 transition-colors">
                {theme.code} {theme.description}
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500">
                {theme.perspective_count} perspectives
              </span>
              <span className="text-gray-400">
                {theme.document_count} docs
              </span>
            </div>
          </Link>
        </div>
        
        {hasChildren && isExpanded && (
          <div className="mt-1">
            {themesByParent[theme.code].map(child => renderTheme(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-1">
      {rootThemes.map(theme => renderTheme(theme))}
    </div>
  );
};

export default ThemeBrowser;
