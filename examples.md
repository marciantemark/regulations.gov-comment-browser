# Pipeline Example Outputs

This document shows actual outputs from each stage of the pipeline.

## Stage 1: Generate Taxonomy

### Input: Multiple comment files
```
./comments/
├── comment_001.txt
├── comment_002.txt
├── comment_003.txt
└── ...
```

### Output: final_taxonomy.md
```markdown
=== THEME TAXONOMY ===

GUIDANCE FOR DATA ABSTRACTORS:
- Code to the most specific level (e.g., use 2.1.3 not just 2.1)
- Multiple codes may apply to a single comment
- Focus on substantive points rather than rhetorical flourishes

1 Patient & Caregiver Empowerment
• Perspective: Patients need unified access to all their health data
  - Excerpt: "I have to log into 7 different portals" (Individual Patient)
  - Excerpt: "We need one dashboard for everything" (Patient Advocacy Group)

1.1 Digital Access Barriers
• Perspective: Rural populations lack connectivity
  - Excerpt: "40% of our patients have no broadband" (Rural Health Clinic)

1.2 Trust and Privacy Concerns

2 Provider Workflow Integration

2.1 Documentation Burden
• Perspective: Current systems increase workload
  - Excerpt: "2 hours documenting for 1 hour with patients" (Primary Care MD)

2.2 Interoperability Challenges

2.2.1 Technical Standards
2.2.2 Regulatory Barriers

3 Technical Infrastructure

3.1 TEFCA Implementation
• Perspective: Mandatory participation essential
  - Excerpt: "Voluntary has failed for 20 years" (Epic Systems)

=== OBSERVED ATTRIBUTES ===
Submitter Types: Individual Patient, Healthcare Provider Organization, EHR Vendor, Health Plan, Patient Advocacy Group
Market Segments: Acute Care, Ambulatory Care, Health IT, Payer Operations
Geographic Scopes: Local, Regional, Multi-State, National
Sentiment Types: Strongly Supportive, Cautiously Optimistic, Neutral, Concerned, Critical
```

## Stage 2: Abstract Comments

### Input: Single comment file
```
Subject: Support for TEFCA with Implementation Concerns

As CEO of Regional Health Network, I strongly support mandatory TEFCA 
participation. However, small rural hospitals in our network need at 
least 5 years to implement and will require federal funding support.
```

### Output: Database entries

**abstractions table:**
| id | filename | submitter_type | organization_name | market_segment | regulatory_stance |
|----|----------|----------------|-------------------|----------------|-------------------|
| 1 | comment_001.txt | Healthcare Provider Organization | Regional Health Network | Acute Care | Strongly Supportive |

**perspectives table:**
| id | abstraction_id | taxonomy_code | perspective | excerpt | sentiment |
|----|----------------|---------------|-------------|---------|-----------|
| 1 | 1 | 3.1 | Support for mandatory TEFCA with timeline concerns | "strongly support mandatory TEFCA participation" | Strongly Supportive |
| 2 | 1 | 3.1 | Small hospitals need extended implementation time | "small rural hospitals... need at least 5 years" | Concerned |

## Stage 3: Discover Axes

### Input: All perspectives for theme 3.1
```
1. [EHR Vendor - Epic Systems]
   Viewpoint: Mandatory TEFCA needed immediately
   Evidence: "Voluntary has failed for 20 years"

2. [Healthcare Provider - Regional Health Network]
   Viewpoint: Support mandatory but need 5 years
   Evidence: "small rural hospitals need at least 5 years"

3. [Patient Advocacy - Patient Rights Coalition]
   Viewpoint: Every delay costs lives
   Evidence: "patients suffer every day we wait"
[... more perspectives ...]
```

### Output: Discovered axes

**theme_axes table:**
| theme_code | axis_name | axis_question |
|------------|-----------|---------------|
| 3.1 | Implementation Timeline | When and how quickly should TEFCA be implemented? |
| 3.1 | Funding Responsibility | Who should pay for implementation? |

**axis_positions table:**
| axis_id | position_key | position_label | position_description |
|---------|--------------|----------------|----------------------|
| 1 | immediate_mandate | Immediate mandate | Required within 12 months |
| 1 | phased_rollout | Phased by size | Large first, small get 3+ years |
| 1 | voluntary | Voluntary adoption | No mandates, market-driven |

## Stage 4: Classify Positions

### Input: Perspective + Axis
```
Perspective: "Small hospitals need extended implementation time"
Axis: Implementation Timeline
Positions: [Immediate, Phased, Voluntary]
```

### Output: Classification

**perspective_positions table:**
| perspective_id | axis_id | position_id | confidence | reasoning |
|----------------|---------|-------------|------------|-----------|
| 2 | 1 | 2 | high | Explicitly requests 5+ years for small hospitals, aligning with phased rollout |

## Final Analysis Outputs

### Debate Summary
```
Theme 3.1: TEFCA Implementation Timeline
  Immediate mandate (23) vs Phased rollout (31)
  Status: ⚡ Highly Contested
```

### Stakeholder Alignment
```
Healthcare Providers on Implementation Timeline:
  - 78% support Phased rollout
  - 15% support Voluntary adoption
  - 7% support Immediate mandate

EHR Vendors on Implementation Timeline:
  - 71% support Immediate mandate
  - 24% support Phased rollout
  - 5% support Voluntary adoption
```

### Coalition Discovery
```
Coalition: Rural Providers + Small Practices
Common Position Profile:
  - Timeline: Phased rollout
  - Funding: Government subsidized
  - Scope: Start with critical data only
Members: 47 organizations
```

### Missing Voices
```
Theme 3.1 - Implementation Timeline - Voluntary adoption
Missing stakeholders: Patient Advocacy Groups, Individual Patients
(No patient representatives support voluntary approach)
```

## Query Result Examples

### Most Contested Debates
| Theme | Axis | Side 1 | Side 2 | Status |
|-------|------|--------|--------|--------|
| 3.1 | Implementation Timeline | Immediate (23) | Phased (31) | ⚡ Highly Contested |
| 2.1 | AI Documentation Role | Full automation (18) | Human required (21) | ⚡ Highly Contested |
| 1.2 | Mental Health Access | Unrestricted (28) | Clinician-mediated (19) | 🔥 Contested |

### Unusual Alliances
| Theme | Position | Alliance | Combined Support |
|-------|----------|----------|------------------|
| 3.1 | Government funding | Patient Groups + Rural Providers | 67 |
| 2.2 | Open standards | EHR Vendors + Patient Advocacy | 43 |
| 1.2 | Consent granularity | Health Plans + Privacy Advocates | 38 |
