import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useDatabase } from '../database/provider';
import { getCommenterDisplayName } from '../utils/commenterDisplay';

interface Perspective {
  perspective: string;
  excerpt: string;
  taxonomy_code: string;
  theme_description: string;
}

interface Comment {
  id: number;
  document_id: string;
  submitter_type: string;
  organization_name: string | null;
  perspectives: Perspective[];
  perspective_count: number;
  themes: string[];
  word_count: number;
  original_metadata?: {
    category?: string;
    organization?: string;
    firstName?: string;
    lastName?: string;
  };
}

const MentionFilterPage: React.FC = () => {
  const { mentionType, mentionValue } = useParams<{ mentionType: string; mentionValue: string }>();
  const { db } = useDatabase();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (db && mentionType && mentionValue) {
      setLoading(true);
      try {
        // Filter comments that match the mention
        const matchingComments: Comment[] = [];
        const decodedValue = decodeURIComponent(mentionValue);

        if (mentionType === 'submitter_type') {
          // Handle submitter_type as a direct column
          const result = db.exec(`
            SELECT 
              a.id,
              a.filename,
              a.submitter_type,
              a.organization_name,
              CASE 
                WHEN a.content IS NOT NULL 
                THEN (LENGTH(a.content) - LENGTH(REPLACE(a.content, ' ', '')) + 1)
                ELSE 0 
              END as word_count,
              a.original_metadata_json
            FROM abstractions a
            WHERE a.submitter_type = ?
          `, [decodedValue]);

          if (result && result[0]) {
            result[0].values.forEach(row => {
                const abstractionId = row[0];
                
                // Get perspectives for this comment
                const perspectivesResult = db.exec(`
                  SELECT 
                    p.perspective,
                    p.excerpt,
                    p.taxonomy_code,
                    t.description
                  FROM perspectives p
                  JOIN taxonomy_ref t ON p.taxonomy_code = t.code
                  WHERE p.abstraction_id = ?
                `, [abstractionId]);

                const perspectives = perspectivesResult && perspectivesResult[0] 
                  ? perspectivesResult[0].values.map(pRow => ({
                      perspective: pRow[0] as string,
                      excerpt: pRow[1] as string,
                      taxonomy_code: pRow[2] as string,
                      theme_description: pRow[3] as string
                    }))
                  : [];

                // Get unique themes
                const themes = [...new Set(perspectives.map(p => p.taxonomy_code))];

                const originalMetadata = row[5] ? JSON.parse(row[5] as string) : {};
                
                matchingComments.push({
                  id: Number(abstractionId),
                  document_id: row[1] as string,
                  submitter_type: row[2] as string,
                  organization_name: row[3] as string | null,
                  perspectives: perspectives.slice(0, 3), // Show first 3
                  perspective_count: perspectives.length,
                  themes,
                  word_count: Number(row[4]),
                  original_metadata: originalMetadata
                });
            });
          }
        } else {
          // Handle other mentions from attributes_json
          const result = db.exec(`
            SELECT 
              a.id,
              a.filename,
              a.submitter_type,
              a.organization_name,
              a.attributes_json,
              CASE 
                WHEN a.content IS NOT NULL 
                THEN (LENGTH(a.content) - LENGTH(REPLACE(a.content, ' ', '')) + 1)
                ELSE 0 
              END as word_count,
              a.original_metadata_json
            FROM abstractions a
            WHERE a.attributes_json IS NOT NULL
          `);

          if (result && result[0]) {
            result[0].values.forEach(row => {
              try {
                const attributes = JSON.parse(row[4] as string);
                const attrValue = attributes[mentionType];
                
                // Check if the mention matches (handle semicolon-separated values)
                const values = String(attrValue || '').split(';').map(v => v.trim());
                if (values.includes(decodedValue)) {
                  const abstractionId = row[0];
                  
                  // Get perspectives for this comment
                  const perspectivesResult = db.exec(`
                    SELECT 
                      p.perspective,
                      p.excerpt,
                      p.taxonomy_code,
                      t.description
                    FROM perspectives p
                    JOIN taxonomy_ref t ON p.taxonomy_code = t.code
                    WHERE p.abstraction_id = ?
                  `, [abstractionId]);

                  const perspectives = perspectivesResult && perspectivesResult[0] 
                    ? perspectivesResult[0].values.map(pRow => ({
                        perspective: pRow[0] as string,
                        excerpt: pRow[1] as string,
                        taxonomy_code: pRow[2] as string,
                        theme_description: pRow[3] as string
                      }))
                    : [];

                  // Get unique themes
                  const themes = [...new Set(perspectives.map(p => p.taxonomy_code))];

                  const originalMetadata = row[6] ? JSON.parse(row[6] as string) : {};
                  
                  matchingComments.push({
                    id: Number(abstractionId),
                    document_id: row[1] as string,
                    submitter_type: row[2] as string,
                    organization_name: row[3] as string | null,
                    perspectives: perspectives.slice(0, 3), // Show first 3
                    perspective_count: perspectives.length,
                    themes,
                    word_count: Number(row[5]),
                    original_metadata: originalMetadata
                  });
                }
              } catch (e) {
                // Skip invalid JSON
              }
            });
          }
        }

        setComments(matchingComments);
      } catch (error) {
        console.error('Error loading comments:', error);
        setComments([]);
      }
      setLoading(false);
    }
  }, [db, mentionType, mentionValue]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner"></div>
      </div>
    );
  }

  const displayMentionType = mentionType?.replace(/_/g, ' ') || '';
  const displayMentionValue = decodeURIComponent(mentionValue || '');

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap">
        <Link to="/" className="hover:text-primary-600">Home</Link>
        <span>/</span>
        <span className="text-gray-500">Mentions</span>
        <span>/</span>
        <span className="text-gray-900 font-medium">{displayMentionType}: {displayMentionValue}</span>
      </div>

      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          {displayMentionType}: {displayMentionValue}
        </h1>
        <p className="text-gray-600 mt-2">
          {comments.length} comments with this mention
        </p>
      </div>

      {/* Comments List */}
      <div className="space-y-12">
        {comments.map((comment) => (
          <Link 
            key={comment.id} 
            to={`/comment/${comment.id}`}
            className="block hover:bg-gray-50 -mx-4 px-4 py-6 rounded-lg transition-colors duration-200 group"
          >
            <div className="border-l-4 border-blue-400 pl-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    {getCommenterDisplayName({
                      submitter_type: comment.submitter_type,
                      organization_name: comment.organization_name,
                      original_metadata: comment.original_metadata
                    })}
                  </h3>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 mt-2">
                    <div className="flex items-center gap-1.5">
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span>{comment.submitter_type}</span>
                      {comment.original_metadata?.category && (
                        <span className="text-xs text-gray-500">
                          ({comment.original_metadata.category})
                        </span>
                      )}
                    </div>
                    <span className="text-gray-300">•</span>
                    <div className="flex items-center gap-1.5">
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span>{comment.word_count.toLocaleString()} words</span>
                    </div>
                  </div>
                </div>
                <svg className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>

              {/* Perspectives */}
              {comment.perspectives.length > 0 && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-900">
                      Key Perspectives
                      <span className="text-sm font-normal text-gray-500 ml-2">
                        ({comment.perspective_count} total)
                      </span>
                    </h4>
                    {comment.perspective_count > 3 && (
                      <span className="text-xs text-gray-500">
                        +{comment.perspective_count - 3} more
                      </span>
                    )}
                  </div>
                  
                  <div className="space-y-8">
                    {comment.perspectives.map((perspective, idx) => (
                      <div key={idx} className="ml-4">
                        <div className="font-semibold text-gray-900 mb-3 text-lg leading-tight">
                          {perspective.perspective}
                        </div>
                        <div className="ml-4 mb-4">
                          <blockquote className="text-gray-700 italic leading-relaxed">
                            "{perspective.excerpt}"
                          </blockquote>
                        </div>
                        <div className="mt-3 text-sm text-gray-600">
                          Theme: {perspective.taxonomy_code} - {perspective.theme_description}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Theme pills */}
              {comment.themes.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-6">
                  {comment.themes.map(theme => (
                    <span
                      key={theme}
                      className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full"
                    >
                      {theme}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>

      {comments.length === 0 && (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-12 text-center">
          <div className="text-gray-500">
            <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-lg">No comments found with this mention</p>
            <p className="text-sm mt-2">Try searching for a different value</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default MentionFilterPage;
