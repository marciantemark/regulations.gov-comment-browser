-- Comprehensive analysis queries for taxonomy and position data

-- ========================================
-- BASIC OVERVIEW QUERIES
-- ========================================

-- 1. Database summary statistics
SELECT 
    'Documents' as metric, COUNT(*) as count FROM abstractions
UNION ALL
SELECT 'Perspectives', COUNT(*) FROM perspectives
UNION ALL
SELECT 'Themes Used', COUNT(DISTINCT taxonomy_code) FROM perspectives
UNION ALL
SELECT 'Axes Discovered', COUNT(*) FROM theme_axes
UNION ALL
SELECT 'Positions Defined', COUNT(*) FROM axis_positions
UNION ALL
SELECT 'Position Classifications', COUNT(*) FROM perspective_positions;

-- 2. Theme hierarchy with usage statistics
SELECT 
    CASE level 
        WHEN 1 THEN code || ' ' || description
        WHEN 2 THEN '  ' || code || ' ' || description
        WHEN 3 THEN '    ' || code || ' ' || description
        ELSE '      ' || code || ' ' || description
    END as theme,
    perspective_count,
    document_count
FROM theme_coverage
ORDER BY code;

-- 3. Submitter type distribution
SELECT 
    submitter_type,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as percent,
    GROUP_CONCAT(DISTINCT organization_name) as example_orgs
FROM abstractions
GROUP BY submitter_type
ORDER BY count DESC;

-- ========================================
-- POSITION ANALYSIS QUERIES
-- ========================================

-- 4. Discovered axes and positions overview
SELECT 
    ta.theme_code,
    t.description as theme,
    ta.axis_name,
    ta.axis_question,
    GROUP_CONCAT(
        ap.position_label || ' (' || ap.example_count || ')',
        ' | '
    ) as positions
FROM theme_axes ta
JOIN taxonomy_ref t ON ta.theme_code = t.code
JOIN axis_positions ap ON ta.id = ap.axis_id
GROUP BY ta.id
ORDER BY ta.theme_code;

-- 5. Most contested debates (balanced opposing positions)
WITH position_pairs AS (
    SELECT 
        ta.theme_code,
        ta.axis_name,
        ap1.position_label as position_1,
        ap2.position_label as position_2,
        ap1.example_count as count_1,
        ap2.example_count as count_2,
        ABS(ap1.example_count - ap2.example_count) as balance_score
    FROM theme_axes ta
    JOIN axis_positions ap1 ON ta.id = ap1.axis_id
    JOIN axis_positions ap2 ON ta.id = ap2.axis_id
    WHERE ap1.id < ap2.id
    AND ap1.example_count > 5
    AND ap2.example_count > 5
)
SELECT 
    theme_code,
    axis_name,
    position_1 || ' (' || count_1 || ')' as side_1,
    position_2 || ' (' || count_2 || ')' as side_2,
    CASE 
        WHEN balance_score < 5 THEN '⚡ Highly Contested'
        WHEN balance_score < 15 THEN '🔥 Contested'
        ELSE '📊 Imbalanced'
    END as debate_intensity
FROM position_pairs
ORDER BY balance_score ASC
LIMIT 20;

-- 6. Stakeholder alignment matrix
SELECT 
    submitter_type,
    theme_code || ': ' || axis_name as issue,
    position_label,
    count || ' (' || percent || '%)' as support
FROM stakeholder_alignment
WHERE count >= 3
ORDER BY submitter_type, theme_code, percent DESC;

-- 7. Consensus positions (>70% agreement)
SELECT 
    theme_code,
    axis_name,
    position_label,
    supporter_count,
    org_count,
    percent || '%' as consensus_level,
    '✅ Strong Consensus' as status
FROM position_dominance
WHERE percent > 70
ORDER BY percent DESC;

-- 8. Position classification confidence
SELECT 
    confidence,
    COUNT(*) as count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as percent
FROM perspective_positions
GROUP BY confidence
ORDER BY 
    CASE confidence 
        WHEN 'high' THEN 1 
        WHEN 'medium' THEN 2 
        WHEN 'low' THEN 3 
    END;

-- ========================================
-- COALITION AND ALIGNMENT QUERIES
-- ========================================

-- 9. Unusual alliances (different stakeholders, same position)
WITH stakeholder_positions AS (
    SELECT 
        ta.theme_code,
        ta.axis_name,
        ap.position_label,
        a.submitter_type,
        COUNT(*) as count
    FROM perspective_positions pp
    JOIN perspectives p ON pp.perspective_id = p.id
    JOIN abstractions a ON p.abstraction_id = a.id
    JOIN theme_axes ta ON pp.axis_id = ta.id
    JOIN axis_positions ap ON pp.position_id = ap.id
    WHERE pp.confidence IN ('high', 'medium')
    GROUP BY ta.id, ap.id, a.submitter_type
    HAVING count >= 2
)
SELECT 
    sp1.theme_code,
    sp1.axis_name,
    sp1.position_label,
    sp1.submitter_type || ' + ' || sp2.submitter_type as alliance,
    sp1.count + sp2.count as combined_support
FROM stakeholder_positions sp1
JOIN stakeholder_positions sp2 
    ON sp1.theme_code = sp2.theme_code
    AND sp1.axis_name = sp2.axis_name
    AND sp1.position_label = sp2.position_label
    AND sp1.submitter_type < sp2.submitter_type
WHERE sp1.submitter_type != sp2.submitter_type
ORDER BY combined_support DESC
LIMIT 15;

