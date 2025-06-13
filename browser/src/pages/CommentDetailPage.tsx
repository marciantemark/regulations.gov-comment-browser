import React, { useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useDatabase } from '../database/provider';
import { getCommenterDisplayName } from '../utils/commenterDisplay';

interface CommentDetail {
  id: number;
  document_id: string;
  submitter_type: string;
  organization_name: string | null;
  content: string;
  word_count: number;
  perspectives: Array<{
    id: number;
    perspective: string;
    excerpt: string;
    taxonomy_code: string;
    theme_description: string;
    sentiment: string | null;
  }>;
  attributes: Record<string, string>;
  original_metadata: {
    category?: string;
    organization?: string;
    firstName?: string;
    lastName?: string;
    country?: string;
    stateProvinceRegion?: string;
    receiveDate?: string;
    postedDate?: string;
    trackingNbr?: string;
    documentType?: string;
    subtype?: string;
  };
}

const CommentDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { db } = useDatabase();
  const location = useLocation();
  const [comment, setComment] = useState<CommentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [highlightId, setHighlightId] = useState<number | null>(null);

  useEffect(() => {
    if (db && id) {
      setLoading(true);
      try {
        // Get abstraction details
        const result = db.exec(`
          SELECT 
            a.id,
            a.filename,
            a.submitter_type,
            a.organization_name,
            a.content,
            a.attributes_json,
            CASE 
              WHEN a.content IS NOT NULL 
              THEN (LENGTH(a.content) - LENGTH(REPLACE(a.content, ' ', '')) + 1)
              ELSE 0 
            END as word_count,
            a.original_metadata_json
          FROM abstractions a
          WHERE a.id = ?
        `, [id]);

        if (!result || result.length === 0 || result[0].values.length === 0) {
          setComment(null);
          setLoading(false);
          return;
        }

        const row = result[0].values[0];
        const attributes = row[5] ? JSON.parse(row[5] as string) : {};
        const originalMetadata = row[7] ? JSON.parse(row[7] as string) : {};

        // Get all perspectives for this comment
        const perspectivesResult = db.exec(`
          SELECT 
            p.id,
            p.perspective,
            p.excerpt,
            p.taxonomy_code,
            t.description,
            p.sentiment
          FROM perspectives p
          JOIN taxonomy_ref t ON p.taxonomy_code = t.code
          WHERE p.abstraction_id = ?
          ORDER BY p.taxonomy_code
        `, [id]);

        const perspectives = perspectivesResult && perspectivesResult[0] 
          ? perspectivesResult[0].values.map(pRow => ({
              id: Number(pRow[0]),
              perspective: pRow[1] as string,
              excerpt: pRow[2] as string,
              taxonomy_code: pRow[3] as string,
              theme_description: pRow[4] as string,
              sentiment: pRow[5] as string | null
            }))
          : [];

        setComment({
          id: Number(row[0]),
          document_id: row[1] as string,
          submitter_type: row[2] as string,
          organization_name: row[3] as string | null,
          content: row[4] as string,
          word_count: Number(row[6]),
          perspectives,
          attributes,
          original_metadata: originalMetadata
        });
      } catch (error) {
        console.error('Error loading comment:', error);
        setComment(null);
      }
      setLoading(false);
    }
  }, [db, id]);

  // watch query param p for highlight
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const pVal = params.get('p');
    if (pVal) {
      const pid = parseInt(pVal);
      if (!isNaN(pid)) setHighlightId(pid);
    } else {
      // fallback to hash style
      if (window.location.hash.startsWith('#p')) {
        const pid = parseInt(window.location.hash.replace('#p',''));
        if (!isNaN(pid)) { setHighlightId(pid); return; }
      }
      setHighlightId(null);
    }
  }, [location.search]);

  // Scroll to highlighted perspective when ready
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`p${highlightId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightId, comment]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner"></div>
      </div>
    );
  }

  if (!comment) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Comment not found.</p>
        <Link to="/" className="text-primary-600 hover:text-primary-700 mt-4 inline-block">
          ← Back to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="space-y-4">
        <div>
          <Link to="/" className="text-primary-600 hover:text-primary-700 mb-2 inline-block">
            ← Back to Home
          </Link>
        </div>
        
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {getCommenterDisplayName({
              submitter_type: comment.submitter_type,
              organization_name: comment.organization_name,
              original_metadata: comment.original_metadata
            })}
          </h1>
          <div className="text-gray-600 flex items-center gap-4 flex-wrap mb-4">
            <span className="flex items-center gap-2">
              <span className="font-medium">Type:</span>
              <span>{comment.submitter_type}</span>
              {comment.original_metadata.category && (
                <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                  Original: {comment.original_metadata.category}
                </span>
              )}
            </span>
            {(comment.organization_name || comment.original_metadata.organization) && (
              <>
                <span>•</span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">Organization:</span>
                  <span>{comment.organization_name || comment.original_metadata.organization}</span>
                </span>
              </>
            )}
            {comment.original_metadata.stateProvinceRegion && (
              <>
                <span>•</span>
                <span>{comment.original_metadata.stateProvinceRegion}, {comment.original_metadata.country || 'USA'}</span>
              </>
            )}
            <span>•</span>
            <span>Document: {comment.document_id}</span>
            <span>•</span>
            <span>{comment.word_count.toLocaleString()} words</span>
          </div>
          
          {/* Regulations.gov Link */}
          <button
            onClick={() => window.open(`https://www.regulations.gov/comment/${comment.document_id}`, '_blank')}
            style={{
              marginTop: '16px',
              display: 'block',
              width: 'fit-content',
              padding: '10px 16px',
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: '500',
              fontSize: '15px',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#2563eb';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#3b82f6';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg style={{ width: '18px', height: '18px', minWidth: '18px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span style={{ whiteSpace: 'nowrap' }}>View on Regulations.gov ({comment.word_count.toLocaleString()} words)</span>
            </div>
          </button>
        </div>
      </div>

      {/* Mentions */}
      {Object.keys(comment.attributes).length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Mentions</h2>
          <dl className="space-y-3">
            {Object.entries(comment.attributes).map(([key, value]) => {
              // Skip null, undefined, or empty values
              if (!value || value === 'null' || value === '') return null;
              
              return (
                <div key={key} className="flex items-start">
                  <dt className="text-sm text-gray-500 capitalize w-48 flex-shrink-0">
                    {key.replace(/_/g, ' ')}:
                  </dt>
                  <dd className="text-sm flex-1">
                    {String(value).split(';').map((v, idx) => {
                      const trimmedValue = v.trim();
                      if (!trimmedValue || trimmedValue === 'null') return null;
                      
                      return (
                        <span key={idx}>
                          {idx > 0 && <span className="text-gray-400 mx-1">•</span>}
                          <Link
                            to={`/mention/${key}/${encodeURIComponent(trimmedValue)}`}
                            className="text-primary-600 hover:text-primary-700 hover:underline"
                          >
                            {trimmedValue}
                          </Link>
                        </span>
                      );
                    })}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}

      {/* All Perspectives */}
      {comment.perspectives.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Perspectives ({comment.perspectives.length})
          </h2>
          <div className="space-y-4">
            {comment.perspectives.map((perspective, idx) => (
              <div 
                key={idx} 
                id={`p${perspective.id}`} 
                className={`border-l-4 pl-4 transition-colors ${highlightId===perspective.id ? 'highlight-card' : 'border-primary-400'}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-gray-800 flex-1">
                    {perspective.perspective}
                  </h3>
                  <div className="flex items-center gap-2">
                    {perspective.sentiment && (
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        perspective.sentiment === 'supportive' 
                          ? 'bg-green-100 text-green-700'
                          : perspective.sentiment === 'critical'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {perspective.sentiment}
                      </span>
                    )}
                    <Link 
                      to={`/theme/${perspective.taxonomy_code}`}
                      className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                      title={perspective.theme_description}
                    >
                      {perspective.taxonomy_code} →
                    </Link>
                  </div>
                </div>
                <blockquote className="text-sm text-gray-600 italic bg-gray-50 p-3 rounded">
                  "{perspective.excerpt}"
                </blockquote>
                <div className="text-xs text-gray-500 mt-1">
                  Theme: {perspective.theme_description}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CommentDetailPage;