-- 10. Multi-axis position profiles (coalitions)
WITH position_profiles AS (
    SELECT 
        a.id as abstraction_id,
        a.organization_name,
        a.submitter_type,
        GROUP_CONCAT(
            ta.axis_name || ': ' || ap.position_label,
            ' | '
        ) as position_profile
    FROM perspective_positions pp
    JOIN perspectives p ON pp.perspective_id = p.id
    JOIN abstractions a ON p.abstraction_id = a.id
    JOIN theme_axes ta ON pp.axis_id = ta.id
    JOIN axis_positions ap ON pp.position_id = ap.id
    WHERE pp.confidence IN ('high', 'medium')
    GROUP BY a.id
)
SELECT 
    submitter_type,
    position_profile,
    COUNT(*) as count,
    GROUP_CONCAT(organization_name, ', ') as organizations
FROM position_profiles
GROUP BY submitter_type, position_profile
HAVING count > 1
ORDER BY count DESC
LIMIT 20;

-- ========================================
-- MISSING VOICES AND GAPS
-- ========================================

-- 11. Missing voices by position
WITH expected_stakeholders AS (
    SELECT DISTINCT submitter_type FROM abstractions
),
position_coverage AS (
    SELECT 
        ta.id as axis_id,
        ap.id as position_id,
        ta.theme_code,
        ta.axis_name,
        ap.position_label,
        a.submitter_type,
        COUNT(*) as count
    FROM perspective_positions pp
    JOIN perspectives p ON pp.perspective_id = p.id
    JOIN abstractions a ON p.abstraction_id = a.id
    JOIN theme_axes ta ON pp.axis_id = ta.id
    JOIN axis_positions ap ON pp.position_id = ap.id
    GROUP BY ta.id, ap.id, a.submitter_type
)
SELECT 
    ta.theme_code,
    ta.axis_name,
    ap.position_label,
    GROUP_CONCAT(
        CASE 
            WHEN pc.submitter_type IS NULL 
            THEN es.submitter_type 
        END, ', '
    ) as missing_stakeholders
FROM theme_axes ta
CROSS JOIN axis_positions ap
CROSS JOIN expected_stakeholders es
LEFT JOIN position_coverage pc
    ON ta.id = pc.axis_id
    AND ap.id = pc.position_id
    AND es.submitter_type = pc.submitter_type
WHERE ap.axis_id = ta.id
GROUP BY ta.id, ap.id
HAVING missing_stakeholders IS NOT NULL
ORDER BY ta.theme_code;

-- 12. Themes lacking axis discovery (need more perspectives)
SELECT 
    t.code,
    t.description,
    tc.perspective_count,
    CASE 
        WHEN tc.perspective_count < 5 THEN 'Need ' || (5 - tc.perspective_count) || ' more perspectives'
        ELSE 'Ready for axis discovery'
    END as status
FROM taxonomy_ref t
JOIN theme_coverage tc ON t.code = tc.code
LEFT JOIN theme_axes ta ON t.code = ta.theme_code
WHERE ta.id IS NULL
AND tc.perspective_count > 0
ORDER BY tc.perspective_count DESC;

-- ========================================
-- DETAILED PERSPECTIVE ANALYSIS
-- ========================================

-- 13. Sample perspectives by position
SELECT 
    ta.theme_code,
    ta.axis_name,
    ap.position_label,
    a.organization_name,
    a.submitter_type,
    p.excerpt,
    pp.confidence,
    pp.reasoning
FROM perspective_positions pp
JOIN perspectives p ON pp.perspective_id = p.id
JOIN abstractions a ON p.abstraction_id = a.id
JOIN theme_axes ta ON pp.axis_id = ta.id
JOIN axis_positions ap ON pp.position_id = ap.id
WHERE ta.theme_code = '3.1'  -- Change to explore different themes
    AND pp.confidence = 'high'
ORDER BY ap.position_label, a.submitter_type
LIMIT 20;

-- 14. Position reasoning patterns
SELECT 
    ta.axis_name,
    ap.position_label,
    SUBSTR(pp.reasoning, 1, 100) || '...' as reasoning_preview,
    COUNT(*) as frequency
FROM perspective_positions pp
JOIN theme_axes ta ON pp.axis_id = ta.id
JOIN axis_positions ap ON pp.position_id = ap.id
WHERE pp.confidence = 'high'
GROUP BY ta.axis_name, ap.position_label, reasoning_preview
HAVING frequency > 1
ORDER BY frequency DESC;

-- ========================================
-- EXPORT QUERIES
-- ========================================

-- 15. Export for visualization (position network)
SELECT 
    'org_' || a.id as source_id,
    a.organization_name || ' (' || a.submitter_type || ')' as source_label,
    'pos_' || ap.id as target_id,
    ta.theme_code || ': ' || ap.position_label as target_label,
    pp.confidence as edge_weight
FROM perspective_positions pp
JOIN perspectives p ON pp.perspective_id = p.id
JOIN abstractions a ON p.abstraction_id = a.id
JOIN theme_axes ta ON pp.axis_id = ta.id
JOIN axis_positions ap ON pp.position_id = ap.id
WHERE a.organization_name IS NOT NULL
    AND pp.confidence IN ('high', 'medium');

-- 16. Debate summary for report
SELECT 
    ds.theme_code,
    ds.theme_desc,
    ds.axis_name,
    ds.axis_question,
    ds.total_perspectives,
    GROUP_CONCAT(
        ap.position_label || ': ' || ap.example_count,
        ' vs '
    ) as position_breakdown
FROM debate_summary ds
JOIN axis_positions ap ON ap.axis_id = (
    SELECT id FROM theme_axes WHERE theme_code = ds.theme_code AND axis_name = ds.axis_name
)
GROUP BY ds.theme_code, ds.axis_name
ORDER BY ds.total_perspectives DESC;
